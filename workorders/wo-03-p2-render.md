零越权：只写 ② 清单内路径；禁脑补需求，缺料即停。
禁脑补：P2 只做 FR-12（渲染素材通道，形态 A）；不新增依赖包、不新增 preset 行/loader entry、不引入 P1 之外的功能。

## ① 目标与可核验验收判据

目标：在既有插件内实现 **FR-12 渲染素材通道**——`render:true` 时产出「文字 + 页面像素」素材包，**最终图文合并由 agent 侧完成（插件不调任何视觉 API）**。

| ID | 判据（由主侧执行，你只需保证实现满足） |
|---|---|
| A1 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` exit 0 |
| A2 | `tsc -p tsconfig.json --noEmit` exit 0 |
| A3 | `node scripts/verify.mjs` exit 0，项数 = 现有 16 + 新增 3（render/shots/arbiter） |
| A4 | `node scripts/assert-render.mjs` / `assert-shots.mjs` / `assert-arbiter.mjs` / `assert-config.mjs` 各自 exit 0 |
| A5 | 工具参数键集合恰为 **9 项**：`url, output_dir, clean, children, max_depth, max_pages, render, text_source, max_shots`；不得出现第 10 个 |
| A6 | 错误码集合恰为 **11 个**（原 8 个 + `E_NO_EDGE`/`E_RENDER_TIMEOUT`/`E_RENDER_FAILED`） |
| A7 | `Config` 字段数 = 现有 11 + 新增 5 = 16；新增键：`edgePath, renderTimeoutMs, renderViewport, renderSettleMs, renderScrollOverlap` |
| A8 | **P0/P1 行为零变化**：`children` 缺省 false 时单页落盘仍为纯正文；`children:true` 仍走原合集路径；既有 16 项 verify 断言仍全 PASS |

## ② 允许写入清单

- `bundle/src/index.ts`
- `bundle/package.json`（仅 `version` → `0.3.0`）
- `bundle/scripts/assert-render.mjs`（新）
- `bundle/scripts/assert-shots.mjs`（新）
- `bundle/scripts/assert-arbiter.mjs`（新）
- `bundle/scripts/assert-config.mjs`（更新期望字段集）
- `bundle/scripts/assert-classify-error.mjs`（如涉及错误码集合则更新）
- `bundle/scripts/verify.mjs`（接入 3 个新断言）

只读（禁写）：`Plugin-Spec.md`、`Plugin-Design.md`、`DEV-PLAN.md`、`PIPELINE-STATE.md`、`evidence/`、`diagrams/`、`preset/`、`bundle/cordis.patch.yml`、`bundle/scripts/build.sh`、`bundle/tsconfig.json`、`.zcode/`（含密钥，禁读禁写）、`workorders/`。

## ③ 冻结基线

- `Plugin-Spec.md` v0.4 → sha256 `44fb4f6d414a488b…`（19330 B）——FR-12 为需求权威
- `Plugin-Design.md` v0.4 → sha256 `3889ad3a476f0e84…`（34802 B）——**§15 为实现权威**（务必通读 §15.1~§15.12）
- `DEV-PLAN.md` v0.4 → sha256 `9b74d52baaa989e7…`（65762 B）——**§11 为任务权威**（T-16~T-20）
- `bundle/src/index.ts` → sha256 `d5e72ec56c4994ef…`（57210 B）——**在它之上增量修改，禁止重写既有函数语义**

**已验证可用的参考原型（直接移植思路，不要从零发明）**：
- `workorders/kdocs-cdp.mjs` —— CDP 连接 + 逐帧 `document.body.innerText`（已实测拿到 2670 字干净正文）
- `workorders/proto-shots.mjs` —— 跨页滚动 + 按视口分屏截图 + sha1 去重（已实测 37 张、去重 4 张）
- `workorders/kdocs-clean.mjs` —— 编辑器 UI 行黑名单过滤 + 去重复页眉

## ④ 关联阶段与台账引用

阶段04（P2 第三批）。台账 `C:\project-study\dsh-deepseek-fetch\PIPELINE-STATE.md`（只读，主维护；你只上报，不写台账）。任务编号 T-16~T-20 见 `DEV-PLAN.md` §11.1；设计细节见 `Plugin-Design.md` §15。

## ⑤ 契约摘录（必须逐条落地）

**T-16 参数/Config/错误码**
- `TOOL_PARAMETERS` 增：`render`（boolean，默认 false）、`text_source`（string，默认 `'auto'`，取值 `auto|api|render`）、`max_shots`（integer，默认 40）。
- `Config` 增 5 字段：`edgePath`(string `''`)、`renderTimeoutMs`(number 90000)、`renderViewport`(string `'1440x900'`)、`renderSettleMs`(number 700)、`renderScrollOverlap`(number 60)；`CONFIG_FIELDS` 同步为 16 项。
- `ERROR_CODES` 增 3：`E_NO_EDGE`、`E_RENDER_TIMEOUT`、`E_RENDER_FAILED`（共 11）。
- 未知参数仍显式拒绝（`ALLOWED_ARG_KEYS` 由 `TOOL_PARAMETERS` 派生，勿手写常量）。

**T-17 Edge 探测 + CDP 渲染器**
- `findEdgeExecutable(config)`：优先 `config.edgePath`（非空且存在 → 用）；否则探测 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`、`C:/Program Files/Microsoft/Edge/Application/msedge.exe`、`%LOCALAPPDATA%/Microsoft/Edge/Application/msedge.exe`；全不中 → `null`。
- `launchEdge(url, config)`：`spawn` 参数必须含 **`--headless=new`**（旧版不暴露 CDP 端口）、`--disable-gpu --no-sandbox --no-first-run --disable-extensions --disable-background-networking --hide-scrollbars`、`--user-data-dir=<临时目录>`、`--remote-debugging-port=<随机空闲端口>`、`--remote-allow-origins=*`、`--window-size=W,H`、URL。端口随机（先探测空闲端口再释放）。
- `cdpConnect(port)`：轮询 `http://127.0.0.1:<port>/json/version` → `/json/list` 找 page target → `WebSocket` 连接 → `Runtime.enable` + `Page.enable` → `Emulation.setDeviceMetricsOverride{width,height,deviceScaleFactor:1,mobile:false}`。
- `readInnerText()`：`Runtime.evaluate('document.body.innerText')`。
- `measureCanvasRatio()`：统计所有 `<canvas>` 的面积占比（面积/视口面积），返回最大值。
- `closeAll()`：WS `close()` + **只 kill 自己 spawn 的 child** + 删临时 profile 目录（`rmSync(recursive, maxRetries)`，失败不抛）。

**T-18 滚动定位 + 分屏截图**
- `pickScrollingElement()`：在 `scrollHeight > clientHeight + 50 && clientHeight > 200` 的元素里取**面积最大**者（WebOffice 正文容器不是 `documentElement`）；找不到 → 退化为 `window.scrollBy`。
- `captureShots()`：滚动步长 = 视口高 − `renderScrollOverlap`；每屏等 `renderSettleMs`；截图字节 `sha1` 与上一帧相同则丢弃；到达容器底部（`scrollTop + clientHeight >= scrollHeight - 5`）或达 `max_shots` 终止；PNG 落 `<基名>.shots/NN.png`（两位序号）。
- 总预算 `renderTimeoutMs` 覆盖「启动 + 渲染等待 + 截图循环」，超时 → `E_RENDER_TIMEOUT`（已产出的截图保留）。

**T-19 择源器 + 素材包**
- `decideTextSource()`：`api` → 只用 API 文字且**不启动 Edge**；`render` → 只用渲染 innerText；`auto` → 命中任一特征即用渲染 innerText：① `measureCanvasRatio() >= 0.3`；② API 文字命中编辑器 UI 噪声标记（`表情与角色`/`顶部工具栏已关闭`/`快捷登录并查看`/`仅查看`/`立即登录`/`点赞`/`留言`/`发送`）；③ API 文字为空或长度 < 200。
- **降级而非失败**：`auto` 下 Edge 缺失/渲染失败 → 退回 API 文字，`text_source='api(fallback)'` + `warning`；只有 `text_source='render'` 时才抛 `E_NO_EDGE`/`E_RENDER_*`。
- `writeMaterialBundle()`：产出 `<基名>.md`（文字，走既有 `writeDoc` 排他占名）、`<基名>.shots/NN.png`、`<基名>.manifest.json` = `{url,title,text_source,text_chars,shots_total,shots:[{file,bytes}],captured_at,merge_hint}`；`merge_hint` 固定写明「读取 shots_dir 下的 PNG，用模型自带视觉能力把图内内容转成文字，按顺序插入 text_path 对应位置，形成图文合并终稿」。
- `render:true` 时工具返回增量字段：`text_path`/`shots_dir`/`shots[]`/`manifest_path`/`text_source`/`shots_total`/`text_chars`；非 render 路径返回字段不变。
- `children` 与 `render` **互斥**：render 路径不启动 BFS。

**T-20 断言**
- `assert-render.mjs`：Edge 探测（命中或 null）、`measureCanvasRatio` 纯函数（假元素集）、两次随机端口不同、启动参数字符串含 `--headless=new` 与 `--remote-debugging-port`。
- `assert-shots.mjs`：`pickScrollingElement` 选择逻辑（假元素集）、sha1 去重（同字节丢弃/异字节保留）、步长 `H - overlap`、终止判定。
- `assert-arbiter.mjs`：auto 命中 canvas → `render`；auto 未命中 → `api`；auto + Edge 不可用 → `api(fallback)` + warning；显式 `render` + 无 Edge → `E_NO_EDGE`；manifest 含 `merge_hint` 与 `shots` 数组。
- `verify.mjs` 接入 3 个新断言；`assert-config.mjs` 期望字段集更新为 16。
- 断言一律写成独立 `.mjs` 文件（`cat > f <<'EOF'` 写入），**不要**用 `node -e`。

## ⑥ 失败约束与头部禁令

- **缺料即停**：拿不准（CDP 协议细节、框架契约、既有函数签名）→ 停下如实报告，禁止臆造。
- **禁止执行任何命令**（`build.sh`/`tsc`/`node`/`npm`/`bash` 全部由主侧跑）。若你的环境无命令执行权限，**不要因此停工**——只写文件，并在回报里写明"未执行命令"。
- **禁止引入任何新 npm 依赖**：只可用 Node 内置（`node:child_process`/`node:fs`/`node:path`/`node:net`/`node:crypto`/`fetch`/全局 `WebSocket`）+ 已声明的 `cordis`/`schemastery`/`@deepseek-ai/dsh-tools`。
- 禁止修改既有函数（`writeDoc`/`cleanMarkdown`/`slugify`/`fetchOne`/`resolveApiKey`/`crawlChildren`/`renderMerged`）的语义；只做增量。
- 禁止改门禁/断言以求通过；禁止放宽 schema 或错误码。
- 测试失败必须原样输出完整报错，禁止筛选/美化。

## ⑦ 缺陷清单

（首轮为空）
