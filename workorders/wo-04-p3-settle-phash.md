零越权：只写 ② 清单内路径；禁脑补需求，缺料即停。
禁脑补：P3 只做 FR-13（render_settle_ms + 预算联动）与 FR-14（感知哈希去重）；不新增 npm 依赖、不改 preset/loader entry、不动 children 合集路径。

## ① 目标与可核验验收判据

目标：给渲染素材通道加 **两个能力**——① 每屏等待可按调用覆盖（含总预算自动联动）；② 截图近重复判定改用**感知哈希**（修掉"差 1~2 像素的近似帧漏网"）。

| ID | 判据（主侧执行；你只保证实现满足） |
|---|---|
| A1 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` exit 0 |
| A2 | `tsc -p tsconfig.json --noEmit` exit 0 |
| A3 | `node scripts/verify.mjs` exit 0，项数 = 原 20 + 2（png / phash）= **22** |
| A4 | `node scripts/assert-png.mjs` / `assert-phash.mjs` 各自 exit 0 |
| A5 | `node scripts/assert-shots.mjs` / `assert-pipeline.mjs` 仍 exit 0（既有用例零回归） |
| A6 | 工具参数键恰 **10 项**：`url, output_dir, clean, children, max_depth, max_pages, render, text_source, max_shots, render_settle_ms` |
| A7 | 错误码仍恰 **11 个**（不得新增） |
| A8 | `Config` 字段仍 **17 个**（不得新增） |
| A9 | P0/P1 行为零变化：`children:false` 单页落盘仍为纯正文；`render:false` 路径不触发任何新逻辑 |

## ② 允许写入清单

- `bundle/src/index.ts`
- `bundle/scripts/assert-png.mjs`（新）
- `bundle/scripts/assert-phash.mjs`（新）
- `bundle/scripts/assert-shots.mjs`（新增去重用例）
- `bundle/scripts/assert-pipeline.mjs`（新增 settle/预算用例）
- `bundle/scripts/verify.mjs`（接入 2 项）
- `bundle/package.json`（仅 `version` → `0.4.0`）

只读（禁写）：`Plugin-Spec.md`、`Plugin-Design.md`、`DEV-PLAN.md`、`PIPELINE-STATE.md`、`evidence/`、`diagrams/`、`preset/`、`bundle/cordis.patch.yml`、`bundle/scripts/build.sh`、`bundle/tsconfig.json`、`C:\deepseek网页抓取\`、`.zcode/`（含密钥，禁读禁写）。

## ③ 冻结基线

- `Plugin-Spec.md` v0.5 → sha256 `db5dc406ca03e1a1…`（22925 B）——FR-13/FR-14 为需求权威
- `Plugin-Design.md` v0.5 → sha256 `eb6396e0793a3e6d…`（45756 B）——**§16 为实现权威**（务必通读 §16.1~§16.10）
- `DEV-PLAN.md` v0.7 → sha256 `efa6469a51844120…`（75301 B）——**§12 为任务权威**（T-22~T-27）
- `bundle/src/index.ts` → sha256 `232983a4d3db7ea8…`（121134 B）——在其上增量修改，**禁止重写既有函数语义**

**可直接移植的已验证原型（务必先读它）**：`workorders/proto-phash.mjs`（5941 B）
- 内含 `decodePng(buf)`（PNG 解析 + `zlib.inflateSync` + 5 种行反滤波）、`dHash(img)`、`madHash32(img)`、`hamming(a,b)`、`mad(a,b)`
- **已实测**：45 张真实截图解码 1.4s；真近重复对 MAD=0.954；相似幻灯片对 MAD≥2.791
- 移植要点：改成 TypeScript、导出、把 `Float64Array` 保留、`BigInt` 用于 dHash。

## ④ 关联阶段与台账引用

阶段04（P3 第四批）。台账 `PIPELINE-STATE.md`（只读，主维护；你只上报）。任务 T-22~T-27 见 `DEV-PLAN.md` §12；设计见 `Plugin-Design.md` §16。

## ⑤ 契约摘录（逐条落地）

**T-22 参数 + 预算联动**
- `TOOL_PARAMETERS` 增 `render_settle_ms`（`type: 'integer'`，描述含"0–5000，缺省用 Config.renderSettleMs"）。
- 运行时校验：非整数或 <0 或 >5000 → `fail('E_INVALID_URL', msg, undefined, '参数不合法：render_settle_ms 只能取 0–5000 的整数，请修正该参数后重试（与 URL 无关）')`。
- `resolveRenderBudget({maxShots, settleMs, configTimeoutMs})` 纯函数导出：
  ```
  needByShots = Math.ceil(maxShots * settleMs * 1.6) + 20000
  return Math.min(600000, Math.max(5000, Math.max(configTimeoutMs, needByShots)))
  ```
- `settle 实际值 = args.render_settle_ms ?? config.renderSettleMs`（**不传时行为与现状完全一致**）。
- deadline 用 `resolveRenderBudget(...)` 的返回值，而不是 `Date.now() + config.renderTimeoutMs`。
- 返回与 manifest 增 `render_settle_ms`、`render_timeout_ms`（实际生效值）。

**T-23 PNG 解码器**
- `export class PngUnsupportedError extends Error {}`
- `export function decodePng(buf: Buffer): { width: number; height: number; channels: number; pixels: Buffer }`
- 支持：8-bit 非隔行、colorType 0/2/4/6；**隔行(interlace≠0)、bitDepth≠8、未知 colorType、签名不符 → 抛 `PngUnsupportedError`**（不得返回错数据）。

**T-24 判定**
- `export function dHash64(img): bigint`（9×8 灰度相邻差分）
- `export function gray32(img): Float64Array`（32×32 灰度降采样）
- `export function hammingBig(a: bigint, b: bigint): number`
- `export function meanAbsDiff(a: Float64Array, b: Float64Array): number`
- `export const PHASH_MAX_HAMMING = 2`、`export const PHASH_MAX_MAD = 1.5`（**内部常量，不进 Config**）
- `export type FrameFingerprint = { sha1: string; dhash: bigint | null; gray: Float64Array | null }`
- `export function fingerprintFrame(data: Buffer): FrameFingerprint`（解码失败 → `dhash/gray` 为 null，**不抛**）
- `export function isNearDuplicate(prev: FrameFingerprint | null, cur: FrameFingerprint): boolean`
  - `prev === null` → false
  - `prev.sha1 === cur.sha1` → true（快路径）
  - 任一 `dhash/gray` 为 null → **false**（回退：仅 sha1 语义）
  - 否则 `hamming ≤ 2 && mad ≤ 1.5` → true

**T-25 接线**
- `captureShots` 内：`prevSha1` 改为 `prev: FrameFingerprint | null`；每帧 `fingerprintFrame(buf)`；`isNearDuplicate(prev, cur)` 为 true → 丢弃并 `deduped += 1`，否则保留并令 `prev = cur`。
- `CaptureOutcome` 增 `deduped: number`；`shots_deduped` 贯通到返回与 manifest。
- 解码失败（`dhash===null` 且 sha1 不同）时置 `dedupFallback = true` → 返回/manifest `dedup_method='sha1(fallback)'` + `warnings` 追加一次（**只在首次**追加，避免刷屏）；正常为 `dedup_method='sha1+phash'`。

**T-26 断言**
- `assert-png.mjs`：① 用 `C:\deepseek网页抓取\交易回战-·-AI自进化&可解释量化交易-3.shots\*.png`（**只读**，取前 5 张即可，避免慢）全部解码成功、尺寸 1440×900、channels=4；② 手工构造 Sub/Up/Average/Paeth 四种滤波的 1×1 或 2×2 PNG 字节（用 `zlib.deflateSync` 造 IDAT）断言像素正确；③ 隔行桩 → 抛 `PngUnsupportedError`；④ 签名不符 → 抛。
- `assert-phash.mjs`：① 真重复对 `27.png` vs `37.png` → `isNearDuplicate` true；② 三对相似但不同 `38vs42`、`41vs43`、`28vs44` → **false**；③ `01vs02` → false；④ 解码失败桩（`dhash=null`）→ 相同 sha1 true / 不同 false；⑤ `hammingBig` 边界（同值 0、全反 64）；⑥ `meanAbsDiff` 边界（相同=0）。
- `assert-shots.mjs` 增：近重复帧交替 → 只留 1 张且 `deduped ≥ 1`；不同帧交替 → 全留 `deduped = 0`。
- `assert-pipeline.mjs` 增：不传 `render_settle_ms` → 回显 = Config 值（假 config 里给 700）；传 2500 → 回显 2500 且 `render_timeout_ms ≥ Math.ceil(max_shots*2500*1.6)+20000`；传 6000 → `E_INVALID_URL` 且 hint 不含"修正 URL"。
- `verify.mjs` 接入 `png` / `phash` 两项（共 22）。

## ⑥ 失败约束与头部禁令

- **缺料即停**：拿不准（PNG 格式细节、既有函数签名、框架契约）→ 停下如实报告，禁止臆造补全。
- **禁止执行任何命令**（build/tsc/node/npm/bash 由主侧跑）；你的环境无命令权限**不是停工理由**——只写文件，回报里写明"未执行命令"。
- **禁止引入任何新 npm 依赖**：只可用 Node 内置（`node:zlib`/`node:crypto`/`node:fs`/`node:path` 等）+ 已声明的 `cordis`/`schemastery`/`@deepseek-ai/dsh-tools`。
- 既有函数（`writeDoc`/`cleanMarkdown`/`slugify`/`fetchOne`/`resolveApiKey`/`crawlChildren`/`renderMerged`/`waitForTextLongest`/`waitForScrollableContent`/`pickScrollingElement`/`decideTextSource`）语义**零改动**，只做增量。
- 测试失败必须原样输出完整报错，禁止筛选/美化。
- 断言写成独立 `.mjs` 文件（`cat > f <<'EOF'`），**不要**用 `node -e`。
- 禁止改门禁/断言以求通过；禁止放宽 schema 或错误码。

## ⑦ 缺陷清单

（首轮为空）
