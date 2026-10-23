# Plugin-Design — dsh-deepseek-fetch

- 版本：v0.6
- 日期：2026-10-21
- 阶段：02 设计（待用户审核）
- 输入基线：`Plugin-Spec.md` v0.3（用户已确认【阶段1审核通过】）

---

## 1. 设计输入与阶段01 结论引用

**规格基线**：`Plugin-Spec.md` v0.3 —— 交付 FR-1 ~ FR-8（P0 单页抓取）；FR-11（P1 子页合并）仅登记。

**UI 结论原文引用**（阶段01 §7，本阶段不得改写）：

> **结论**：纯后台逻辑 / 纯工具插件，无任何前端 UI 视图。
> **承载形态**：不适用（① / ② / ③ 均不成立）。阶段02 **不启动 `style-design`**，阶段02 与阶段05 均不需要 verify 门禁证据。

因此本设计走 **B 分支（无前端 UI）**，只审设计文档。

**实测事实（设计前提）**：

| 事实 | 来源 | 设计后果 |
|---|---|---|
| 接口返回 `{title, content}`，content 含反斜杠转义 | 12 例实测 | 需要清洗层（FR-2） |
| content **不含任何链接** | 4 站实测 `mdLinks=0` | P1 无法在 P0 上顺延实现，需独立 HTML 通道；P0 不预留假参数 |
| 无 `x-ratelimit-*` 响应头 | 全量实测 | 只能以 429 兜底 |
| 部分站点 404（维基百科） | 实测复现 | `E_FETCH_FAILED` 是一等错误面 |
| 凭据仅用户级环境变量可用（进程级为空） | 本机实测 | 需要三级凭据解析（见 §7） |

## 2. 总体架构与运行平面归属

### 2.1 结构图（archify 出图闸门）

- 产物：[dsh-deepseek-fetch-structure.html](C:\project-study\dsh-deepseek-fetch\diagrams\dsh-deepseek-fetch-structure.html)
- 候选源：[structure.candidate.json](C:\project-study\dsh-deepseek-fetch\diagrams\structure.candidate.json)（sha256 `8de8b570…` → 终版见 receipt）
- **生成时点**：2026-10-21 02:05（Asia/Shanghai）
- **基线版本**：`Plugin-Spec.md` v0.3；插件 v0.1.0（尚未建仓，无 git commit）
- **机检 receipt**：`diagrams/dsh-deepseek-fetch-structure.finalize.json`；四门 **validate=pass / deliver=pass / check=pass / browser-check=pass**
- **渲染证据**：`diagrams/shots3/*.png`（1440×900 与 2048×1320，明/暗各一）；人眼复核结论：组件无重叠、走线清晰、卡片可见、边界与凭据组清晰
- **环境预检**：`archify-preflight.ps1` → `READY browser=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（本机无 Chrome，**按闸门写死走 Edge**，已设 `ARCHIFY_CHROME`；未降级）
- **权威与时效（R2）**：图是**时点性审核对象**；实施中若挂载点/依赖边变化 → 工单级重画重审；**图与本文冲突以本文为准**

图表达的结构（文字等价）：

```
用户 → Agent 会话 → deepseek_fetch（工具契约入口）
                       ├─① 校验层 → ② 调用层 → DeepSeek Fetch API（HTTPS）
                       │                 ↑ Bearer（仅内存）来自 DEEPSEEK_API_KEY
                       ├─③ 清洗层 → ④ 命名层 → ⑤ 落盘层 → 本地文件系统 C:\deepseek网页抓取\*.md
                       └─Config（endpoint / 默认目录 / 超时 / 重试 / clean 默认值）
边界：HOST 组合面 bundle entry（无 client 半 / 无 service / 无定时器）；凭据只进内存
```

### 2.2 运行平面归属

| 能力 | 平面 | 判据与理由 |
|---|---|---|
| 工具 `deepseek_fetch` 注册 | **HOST 组合**（bundle patch 的 entry） | 与 `site-crawl` 同范式：`export const inject = ['tools']` + `ctx.effect(() => ctx.tools.register(...))`。工具对每个 session 可见，但**无 per-session 状态**，不需要进预设行 |
| 配置（endpoint / 默认目录 / 超时 / 重试 / clean） | **HOST 组合**（`Config = z.object(...)`） | 部署可变项，由 profile patch 的 config 覆盖；不硬编码 |
| 凭据解析 | **HOST**（进程 env → 用户级 env → Config.apiKey） | 不引入 `credentials` service 硬依赖，保持零额外服务依赖；不落盘、不回显 |
| 服务（service） | **无** | 无组外消费者；因此**不涉及**预设 `isolate` realm 约束 |
| 事件订阅 | **无** | 无跨组件协作需求 |
| client 半（UI） | **无** | 阶段01 UI 结论：无 UI |

> 结论：单条 host 侧 entry 即可，**不新增预设 service 行**；`preset-dsh-deepseek-fetch` 仅承载默认配置（bundle 预设），不含 service。

## 3. 插件形态与 host/client 职责

| 项 | 内容 |
|---|---|
| 形态 | **toolkit（工具包）** |
| host 半 | 注册 1 个工具 `deepseek_fetch`；提供 5 层内部管线（校验/调用/清洗/命名/落盘）；读 Config；读凭据 |
| client 半 | **无**（无 UI、无 slot、无样式注入） |
| 后台任务 | 无定时器、无循环、无 job |
| P1 扩展点 | 内部 `fetchOne()` 与 `writeDoc()` 保持纯函数化，P1 的 BFS 复用二者；**P0 不暴露** `children` / `max_depth` / `max_pages` 参数（避免"看起来支持其实没实现"） |

## 4. 工具契约

### 4.1 `deepseek_fetch`

| 项 | 定义 |
|---|---|
| name | `deepseek_fetch` |
| description | 抓取指定网页并由 DeepSeek 官方 Fetch API 转为 Markdown 落盘。文件内容即正文（无 front matter / 来源行 / 时间头）；失败不落盘并返回结构化错误码。 |
| 呈现意图 | **generic**（返回文本摘要 + 结构化对象；无 terminal / diff 渲染） |
| 是否后台 | 否（同步等待，超时 60s） |
| 幂等性 | 非幂等（每次落盘一个新文件；重名自动加序号，不覆盖） |

**参数 schema**

| 参数 | 类型 | 必填 | 默认 | 校验 | 说明 |
|---|---|---|---|---|---|
| `url` | string | 是 | — | 非空；≤8192 字符；`http/https`；含 host；**不含用户名/密码** | 与接口侧约束一致，本地前置拒绝 |
| `output_dir` | string | 否 | `config.defaultOutputDir`（`C:\deepseek网页抓取`） | 非空；绝对路径则直接用，相对路径基于会话工作区解析 | 目录不存在则递归创建 |
| `clean` | boolean | 否 | `config.defaultClean`（`true`） | — | `true` 剥离 Markdown 反斜杠转义；`false` 原样保真 |

**返回（成功）**

```json
{ "ok": true, "title": "string", "path": "C:\\deepseek网页抓取\\xxx.md",
  "bytes": 12480, "chars": 6102, "request_id": "…", "elapsed_ms": 1830 }
```

**返回（失败）**——不抛异常（框架级参数校验除外），便于 agent 读码换通道：

```json
{ "ok": false, "code": "E_FETCH_FAILED", "message": "failed to fetch URL",
  "request_id": "…", "hint": "目标站点拒绝抓取，可改用 site_crawl" }
```

**错误码表**

| code | 触发 | hint（给 agent 的行动建议） |
|---|---|---|
| `E_INVALID_URL` | 空 / 超长 / 非 http(s) / 含凭证 / 无 host | 修正 URL 后重试 |
| `E_NO_KEY` | 三级解析均未取到 Key | 配置 `DEEPSEEK_API_KEY` 或 Config.apiKey |
| `E_AUTH` | 401 / 403 | Key 无效或无权限 |
| `E_FETCH_FAILED` | 404 且上游 message 含 `failed to fetch URL` | 站点不可抓，换 `site_crawl` |
| `E_RATE_LIMIT` | 429 | 稍后重试 |
| `E_UPSTREAM` | 5xx / 网络异常 / 超时（已重试 1 次） | 重试或稍后 |
| `E_EMPTY_CONTENT` | 200 但 content 为空/纯空白 | 该页无正文（可能是 SPA 空壳） |
| `E_IO` | mkdir / 写入 / 改名失败（权限、占用、磁盘满） | 换目录或检查权限 |

**渲染函数**：成功 → `抓取成功：<title>\n路径：<path>（<chars> 字符，<elapsed_ms>ms，request_id=<id>）`；失败 → `抓取失败：<code> — <message>`。

## 5. 服务与事件契约

| 项 | 结论 |
|---|---|
| 注册 service | **无** |
| 依赖注入 | `export const inject = ['tools']`（硬依赖，唯一） |
| 事件订阅 | **无**（无 `ctx.on`；waterfall / serial 均不适用，故无 `next()` 约定需要） |
| 暴露给其它插件的能力 | 无（内部函数不导出为 service 方法） |

## 6. client ↔ host 通道契约

**不适用**（无 UI、无 client 半、无私有 JSON 方法、无 slot）。本阶段不产出任何 client 侧代码或样式。

## 7. 配置面（Config）

`export const Config = z.object({...})`（schemastery）

| 字段 | 类型 | 默认 | 校验 | 说明 |
|---|---|---|---|---|
| `defaultOutputDir` | string | `C:\deepseek网页抓取` | 非空 | 默认落盘目录；POSIX 下由实现退化为 `~/deepseek网页抓取` |
| `endpoint` | string | `https://api.deepseek.com/v1/tools/fetch` | 必须 http(s) | 端点可覆盖（测试/代理场景） |
| `timeoutMs` | number | `60000` | 1000–300000 | 单次请求超时 |
| `retries` | number | `1` | 0–3 | 5xx/网络异常重试次数（429 不重试，直接回报） |
| `defaultClean` | boolean | `true` | — | `clean` 参数缺省值 |
| `apiKeyEnv` | string | `DEEPSEEK_API_KEY` | 非空 | 环境变量名 |
| `apiKey` | string | `''`（空=不启用） | — | 兜底直配（不进日志、不回显；仅建议在本地 profile patch 使用） |

**凭据解析顺序（v0.2 更正，按 Spec FR-7）**：① `process.env[apiKeyEnv]` → ② Windows 用户级环境（`reg query HKCU\Environment /v <name>`，非 Windows 跳过）→ ③ `config.apiKey` → ④ `E_NO_KEY`。
**理由**：本机实测进程级为空、用户级有值；不引入 `subprocess` service，避免额外注入面。v0.1 曾误写为 env→config→reg，与 Spec FR-7 相反，已按 Spec 更正（代码自始按 Spec 实现）。

**配置错误行为**：类型/范围不合法 → **加载期大声失败**（schemastery 抛错，插件不装载），不允许静默回退默认值。

## 8. 数据与持久化设计

**不建库、不写宿主存储、不写台账（FR-9 未实现）**。唯一持久化产物 = 目标目录下的 `.md` 文件。

| 项 | 设计 |
|---|---|
| 文件内容 | **= 接口 `content`（经清洗）本身**；UTF-8 无 BOM；不追加换行/页脚 |
| 写入方式 | 写满同目录临时文件 `.<name>.tmp-<pid>-<rand>` → **排他占名**：`fs.link(tmp,target)`（目标已存在即 `EEXIST` → 换候选；不支持硬链接的文件系统退化为 `copyFile(...,COPYFILE_EXCL)`）→ `finally` 清理临时文件。**刻意不用 `rename`**：Windows（`MOVEFILE_REPLACE_EXISTING`）与 POSIX 的 rename 都会静默覆盖已存在目标，无法提供「绝不覆盖」保证（阶段05 独立审查 P1-1） |
| 并发/重名 | 目标名被占用（`EEXIST`/`EPERM`）→ 序号 `-2`…`-99` 递增重试；仍冲突 → `-YYYYMMDD-HHmmss` + 4 位随机；再失败 → `E_IO` |
| 目录 | `fs.mkdir(dir, { recursive: true })`；路径用 `path.resolve` 归一 |
| 文件名规则 | 标题 → 去文件系统非法字符 `<>:"/\|?*` 与控制字符 → 空白折叠为 `-` → 去首尾 `-`/`.` → 截断 80 字符；空标题回退 `host-pathname`；Windows 保留名（`CON/PRN/AUX/NUL/COM1-9/LPT1-9`）前缀 `_`；保险回退 `untitled` |
| 版本策略 | 无持久 schema（无 `SCHEMA_VERSION` 需求）。若 P1 启用 FR-9 台账，JSONL 每行须带 `v:1` 字段 |
| 损坏行为 | 不适用（不读回自己写的文件） |
| **P2 素材包**（FR-12） | 渲染通道额外产出：`<基名>.shots/NN.png`（分屏截图，sha1 去重）与 `<基名>.manifest.json`（清单，含 `text_source`/`shots_total`/`shots[]`/`merge_hint`）；文字仍落 `<基名>.md`（走同一排他占名，不覆盖同名旧文件）。manifest 无版本字段（结构随实现演进，仅本轮使用） |

## 9. 生命周期与资源回收清单

| 副作用 | 注册方式 | 回收 |
|---|---|---|
| 工具 `deepseek_fetch` | `ctx.effect(() => ctx.tools.register(defineTool({...})), 'dsh-deepseek-fetch: deepseek_fetch')` | `ctx.effect` 的 disposer 在插件卸载/重载时自动注销工具 |
| HTTP 请求 | 每次调用内创建 `AbortController` | `finally` 中 `clearTimeout` + 请求结束即释放 |
| 临时文件 | 每次调用内创建 | `try/finally` 中 `unlink`（成功 rename 后无残留） |
| 定时器 / 事件 / slot / 样式 | **无** | 不适用 |
| 模块级可变状态 | **无**（无缓存、无全局单例、无懒加载注册） | 重载后无残留 |

## 10. 失败模式与用户可见表现

| 场景 | 内部处理 | 用户/agent 看到 |
|---|---|---|
| 参数不合法（缺 url / 类型错） | 框架 schema 校验抛错 | 工具调用错误（框架级） |
| URL 非法/带凭证/超长 | 本地前置拒绝，不发请求 | `E_INVALID_URL` + 原因（不消耗外网调用） |
| 无 Key | 三级解析失败 | `E_NO_KEY` + 配置指引 |
| Key 失效 | 401/403 | `E_AUTH` |
| 站点拒绝抓取 | 404 + 特定 message | `E_FETCH_FAILED` + 建议换 `site_crawl` |
| 限流 | 429，不重试 | `E_RATE_LIMIT` |
| 5xx / 网络错误 / 超时 | 重试 1 次（可配） | 仍失败 → `E_UPSTREAM` |
| 返回空正文 | 不写文件 | `E_EMPTY_CONTENT` |
| 目录不可写 / 磁盘满 / 文件被占用 | 不写半成品（临时文件已清理） | `E_IO` + 系统错误摘录 |
| 并发写同名 | 序号递增；原子 rename 保证不覆盖 | 两个文件并存（`-2` 后缀） |
| 插件重载 | `ctx.effect` 注销工具；无状态残留 | 重载后同名工具唯一存在 |

## 11. 复用对照表（不重复造轮子）

| 资产 | 来源路径 | 复用方式 | 具体借用点 |
|---|---|---|---|
| 工具注册范式 | `D:\deepseek-harness\plugins\dsh-site-crawl\lib\index.js:345-368` | **借鉴** | `defineTool({name, description, parameters, output:{schema,render}, execute})` + `ctx.effect(() => ctx.tools.register(...), '<id>: <name>')` |
| Config 范式 | 同上 `:3-10` | **借鉴** | `export const Config = z.object({ ... z.number().default(...) })` |
| URL 校验 / 同域判断 / 去重工具函数 | 同上 `:14-44`（`resolveUrl` / `sameSite` / `canonicalKey`） | **P1 借鉴** | P0 仅借「协议白名单 + creds 拒绝」思路；P1 直接复用三函数 |
| 构建脚本 | `dsh-site-crawl/scripts/build.sh` | **克隆** | `DSH_CHECKOUT` 探测 + junction link 依赖 + `tsc -p tsconfig.json` |
| bundle patch 声明 | `dsh-site-crawl/package.json`（`dsh.bundle.patch`）+ `cordis.patch.yml` | **克隆** | `- insert: [{ id: deepseek-fetch, name: '@dsh-external/dsh-deepseek-fetch' }]` |
| 注入器（开发期验证） | `dev_inject_plugin` / `dev_build_plugin` / `dev_reload_package` | **复用** | 无需重启即可注入、热重载、卸载 |
| 插件骨架技能 | `deepseek-harness-plugin-creator` | **参考** | 目录结构、`peerDependencies` 范围声明 |
| 官方抓取提供者 | `packages/web/web-fetch-http` | **仅参考** | 超时/重试封装思路（不复用其抓取实现，本插件正文来自 DeepSeek API） |

**明确不复用**：`site_crawl` 的 HTML→Markdown 转换与 BFS（本插件正文由官方 API 提供，重复实现即为浪费）。

## 12. UI 设计交付物索引

【本插件无前端 UI 模块，跳过 style-design 页面设计环节】

依据：`Plugin-Spec.md` v0.3 §7《UI 需求识别结论》——结论为「纯后台逻辑 / 纯工具插件，无任何前端 UI 视图」，承载形态不适用。

因此：`design/` 目录**不创建**；无 `DESIGN.md`、无 theme kit、无页面脚手架、**无 verify 证据与已登记例外（均不适用）**。阶段05 亦不执行 UI 门禁复核。

## 13. 逐页形态归属表

| 页面 | 形态（① 宿主内嵌 / ② 独立页面） | 颜色来源 | 脚手架 | 门禁模式 | verify 证据 |
|---|---|---|---|---|---|
| 无页面 | 不适用（B 分支，无 UI） | 不适用 | 不适用 | 不适用 | 不适用 |

## 14. P1 增量设计（FR-11：同域子页合并抓取）

> 本节为 **v0.2 增量**（P1 第二批）。P0 设计（§1~§13）不变，本节只写新增/变更面。

### 14.1 结构变更与图

- 图产物：[dsh-deepseek-fetch-structure-v2.html](C:\project-study\dsh-deepseek-fetch\diagrams\dsh-deepseek-fetch-structure-v2.html)（候选 `structure-v2.candidate.json`）
- **生成时点**：2026-10-21 04:08；**基线**：Plugin-Spec v0.3 FR-11；插件 v0.2.0（未建仓，无 commit）
- 四门：**validate / deliver / check / browser-check 全 PASS**；渲染证据 `diagrams/shots-v3/*.png`；人眼复核：无重叠、双路径（单页/合集）方向清楚
- 新增组件：**发现层（HTML）**、**BFS 队列**、**robots.txt**、**合并器**；平面不变（仍是同一 bundle entry，**不新增 service**）
- 图权威：与时点性冲突以本文为准

### 14.2 工具契约增量

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `children` | boolean | `false` | — | `true` 走合集路径；`false` 与 P0 行为完全一致 |
| `max_depth` | integer | `2` | 0–5 | 0 = 仅根页；1 = 根页 + 直接子链接 |
| `max_pages` | integer | `30` | 1–200 | 含根页的总页数上限 |

- 参数集合变为 6 项（`url / output_dir / clean / children / max_depth / max_pages`）；`ALLOWED_ARG_KEYS` 由 `TOOL_PARAMETERS` 派生，未知参数仍显式拒绝。
- `max_depth` / `max_pages` **仅在 `children:true` 时生效**；`children:false` 时传了也忽略（不报错，避免 agent 误传即失败）。
- 返回增量：`{ pages_total, pages_ok, pages_failed, skipped? }`；单页路径返回字段不变（向后兼容）。

### 14.3 发现层（独立通道，不复用 fetch 返回内容）

1. `GET <url>` 取**原始 HTML**（`fetch`，超时 `config.timeoutMs`，`AbortSignal` 合并调用方取消信号，UA = `config.htmlUserAgent`）。
   **重定向安全（阶段05 审查 P1-1）**：`redirect:'manual'` 逐跳处理，每跳 `Location` 的 host 必须等于根 host，否则判定越界并失败——否则站点可用 302 把本机通道导向内网（盲打 GET 型 SSRF）。
2. 抽链接：正则匹配 `<a ... href="...">`，HTML 实体做最小解码（`&amp; &lt; &gt; &quot; &#39;`）。
3. URL 归一：`new URL(href, pageUrl)`；丢弃 `#fragment`；**只留 http/https**；丢弃 `mailto:/tel:/javascript:/data:/blob:`。
4. **严格同 host**（用户裁决）：`u.hostname === root.hostname`（大小写不敏感，含端口比较用 `u.host`）；**不跨子域**。
5. 扩展名黑名单（直接跳过）：图片/音视频/样式/脚本/压缩/文档二进制（沿用 site-crawl 的 `BLOCKED_EXT` 思路）。
6. 去重键：`origin + pathname`（保留 query 的页面不重复抓取；仅按 pathname 判重）。
7. 发现通道失败（HTML 取不到/解析 0 链接）：**降级单页**——仍用 DeepSeek fetch 抓根页并生成合集文件（只 1 页），文末「未抓取清单」记 `子页发现失败：<原因>`；返回 `pages_total=1`。

### 14.4 robots.txt（用户裁决：尊重）

- 每个 host 只取一次 `<origin>/robots.txt`（超时 5s，失败/404 → **视为放行**）。
- 解析最小子集：按 `User-agent` 分组（**空行结束一组**），匹配 `*` 或 `config.htmlUserAgent` 的 product token；收集 `Allow` / `Disallow`。
- 规则匹配按 **RFC 9309 §2.2 最小子集**：`*` = 任意串、结尾 `$` = 尾锚、无通配且不以 `/` 结尾 = 「完全相同或其后紧跟 `/`」、以 `/` 结尾 = 路径前缀匹配（`/` 拦全站）。**按字面前缀比较会让 `/*.pdf$`、`/private$` 这类规则永不命中（= 越界抓取），不得退回该实现**；Allow 比 Disallow 更长或等长时放行。
- 被拒 URL → 跳过并记入「未抓取清单」`robots.txt 禁止`。
- **根页被 robots 拒绝** → 直接返回 `E_FETCH_FAILED`（不抓、不落盘），hint 说明 robots 限制。
- `config.respectRobots=false` 可关闭（默认 `true`）。

### 14.5 BFS 与预算

- 队列元素 `{ url, depth }`；根页 depth=0。出队时：**`depth >= max_depth` 的页不再扩展子链接**（`max_depth=1` = 根页 + 直接子链接）；`已抓页数 >= max_pages` 停止扩展。
- 抓取顺序：**FIFO**（先根页，再按其链接出现顺序逐层）。
- 并发：`config.childrenConcurrency`（默认 3，上限 5）；**同一时刻不超过 3 个在途请求**。
- 总预算：`config.childrenTimeoutMs`（默认 300000 = 5 分钟）。预算耗尽 → 停止扩展，剩余待抓页写入「未抓取清单」`超出时间预算`，已抓部分照常合并。
- 单页失败（`E_FETCH_FAILED` / `E_UPSTREAM` / `E_EMPTY_CONTENT`）→ **跳过并记录**，不中断整体。

### 14.6 合并格式（单文件）

```markdown
# <根页标题>

> 来源: <根页 URL>

<根页正文>

---

## <子页标题>

> 来源: <子页 URL>

<子页正文>

---

## 未抓取清单

- <url> — <原因>
```

- 根页用 `#`，子页统一 `##`；**不重写页内标题层级**（避免破坏原文结构）。**已知代价**：页内原有 `#`/`##` 与我方页标题同级甚至更高（子页正文含 H1 时会反压 `##`），且正文自带的 `\n\n---\n\n` 与页间分隔无法区分——两者均为「保真优先」的有意取舍。
- 页间统一 `\n\n---\n\n` 分隔；来源行固定 `> 来源: <url>`。
- 「未抓取清单」只在有跳过项时出现；**条数有上限**（`MAX_SKIPPED=200`），超出部分只给汇总行「另有 N 条未逐条列出，合计 M 条」，避免合集与工具返回值体积无界。
- 文件仍为**纯正文**（无 YAML front matter / 无时间头）。

### 14.7 命名

- 合集文件名：`slugify(<根页标题>) + "-合集"` → 落盘时再加 `.md` 并走同一重名序号逻辑。
- **根页标题形如 URL**（`^https?://`）→ 回退 `<host>-<pathname>` 再拼 `-合集`（仅合集路径启用此回退；单页路径保持 P0 规则，O-01 仍未修）。

### 14.8 Config 增量

| 字段 | 类型 | 默认 | 校验 | 说明 |
|---|---|---|---|---|
| `childrenConcurrency` | number | `3` | 1–5 | 合集路径并发上限 |
| `childrenTimeoutMs` | number | `300000` | 10000–1800000 | 合集路径总预算 |
| `respectRobots` | boolean | `true` | — | 是否遵守 robots.txt |
| `htmlUserAgent` | string | `Mozilla/5.0 (dsh-deepseek-fetch/0.2)` | 非空 | 发现通道 UA |

### 14.9 失败模式增量

| 场景 | 处理 | 用户可见 |
|---|---|---|
| 根页 HTML 发现失败 | 降级单页 + 清单记原因 | `ok:true`，`pages_total=1`，文件末列原因 |
| robots 拒根页 | 不抓不落盘 | `E_FETCH_FAILED`，hint 指向 robots |
| 子页全部失败 | 只含根页 + 清单 | `ok:true`，`pages_failed>0` |
| 总预算耗尽 | 停止扩展，已抓部分合并 | `ok:true`，清单标「超出时间预算」 |
| 并发写同名（两次合集） | 排他占名 + 序号 | 两个文件并存 |
| 调用方取消 | 停止扩展、不落盘 | `E_UPSTREAM`「调用方已取消」 |

### 14.10 复用对照（增量）

| 资产 | 来源 | 复用方式 |
|---|---|---|
| URL 归一 / 扩展名黑名单 | `D:\deepseek-harness\plugins\dsh-site-crawl\lib\index.js`（`resolveUrl` / `BLOCKED_EXT`） | 借鉴（改写为严格同 host） |
| HTML→链接抽取 | 同上（`<a href>` 收集段） | 借鉴（只取 href，不做正文转换——正文仍由 DeepSeek API 提供） |
| 原子落盘 / 清洗 / 凭据 | 本项目 P0 实现 | 直接复用 |

### 14.11 P1 明确不做

不做 sitemap.xml 解析、不做分页参数自动展开、不跨子域、不跟随外链、不做 JS 渲染（发现通道只读静态 HTML；目标页正文仍由 DeepSeek 侧渲染抓取）。

---

## 15. P2 增量设计（FR-12：渲染素材通道 · 形态 A）

> 本节为 **v0.4 增量**（P2 第三批）。P0（§1~§13）与 P1（§14）设计不变。

### 15.1 结构变更与图

- 图产物：[dsh-deepseek-fetch-structure-v3.html](C:\project-study\dsh-deepseek-fetch\diagrams\dsh-deepseek-fetch-structure-v3.html)（候选 `structure-v3.candidate.json`）
- **生成时点**：2026-10-22 01:25；**基线**：Plugin-Spec v0.4 FR-12；插件 v0.3.0（未建仓，无 commit）
- 四门：**validate / deliver / check / browser-check 全 PASS**；渲染证据 `diagrams/shots-v3p2/`；人眼复核：双文字通道与「渲染器→滚动定位→截图器→素材包」链路清楚，Edge 进程边界独立圈出，无重叠
- 环境预检：`PREFLIGHT: READY browser=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（Edge，未降级）
- **新增组件**：① 择源器 ② 渲染器（无头 Edge + CDP）③ 滚动定位 ④ 截图器 ⑤ 素材包写入；平面不变（同一 bundle entry，**不新增 service / client 半**）
- 外部消费者：**Agent 视觉合并**（读图转文字并合并终稿）——属**工具使用方式**，不是插件能力

### 15.2 工具契约增量

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `render` | boolean | `false` | `true` 启用素材通道（文字 + 页面像素） |
| `text_source` | string | `'auto'` | `auto`（按特征择源）/ `api`（只用 DeepSeek 抓取）/ `render`（只用渲染 innerText） |
| `max_shots` | integer | `40` | 截图张数上限（1–100） |

- 参数集合由 6 项扩为 9 项；`ALLOWED_ARG_KEYS` 仍由 `TOOL_PARAMETERS` 派生（未知键继续显式拒绝）。
- **返回增量**（`render:true` 时）：`text_path` / `shots_dir` / `shots[]` / `manifest_path` / `text_source` / `shots_total` / `text_chars`；非 render 路径返回字段不变（向后兼容）。
- **Config 字段总数**：原 11 → **17**（P2 增 6：`edgePath` / `renderTimeoutMs` / `renderViewport` / `renderTextViewport` / `renderSettleMs` / `renderScrollOverlap`）。
- **错误码由 8 增至 11**：新增 `E_NO_EDGE`（找不到 Edge 且 `text_source='render'`）、`E_RENDER_TIMEOUT`（CDP 未就绪 / 渲染或滚动超预算）、`E_RENDER_FAILED`（Edge 启动失败 / 截图失败 / WS 断开）。render 相关失败**不得**复用 `E_IO`/`E_UPSTREAM` 混淆语义。

### 15.3 择源判定（auto 模式）

1. 先用 DeepSeek fetch API 取文字（沿用 P0 调用层）。
2. `text_source='api'` → 用 API 文字，**不启动 Edge**。
3. `text_source='render'` → 启动渲染通道，文字取 `document.body.innerText`（并做 UI 行过滤，见 15.6）。
4. `auto`（默认）→ 命中**任一**特征即改用渲染 innerText：
   - 渲染 DOM 中存在**面积 ≥ 视口 30% 的 `<canvas>`**（WebOffice/图表类正文）；
   - API 文字命中编辑器 UI 噪声标记（`表情与角色` / `顶部工具栏已关闭` / `快捷登录并查看` / `仅查看` / `立即登录` / `点赞` / `留言` / `发送`）；
   - API 文字为空或短于 200 字。
5. **降级而非失败**：`auto` 模式下 Edge 缺失或渲染失败 → 退回 API 文字，返回 `text_source='api(fallback)'` 并附 `warning`；**只有** `text_source='render'` 时才抛 `E_NO_EDGE` / `E_RENDER_*`。

### 15.4 渲染器实现要点（无外部依赖）

- **Edge 定位**：`Config.edgePath`（默认空）→ 否则自动探测 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`、`C:\Program Files\Microsoft\Edge\Application\msedge.exe`、`%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe`；全不中 → `E_NO_EDGE`。
- **启动参数**（实测坑已固化为规范）：
  `--headless=new`（**旧版 `--headless` 不暴露 CDP 端口**）`--disable-gpu --no-sandbox --no-first-run --disable-extensions --disable-background-networking --hide-scrollbars --user-data-dir=<临时目录> --remote-debugging-port=<随机空闲端口> --remote-allow-origins=* --window-size=<W>,<H> <url>`
- **CDP 序列**（Node 内置 `fetch` + 全局 `WebSocket`，**不引入 puppeteer/playwright**）：
  轮询 `http://127.0.0.1:<port>/json/version` → `/json/list` 取 page target → WS 连接 → `Runtime.enable` + `Page.enable` → `Emulation.setDeviceMetricsOverride{width,height,deviceScaleFactor:1}` → 逐次 `Runtime.evaluate` / `Page.captureScreenshot`。
- **超时与预算**：整体 `Config.renderTimeoutMs`（默认 90s）覆盖「启动 + 渲染等待 + 截图循环」；超预算 → `E_RENDER_TIMEOUT`（已产出的截图保留在 manifest 里）。
- **只杀自己拉起的进程**：`finally` 里 `child.kill()`；**绝不**按进程名批量杀 Edge（会误杀用户自己的浏览器）。
- **两阶段视口（v0.4 主侧增补，实测得出）**：
  1. **阶段 A 取文字**：`Emulation.setDeviceMetricsOverride` 切到**高视口** `renderTextViewport`（默认 1440×2400）→ 等就绪 → 读 `innerText`；
  2. **阶段 B 取截图**：切回**标准视口** `renderViewport`（默认 1440×900）→ 跨页滚动分屏截图。
  - 依据：WebOffice 类文档（kdocs）**只有当视口容得下一整页时才把正文渲染进 DOM**——实测 900 与 1600 视口下 `innerText` 恒为 1391 字（仅轮廓面板），2400 视口下为 2670 字（含正文）；若统一用截图视口取文字，正文永远取不到（**静默丢失，不报错**）。这是 P2 阶段最隐蔽的一处陷阱。
- **就绪轮询**：在总预算内每 500ms 轮询「页面有实质内容」（文本 ≥200 字 / 有 canvas / readyState=complete 且有子节点），避免在页面尚未成型时取到空正文（实测 kdocs 渲染需约 9s）。
- **取文字策略＝窗口内取最长的一份**（v0.4 主侧二次增补，实测得出）：切到高视口后**不能**用"连续两次长度相同即稳定"判定——WebOffice 渲染中途存在**平台期**（实测长度序列 `1375 → 2654 → 2654 → 2670 → 2670…`，中途可停在某个值连续两次不变），会被误判为稳定 → 同一文档两次抓取得到 1693 与 2423 两种残缺程度不同的正文。现改为 `waitForTextLongest`：切视口后等 2.5s 重排，再在 6s 窗口内每 400ms 采样，**取最长的一份**。
- **阶段 C 复读**：滚动分屏结束后再切回高视口复读一次正文（滚动会触发更多内容渲染），两次取更长者——只会更全，不会更差。

### 15.5 滚动定位与分屏截图

- **滚动容器**：`Runtime.evaluate` 遍历元素，取 `scrollHeight > clientHeight + 50 && clientHeight > 200` 中**面积最大**者（WebOffice 正文容器**不是** `documentElement`）；找不到则退化为 `window.scrollBy`。
- **分屏**：视口默认 1440×900（`Config.renderViewport`），滚动步长 = 视口高 − `renderScrollOverlap`（默认 60，避免漏行）。
- **每屏等待**：`Config.renderSettleMs`（默认 700ms）——等懒加载/重排稳定。
- **去重**：截图字节 `sha1` 与上一帧相同则丢弃（实测重复帧 4 张）。
- **终止**：到达容器底部（`scrollTop + clientHeight >= scrollHeight - 5`）或达到 `max_shots`。
- **产物命名**：`<基名>.shots/01.png`、`02.png`…（两位序号，顺序即阅读顺序）。

### 15.6 文字与素材包

- 渲染文字：取 `document.body.innerText` 后按已知 UI 行黑名单过滤（与 P1 编辑器 UI 噪声同源），去连续重复块与重复页眉；**不改正文文字**。
- 素材包三件：`<基名>.md`（文字，清洗后走既有 `writeDoc` 排他占名，不覆盖同名旧文件）、`<基名>.shots/NN.png`（分屏截图）、`<基名>.manifest.json`（`{url, title, text_source, text_chars, shots_total, shots:[{file,bytes}], captured_at, merge_hint}`）。
- `merge_hint` 固定文案：「读取 `shots_dir` 下的 PNG，用模型自带视觉能力把图内内容转成文字，按顺序插入 `text_path` 对应位置，形成图文合并终稿」——**插件不调任何视觉 API**（形态 A）。

### 15.7 Config 增量

| 字段 | 类型 | 默认 | 校验 | 说明 |
|---|---|---|---|---|
| `edgePath` | string | `''` | 非空时**优先使用**；文件不存在则**回退默认探测并在 `warnings` 中告警**（不静默） | Edge 可执行文件路径（空 = 自动探测） |
| `renderTimeoutMs` | number | `90000` | 5000–600000 | 渲染通道总预算 |
| `renderViewport` | string | `'1440x900'` | 形如 `W×H` | **截图**视口 |
| `renderTextViewport` | string | `'1440x2400'` | 形如 `W×H` | **取文字**用的高视口（WebOffice 类文档只有视口容得下一整页时正文才进 DOM；实测 900/1600 视口只得轮廓面板 1391 字，2400 视口得正文 2670 字）→ v0.4 主侧增补 |
| `renderSettleMs` | number | `700` | 0–5000 | 每屏等待（等懒加载） |
| `renderScrollOverlap` | number | `60` | 0–400 | 滚动步长 = 视口高 − 该值 |

### 15.8 失败模式增量

| 场景 | 处理 | 用户可见 |
|---|---|---|
| 找不到 Edge | `text_source='render'` → `E_NO_EDGE`；`auto` → 退回 API 文字 | 降级：`text_source='api(fallback)'` + `warning` |
| CDP 未就绪 / 渲染超时 / 滚动超预算 | `E_RENDER_TIMEOUT` | 已产出的截图与文字保留在素材包，manifest 标注 `partial` |
| Edge 启动失败 / 截图失败 / WS 断开 | `E_RENDER_FAILED` | 同上 |
| `auto` 模式特征判定需要渲染通道 | 先起 Edge 做特征探测；探测失败 → 用 API 文字 | 降级 |
| 页面本身不可访问 | 渲染通道同样失败 | `E_RENDER_FAILED`（含上游原因） |

### 15.9 生命周期与资源回收

| 副作用 | 回收 |
|---|---|
| 无头 Edge 进程 | `finally` 中 `kill()`；只针对自己 spawn 的 child |
| 临时 `--user-data-dir` | `finally` 中 `rmSync(recursive, maxRetries)`；删不掉则留待系统清理（不阻塞） |
| CDP 端口 | 随机空闲端口，仅监听 127.0.0.1；进程退出即释放 |
| WebSocket | 截图循环结束或异常时 `close()` |
| 文件句柄 | 截图逐张写完即关（`writeFile` 一次性） |

### 15.10 安全与限制（明示）

- **Windows-only**：渲染通道依赖本机 Edge；非 Windows 或无 Edge → `E_NO_EDGE`（`auto` 模式自动降级为纯 API 通道，插件其余能力不受影响）。
- **页面 JS 会在渲染中执行**，页面自身可能发起内网请求——这是**页面行为**而非插件主动行为，插件不做拦截（已知限制，如实登记）。
- **不支持登录态**：使用独立临时 profile，**不碰用户浏览器 profile**，因此需登录才能看的文档仍取不到。
- **零视觉 API 费用**：插件不调用任何视觉模型；图像文字化由 agent 的模型视觉能力承担（形态 A）。
- **不承诺 OCR 质量**：截图分辨率/字体渲染质量由页面与 Edge 决定，文字化质量取决于视觉模型。

### 15.11 复用对照（增量）

| 资产 | 来源 | 复用方式 |
|---|---|---|
| `writeDoc` / `cleanMarkdown` / `slugify` / `fetchOne` / `resolveApiKey` | 本项目 P0/P1 | 直接复用，不改语义 |
| CDP 客户端 | **Node 内置** `fetch` + 全局 `WebSocket`（Node 24 实测可用） | 自实现约 200 行，**不引入 puppeteer/playwright** |
| Edge 路径与 CDP 实测经验 | `evidence/p2-render-probe.md` | 固化为规范（`--headless=new`、正斜杠路径、随机端口、`DevToolsActivePort`） |

### 15.12 P2 明确不做

不调用视觉 API、不做 OCR、不做登录态、不做 PDF/Word 导出、不做多浏览器渲染、不把渲染通道用于 `children` 合集（FR-11 与 FR-12 的组合留待下版）。

---

## 16. P3 第四批增量设计（FR-13 参数化等待 · FR-14 感知哈希去重）

> 本节为 **v0.5 增量**（P3 第四批）。P0（§1~§13）、P1（§14）、P2（§15）设计不变。

### 16.1 结构变更与图

- 图产物：`diagrams/dsh-deepseek-fetch-structure-v4.html`（候选 `structure-v4.candidate.json`）
- **生成时点**：2026-10-23 00:30；**基线**：Plugin-Spec v0.5 FR-13/FR-14；插件 v0.3.0（未建仓，无 commit）
- 四门：**validate / deliver / check / browser-check 全 PASS**；渲染证据 `diagrams/shots-v4/`（4 张，含 2048×1320 light/dark）
- **人眼复核通过**：链条连续（tool → 入参 → 预算联动器 → 择源器 → 渲染器 → 滚动定位 → 分屏 → 截图器 → 感知哈希去重器 → 素材包 → 本地文件系统；素材包 → 清单+截图 → Agent 视觉合并；择源器 → 文字·api 通道 → DeepSeek API），两个新组件就位，无重叠、Edge 边界清晰。**返工留痕**：2 轮布局修正（① 带标签的横向边净空不足：35/40px < 所需 65/74/103px；② 将横向边标签并入节点副标签、只保留纵向/斜向标签 → 通过）
- 环境预检：`PREFLIGHT: READY browser=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（Edge，未降级）
- **新增组件 2 个**：
  - **预算联动器** —— 由 `render_settle_ms` × `max_shots` 推导本次渲染的**实际总预算**，写入 deadline（不再让调用方手算第二个参数）。
  - **感知哈希去重器** —— 位于「截图器」之后、「素材包」之前：sha1 快路径 + dHash 预筛 + 32×32 MAD 复核。
- **既有组件变更 1 个**：`deepseek_fetch` 的入参面由 9 键扩为 **10 键**（+`render_settle_ms`）。
- 平面不变（同一 bundle entry，不新增 service / client 半）。

### 16.2 工具契约增量

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `render_settle_ms` | integer | 不传 = 不覆盖 | 每屏滚动后的等待毫秒（0–5000）。缺省用 `Config.renderSettleMs`（700）。越界 → `E_INVALID_URL` + **参数专属 hint**（不复用"修正 URL"） |

- 参数集合由 9 键扩为 **10 键**：`url, output_dir, clean, children, max_depth, max_pages, render, text_source, max_shots, render_settle_ms`；未知键仍显式拒绝。
- **返回增量**：`render_settle_ms`（实际生效值）、`render_timeout_ms`（实际生效值）、`shots_deduped`（被丢弃的近重复帧数）、`dedup_method`（`sha1+phash`）。非 render 路径返回字段不变（向后兼容）。
- **错误码仍为 11 个**：不新增码；参数类错误继续用 `E_INVALID_URL` 但带专属 hint（P2 已有 `fail(code, msg, reqId, hintOverride)` 机制）。
- **校验范围**：`render_settle_ms` 的**范围校验只在 `render:true` 时执行**（校验位于 `executeRender` 内）；非 render 路径下该参数**静默忽略、不报错**——与 `max_shots`/`text_source` 同策略（既有一致性）。

### 16.3 预算联动规则（FR-13 核心）

```
settle      = args.render_settle_ms ?? config.renderSettleMs        // 实际每屏等待
needByShots = ceil(max_shots × settle × 1.6) + 20000                // 1.6 = 截图+滚动开销系数
timeout     = clamp(max(config.renderTimeoutMs, needByShots), 5000, 600000)
```

- **依据**：`1.6` 系数来自实测——settle=700ms 时 45 屏耗时 79.6s（约 1.5s/屏，含截图与滚动），settle=2500ms 时 45 屏耗时 159.5s（约 3.4s/屏），即每屏开销 ≈ 0.9s + settle，1.6 留了余量。
- **上限 600000ms** 与 `Config.renderTimeoutMs` 的 schema 上限一致（`z.number().min(5000).max(600000)`）。
- **不覆盖时**：`timeout = config.renderTimeoutMs`（与现状完全一致 → P2 行为零变化）。
- **返回回显**：调用方能直接看到本次实际用的等待与预算，避免"设了 2500 却仍超时"的黑箱。

### 16.4 感知哈希去重器（FR-14 核心）

**两级判定**（顺序执行，命中即停）：

1. **快路径**：`sha1(prev) === sha1(cur)` → 判重（保留原行为，零额外成本）。
2. **感知级**：
   - `decodePng(buf)`：解析 IHDR/IDAT → `zlib.inflateSync` → 逐行反滤波（None/Sub/Up/Average/Paeth 五种）→ `{width,height,channels,pixels}`。**仅支持 8-bit 非隔行**（colorType 0/2/4/6）；隔行或 16-bit → 抛错 → 走回退。
   - `dHash64(img)`：9×8 灰度网格 → 相邻差分 → 64bit `BigInt`。
   - `gray32(img)`：32×32 灰度降采样（`Float64Array`）。
   - **候选**：汉明距离(`dHash`) ≤ **2**；
   - **判定**：`MAD(gray32(prev), gray32(cur))` ≤ **1.5** → 判重。
3. **回退**：PNG 解码失败（异常）→ **仅用 sha1 精确比较**（宁可不删，也绝不因解码失败丢帧），并**记一次 warning**（`dedup_method='sha1(fallback)'`）。

**实测依据（kdocs 45 张真实素材，脚本 `workorders/proto-phash.mjs`）**：

| 指标 | 值 |
|---|---|
| 纯 Node（zlib）解码 45 张 | **1.4 s**（~31ms/张） |
| 真近重复对（27 vs 37，仅差 1~2 像素） | MAD = **0.954** |
| 版式相似但内容不同的幻灯片对 | MAD ≥ **2.791** |
| 分离度 | 1.8 倍 → 阈值取 **1.5**（保守：宁可多留帧，不得误删真内容） |
| dHash 单独用的失效证据 | dHash 把"深蓝横幅"与"空白屏"并入同一组（MAD 差 25+）→ **必须叠加 MAD 复核** |

**比较对象**：**上一张保留帧**（顺序滚动语义：连续空白屏会成片被判重）。**内存**：逐帧处理，**只保留 1 份**上一帧的指纹（sha1 + dHash + 32×32 gray32 ≈ 8 KB）；**解码像素不驻留**，单帧解码的瞬时峰值 ≈ 10.4 MB（raw 5.2 MB + out 5.2 MB），帧结束即释放。

**审查后加固（v0.5 阶段05 增补，审查 P1-1）**：均值 MAD 会被"**小面积但高对比**"的变化稀释——实测 1440×900 仅 30×30px 变黑时均值 MAD 只有 **0.249**（远低于 1.5），单靠均值会把"真的变了"判成重复而**丢内容**。故在均值判定之外叠加两条保守闸：

| 闸门 | 规则 | 作用 |
|---|---|---|
| **uniform 守卫** | 灰度标准差 `< PHASH_UNIFORM_STDDEV(3)` → 只认 sha1 完全相同 | 近纯色帧（空白画布/纯色块）的 dHash 无梯度、均值无分辨力，感知判定不可靠 |
| **逐格否决** | 32×32 网格中任一格灰度差 `> PHASH_MAX_CELL_DIFF(24)` → 不判重 | 把"平均相似"收紧为"没有任何一块明显不同"，堵住小面积高对比的误删窗口 |

**代价（如实记录）**：加固后去重命中率显著下降——实测 **45 帧与 20 帧两种真实序列，丢弃数均为 0**（加固前的首版在 settle=2500 的 50 屏序列里曾丢 4 张；那 4 对含 maxCell > 24 的局部差异，按新规则一律保守保留）。因此当前 FR-14 在安全侧近似等于"sha1 精确去重 + 极近重复"。若要恢复收益，需更精细的判定（识别并掩蔽登录浮层等 UI 覆盖区后比对内容区，或按内容区裁剪），列为 **P4 候选**，不在本批范围。

**已知代价**：每帧多 ~31ms 解码开销（45 帧 ≈ +1.4s），换取空白/近似帧不再占额度与误导人工转写。

### 16.5 Config 增量

**无新增 Config 字段**（`renderSettleMs` 已有；去重阈值 1.5 / dHash 候选半径 2 均为**内部常量**，写进代码与断言，不进配置面——避免配置面膨胀与"改配置导致行为不可预期"）。若后续要调，作为 P4 候选。

### 16.6 失败模式增量

| 场景 | 处理 | 用户可见 |
|---|---|---|
| `render_settle_ms` 越界/非整数（**仅 `render:true` 时校验**） | `E_INVALID_URL` + 参数专属 hint | 明确指出合法范围 |
| 非 PNG 畸形（无 IDAT / IHDR 声明长度 < 13） | 统一抛 `PngUnsupportedError`（阶段05 修正；此前会漏成普通 `Error`/`RangeError`） | 上层回退 sha1，外部行为不变 |
| PNG 解码失败（隔行/16-bit/损坏） | 回退 sha1 精确去重 | `dedup_method='sha1(fallback)'` + warning 一次 |
| 调高 settle 后仍超时 | `E_RENDER_TIMEOUT`（partial 素材保留） | 返回值含实际 `render_settle_ms` / `render_timeout_ms`，便于定位 |
| 去重把内容帧误判为重复 | **设计上规避**（MAD 双阈值 + 实测分离度 1.8 倍）；万一发生 → 内容丢失 | 由断言"相似对不得被判重"守住 |

### 16.7 生命周期与资源（增量）

| 副作用 | 回收 |
|---|---|
| PNG 解码缓冲 | 逐帧分配、逐帧释放（仅保留上一帧的两份摘要） |
| 额外 CPU | ~31ms/帧，属渲染通道预算内 |
| 无新增进程/端口/文件 | 沿用 §15.9 |

### 16.8 安全与限制（增量）

- PNG 解码只处理**本地内存中的截图字节**，不涉及外部输入（截图源自本次渲染的页面）→ 无新增攻击面。
- `render_settle_ms` 上限 5000ms、单次总预算上限 600000ms → **无资源耗尽风险**（渲染通道仍受 `max_shots` 与总预算双重约束）。
- 去重只影响"丢弃重复帧"，不改变文字通道、不改变内容语义。

### 16.9 复用对照（增量）

| 资产 | 来源 | 复用方式 |
|---|---|---|
| PNG 解码 + dHash + MAD | **已验证原型** `workorders/proto-phash.mjs`（实测 45 张 1.4s、阈值分离度 1.8 倍） | 移植进 `src/index.ts`（纯 Node `zlib`，**零新依赖**） |
| `fail(code,msg,reqId,hintOverride)` | 本项目 P2 已有 | 参数类错误直接用专属 hint |
| `renderSettleMs` Config 字段 | 本项目 P2 已有 | 作为缺省值来源（不改语义） |

### 16.10 P3 明确不做

不做多线程/并行解码、不做 SIMD 加速、不做感知哈希算法可配置（阈值固定）、不引入 `pngjs` 等依赖、不做"内容相似度"（语义级）去重、不改 `children` 合集路径。

---

## 17. 第五批增量设计（FR-15 渲染期剥离覆盖型浮层）

> 本节为 **v0.6 增量**（第五批）。P0（§1~§13）、P1（§14）、P2（§15）、P3（§16）设计不变。

### 17.0 设计前提修正（先说结论）

P3 §16.6 登记的"感知去重恢复收益"**前提不成立**。实测（`evidence/p4-rootcause-probe.md`）：真实素材上"该判重的对"与"该保留的对"在 **32×32 点采样 / 8×8 块采样 / 4×4 块采样 / 逐格否决 / bbox 居中度 / 填充率 / 面积占比** 上**全部统计重叠**（必须保留的对 MAD 反而更小）。

**真因**：页面自己的**动态覆盖层**（WPS「快捷登录并查看」浮层：`.component-popup.component-login-modal-pop` 覆盖全 body，内含动态头像/动画）每帧像素都在变 → 把帧间差异的分布整个抹平，**使任何阈值都失去分辨力**。

**因此本批不改去重算法**，而是**在渲染期剥离覆盖层**，让 P3 的安全阈值（`maxCell≤24 且 MAD≤1.5`）重新具备分辨力。

### 17.1 结构变更与图

- 图产物：`diagrams/dsh-deepseek-fetch-structure-v5.html`（候选 `structure-v5.candidate.json`）
- **生成时点**：2026-10-23 16:10；**基线**：Plugin-Spec v0.6 FR-15；插件 v0.4.0（未建仓，无 commit）
- 四门：**validate / deliver / check / browser-check 全 PASS**；渲染证据 `diagrams/shots-v5/`（4 张）；**人眼复核通过**（链条连续：渲染器 → 每屏剥离 → 截图器 → 去重器 → 素材包；两新组件就位、边界清晰、无重叠）。**返工留痕**：1 轮布局修正（`dedup→bundle` 净空 30px < 所需 55px → 调整为 60px）
- **新增组件 1 个**：**浮层剥离器** —— 位于「滚动定位」与「截图器」之间（每屏截图前执行）。
- 平面不变（同一 bundle entry，不新增 service / client 半）；工具参数仍 **10 键**、错误码仍 **11 个**。

### 17.2 剥离器设计

**执行时机**：每屏截图**之前**执行一次（幂等：页面不重建浮层 → 剥一次即长期有效；若重建则下一屏再剥）。

**五重约束（缺一不剥，全部满足才移除）**：

| # | 约束 | 取值 | 挡住的误伤 |
|---|---|---|---|
| ① | class 名含关键词（忽略大小写） | `popup｜modal｜mask｜overlay｜dialog｜guide` | 局部浮层（工具提示、气泡） |
| ② | `getBoundingClientRect()` 面积 | ≥ **85% 视口面积** | 侧边抽屉、小卡片 |
| ③ | 元素**子树** `textContent` 字符数 | < **300 字**（`≥300` 即跳过） | 正文容器（长文本）。子树口径 → "含浮层的祖先"会被一并跳过，属**安全方向的漏剥**（不误剥） |
| ④ | 标签 | **非** `CANVAS` / `IFRAME` | 正文渲染载体 |
| ⑤ | computed `position` | ∈ `fixed` / `absolute` / `sticky` | **文档流内的同名短区块**（如 `.guide-content` 首屏 hero）——审查 P2-5 实测会被误剥 |

**执行方式**：在页面上下文里遍历 `document.querySelectorAll('body *')`，命中者 `el.remove()`，返回**本次剥离数**。

**失败语义**：求值异常（页面结构异常 / 表达式被改）→ **捕获并忽略**，抓取继续（绝不因剥离失败中断渲染通道）。计数**仅接受整数**（非整数/非数值/异常一律折叠为 0）。

**额外守卫（审查后加固）**：表达式开头 `if (!(area > 0)) return 0` —— 视口面积为 0 时（度量覆盖尚未生效）面积约束会退化为恒真，必须直接放弃本次剥离。

**剥离后的容器重选（审查 P1-1 修正）**：剥离改变了 DOM，**先前选中的可滚容器可能本身（或其祖先）已被移除** —— 脱挂节点的 `scrollTop/scrollHeight/clientHeight` 恒为 0 → `reachedBottom` 恒真 → 会静默只出 1 张截图且 `endReason` 为 `bottom`（不计 partial、无告警）。故**剥离数 > 0 时立即重新采集候选 + 重选容器 + 重置 `lastY` / `repickStalls`**。

**已知成本（审查 P2-8）**：每屏一次 `body *` 全量扫描（仅 class 命中者才取 `textContent`）。超大 DOM 页面上为 O(N)；若预算本就吃紧，可能把"本可完成"推成 `E_RENDER_TIMEOUT`。缓解（扫描上限/降频）留 P6 候选。

**副作用边界**：只做 `remove()`，**不触碰页面数据**、不注入脚本、不改样式；被剥离的是站点自己的覆盖层，不是内容。

### 17.3 契约与配置增量

| 项 | 变化 |
|---|---|
| 工具参数 | **不变**（仍 10 键）——剥离是 render 路径的内部行为 |
| Config | **新增 1 字段** `renderStripOverlays: boolean`（默认 **true**）→ Config 字段数 17 → **18** |
| 返回 / manifest | **新增 1 字段** `overlays_stripped`（累计剥离元素数；0 = 本次没剥到任何覆盖层） |
| 错误码 | **仍 11 个**（剥离失败不产生新错误码，只忽略） |
| 关闭方式 | `Config.renderStripOverlays=false` → 行为与 v0.4.0 **逐语义一致**（零回归） |

### 17.4 失败模式

| 场景 | 处理 | 用户可见 |
|---|---|---|
| 页面无覆盖层 | 剥离数 0，正常截图 | `overlays_stripped=0` |
| 剥离求值抛错 | 捕获忽略，继续截图 | 计数少计，但**不影响产物** |
| 误剥正文容器 | **四重约束**（尤其③文本量与④非 CANVAS/IFRAME）挡住 | 断言守护：假会话用例要求"大文本正文容器不被剥离" |
| 覆盖层每帧重建 | 每屏前重剥（幂等性由"剥过就不存在"保证） | 计数累加 |

### 17.5 验收判据

| # | 判据 |
|---|---|
| A1 | 假会话：构造"假浮层"（class 含 popup + 覆盖 ≥85% + 文本 <300 + 非 canvas）→ 剥离计数 = 1 |
| A2 | 假会话：构造"正文容器"（文本 >300 字 或 标签为 CANVAS）→ 剥离计数 = **0**（不误剥） |
| A3 | 真实 kdocs 抓取：`overlays_stripped ≥ 1`，且剥离后帧间差异恢复可分（真同内容对趋近 0） |
| A4 | `Config.renderStripOverlays=false` → `overlays_stripped=0` 且行为与 v0.4.0 一致 |
| A5 | `build.sh` / `tsc` / `verify`（22 → **23 项**）/ `check-plugin-ready` 全绿；P0/P1 回归通过 |

### 17.6 与"去重阈值"的关系（明确不做什么）

- **不改** `PHASH_MAX_HAMMING=2` / `PHASH_MAX_MAD=1.5` / `PHASH_MAX_CELL_DIFF=24` / `PHASH_UNIFORM_STDDEV=3`。
- 剥离后，**真近似重复**（渲染抖动、抗锯齿、光标）会呈现为 `maxCell≤24 且 MAD≤1.5` → 被双阈值命中；**内容真变化**仍被逐格否决拦下 → 安全侧不变。
- 因此本批**不降低**任何安全阈值；若剥离后仍有应判重未判重的样本，属 P5 候选（需新证据，不在本批）。

### 17.7 明确不做

不做覆盖层**识别模型**（不引入 CV/OCR）、不做遮挡区域**内容重建**、不改去重阈值、不做"自动登录消除浮层"（涉用户凭据，禁止）、不把剥离扩展到 `<iframe>` 内部文档（跨源不可达）。

---

## 18. 设计变更日志

| 日期 | 版本 | 变更 | 影响 | 用户确认 |
|---|---|---|---|---|
| 2026-10-21 | v0.1 初版 | 依 `Plugin-Spec.md` v0.3 完成运行层设计：tokkit 形态、单工具契约、5 层管线、三级凭据解析、原子写与重名策略、8 个错误码、复用对照 | 全部 | 待审核 |
| 2026-10-21 | 结构图 | archify architecture 图四门 PASS（Edge 预检、`ARCHIFY_CHROME` 已设），人眼复核通过 | §2.1 | 随本文一并待审 |
| 2026-10-21 | v0.2 | **凭据解析顺序更正**：§7 由 env→config→reg 改为 env→**reg**→config，与 Spec FR-7 对齐（阶段05 独立审查 P1-4 指出两基线互相矛盾；代码自始按 Spec 实现，本次仅同步文档） | §7 | 阶段05 检查期内更正，待用户最终验收一并确认 |
| 2026-10-21 | **v0.3（P1 增量）** | 新增 §14：FR-11 合集路径设计——工具参数 `children/max_depth/max_pages`、独立 HTML 发现层（严格同 host + robots.txt + 扩展名黑名单）、BFS 预算与并发、合并格式（根页 `#` / 子页 `##` / `> 来源:` / 未抓取清单）、合集命名 `根标题-合集`、Config 增 4 字段；结构图重画 v2（四门 PASS） | 新增 §14；§4/§7/§10 的增量见 §14 | 待审核（P1 第二批阶段02） |
| 2026-10-23 | **v0.5（P3 第四批）** | 新增 §16：FR-13 `render_settle_ms` **按调用覆盖**（工具参数 9→10 键）+ **预算联动器**（settle × shots × 1.6 + 20000，与 `Config.renderTimeoutMs` 取大、上限 600000）；FR-14 **感知哈希去重器**（sha1 快路径 → dHash 64bit 预筛 ≤2 → 32×32 灰度 MAD ≤1.5 复核，PNG 经 Node 内置 zlib 解码，失败回退 sha1 并记 warning）；返回新增 `render_settle_ms`/`render_timeout_ms`/`shots_deduped`/`dedup_method`；**无新增 Config 字段**（阈值固定为内部常量）；结构图重画 v4（四门 PASS + 人眼复核） | 新增 §16；§2/§4/§7/§10 增量见 §16 | 待审核（P3 阶段02） |
| 2026-10-22 | **v0.4（P2 增量）** | 新增 §15：FR-12 渲染素材通道（形态 A）——参数 `render/text_source/max_shots`、择源器（canvas 面积≥30% / UI 噪声标记 / 文字<200 字三判据）、无头 Edge+CDP 渲染器（`--headless=new`、随机端口、临时 profile、必杀进程）、滚动定位（面积最大可滚元素）+ 按屏高分屏截图 + sha1 去重、素材包三件（md / shots/ / manifest.json + merge_hint）、错误码 8→11（`E_NO_EDGE`/`E_RENDER_TIMEOUT`/`E_RENDER_FAILED`）、Config 增 6 字段（含 renderTextViewport，共 17 字段）、auto 模式**降级而非失败**；结构图重画 v3（四门 PASS + 人眼复核） | 新增 §15；§4/§7/§10 的增量见 §15 | 待审核（P2 阶段02） |
