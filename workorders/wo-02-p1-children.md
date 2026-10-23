零越权：只写 ② 清单内路径；禁脑补需求，缺料即停。
禁脑补：P1 只做 FR-11（合集路径）；不新增 UI、不新增工具名、不新增 loader entry。

## ① 目标与可核验验收判据

目标：在既有 `@dsh-external/dsh-deepseek-fetch` 插件内实现 **P1 合集路径**（`children:true` → 同 host 子页 BFS → 合并为单个大 md）。**P0 单页路径行为必须零变化**。

| ID | 判据（由主侧执行，你只需保证实现满足） |
|---|---|
| A1 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` exit 0 |
| A2 | `tsc -p tsconfig.json --noEmit` exit 0 |
| A3 | `node scripts/verify.mjs` exit 0（原 10 项仍 PASS + 新增 discover/bfs/merge 3 项） |
| A4 | `node scripts/assert-discover.mjs` / `assert-bfs.mjs` / `assert-merge.mjs` / `assert-config.mjs` 各自 exit 0 |
| A5 | `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle>` exit 0 全 PASS |
| A6 | 工具参数键集合恰为 `{url, output_dir, clean, children, max_depth, max_pages}`；不得出现 `filename`/`max_depth>5` 之外的越界参数 |
| A7 | `children` 缺省或 `false` 时，落盘文件内容仍**只有正文**（无 `> 来源:` 行、无 `##` 页标题、无 front matter） |
| A8 | `package.json` version 升为 `0.2.0`；`preset/` 不变；`cordis.patch.yml` 不变 |

## ② 允许写入清单

- `bundle/src/index.ts`
- `bundle/scripts/assert-discover.mjs`（新）
- `bundle/scripts/assert-bfs.mjs`（新）
- `bundle/scripts/assert-merge.mjs`（新）
- `bundle/scripts/assert-config.mjs`
- `bundle/scripts/verify.mjs`
- `bundle/package.json`（仅 version 字段）

只读（禁写）：`Plugin-Spec.md`、`Plugin-Design.md`、`DEV-PLAN.md`、`PIPELINE-STATE.md`、`evidence/`、`diagrams/`、`preset/`、`bundle/cordis.patch.yml`、`bundle/scripts/build.sh`、`bundle/tsconfig.json`、`.zcode/`（含密钥，禁读禁写）。

## ③ 冻结基线

- `Plugin-Design.md` v0.3 → sha256 `6995c3e99ac7e3a4…`，22923 B（**§14 是本轮唯一设计权威**）
- `DEV-PLAN.md` v0.3 → sha256 `fef3d03219742c3a…`，56858 B（**§10 是本轮任务权威**）
- `bundle/src/index.ts` → sha256 `c65bd40f9b99193a…`，28186 B（**在它之上增量修改，禁止重写既有函数语义**）

环境：Node v24.18.1；checkout `D:/deepseek-harness`；构建必须显式 `DSH_CHECKOUT=D:/deepseek-harness`。

## ④ 关联阶段与台账引用

阶段04（P1 第二批）。台账 `C:\project-study\dsh-deepseek-fetch\PIPELINE-STATE.md`（只读，主维护；你只上报，不写台账）。
任务编号 T-11~T-14 见 `DEV-PLAN.md` §10.1；设计细节见 `Plugin-Design.md` §14（务必通读 §14.1~§14.11）。

## ⑤ 契约摘录

**T-11 参数与 Config**
- `TOOL_PARAMETERS` 增：`children`（boolean，默认 false）、`max_depth`（integer，范围 0–5，默认 2）、`max_pages`（integer，范围 1–200，默认 30）；description 写清语义。
- `Config` 增 4 字段：`childrenConcurrency`（number，默认 3，范围 1–5）、`childrenTimeoutMs`（number，默认 300000，范围 10000–1800000）、`respectRobots`（boolean，默认 true）、`htmlUserAgent`（string，默认 `Mozilla/5.0 (dsh-deepseek-fetch/0.2)`）。
- `CONFIG_FIELDS` 同步为 11 项（原 7 + 新 4），`assert-config.mjs` 期望值同步。
- `ALLOWED_ARG_KEYS` 由 `Object.keys(TOOL_PARAMETERS)` 派生（自动跟随，勿手写常量）。
- `children:false` 时 `max_depth`/`max_pages` 被忽略且**不报错**。

**T-12 发现层与 robots**
- `extractAnchors(html): string[]` —— 匹配 `<a ... href="...">`，HTML 实体最小解码（`&amp; &lt; &gt; &quot; &#39;`）。
- `normalizeLink(href, baseUrl): string | null` —— `new URL(href, baseUrl)`；去 `#fragment`；只保留 http/https；丢弃 `mailto:/tel:/javascript:/data:/blob:`。
- `sameHost(url, rootHost): boolean` —— **严格同 host**（`new URL(url).host === rootHost`，大小写不敏感；**不跨子域**）。
- 扩展名黑名单（跳过）：`png jpe?g gif webp svg ico css js map json zip gz tar pdf docx? xlsx? pptx? mp[34] webm avi mov woff2? ttf eot`。
- 去重键：`origin + pathname`。
- `parseRobots(text): { disallow: string[]; allow: string[] }` —— 按 `User-agent` 分组，取 `*` 与本插件 UA token 两组；收集 `Allow`/`Disallow`；**最长前缀匹配**，`Allow` 优先于同长 `Disallow`。
- `robotsAllows(rules, pathname): boolean` —— 命中 Disallow 且无更长的 Allow 前缀 → 拒绝；空规则 → 放行。
- `fetchHtml(url, timeoutMs, signal): Promise<{ok:boolean; html?:string; status?:number}>` —— `fetch` + `AbortSignal`（合并调用方取消信号）+ 超时；非 2xx → `{ok:false}`。

**T-13 BFS 与预算**
- `crawlChildren(rootUrl, key, config, signal): Promise<{ pages: PageResult[]; skipped: {url:string; reason:string}[]; budgetExhausted: boolean }>`
- 队列 `{url, depth}`，根页 depth=0，**FIFO**；`depth >= max_depth` 不再扩展；已抓页数 >= `max_pages` 停止扩展。
- 每页正文用**既有** `fetchOne(url, key, config, signal)` 拿（复用，不重写）；逐页失败（`E_FETCH_FAILED`/`E_UPSTREAM`/`E_EMPTY_CONTENT`）→ 记入 `skipped` 并继续。
- 并发 ≤ `config.childrenConcurrency`（≤3）；**发请求前**检查 `Date.now() < deadline`（`deadline = 开始 + config.childrenTimeoutMs`），超预算 → `budgetExhausted=true` 并停止扩展，已抓页保留。
- robots：每 host 只取一次 `<origin>/robots.txt`（失败/404 → 视为放行）；被拒 URL 跳过并记 `skipped`（reason `robots.txt 禁止`）；**根页被拒** → 返回 `E_FETCH_FAILED`。
- 发现通道失败（HTML 取不到或 0 链接）→ **降级**：只抓根页，`skipped` 记 `子页发现失败：<原因>`。

**T-14 合并与命名**
- `renderMerged(root, pages, skipped): string` 结构：
  ```
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
  根页 `#`、子页 `##`、页间 `\n\n---\n\n`、来源行 `> 来源: <url>`；`skipped` 非空才输出「## 未抓取清单」；**不重写页内标题**。
- `mergedSlug(title, url): string` —— `slugify(title, url)` + `-合集`；若 title 形如 `^https?://` → 回退 `<host>-<pathname>` 再拼 `-合集`。
- 合集文件最终落盘仍走既有 `writeDoc`（排他占名 + 序号），内容为合并结果。

**必须保持的既有不变量（不得破坏）**
- `children` 缺省 false 时，P0 单页输出**逐字节不变**（纯正文、无来源行）。
- 排他占名（`fs.link` / `COPYFILE_EXCL`）、UTF-8 无 BOM、失败不落盘、`exec.signal` 转发与落盘前复查、`base_dir` 回显、凭据三级顺序（env → Windows 用户级 → config）。
- 新增错误码**不得**引入（仍 8 码）；合集路径失败复用既有码。

## ⑥ 失败约束与头部禁令

- **缺料即停**：拿不准（框架契约、上游行为、既有函数签名）→ 停下如实报告，禁止臆造。
- **禁止执行任何命令**（`build.sh`/`tsc`/`node`/`npm` 全部由主侧跑）。若你的环境无法执行命令，**不要因此停工**——只写文件，并在回报里写明"未执行命令"。
- 禁止修改基线文件、禁止改 `build.sh`/`tsconfig.json`/`cordis.patch.yml`/`preset/`、禁止写 `.zcode/`。
- 禁止为让断言通过而放宽断言或注释掉检查。
- 禁止重写既有函数语义（只增量扩展）；禁止引入新依赖（不得 import 任何未在 `package.json` 声明的包，只可用 Node 内置与已声明的 `cordis`/`schemastery`/`@deepseek-ai/dsh-tools`）。
- 断言一律写成 `bundle/scripts/assert-*.mjs`（`cat > f <<'EOF'` 写入），**不要**用 `node -e`。
- 测试失败必须原样输出完整报错，禁止筛选/美化。

## ⑦ 缺陷清单

（首轮为空）
