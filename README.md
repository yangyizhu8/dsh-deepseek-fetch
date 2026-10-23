# dsh-deepseek-fetch

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的**网页抓取插件**：输入网址，把页面变成干净的 Markdown 落到指定目录；SPA / 文档站还能额外产出「正文 + 跨页截图 + manifest」素材包，供 agent 用自带视觉能力做图文合并。

- 工具名：`deepseek_fetch`
- 版本：**0.5.0**
- 形态：纯工具插件（**无 UI**）

## 能力一览

| 用法 | 说明 |
|---|---|
| `抓取 <网址>` | 调 DeepSeek Fetch API 取正文 → 纯 Markdown（无 front matter、无来源行） |
| `抓取 <网址> 的整个子页（深度1，最多3页）` | 同域 BFS 发现子链接 → 合并成单个 md（含「未抓取清单」） |
| `抓取 <金山文档/SPA 网址>，要图和正文` | `render:true` → 素材包：正文 md + 逐屏截图 + manifest |
| `抓取 <网址> 要图和正文，每屏等 2.5 秒，最多 20 张` | `render_settle_ms` + `max_shots`（预算自动联动） |

## 工具参数（10 键）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `url` | string | 必填 | 目标网址（http/https） |
| `output_dir` | string | `C:\deepseek网页抓取` | 落盘目录（相对路径按会话工作区解析） |
| `clean` | boolean | `true` | 剥离 Markdown 反斜杠转义 |
| `children` | boolean | `false` | 同域子页合并抓取 |
| `max_depth` | integer | `2` | `children` 时的 BFS 深度（0–5） |
| `max_pages` | integer | `30` | `children` 时的总页数上限（1–200） |
| `render` | boolean | `false` | 走渲染素材通道（文字 + 截图 + manifest） |
| `text_source` | enum | `auto` | `auto` / `api` / `render`；`auto` 按 canvas 占比、编辑器噪声标记、API 文本过短三条判据择源 |
| `max_shots` | integer | `40` | 截图张数上限（1–100） |
| `render_settle_ms` | integer | 不传=用 Config | 每屏滚动后等待毫秒（0–5000），**总预算自动联动** |

## 渲染素材通道（`render:true`）

只在 Windows 上可用（依赖本机 Microsoft Edge + CDP）：

1. **两阶段视口**：先用 1440×2400 取正文（文档站正文要等页面渲染进 DOM），再切回 1440×900 逐屏截图；
2. **对齐「滚动容器」而非窗口**——WebOffice 类站点的可滚元素不是 `documentElement`；
3. **取窗口内最长的一份正文**（渲染存在「平台期」，连续两次长度相同不等于稳定）+ 滚动后**复读一次**取更长者；
4. **浮层剥离**：每屏截图前把覆盖型浮层从 DOM 移除（五重约束，见下），避免登录浮层遮挡内容与污染帧间比较；
5. **感知哈希去重**：sha1 快路径 + dHash 预筛 + 32×32 灰度 MAD 复核，**安全侧优先**（宁可多留帧，不误删内容）；
6. 产出：`<基名>.md`、`<基名>.shots/NN.png`、`<基名>.manifest.json`（含 `text_source`、`overlays_stripped`、`shots_deduped`、`dedup_method`、实际生效的 `render_settle_ms` / `render_timeout_ms`）。

**返回的合并指引**约定形态：由 **agent 用自身视觉能力**读截图 → 把图内内容文字化 → 与正文合并成终稿。插件**不调用任何视觉 API**、不做 OCR。

### 浮层剥离的五重约束（缺一不剥）

| # | 约束 | 作用 |
|---|---|---|
| ① | class 含 `popup`/`modal`/`mask`/`overlay`/`dialog`/`guide`（忽略大小写） | 命中命名惯例 |
| ② | `getBoundingClientRect()` 面积 ≥ **85%** 视口 | 只剥"覆盖全屏"的层，不动局部气泡 |
| ③ | 元素**子树** `textContent` < **300 字** | 保护正文容器（子树的隐藏在浮层祖先中 → 安全方向漏剥） |
| ④ | 标签非 `CANVAS` / `IFRAME` | 绝不动正文渲染载体 |
| ⑤ | computed `position` ∈ `fixed`/`absolute`/`sticky` | 不动文档流内的同名短区块 |

实测（kdocs 文档站）命中 4 个：三个全屏 `fixed` 遮罩/覆盖容器 + 一个 `absolute` 登录弹窗壳。

## Config（插件 schema，18 字段）

除通用项（`defaultOutputDir` / `endpoint` / `timeoutMs` / `retries` / `defaultClean` / `apiKeyEnv` / `apiKey` / `childrenConcurrency` / `childrenTimeoutMs` / `respectRobots` / `htmlUserAgent` / `edgePath`）外，渲染相关：

| 字段 | 默认 | 说明 |
|---|---|---|
| `renderTimeoutMs` | 90000 | 渲染总预算（5000–600000） |
| `renderViewport` | `1440x900` | 截图视口 |
| `renderTextViewport` | `1440x2400` | 取正文用的高视口 |
| `renderSettleMs` | 700 | 每屏等待缺省值（可被 `render_settle_ms` 覆盖） |
| `renderScrollOverlap` | 60 | 滚动步长 = 视口高 − 该值 |
| `renderStripOverlays` | **true** | 是否剥离覆盖型浮层；设 `false` 即完全退回 0.4.0 行为 |

**预算联动**：传 `render_settle_ms` 时，实际总预算 = `clamp(max(Config.renderTimeoutMs, ⌈max_shots × settle × 1.6⌉ + 20000), 5000, 600000)`——只增不减，实际值在返回值与 manifest 回显。

## 安装

```bash
# 1) 克隆到本机
git clone https://github.com/yangyizhu8/dsh-deepseek-fetch.git D:/dsh-sync/packages/dsh-deepseek-fetch

# 2) 在 profile（本机为 ~/.dsh/profiles/web/package.json）里声明 link 依赖
#    dependencies:        "@dsh-external/dsh-deepseek-fetch": "link:D:/dsh-sync/packages/dsh-deepseek-fetch/bundle"
#    dsh.profile.bundles: 追加 "@dsh-external/dsh-deepseek-fetch"

# 3) 重启 DSH（或运行时注入）
```

**依赖**：DSH 侧 `@deepseek-ai/dsh-tools` / `cordis` / `schemastery`（peer）；**无第三方 npm 依赖**（PNG 解码走 Node 内置 `zlib`）。渲染通道需 Windows + Microsoft Edge。

**凭据**：DeepSeek API Key 三级解析（`Config.apiKey` → `apiKeyEnv` 指定的进程环境变量 → Windows 用户级环境变量）。渲染通道（`render:true`）全程不触 API，不需要 Key。

## 卸载

从 profile 的 `dependencies` 与 `dsh.profile.bundles` 移除对应项后重启；或运行时用 super-injector 的 `dev_uninject_plugin`。插件只注册 1 个工具、1 条 loader entry，无路由/定时器/slot。

## 已知限制

| 项 | 说明 |
|---|---|
| 渲染通道仅 Windows | 依赖本机 Edge + CDP（`--headless=new`、临时 profile、随机端口、自建自杀） |
| 浮层剥离是启发式 | 依赖 class 命名与定位；无语义 class 的浮层剥不到（行为退回 0.4.0），属安全方向 |
| 去重偏保守 | 加固后仅命中"几乎完全相同"的帧；真实素材上常见丢弃数 0（误删不可逆，宁可多留） |
| 每屏一次全量 DOM 扫描 | 超大 DOM 页面为 O(N)，预算吃紧时可能推成 `E_RENDER_TIMEOUT` |
| 页面 JS 可访问内网 | 渲染通道会把页面脚本跑在本机浏览器里 |
| robots 通配支持有限 | 仅处理 `User-agent: *` 与 `Disallow:` 的常见形态 |

## 目录

```
bundle/            插件包（src/ + scripts/ 19 个断言 + lib/ 构建产物 + cordis.patch.yml）
preset/            预设配置（agent.cordis.yml / preset.yml）
Plugin-Spec.md     需求规格（v0.6，含 FR-1~FR-15）
Plugin-Design.md   设计（v0.6，§17 为第五批增量）
DEV-PLAN.md        开发计划（v1.2，§13 为第五批）
SHIPPABLE.md       验收报告（v0.7）
PIPELINE-STATE.md  流水线状态台账
evidence/          10 份实测证据（API 探针 / 各批自验 / 根因定位）
diagrams/          5 张结构图（archify，四门 PASS）
workorders/        5 份外部委派工单（含机检）+ 可复现探针脚本
```

## 开发

```bash
cd bundle
export DSH_CHECKOUT=/path/to/deepseek-harness
bash scripts/build.sh          # tsc 编译 src → lib
node scripts/verify.mjs        # 23 项门禁（任一失败即 exit≠0）
node scripts/assert-strip.mjs  # 浮层剥离器专项
```

**同步规则**：本仓为发布源；上游编辑发生在本地工作副本，按「工作副本 → 提交 → 克隆 `git pull`」单向流动，避免两处分叉。

## License

MIT
