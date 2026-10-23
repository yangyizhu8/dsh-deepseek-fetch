# SHIPPABLE — dsh-deepseek-fetch（阶段05 验收报告 v0.3 = P0 v0.2 + P1 增量）

- 插件版本：**P0 v0.1.0**（§1~§7）→ **P1 v0.2.0**（§8）
- 日期：2026-10-21
- 验收人：DSH 主侧（构建/门禁/注入链主侧执行）
- **v0.1 已作废**：首版在独立审查返回前出具，审查报回 P1×4 后撤回；v0.2 为修复后重出
- **§1~§7 = P0 轮报告（保持原样）**；**§8 = P1 第二批增量验收**（FR-11 同域子页合并）

## 0. P0 轮摘要（详见 §1~§7）

P0 轮：五阶段全过 → `SHIPPABLE（v0.2）` → 正式装配 web profile（bundles 第 53 条）。P1 轮在其上做**增量**，不改动 P0 已验收行为（回归判据见 §8.2）。
- 立场：默认「有缺陷」，逐项以命令与输出取证

---

## 1. 检查范围与输入

| 类别 | 路径 |
|---|---|
| 需求 | `Plugin-Spec.md` v0.3 |
| 设计 | `Plugin-Design.md` v0.2（v0.1 + 凭据顺序更正）；结构图四门 PASS |
| 计划 | `DEV-PLAN.md` v0.2 |
| 产物 | `bundle/`（16 文件，`src/index.ts` 约 640 行）＋ `preset/`（2 文件） |
| 证据 | `evidence/dev-selftest.md`（阶段04）、`evidence/stage05-review-fixes.md`（本轮修复） |
| UI 基线 | 无（B 分支） |
| 独立审查 | 子代理 `3a316a32…` 只读审查：P0=0 / P1=4 / P2=17 |

环境：Node v24.18.1；checkout `D:/deepseek-harness`；bash = Git Bash；API `https://api.deepseek.com/v1/tools/fetch`。

---

## 2. 逐项检查结果（修复后）

### 2.1 结构合规 —— 通过

| 项 | 证据 | 结论 |
|---|---|---|
| 包结构 | `package.json` / `cordis.patch.yml` / `tsconfig.json` / `src/` / `scripts/` / `lib/` | 通过 |
| 包声明 | `name=@dsh-external/dsh-deepseek-fetch`、`version=0.1.0`、`type=module`、`main=./lib/index.js`、`dsh.bundle.patch=./cordis.patch.yml`（真实存在） | 通过 |
| patch 可解析 | js-yaml 解析 + `check-plugin-ready`：`- insert: [{id: deepseek-fetch, ...}]`，`[PASS] bundle` | 通过 |
| preset 双文件 | `agent.cordis.yml`（裸行列表，与活 preset `client-key-agent` 同构）+ `preset.yml`（name/description） | 通过 |
| service/isolate | 预设无 service 行 → 约束不适用 | 通过（不适用） |

### 2.2 装配与启动 —— 通过（含一处限制）

| 项 | 证据 | 结论 |
|---|---|---|
| 运行时装配 | `dev_inject_plugin` → `OK: … 已注入`；host ✓；client 跳过（预期） | 通过 |
| 状态 | `dev_plugin_status` → `[active] e3d6903e (…) [injected]` | 通过 |
| 无插件树错误 | 注入后宿主持续运行，无 `plugin tree failed` / `duplicate` / `already registered` / `declares no` | 通过 |
| 独立 profile 组合 | `dsh --profile web --dump-config --patch <patch>` → **EXIT=1**：profile 自身缺 `@deepseek-ai/dsh-experimental-agent-team-profile`（与本插件无关） | **部分通过（环境既有缺陷）** |
| 唯一性①loader id | registry 8 条无本插件；装配清单仅一条 | 通过 |
| 唯一性②工具名 | `TOOL_NAME='deepseek_fetch'` 未与 `site_crawl` 等重名 | 通过 |
| 唯一性③slot | `client` 声明 0、`slot` 引用 0 | 通过（不适用） |

### 2.3 功能生效 —— 通过

| 项 | 证据 | 结论 |
|---|---|---|
| 工具进入工具集 | 注入当轮即可见可调用 | 通过 |
| 真实调用 | `deepseek_fetch({url})` → `ok:true`，`C:\deepseek网页抓取\https-api.deepseek.com-v1-tools-fetch.md`，922 字符 | 通过 |
| 修复后真实调用 | lib 直连：`Example-Domain.md`，916 字符，`base_dir` 回显，无 BOM，首行即正文 | 通过 |
| 参数集合 | 恰 `{url, output_dir, clean}`，`required=[url]`；未知键运行期显式拒绝 | 通过 |
| 返回值 | `ok/title/path/bytes/chars/request_id/elapsed_ms/base_dir` | 通过 |

### 2.4 边界与失败路径 —— 通过（8 码 + 并发 + 取消）

| 错误码 | 触发 | 结果 | 落盘 |
|---|---|---|---|
| `E_INVALID_URL` | `not-a-url` / 带凭证 / 超长 / 非 http(s) / 未知参数 | 拒绝 | 无 ✓ |
| `E_NO_KEY` | `apiKeyEnv` 指向不存在变量 + 空 `apiKey` | 返回码正确 | 无 ✓ |
| `E_AUTH` | 无效 Key（真实上游 401） | 返回码正确，上游自掩码 `****test` | 无 ✓ |
| `E_FETCH_FAILED` | 维基百科页（B5 基线） | 返回码 + request_id | 无 ✓ |
| `E_RATE_LIMIT` | 本地桩 429 | 上游命中 1 次（不重试） | 无 ✓ |
| `E_UPSTREAM` | 本地桩 500（`retries=1`） | 命中 2 次；总预算内 | 无 ✓ |
| `E_EMPTY_CONTENT` | 桩返回纯空白 | 返回码正确 | 无 ✓ |
| `E_IO` | `output_dir` 指向已存在文件 / 空串 | 返回码正确 | 无 ✓ |

其它边界：

| 项 | 修复前 | 修复后证据 |
|---|---|---|
| 并发同名（P1-1） | `rename` 可静默覆盖 | 3 并发 → `Stub-Title.md` / `-2` / `-3` 并存，无覆盖、无 `.tmp-*` |
| 相对目录（P1-2） | 落到宿主 cwd | 会话 cwd 为基准：`<session-ws>/notes/`，`base_dir` 回显 |
| 调用方取消（P1-3） | 取消后仍落盘 | 已取消信号 → `E_UPSTREAM`「调用方已取消」，文件数不变 |
| 总预算（P2-5） | 最坏 2×60s | `timeoutMs` 为 总预算，桩 500 + 4s 预算 → 17ms 返回 |
| 围栏状态机（P2-13） | 四反引号内含 ``` 会错位 | 内层保留、其后正文正确剥离 |
| 行内代码（P2-14） | `C:\*.txt` 被剥 | 反引号内保留、外部剥离 |
| 保留名（P2-15） | `con.backup` 判合法 → E_IO | `_con.backup` / `_aux.v2` |

### 2.5 生命周期与残留 —— 通过

`dev_uninject_plugin` → entry 卸载 / patch 写 disabled / registry 清理 / junction 删除 / client 模块表清理；`Test-Path junction` = False；registry 无本插件；无 timer / 无 `ctx.on` / 无 slot / 无路由。

### 2.6 UI 门禁复核 —— 不适用

B 分支：无 `design/`、无 `design.lock.json`、无 verify 证据、无例外清单。阶段02 原文【本插件无前端 UI 模块，跳过 style-design 页面设计环节】。

---

## 3. 缺陷清单

### 3.1 已闭合

| ID | 描述 | 等级 | 归属 | 处置 |
|---|---|---|---|---|
| D-01 | `build.sh` 漏 `mkdirSync` → 构建 ENOENT | P0 | 开发 | 已修（1 行） |
| D-02 | slugify 非法字符删除 ≠ Spec「替换 `-`」 | P1 | 开发 | 已修 + 双横线折叠 |
| D-03 | 凭据顺序与 Spec 不符 | P1 | 开发 | 已修（env→reg→config） |
| D-04/D-05 | 断言期望值与注释未同步 | P2 | 开发 | 已同步 |
| **D-06（审查 P1-1）** | `rename` 静默覆盖（TOCTOU） | **P1** | 开发 | 改排他占名（`link` / `COPYFILE_EXCL`） |
| **D-07（审查 P1-2）** | 相对目录按宿主 cwd | **P1** | 开发 | 取 `exec.agent.session.header.cwd`，回显 `base_dir` |
| **D-08（审查 P1-3）** | `exec.signal` 未接、取消后仍落盘 | **P1** | 开发 | 信号合并 + 落盘前复查 |
| **D-09（审查 P1-4）** | Spec FR-7 与 Design §7 矛盾 | **P1** | 设计文档 | Design 更正为 env→reg→config，登记 v0.2 |
| D-10~D-19 | P2-5/9/10/11/13/14/15/16/17/20/21 共 11 项 | P2 | 开发 | 已修（见 `evidence/stage05-review-fixes.md`） |

### 3.2 未闭合（已知限制，不阻塞交付）

| ID | 描述 | 等级 | 影响 | 建议 |
|---|---|---|---|---|
| O-01 | title 形如 URL 的站点 → 长文件名 | P2 | 观感 | 需规格修订（FR-3 加 URL 回退） |
| O-02 | `dev_self_test` 需宿主 `DSH_CHECKOUT` | P2 | 注入器自检 | 带该变量的实例补跑 |
| O-03 | 独立 profile 全新试装未做 | P2 | 装配证据少一条 | 修好缺包后隔离补跑 |
| O-04（审查 P2-6） | "200 非 JSON" 也重试；无退避 | P2 | 极端情况多一次计费 | 建议下版仅 5xx/网络/超时重试 + 退避 |
| O-05（审查 P2-7） | 400/413/422 归 `E_FETCH_FAILED`，hint 偏站点侧 | P2 | 归因误导 | 待上游 `error.type` 契约明确后细分 |
| O-06（审查 P2-12） | 临时文件清理 best-effort | P2 | AV 占用时留隐藏 tmp | 建议加清理重试 |
| O-07（审查 P2-18） | 无响应体大小上限 | P2 | 超大页内存尖峰 | 建议加 `maxBytes` Config |
| O-08（审查 P2-19） | `Config.apiKey` 直配会让 Key 进 patch 明文 | P2 | 配置卫生 | 已在文档明示「推荐仅用环境变量」 |
| O-09 | 4 空格缩进代码块不识别 → 其内反斜杠会被剥离 | P2 | 少数文档格式内容偏差 | `clean:false` 兜底；后续可加缩进块识别 |
| O-10 | `E_EMPTY_CONTENT` 无 request_id（上游 200 不返回） | P2 | 追溯信息缺 | 与成功形状对齐为 `null`，不臆造 |

---

## 4. UI 门禁复核结果

**不适用（B 分支）**：无 UI 模块 → 无 verify 命令、无 `--json`、无 `exemptCount`、无例外清单。

---

## 5. 残留与生命周期

- 卸载即净（entry/patch/registry/junction/client 表全清），已复验两次。
- 运行期无 timer / 事件 / slot / 路由 / 持久化；每请求 `AbortController` + `finally clearTimeout`。
- 临时文件 `finally` 必清理；实测 `.tmp-*` 残留 0。

---

## 6. 交付说明

```powershell
# 装配（任选其一）
dev_inject_plugin { "dir": "C:\project-study\dsh-deepseek-fetch\bundle" }   # 免重启
dsh plugin --profile web add "C:\project-study\dsh-deepseek-fetch\bundle"   # 正式（需重启）

# 卸载
dev_uninject_plugin dsh-deepseek-fetch
dsh plugin --profile web remove @dsh-external/dsh-deepseek-fetch

# 使用
deepseek_fetch({ url: "https://…" })
deepseek_fetch({ url: "https://…", output_dir: "notes" })   # 相对路径 → 会话工作区
deepseek_fetch({ url: "https://…", clean: false })          # 原文保真
```

回滚：`bundle/` 与 `preset/` 为独立目录，删除即恢复；基线四件（Spec/Design/DEV-PLAN/STATE）未被破坏。

---

## 7. 可发布标记

**SHIPPABLE（v0.2）**

依据：结构合规通过；运行时装配 `[active]`、真实抓取成功、无插件树错误；8 错误码全部实测；四项门禁全绿（build 0 / tsc 0 / verify 10 项 PASS / check-plugin-ready 1/1 PASS）；并发/取消/相对目录三项 P1 缺陷已修复并复验；卸载即净；无 UI 门禁项。

**必须随标记阅读的限制**：
1. 独立 profile 全新试装未做（环境缺包 + 生产 profile 纪律）——以注入装配 + 组合期门禁 + 卸载即净替代。
2. `dev_self_test` 受宿主缺 `DSH_CHECKOUT` 限制未通过。
3. §3.2 的 10 条已知限制（O-01~O-10），其中 O-04/O-05/O-06/O-07/O-08 来自独立审查、经评估后**有意保留**，不影响已批准规格的验收判据。
4. 交付前已删除 `.zcode/`（含明文 Key），`.gitignore` 已排除。

---

# 8. P1 第二批增量验收（FR-11 同域子页合并 · 插件 v0.2.0）

## 8.1 检查范围与输入

| 类别 | 路径 |
|---|---|
| 需求 | `Plugin-Spec.md` v0.3 FR-11 |
| 设计 | `Plugin-Design.md` **v0.3 §14**（已过审）；结构图 v2（四门 PASS，人眼复核） |
| 计划 | `DEV-PLAN.md` **v0.3 §10**（T-11~T-15、R-09~R-15、M3/M4，已过审） |
| 产物 | `bundle/` **v0.2.0**（`src/index.ts` 1144 行；10 个断言脚本）；`preset/` **P1 未改动**（mtime 03:03） |
| 证据 | `evidence/p1-selftest.md` |
| 装配态 | 已正式装配 web profile（bundles 第 53 条）+ junction；P1 后 `dev_reload_package` 前后 `[active]` |

## 8.2 逐项检查结果

**P0 非回归（硬判据 A7）**

| 用例 | 结果 |
|---|---|
| 不传 `children` | `ok:true`；落盘 `source=false h2=false sep=false front=false`（**纯正文**） |
| `children:false` | 同构（`source=false front=false`） |
| `children:false` + `max_depth:5` + `max_pages:99` | `ok:true`（两参忽略且不报错） |
| 未知参数 `filename` | `E_INVALID_URL`（提示仅支持 6 个参数） |

**P1 合集能力**

| 用例 | 结果 |
|---|---|
| 真实站点（lib 直连） | `pages_total=4 / ok=4 / failed=0`；来源行 4、`---` 4、无 front matter、含「## 未抓取清单」 |
| **宿主真实调用**（已装配 profile） | `children:true, max_depth:1, max_pages:3` → `3 页 / 0 失败 / 19141 字符 / 624ms` → `网页搜索与抓取-合集-2.md`（重名自动 `-2`，排他占名生效） |
| `max_depth:0` | `pages_total=1`（仅根页） |
| 参数越界 | `max_depth=6/-1`、`max_pages=0/201` → 均 `E_INVALID_URL`（本地前置，不发请求） |
| 门禁 | build 0 / tsc 0 / **verify 13 项全 PASS**（原 10 + discover/bfs/merge）/ check-plugin-ready 1-1 / 10 个断言脚本全 exit 0 |
| robots 拒绝 | `assert-bfs` 覆盖「robots 拒根页 → 整体失败」「拒子树 → 跳过并记录」 |
| 发现失败降级 | 根页 HTML 取不到/0 链接 → 降级单页 + 清单记原因（`assert-bfs` 覆盖） |
| 预算耗尽 / 取消 / 并发上限 | `assert-bfs` 覆盖（`budgetExhausted`、信号转发、批宽 ≤ `childrenConcurrency`） |
| 唯一性 | 工具名 `deepseek_fetch` 未重名；`slot` / `client` 引用 = 0；loader id 唯一 |
| 交付卫生 | `.zcode/` 已删、密钥形态扫描无命中、自测目录已清 |

## 8.3 P1 缺陷清单

| ID | 描述 | 等级 | 状态 |
|---|---|---|---|
| D-20 | P1 首轮构建 `TS2367`（index.ts:852 因前一处判断被窄化，重复比较被判无交集） | P1 | 已修（改真值判断，运行期语义不变），build/tsc 复跑全绿 |
| D-21 | P1 工单机检由主侧下发前执行（ZCode 侧 Bash 被拦，未复跑） | P2 | 如实记录；A1~A5 门禁全由主侧执行留证 |
| **O-11** | **404 页面不触发降级**：站点 404 页仍含导航链接 → 合集会混入 `Page Not Found` 正文（实测 `/zh-cn/api/guides/search` 被当可抓页，抓回 3 页含 404 文案） | P2 | 已知限制；与 P0 同源（接口对 404 页返回 200，无状态码可判） |
| **O-12** | 合集内**我方页标题与页内原有标题混层**（根页出现两个同名 `# 网页搜索与抓取`，其一来自源页面自身 H1） | P2 | 已知限制；设计 §14.6 已声明该取舍；如需区分需改设计 |
| O-01~O-10 | P0 轮保留项（见 §3.2） | P2 | 沿用 |

## 8.4 UI 门禁复核

**不适用（B 分支）**：P1 未新增任何 UI，无 `design/`、无 verify 证据、无例外清单。

## 8.5 残留与生命周期

- P1 未新增 timer / 事件 / slot / 路由 / 持久化；合集路径复用 P0 的排他占名与临时文件清理（实测 `.tmp-*` 残留 0、重名并存不覆盖）。
- `dev_reload_package` 前后 `[active]`，无重复注册。

## 8.6 独立只读审查结论（子代理 `aea05082…`，静态阅读 + 只读行为探针）

| 编号 | 缺陷 | 等级 | 处置 |
|---|---|---|---|
| P1-1 | 发现通道 `fetch` 默认跟随重定向且**不校验目标 host** → 站点可用 302 把本机通道导向内网（盲打 GET 型 SSRF，探针实测目标端口收到请求） | **P1** | ✅ 已修 |
| P1-2 | robots 的 `*` 通配与 `$` 尾锚被按**字面前缀**比较 → 规则永不命中 = **越界抓取**（`/*.pdf$`、`/private$` 失效） | **P1** | ✅ 已修 |
| P2-3 | robots UA 分组：空行不重置分组 → 空组规则泄漏到下一组 → 误拒 | P2 | ✅ 已修 |
| P2-4 | robots 前缀匹配无路径段边界 → `Disallow: /a` 误拒 `/abc` | P2 | ✅ 已修 |
| P2-5 | 页标题为空 → 合集出现空标题层级 `# ` | P2 | ✅ 已修 |
| P2-6 | 锚点抽取误判：`data-href`、`<script>`/`<textarea>`/注释内的伪 `<a>` | P2 | ✅ 已修 |
| P2-7 | 属性值含 `>` 时整条锚点被漏抽 | P2 | ✅ 已修 |
| P2-8 | 未抓取清单无上限 → 合集与**工具返回值**体积无界 | P2 | ✅ 已修（双重上限 + 汇总行） |
| P2-9 | 两条通道响应体无大小上限 | P2 | ⏸ 有意保留（见 §8.8） |
| P2-10 | 去重键折叠「仅 query 不同」的页面且**静默丢弃** | P2 | ✅ 已修（改为计入清单） |
| P2-11 | 正文自带 `---` / `#` 会与页间分隔、页标题层级混淆 | P2 | ⏸ 有意保留（设计取舍，见 §8.8） |
| P2-12 | 断言覆盖缺口（并发上限、robots-404 放行、maxDepth=0、在途取消、环路去重、robots 通配/分组/段边界、空标题、正文 `---`、Config 范围、lib↔src 新鲜度） | P2 | ✅ 部分补齐（新增 `assert-robots.mjs` / `assert-edge.mjs` / `freshness` 三项；其余仍缺） |
| P2-13 | 根页失败时剩余队列 drain 原因误标 | P2 | ✅ 已修 |
| P2-14 | 总预算可被单请求超时穿透 | P2 | ✅ 已修（单请求超时取 `min(timeoutMs, 剩余预算)`） |
| P2-15 | 文档/注释三处与实现不一致 | P2 | ✅ 已修（Design §14.5 措辞、文件头表述、Spec FR-11 措辞） |

**审查逐项结论**：P0 非回归 **通过**；发现层 / robots 解析 / BFS 预算 / 合并命名 / 断言质量 **部分通过**；安全与资源 **不通过**（P1-1）。P1 与可修 P2 已全部处置后重跑全部门禁。

## 8.7 修复后的复验（修复后重新执行本阶段全部检查）

| 门 | 命令 | 结果 |
|---|---|---|
| 构建 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | exit 0 |
| 类型 | `tsc -p tsconfig.json --noEmit` | exit 0 |
| **verify（含新增项）** | `node scripts/verify.mjs` | **16 项全 PASS**：`module / **freshness** / tool-contract / error-codes / validateUrl / resolveApiKey / classifyError / cleanMarkdown / slugify / config-fields / preset / discover / **robots** / **edge** / bfs / merge` + `verify: PASS` |
| 准入 | `check-plugin-ready.mjs <bundle>` | `[PASS] bundle` 1/1 |
| **P1 回归断言** | `assert-robots.mjs` | `robots-ok`（通配 `/*.pdf$` 拦 `/x.pdf`；`$` 尾锚不拦 `/privateX`；`/a` 不拦 `/abc`；空组不泄漏；`data-href`/script/注释伪链接被剔除；属性含 `>` 不漏抽） |
| **P1 回归断言** | `assert-edge.mjs` | `edge-ok`（**越界 302 → 目标端口零请求**；同 host 302 → 允许跟随；空标题回退 host+pathname；清单 >200 → 逐条截断 + 「另有 N 条」汇总行） |
| P0 非回归 | 4 组 | 不传 children / `children:false` / 多传 `max_*` → 落盘**纯正文**（无来源行/无页标题/无 front matter）；未知参数 → `E_INVALID_URL` |
| 合集端到端 | 真实站点 | `pages_total=4 / ok=4 / failed=0`；`skipped_total=49`（其中 34 条为「同页多参已折叠」——原先静默丢弃，现如实记账）；来源行 4、分隔 4、无 front matter |
| 宿主实跑 | 已装配 profile + reload | `children:true, max_depth:1, max_pages:3` → **3 页 / 0 失败 / 21732 字符 / 832ms** → `网页搜索与抓取-合集-3.md` |

## 8.8 有意保留的 P2（不影响已批准判据）

| ID | 内容 | 理由 |
|---|---|---|
| P2-9 | 响应体无大小上限 | 实现需流式截断，改动面大；上游对返回内容本身有截断，实测未遇超大页；记为下版项（建议加 `maxBytes`） |
| P2-11 | 正文自带 `---` / `#` 与合集分隔/层级混淆 | 设计 §14.6 明写「不重写页内标题」；改写正文会破坏保真承诺。已补齐设计对该代价的说明（含子页 H1 反压 `##` 的场景） |
| P2-12（余项） | 并发上限、robots-404 放行、maxDepth=0、在途取消、环路去重、Config zod 范围的**断言**未补齐 | 行为已由实现与端到端实测覆盖，但缺独立断言；建议下版补（`assert-bfs` 加并发/404 用例） |
| O-11 | 404 页面不触发降级（站点 404 页含导航链接 → 被当可抓页） | 与 P0 同源：接口对 404 页返回 200，无状态码可判；建议用户确认根页 URL 有效 |
| O-12 | 合集内我方页标题与页内标题混层 | 设计已声明；如需区分需改设计（如页标题加 `[n]` 标记） |
| O-13 | robots 最小子集仍不支持 `$` 之外的复杂通配语义（如 `*` 与 `$` 组合已支持，但不支持正则字符类） | 已覆盖常见写法；完整 RFC 9309 支持留待下版 |
| **O-14** | **SPA / 在线编辑器（WebOffice）类页面的正文抓不到**：实测 `kdocs.cn`（金山文档）——① 初始 HTML 是**登录壳**（WPS 账号 SDK），正文由 JS 拉取后渲染；② **无公开打印/导出版**：`?print=1` / `?print=true` / `?view=print` / `?export=1` / `?from=docs&print=1` / `?r=1` / `m.kdocs.cn` 返回**完全相同**的内容（6553 字，噪声位置一致），`/print` 是 404；③ 工具抓到的 2691 行里仅前 142 行是目录/要点，其余是 emoji 面板与工具栏；④ 真实正文由 WebOffice 引擎画在 **canvas** 上（`img=11, canvas=1`，正文文字不在 DOM）。**已验证的可行解法**：无头 Edge（`--headless=new`）+ CDP 逐帧取 `document.body.innerText`（拿到 2670 字干净正文，`三剑客=true`、无 emoji 面板/工具栏），再去 UI 浮层行 → 本项目已据此产出 `交易回战-…-干净正文.md`（126 行，第 1 战全文含表格与流程）。**插件侧未实现该能力**（属新增渲染通道能力，需走规格修订） | P2 | 页面形态使然，非插件缺陷 |

## 8.9 P1 可发布标记

**SHIPPABLE（v0.4）**

依据：结构合规；已装配 profile 运行 `[active]`、真实抓取与合集抓取均成功；**独立只读审查报回的 2 条 P1 + 12 条可修 P2 已全部修复并复验**（新增 3 组断言覆盖修复点，含 SSRF 回归）；verify 16 项全 PASS；build / tsc / check-plugin-ready 全绿；P0 非回归逐条复验通过；卸载/回滚路径明确；无 UI 门禁项。

**必须随标记阅读的限制**：§8.8 的 6 条（P2-9 / P2-11 / P2-12 余项 / O-11 / O-12 / O-13），以及 §2.2 的「独立 profile 全新试装未做（环境既有缺包）」与 `dev_self_test` 需宿主 `DSH_CHECKOUT`。

**交付卫生**：`.zcode/`（含明文 Key）已删除并扫描无命中；自测临时目录已清；`preset/` 与 `cordis.patch.yml` 全程未被 P1 改动。

---

# 9. P2 第三批增量验收（FR-12 渲染素材通道 · 插件 v0.3.0）

## 9.1 检查范围与输入

| 类别 | 路径 |
|---|---|
| 需求 | `Plugin-Spec.md` v0.4 FR-12（已过审） |
| 设计 | `Plugin-Design.md` **v0.4 §15**（已过审）+ 结构图 v3（四门 PASS + 人眼复核） |
| 计划 | `DEV-PLAN.md` v0.4 §11（T-16~T-21、R-16~R-23、M5/M6，已过审） |
| 产物 | `bundle/` v0.3.0：`src/index.ts` 2404 行 + 3 个新断言脚本（verify 19 项） |
| 证据 | `evidence/p2-selftest.md`、`evidence/p2-render-probe.md` |

## 9.2 逐项检查结果

| 检查项 | 证据 | 结论 |
|---|---|---|
| 构建 / 类型 | `build.sh` exit 0；`tsc --noEmit` exit 0 | 通过 |
| 自验门禁 | `verify.mjs` **19 项全 PASS**（原 16 + render/shots/arbiter） | 通过 |
| 新断言可证伪 | 改断言条件 → exit 51 / 52；还原 → PASS（两轮抽检） | 通过 |
| 准入 | `check-plugin-ready` `[PASS] bundle` 1/1 | 通过 |
| 唯一性 | 工具名 `deepseek_fetch` 未变；无新 loader entry / preset 行 / **npm 依赖**（CDP 用 Node 内置 fetch+WebSocket） | 通过 |
| **素材包端到端** | 宿主真实调用 `render:true` → `ok:true`、正文 **2387 字符**、**10 张**截图、manifest 8 键齐全（`merge_hint` 在位）；md 首行即正文、含正文段落、**无 UI 噪声**、**无 front matter** | 通过 |
| **P0 回归** | 单页落盘**无**来源行 / **无** front matter、916 字符 → 纯正文未变 | 通过 |
| **P1 回归** | `children:true` → 3 页、3 条来源行、含未抓取清单 → 合集结构未变 | 通过 |
| 资源回收 | Edge 进程**零新增残留**（只 kill 自己 spawn 的 child）；插件自建临时 profile 已清；端口随机且仅 127.0.0.1 | 通过 |
| UI 门禁 | 不适用（B 分支，无 UI） | 通过（不适用） |
| 独立 profile 全新试装 | `--dump-config` 仍因 profile 自身缺包失败（与本插件无关） | 部分通过 |

## 9.3 P2 缺陷清单

**已闭合（主侧实测发现并修，5 处）**

| ID | 现象 | 判定 | 修复 |
|---|---|---|---|
| D-22 | `assert-shots` ① 失败 | **断言错、实现对**（样例 `sh=700/ch=600` 实为可滚） | 样例改 640/600 |
| D-23 | 首轮抓取：正文 **0 字符**、仅 1 张截图 | 实现缺陷：只等 700ms，页面未成型 | 补 `waitForRenderReady` 轮询 → 655 字 / 8 张 |
| D-24 | 正文只到 655 字（仅轮廓面板） | 实现缺陷：候选容器采集过早（正文容器约 9s 后才建好） | 补 `waitForScrollableContent`（`scrollHeight ≥ 3×clientHeight`）+ 触底后重选容器 |
| D-25 | 正文稳定 **662 字**，永远取不到第 1 战正文 | **静默丢失型缺陷**（不报错）：900/1600 视口下 WebOffice 正文**不在 DOM**（`innerText` 恒 1391 字＝轮廓面板），2400 视口才 2670 字 | 改**两阶段视口**（1440×2400 取文字 → 切回 1440×900 取截图）→ 正文 **662 → 2387 字** |
| D-26 | `TS18047: 'textViewport' is possibly 'null'` | 类型缺陷 | `?? viewport` 兜底 |

**加固**：新增断言 ⑤（正文级容器判定：`sh/ch≈56` 判 substantial、`sh/ch=2` 不算）与 ⑥（取文字视口高度必须 > 截图视口）→ 把 D-24/D-25 变成**可回归检测**（已做防恒绿抽检：突变 → exit 51）。

**未闭合（已知限制）**

| ID | 内容 | 影响 |
|---|---|---|
| O-11 | 404 页面不触发降级（站点 404 页仍含导航链接）→ 素材含 "Page Not Found" | 与 P0 同源（接口对 404 返回 200） |
| O-13 | robots 通配符仅支持 `*` 与 `$`，不支持字符类 | 常见写法已覆盖 |
| **O-16** | 正文取自**渲染后 DOM 文本**；canvas 绘制且不进 DOM 的内容（纯图片页）取不到文字 | 这类页面只能靠截图 → agent 视觉文字化 |
| **O-17** | 渲染执行页面 JS，页面自身可能发起内网请求 | **页面行为**，非插件主动；插件不拦截 |
| P2-12（余项） | 并发上限 / robots-404 放行 / maxDepth=0 / 在途取消 / 环路去重 / Config zod 范围 的断言未补齐 | 行为已由实现与端到端实测覆盖 |

## 9.4 独立只读审查（子代理 `534c5a0f…`，静态审查 + 只读探针）

**结论：0 项 P0；2 项 P1；12 项 P2。**

| 编号 | 缺陷 | 等级 | 处置 |
|---|---|---|---|
| P1-1 | **渲染预算被「等 ≥3× 正文容器」独占** → 普通页面（可滚内容 <3 屏）空等满 `renderTimeoutMs`，且截图阶段拿到已耗尽 deadline → **0 张截图**（"有 md 无 PNG"） | **P1** | ✅ 已修：`waitForScrollableContent` 加**子预算 15s**（不占总预算）+ 无候选/页面已就绪即返回；`captureShots` 改「预算已过也至少 1 屏」。**实测**：`example.com` 从空耗 90s/0 张 → **6.5s / 1 张** |
| P1-2 | **`executeRender` 管线零自动化断言**，现场修的 3 个缺陷全落此盲区 | **P1** | ✅ 已修：新增 **`assert-pipeline.mjs`**（RenderDeps 依赖注入，假 Edge/假 API/假 CDP），覆盖 ①互斥拒绝 ②枚举/范围拒绝 ③显式 render 不降级 ④auto 降级带 warning ⑤两阶段视口顺序 ⑥view 配反告警；已接入 verify（**19 → 20 项**） |
| P2-1 | `edgePath`「非空必须存在」（设计）vs「静默回退」（实现+断言）三方不一致 | P2 | ✅ 已裁决并同改三处：**优先使用；不存在则回退默认探测 + `warnings` 告警**（代码加 warning、Design 表改口径、断言不动） |
| P2-2 | 参数类错误复用 `E_INVALID_URL` + "修正 URL" hint 误导 | P2 | ✅ 已修：`fail()` 支持定制 hint；text_source / max_shots / render×children 三处改为参数专属提示（错误码仍 11 个） |
| P2-3 | `assert-render` ⑥ 是**空洞断言**（硬写字面量，与 Config 默认无绑定） | P2 | ✅ 已修：改从 `Config({})` 取真值断言不变量。**抽检验证**：把 `renderTextViewport` 默认改回 900 → **exit 51 失败**；还原 → PASS |
| P2-4 | `assert-render` ① 条件式断言，无 Edge 机器上空过 | P2 | ✅ 已修：改为无条件断言候选清单内容与顺序 |
| P2-5 | 触底重选容器跨数组按下标比较，可活锁烧光截图预算 | P2 | ✅ 已修：改比 `scrollHeight`（新容器须大 50px 以上）+ 连续无进展熔断 `stagnant` |
| P2-6 | 临时 profile 删除失败被完全静默（R-23 承诺的 warning 无通道） | P2 | ⏸ 保留（见 §9.6） |
| P2-7 | 素材包三件非原子写，中途失败留无 manifest 的孤儿产物 | P2 | ✅ 部分修：写盘失败时**回报已落盘路径**（正文明细 + 截图目录）；原子化（临时目录 rename）留待下版 |
| P2-8 | manifest 首次把完整 URL 落盘（带签名/临时 token 会留盘） | P2 | ✅ 已修：新增 `maskUrlQuery`，落盘前剥离 query；断言已覆盖 |
| P2-9 | 切回截图视口后无再就绪校验 | P2 | ✅ 已修：切回后补 `waitForRenderReady` |
| P2-10 | `renderTextViewport ≤ renderViewport` 时静默退化为单阶段（正文可能不全） | P2 | ✅ 已修：该情形写 `warnings`（断言覆盖），不再静默 |
| P2-11 | CDP target 不校验 URL、也不主动导航（可能拍到 about:blank） | P2 | ✅ 已修：优先按**目标 host 匹配** target，匹配不到取首个 page target |
| P2-12 | 文档/预设口径不一（Design 头 v0.1、Config "5 字段"、DEV-PLAN "16 项"、preset 未提 P2） | P2 | ✅ 已修：Design 头 → v0.4；Config 口径 → 6 字段/17 总数；DEV-PLAN → 17 项；`preset.yml` description 补 P2 |

**审查逐项结论**：参数与契约 **通过**；择源器 **通过**；渲染器 **通过（附 3 P2）**；截图器 **通过（P1-1 直接影响）**；资源与安全 **通过（附 2 P2）**；P0/P1 非回归 **通过**；断言质量 **有条件通过**（P1-2/P2-3/P2-4 修后转通过）；其它 **无 P0**。

## 9.5 修复后的复验（审查 P1×2 + 可修 P2 全部处置后重跑）

| 门 | 命令 | 结果 |
|---|---|---|
| 构建 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | exit 0 |
| 类型 | `tsc -p tsconfig.json --noEmit` | exit 0 |
| **verify（新增 pipeline）** | `node scripts/verify.mjs` | **20 项全 PASS** + `verify: PASS` |
| 准入 | `check-plugin-ready.mjs <bundle>` | `[PASS] bundle` 1/1 |
| **P1-1 靶子：普通短页** | `deepseek_fetch({url:'https://example.com', render:true})` | **6.5s**、正文 916 字符、**截图 1 张**（修复前：90s、0 张） |
| **P1-1 不回归：文档站** | `deepseek_fetch({kdocs, render:true, max_shots:10})` | 正文 **2404 字符**、截图 10 张、18.2s |
| **稳定性（同一 URL 连跑两次）** | 上者再跑一次 `max_shots:6` | 正文 **2404 字符**（完全一致）、截图 6 张、13.3s；修复前在 **1272 / 1586 / 2387** 间跳动 |
| P0 回归 | 单页 | 无来源行、无 front matter、916 字符 |
| P1 回归 | `children:true, max_depth:1, max_pages:3` | 3 页、3 条 `> 来源:`、含未抓取清单 |
| 资源 | Edge 进程 / 临时 profile | 零新增残留；探针残留已清；`.zcode` 不存在 |

**另一处主侧自查补强（审查未提，我实测发现）**：切视口后立即读正文，同一文档三次得到 1272/1586/2387 字——长度**非单调**，「连续两次相同」的稳定判定会提前成立。已修：切视口后先等 **2.5s 重排**，再做稳定判定（`waitForTextStable`）→ 两次连跑均为 **2404 字符**。

## 9.6 追加修复（用户复跑 max_shots=20 时暴露，已修并复验）

| ID | 现象 | 判定 | 修复 |
|---|---|---|---|
| D-27 | 复跑时正文只有 **1693 字符**（此前稳定 2404）；同一 URL 两次结果不一致 | **取文字判据被"平台期"骗过**：切高视口后长度序列 `1375 → 2654 → 2654 → 2670…`，中途会停在某值连续两次不变 → "连续两次相同即稳定"误判成立，拿到残缺正文 | 改为 `waitForTextLongest`：切视口后等 2.5s 重排 + 6s 窗口内每 400ms 采样**取最长的一份**；再加**阶段 C 复读**（滚动后回高视口再取一次，取更长者） |
| D-28 | 无断言覆盖"取文字取最长"这一行为 | 验证盲区 | 新增断言 ⑦（单元 + 管线级两例），并做**防恒绿抽检**：把"取最长"突变为"取最短" → **exit 53 失败**；还原 → PASS |

**修复后实测（同一 URL 连跑两次）**：正文 **2527 / 2404 字符**（均为完整档；此前残缺档为 1693），每次 20 张截图，耗时 36.2s / 38.9s。

## 9.7 有意保留（不影响已批准判据）

| ID | 内容 | 理由 |
|---|---|---|
| P2-6 | 临时 profile 删除失败静默（无 warning 通道） | 影响面限于磁盘残留（系统临时目录）；加通道需改 `closeAll` 返回结构，改动面大于收益，记为下版 |
| P2-7（余项） | 素材包非原子写（未做临时目录 + rename） | 已缓解：失败时回报已落盘路径；原子化需重构三件套写入顺序，下版处理 |
| O-11 | 404 页面不触发降级 | 与 P0 同源（接口对 404 返回 200，无状态码可判） |
| O-13 | robots 复杂通配（字符类）不支持 | 常见写法已覆盖 |
| O-16 | 纯图片页（canvas 不进 DOM）取不到文字 | 只能靠截图 → agent 视觉文字化 |
| O-17 | 渲染执行页面 JS，页面自身可能访问内网 | **页面行为**，非插件主动；不拦截 |
| P2-12（余项） | 并发上限 / robots-404 放行 / maxDepth=0 / 在途取消 / 环路去重 / Config zod 范围 的断言仍缺 | 行为已由实现与端到端实测覆盖 |

## 9.8 P2 可发布标记

**SHIPPABLE（v0.5）**

依据：结构合规（工具名/参数 9 项/错误码 11 个/Config 17 字段，零新依赖）；**独立只读审查报回的 2 条 P1 + 10 条可修 P2 已全部修复并复验**（新增 `assert-pipeline.mjs` 补齐管线级盲区，verify 19 → **20 项全 PASS**；复跑暴露的取文字判据缺陷 D-27 已修并加断言 ⑦）；`build.sh` / `tsc` / `check-plugin-ready` 全绿；**真实站点 `render:true` 产出可核验素材包**（正文 2404 字符 + 10 张截图 + manifest 8 键）；同一 URL 连跑两次正文完全一致（2404/2404）；P0 单页与 P1 合集双回归通过；Edge 进程与临时 profile 零残留；`.zcode`（含明文 Key）不存在。

**必须随标记阅读的限制**：§9.7 全表（P2-6 / P2-7 余项 / O-11 / O-13 / O-16 / O-17 / P2-12 余项），以及 §2.2 的「独立 profile 全新试装未做（环境既有缺包）」与 `dev_self_test` 需宿主 `DSH_CHECKOUT`。

---

# 10. P3 第四批增量验收（FR-13 参数化等待 · FR-14 感知哈希去重 · 插件 v0.4.0）

## 10.1 检查范围与输入

| 类别 | 路径 |
|---|---|
| 需求 | `Plugin-Spec.md` v0.5 §4.1 FR-13/FR-14（已过审） |
| 设计 | `Plugin-Design.md` **v0.5 §16**（已过审）+ 结构图 v4（四门 PASS + 人眼复核） |
| 计划 | `DEV-PLAN.md` v0.7 §12（T-22~T-27、R-24~R-28，已过审） |
| 产物 | `bundle/` **v0.4.0**：`src/index.ts` 2846 行 + 2 个新断言脚本（verify **22 项**） |
| 证据 | `evidence/p3-selftest.md`、`workorders/proto-phash.mjs`（可行性原型） |

## 10.2 逐项检查结果

| 检查项 | 证据 | 结论 |
|---|---|---|
| 构建 / 类型 | `build.sh` exit 0；`tsc --noEmit` exit 0 | 通过 |
| 自验门禁 | `verify.mjs` **22 项全 PASS**（原 20 + png + phash） | 通过 |
| 新断言可证伪 | 两次抽检：① 常量守卫（MAD 1.5→99）② **去掉 MAD 复核的行为突变** → 均 exit 55；还原 → PASS | 通过 |
| 准入 | `check-plugin-ready` `[PASS] bundle` 1/1 | 通过 |
| 唯一性 | 参数键 **10**、错误码 **11**、Config **17**、无新 loader entry / preset 行 / **npm 依赖** | 通过 |
| **预算联动** | 传 2500 + 50 屏 → 回显 `预算 220000ms`（= ⌈50×2500×1.6⌉+20000）、161.5s 不超时；传 2500 + 12 屏 → 回显 `90000ms`（68000 < Config，**只增不减**）、58.5s 不超时 | 通过 |
| **零回归（不传 settle）** | `settle 700ms / 预算 90000ms` = Config 原值；6.2s 完成、1 张截图 | 通过 |
| **去重生效** | 45 帧 → **41 张**（丢 4），`sha1+phash`；**近空白帧 0 张**（原 sha1 版有 2 张）、全帧 sd≥32 → 无内容误删 | 通过 |
| 边界拒绝 | `6000`/`-1` → 插件 `E_INVALID_URL` + 参数专属 hint；`1.5` → 框架 schema 先拒 | 通过 |
| P0 回归 | 单页落盘无来源行/无 front matter、916 字符 | 通过 |
| P1 回归 | `children:true` → 3 页、3 条来源行、含未抓取清单 | 通过 |
| 资源 | Edge 零新增残留；`.edge*` 临时目录 0；`lib/_bak*` 0 | 通过 |
| 交付卫生 | `.zcode/`（483 B 明文 Key）已删除；全仓 `sk-*` 扫描 0 命中 | 通过 |
| UI 门禁 | 不适用（B 分支，无 UI） | 通过（不适用） |

## 10.3 P3 缺陷与已知代价

**已闭合**

| ID | 现象 | 判定 | 修复 |
|---|---|---|---|
| D-29 | ⑧d 用例报 `E_RENDER_TIMEOUT`、实测耗时 **31.1s** | **测试桩缺陷**：假会话 `if (s.includes('canvas')) return 0` 把 `JS_RENDER_READY`（内部含 `querySelectorAll('canvas')`）也判成"未就绪" → 就绪轮询空等满预算 | 假会话**先判就绪特征**（`readyState`/`children.length`）再判 canvas；定位方法是给每个 `evalJs` 打标签记时间戳 |

**已知代价（设计已声明）**

| 项 | 说明 |
|---|---|
| 解码开销 | ~31ms/帧，仅 sha1 不同时才解码（45 帧 ≈ +1.4s） |
| 预算只增不减 | 传 settle 时预算只会 ≥ `Config.renderTimeoutMs`，不会缩小 |
| `render_settle_ms` 仅在 `render:true` 时生效 | 与 `max_shots`/`text_source` 同策略（非 render 路径静默忽略） |
| 阈值固定 | `PHASH_MAX_HAMMING=2` / `PHASH_MAX_MAD=1.5` 为内部常量，不进 Config |
| 非 8-bit/隔行 PNG | 显式抛 `PngUnsupportedError` → 回退 sha1，标 `dedup_method='sha1(fallback)'` |

## 10.4 独立只读审查（子代理 `e1a533ec…`，静态审查 + 6 组只读探针）

**结论：0 项 P0；3 项 P1；8 项 P2。**

| 编号 | 缺陷 | 等级 | 处置 |
|---|---|---|---|
| **P1-1** | **小面积内容变化会被判为重复帧（点采样均值 MAD 的误删窗口）**：实测 1440×900 仅 30×30px 变黑 → hamming=0、MAD=0.249 ≤ 1.5 → **判重丢弃（真内容丢失）**，直接违反"宁可漏删不可误删"红线 | **P1** | ✅ 已修：加 **uniform 守卫**（灰度标准差 < 3 → 只认 sha1）+ **逐格否决**（32×32 任一格差 > 24 → 不判重）；新增断言 ③j（局部高对比变化不得判重）/③k（近纯色帧拒判）+ assert-phash ①（逐格否决不变量）/①b（真近重复仍抓到）/①c（uniform 拒判） |
| **P1-2** | `dedup_method='sha1(fallback)'` 端到端零断言（T-25 验收③未落地，实现本身正确） | **P1** | ✅ 已修：assert-pipeline 新增 ⑧g（非 PNG 帧 → 返回与 manifest 均 `sha1(fallback)`、计数 1/2、warning 恰一次） |
| **P1-3** | "比较基准恒为上一张**保留**帧"这一承重语义无判别性断言（③f/③h 在错误实现下同样绿） | **P1** | ✅ 已修：assert-shots 新增 ③i（A~B、B~C、A!~C 三段帧 → 保留 [A,C]、deduped=1、且校验第二张 bytes 为 C）；**突变抽检**：把 prev 在丢弃分支也前移 → ③i 失败（"实际 1 张"）→ 还原 PASS |
| P2-1 | 预算断言只到不等式，`resolveRenderBudget` 无直调断言 | P2 | ✅ 已修：⑧e 直调断言 4 组精确值（config 胜出 / 联动胜出 ×2 / 上限夹断） |
| P2-2 | "覆盖值真作用于截图等待"无断言 | P2 | ✅ 已修：⑧f 断言相邻滚动间隔 ≥ settle（150ms，容差 20ms） |
| P2-3 | 两类畸形 PNG 抛的不是 `PngUnsupportedError`（无 IDAT → 普通 Error；IHDR 长度 <13 → RangeError） | P2 | ✅ 已修：IHDR 加 `len≥13` 校验、`idat.length===0` 前置判空并统一抛错 |
| P2-4 | partial 失败返回缺 `shots_deduped`/`dedup_method` | P2 | ✅ 已修：补两字段 + `RenderFailure` 类型声明 |
| P2-5 | 无截图路径仍报 `sha1+phash` | P2 | ✅ 已修：`DedupMethod` 增 `'none'`，api-only 与无 Edge 降级两条路径改报 `none` |
| P2-6 | 断言依赖仓外绝对路径 fixture，且与 T-23 "45 张"口径不一致 | P2 | ⏸ 保留（见 §10.6；已在 evidence 登记） |
| P2-7 | 文档三处偏差（内存段 / 校验范围未写 / evidence 行数 2846 vs 2845） | P2 | ✅ 已修：Design §16.4 内存段改为"只留 1 份 8KB 指纹、峰值 ~10.4MB 瞬时"；§16.2/§16.6 补"仅 render:true 校验"；evidence 行数改为 2845 |
| P2-8 | Paeth "c 胜出"与"未知行滤波"分支未被桩覆盖（实现已由审查方独立编码器随机往返验证正确） | P2 | ⏸ 保留（见 §10.6） |

**审查逐项结论**：参数与预算联动 **通过**；PNG 解码器 **通过**；判定逻辑 **有条件通过（P1-1 已有可达误删路径）**；去重接线 **通过**；P0/P1/P2 非回归 **通过**；断言质量 **部分通过**；资源与安全 **通过**；文档一致性 **基本一致**。

## 10.5 修复后的复验

| 门 | 命令 | 结果 |
|---|---|---|
| 构建 | `bash scripts/build.sh` | exit 0 |
| 类型 | `tsc -p tsconfig.json --noEmit` | exit 0 |
| **verify** | `node scripts/verify.mjs` | **22 项全 PASS** |
| 准入 | `check-plugin-ready.mjs <bundle>` | `[PASS] bundle` 1/1 |
| **加固可证伪①** | 去掉 uniform 守卫 + 逐格否决 → `assert-shots` | **exit 52**（"③i 应保留 [A,C] 共 2 张，实际 1 张"）→ 还原 PASS |
| **加固可证伪②** | 把 prev 在丢弃分支也前移（基准错成采集帧）→ `assert-shots` | **exit 52**（同上）→ 还原 PASS |
| 真实端到端（加固后） | `render:true, render_settle_ms:2500, max_shots:20` | 正文 **2404 字符**、20 张、**丢 0 张**、`settle 2500ms / 预算 100000ms`（= ⌈20×2500×1.6⌉+20000）、80.4s 不超时 |

## 10.6 有意保留与重要取舍

| ID | 内容 | 理由 |
|---|---|---|
| **加固代价** | **去重命中率显著下降**：实测 45 帧与 20 帧两种真实序列，丢弃数均为 **0**；加固前首版在 50 屏序列里曾丢 4 张（那 4 对含 maxCell > 24 的局部差异，新规则一律保守保留） | **安全优先**：误删真内容不可逆，漏删只是多留几张图。当前 FR-14 在安全侧近似等于"sha1 精确去重 + 极近重复"。恢复收益需更精细判定（掩蔽 UI 覆盖区后比对内容区），列为 **P4 候选** |
| P2-6 | 断言依赖 `C:\deepseek网页抓取\…-3.shots` 仓外样张（缺则 FAIL 不静默跳过）；门禁实抽样 5+10 张，DEV-PLAN T-23 写"45 张" | 方向安全（缺失即失败）；干净 checkout 需自行准备样张。已在 evidence 与本节登记口径偏差 |
| P2-8 | Paeth "c 胜出"、未知行滤波两分支无桩覆盖 | 审查方已用独立编码器做 ch=1/2/3/4 × 五滤波随机往返，全 OK（含 c 分支命中 1748 次）；补桩为 P4 收尾项 |
| 沿用 P2 | O-11 404 页不降级 / O-13 robots 复杂通配 / O-16 纯图片页取不到文字 / O-17 页面 JS 可能访问内网 / P2-6 临时 profile 删除失败静默 / P2-7 素材包非原子写 | 见 §9.7 |

## 10.7 P3 可发布标记

**SHIPPABLE（v0.6）**

依据：结构合规（参数 **10** / 错误码 **11** / Config **17**，零新依赖）；**独立只读审查报回的 3 条 P1 + 5 条可修 P2 已全部修复并复验**（verify 保持 **22 项全 PASS**；新增断言 ③i/③j/③k/①b/①c/⑧e/⑧f/⑧g）；**两次加固可证伪抽检**均按预期失败并还原；真实站点 `render:true + render_settle_ms:2500` 产出可核验素材包（正文 2404 字符、20 张、预算联动 100000ms、不超时）；不传 settle 时零回归（`settle 700 / 预算 90000`）；P0/P1 回归通过；Edge 与临时 profile 零残留；`.zcode` 已删除、全仓 `sk-*` 0 命中。

**必须随标记阅读的限制**：§10.6 全表（**加固代价 = 去重命中率下降**、P2-6 仓外样张、P2-8 滤波覆盖）与 §9.7 沿用项。


---

# 11. 第五批增量验收（FR-15 渲染期剥离覆盖型浮层 · 插件 v0.5.0）

## 11.1 检查范围与输入

| 类别 | 路径 |
|---|---|
| 需求 | `Plugin-Spec.md` **v0.6** §4.2 FR-15（已过审） |
| 设计 | `Plugin-Design.md` **v0.6** §17（已过审）+ 结构图 v5（四门 PASS + 人眼复核） |
| 计划 | `DEV-PLAN.md` **v1.1** §13（T-28~T-37、R-29~R-35，已过审） |
| 产物 | `bundle/` **v0.5.0**：`src/index.ts` **2977 行** + `assert-strip.mjs`（verify **23 项**） |
| 证据 | `evidence/p5-selftest.md`、`evidence/p4-rootcause-probe.md`、`workorders/probe-p4-strip.mjs` |

## 11.2 逐项检查结果

| 检查项 | 方法 | 证据 | 结论 |
|---|---|---|---|
| 结构合规 | 读 `package.json` / `cordis.patch.yml` | `name=@dsh-external/dsh-deepseek-fetch` `version=0.5.0` `type=module`；`dsh.bundle.patch=./cordis.patch.yml` 文件存在；patch 含 `- insert: [{id: deepseek-fetch, name: '@dsh-external/dsh-deepseek-fetch'}]`；`peerDeps = @deepseek-ai/dsh-tools, cordis, schemastery` | 通过 |
| 构建 / 类型 | `bash scripts/build.sh`、`tsc --noEmit` | 均 **exit 0** | 通过 |
| 自验门禁 | `node scripts/verify.mjs` | **`verify: PASS（23 项）`**（含 `strip-ok`） | 通过 |
| 准入 | `check-plugin-ready.mjs <bundle>` | `[PASS] bundle` **1/1** | 通过 |
| 装配与启动 | `dev_plugin_status` | `[active] deepseek-fetch (@dsh-external/dsh-deepseek-fetch)`，entry = `file:///C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js` | 通过 |
| 唯一性（loader id） | 全量 entry 清单比对 | `deepseek-fetch` 仅 1 条 | 通过 |
| 唯一性（工具名） | 扫全量 `@dsh-external/*/lib/index.js` | 无其他插件声明 `deepseek_fetch` | 通过 |
| 功能生效 | 宿主内真实调用 | 本会话多次调用 `deepseek_fetch` 成功（单页/合集/素材包三形态） | 通过 |
| 边界：无浮层页面 | `{url: example.com, render:true}` | `ok=true`、`overlays_stripped=0`、1 张截图 → **不误剥** | 通过 |
| 边界：越界参数 | `render_settle_ms: 6000` | `ok=false`、`E_INVALID_URL` | 通过 |
| 边界：剥离失败 | 断言⑤（求值抛错桩） | `stripOverlays` 返回 0 且不抛 | 通过 |
| **端到端：浮层剥离** | kdocs 真实抓取 | manifest `overlays_stripped=4`、正文 **2404 字符**（剥离前后一致）、**人眼读图确认浮层消失** | 通过 |
| **防恒绿（三级）** | 突变抽检 | ① 常量 0.85→0.0 → 常量守卫失败；② 去插值 → 插值守卫失败；③ **反转文本守卫比较** → **行为断言失败**（`① 假浮层应剥离 1 个，实际 0`）；三次还原后 23 项 PASS | 通过 |
| P0 回归 | 单页 | `ok=true`、无 `> 来源:`、无 front matter、916 字符 | 通过 |
| P1 回归 | 合集 `children:true` | `ok=true`、3 页、3 条来源行、含未抓取清单 | 通过 |
| 生命周期 | `dev_reload_package` | 重载前后均 `[active]`，无重复注册 | 通过 |
| 资源 | 临时 profile / 进程 | `%TEMP%\dsh-dsf-edge-*` 残留 **0**；**未按进程名杀 Edge** | 通过 |
| 交付卫生 | 目录与扫描 | `.zcode/`（483 B 明文 Key）已删；全仓 `sk-*` **0 命中**；`lib/_bak*` 0、`src/_bak*` 0 | 通过 |
| 数量红线 | 计数 | 参数 **10** / 错误码 **11** / `CONFIG_FIELDS` **18** / verify **23** / 新 npm 依赖 **0** | 通过 |
| UI 门禁 | — | 不适用（B 分支，无 UI） | 不适用 |

## 11.3 缺陷清单

**已闭合**

| ID | 描述 | 等级 | 处置 |
|---|---|---|---|
| D-30 | ZCode 首轮 `[zcode-fallback:other]`「Turn execution failed」**失败前已写入大部分代码**；第二轮声明"基线 pin 不符、判为续作" | 流程 | 主侧**未盲目回滚**：核对 pin 差异 + 三文件逐字节一致 + 契约逐字吻合后，改为**逐条实测验收**（构建/tsc/门禁/三级突变/端到端/回归/卫生全跑）。若当时重写将白烧一轮 230 万 token |

**暂无未闭合缺陷**（待独立审查回填）

## 11.4 独立只读审查（子代理 4f40ad25…，静态审查 + 只读探针）

**结论：0 项 P0；1 项 P1；12 项 P2。**

| 编号 | 缺陷 | 等级 | 处置 |
|---|---|---|---|
| **P1-1** | 剥离后不刷新滚动容器引用 → 容器（或其祖先）被移除时脱挂节点 `scrollHeight` 恒 0 → 误判触底 → **静默只出 1 张、不计 partial、无告警** | **P1** | ✅ 已修：剥离数 > 0 时重新采集 + 重选容器 + 重置 `lastY`/`repickStalls` |
| P2-1 | Design 写"自身文本量"，实现是**子树** `textContent` | P2 | ✅ 文档改述 + 注明"祖先效应 = 安全方向漏剥" |
| P2-2 | 300 字边界三处口径不一（实现 `>300` 跳 vs 文档"<300"） | P2 | ✅ 实现改为 `>=` 跳过，对齐"<300 才剥"；新增 ④d 边界断言 |
| P2-3 | Spec 验收④ 自相矛盾（写了不存在的参数名 + "不传即与 v0.4.0 一致"） | P2 | ✅ 改为"`Config.renderStripOverlays=false` 时逐语义一致" |
| P2-4 | 视口面积为 0 时面积约束恒真（探针 5×5 被剥） | P2 | ✅ 表达式加 `if (!(area > 0)) return 0`；新增 ④c 断言 |
| P2-5 | 只判面积不判定位 → **流内**短区块被误剥（探针 `.guide-content` 8 字命中） | P2 | ✅ 新增**第五重约束**（position ∈ fixed/absolute/sticky）；实测真实站点仍剥 4 个 |
| P2-6 | 计数允许非整数（`2.5` 原样返回） | P2 | ✅ 收紧为 `Number.isInteger`；新增断言 |
| P2-7 | 断言覆盖缺口（"截图**前**"未被断言 / 脱挂未模拟 / 边界未覆盖） | P2 | ✅ 已补 **⑥b 事件序列断言** + ④b/④c/④d/④e/非整数；并在证据中给出**可证伪证明**（交换两块 → ⑥b 失败）。剩余 (b)(c)(d) 登记 P6 |
| P2-8 | 每屏一次 `body *` 全量扫描的预算成本 | P2 | ⏸ 已在 Design §17.2 登记成本 + P6 缓解候选 |
| P2-9 | "非 render 路径不出现字段"表述不准（auto+api 仍截图） | P2 | ✅ 文档改为"未跑截图通道的路径不出现" |
| P2-10 | 验收②③ 缺实测数据（真实"同内容帧"样本不可得） | P2 | ✅ 降级为"以断言为准，不作本批实测验收项"（与 Design §17.6 一致） |
| P2-11 | 证据"4 个=容器+面板+标题+遮罩"与约束②不相容 | P2 | ✅ **我的描述不实**：用 `probe-strip-audit.mjs` 实测 4 个元素并逐条列出（3 个 fixed 全屏层 + 1 个 absolute 登录弹窗壳） |
| P2-12 | 工具成功文本未回显 `overlays_stripped` | P2 | ✅ 成功文本追加 `剥离 N 个覆盖层` |

**审查逐项结论**：四重约束语义 **实现齐全**；安全性 **无 P0**（正文 md 在剥离前已取，最坏只损截图）；调用契约 **通过**；Config/返回字段 **通过**；失败语义 **通过**（7 类非数值全部折叠为 0）；断言质量 **无恒真**（用 `new Function` 执行生产表达式）；非回归 **通过**（四阈值未动、10/11/23 红线）；文档一致性 **大体一致、四处已改**；资源与安全 **通过**（零新依赖、只 `el.remove()`）。

**修复后复验**：`build` 0 / `tsc` 0 / **`verify` 23 项 PASS** / 准入 1/1；真实 kdocs `overlays_stripped=4`、正文 2404 字符未削弱；成功文本回显"剥离 4 个覆盖层"；⑥b 突变抽检按预期失败（exit 54）。

## 11.5 残留与生命周期结论

- 卸载即净：插件仅注册 1 个工具（`deepseek_fetch`）+ 1 条 loader entry，无路由/定时器/slot/监听器；`dev_reload_package` 反复重载无泄漏迹象。
- 外部残留：Edge 临时 profile 由插件自建自删（实测残留 0）；渲染子进程只回收自己 spawn 的 child。

## 11.6 交付说明

| 项 | 值 |
|---|---|
| 装配方式 | profile `web` 的 `dependencies` 声明 `link:C:\project-study\dsh-deepseek-fetch\bundle` + `dsh.profile.bundles` 含包名；重启后由 bundles 正常装配 |
| 卸载方式 | `dev_uninject_plugin dsh-deepseek-fetch`，或从 profile `package.json` 移除 link 依赖与 bundles 条目后重启 |
| 回滚 | `git`-less：保留 `evidence/` + 本报告；代码级回退以 `DEV-PLAN.md` §13.8 备份路径为准 |
| 迁移（方案 A） | 待执行 T-34~T-37：建 GitHub 仓 → 克隆 `D:\dsh-sync\packages\dsh-deepseek-fetch` → 宿主 link 改指 → 迁移后回归 |

## 11.7 第五批可发布标记

**SHIPPABLE（v0.7）**

依据：结构合规（loader id `deepseek-fetch` 唯一、工具名 `deepseek_fetch` 无冲突、`dsh.bundle.patch` 指向真实文件）；构建/类型全绿；**verify 23 项全 PASS**；准入 1/1；宿主内 `[active]` 且真实调用三形态成功；**真实 kdocs `overlays_stripped=4` 且正文 2404 字符未削弱、人眼确认浮层消失**；无浮层页面 `overlays_stripped=0` 不误剥；**独立审查 1×P1 + 9×P2 已修并复验**（含新增 6 组断言与"剥在截之前"的可证伪证明）；数量红线（参数 10 / 错误码 11 / Config 18 / verify 23 / 新依赖 0）；P0/P1 回归通过；`.zcode` 已删、`sk-*` 0 命中、`_bak` 0、临时 profile 0。

**必须随标记阅读的限制**：§11.3 已闭合缺陷、§11.4 登记不修项（P2-7 部分 / P2-8 扫描成本 / P2-10 样本不可得）、以及 §9.7 沿用项。
