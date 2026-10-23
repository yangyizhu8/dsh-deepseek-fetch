# P1 阶段05 独立审查 → 修复 → 复验（证据）

- 时间：2026-10-21 10:15–10:50
- 触发：独立只读审查子代理 `aea05082-2087-40db-8a2c-6d315042d165`（静态阅读 + 只读行为探针）
- 结论：**2 条 P1 + 14 条 P2**；P1 与 12 条可修 P2 全部修复并复验；2 条 P2 有意保留
- 修复执行：**主侧就地修复**（声明：ZCode 侧 Bash 不可执行 → 无法自验；本批改动强耦合现有实现与设计 §14.3/§14.4/§14.6，由主侧改完用新增断言自证）

## 1. 修复清单与复验证据

| # | 审查项 | 修复 | 复验 |
|---|---|---|---|
| P1-1 | 重定向不校验 host → 本机 SSRF | `fetchHtml` 改 `redirect:'manual'` 逐跳处理，每跳 `Location` 的 host 必须等于允许 host，否则 `{ok:false, reason:'重定向越界…'}`；robots 通道同样传 `allowedHost` | `assert-edge.mjs`：源端口 302 → 目标端口，**目标端口 hits = 0**，`res.ok=false` 且 reason 含「重定向越界」；同 host 302 → 允许跟随并取到内容 |
| P1-2 | robots `*`/`$` 被按字面前缀比较 → 规则失效 = 越界抓取 | 新增 `robotsPatternMatcher`（RFC 9309 §2.2 最小子集）：`*`=任意串、`$`=尾锚、无通配且不以 `/` 结尾 =「完全相同或其后紧跟 `/`」、以 `/` 结尾 = 路径前缀匹配 | `assert-robots.mjs`：`/*.pdf$` 拦 `/x.pdf` 与 `/a/b.pdf`；`/private$` 拦 `/private` **不拦** `/privateX`；`/` 拦全站（旧断言 `Disallow: /` 仍 PASS） |
| P2-3 | 空行不重置 UA 分组 → 规则泄漏 | 空行显式重置 `applies` 与 `prevWasUserAgent` | `assert-robots.mjs`：`*`(空组) → 空行 → `EvilBot: Disallow:/secret` → **`/secret` 不被收集、不产生拦截** |
| P2-4 | 前缀匹配无路径段边界 | 匹配器按段语义（见上） | `assert-robots.mjs`：`/a` **不拦** `/abc`，仍拦 `/a/x`；更长的 `Allow:/a/allowed` 放行 |
| P2-5 | 空标题 → 空 `# ` 标题 | `pageDisplayTitle()`：标题空则回退 `host+pathname` | `assert-edge.mjs`：`renderMerged` 空标题 → `# h.example/docs/x` |
| P2-6 | 伪链接（`data-href` / script / textarea / 注释） | 扫描前剔除注释与 `<script>/<style>/<textarea>`；`href` 前须为空白或标签起点 | `assert-robots.mjs`：伪链接全部剔除 |
| P2-7 | 属性值含 `>` 漏抽 | 改为容错标签扫描（尊重引号内的 `>`） | `assert-robots.mjs`：`<a title="a > b" href="/gt">` → 抽出 `/gt` |
| P2-8 | 清单无上限 → 合集/返回值体积无界 | `MAX_SKIPPED=200`（记账层）+ 渲染层二次截断 + 「另有 N 条未逐条列出，合计 M 条」；每页入队候选上限 `MAX_CANDIDATES_PER_PAGE=200`；返回值新增 `skipped_total` | `assert-edge.mjs`：260 条 → 逐条 ≤200 + 汇总行；实跑 `skipped_total=49` |
| P2-10 | query 变体静默丢弃 | 折叠项记入清单（reason「同页多参已折叠（按 pathname 去重）」） | 实跑清单由 15 条 → **49 条**（多出 34 条折叠项） |
| P2-13 | 根页失败时 drain 原因误标 | drain 原因优先判 `rootFailure` → 「根页失败，未继续扩展」 | 代码核对 |
| P2-14 | 总预算被单请求超时穿透 | 单请求超时改为 `min(config.timeoutMs, deadline - now)` | 代码核对 |
| P2-12 | 断言缺口 | 新增 `assert-robots.mjs`（robots 语义 + 锚点容错）、`assert-edge.mjs`（SSRF 回归 + 空标题 + 清单上限）、verify 内置 `freshness`（lib 不得早于 src） | verify **16 项全 PASS** |
| P2-15 | 文档/注释不一致 | Design §14.5 深度措辞、§14.3 重定向、§14.4 robots 匹配、§14.6 清单上限与已知代价；Spec FR-11 判重措辞；src 文件头「单页路径限定」 | 文档核对 |

## 2. 修复后门禁复跑（命令原文 + 退出码）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | 0 | `=== Build complete ===` |
| `tsc -p tsconfig.json --noEmit` | 0 | 无输出 |
| `node scripts/verify.mjs` | 0 | 16 项：module / **freshness** / tool-contract / error-codes / validateUrl / resolveApiKey / classifyError / cleanMarkdown / slugify / config-fields / preset / discover / **robots** / **edge** / bfs / merge + `verify: PASS` |
| `node scripts/assert-robots.mjs` | 0 | `robots-ok` |
| `node scripts/assert-edge.mjs` | 0 | `edge-ok` |
| `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle>` | 0 | `[PASS] bundle` 1/1 |

## 3. P0 非回归 + 合集端到端（修复后）

| 用例 | 结果 |
|---|---|
| 不传 `children` | `ok:true`；落盘 `source=false h2=false front=false`（**纯正文**） |
| `children:false` | `ok:true`，无来源行 |
| `children:false` + `max_depth:5` + `max_pages:99` | `ok:true`（忽略且不报错） |
| 未知参数 `filename` | `E_INVALID_URL` |
| 合集（真实站点，depth 1 / 4 页） | `total=4 / ok=4 / failed=0`；`skipped_total=49`；来源行 4、分隔 4、无 front matter |
| `max_depth=9` | `E_INVALID_URL`（本地前置） |
| **宿主真实调用**（已装配 profile，reload 前后 `[active]`） | `children:true, max_depth:1, max_pages:3` → **3 页 / 0 失败 / 21732 字符 / 832ms** → `C:\deepseek网页抓取\网页搜索与抓取-合集-3.md` |

## 4. 有意保留的 P2

| 项 | 理由 |
|---|---|
| P2-9 响应体无大小上限 | 需流式截断，改动面大；上游对返回内容本身有截断，实测未遇超大页 → 下版加 `maxBytes` |
| P2-11 正文自带 `---`/`#` 与合集结构混淆 | 「保真优先」的有意取舍；已在 Design §14.6 补齐代价说明（含子页 H1 反压 `##`） |
| P2-12 余项（并发上限/robots-404/maxDepth=0/在途取消/环路去重/Config zod 范围的断言） | 行为已由实现与端到端实测覆盖，但缺独立断言 → 下版补 |
| O-11 404 页面不触发降级 | 与 P0 同源（接口对 404 页返回 200，无状态码可判） |
| O-12 页标题与页内标题混层 | 设计已声明；改设计才解决 |
| O-13 robots 复杂通配（字符类等） | 已覆盖常见写法；完整 RFC 9309 支持留待下版 |

## 5. 交付卫生

`.zcode/`（含明文 Key）已删除、密钥形态扫描无命中；自测临时目录已清；`preset/` 与 `cordis.patch.yml` 全程未被 P1 改动。
