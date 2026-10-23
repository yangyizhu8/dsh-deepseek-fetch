零越权：只写 ② 清单内路径；禁脑补需求，缺料即停。
禁脑补：P5 只做 FR-15（渲染期剥离覆盖型浮层）；不改任何去重阈值、不新增工具参数、不引入 npm 依赖。

## ① 目标与可核验验收判据

目标：给渲染通道加一个**浮层剥离器**——每屏截图前把页面上"覆盖全屏的动态浮层"从 DOM 移除，使截图只含真实内容，从而让 P3 的近重复去重阈值恢复分辨力。

| ID | 判据（主侧执行；你只保证实现满足） |
|---|---|
| A1 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` exit 0 |
| A2 | `tsc -p tsconfig.json --noEmit` exit 0 |
| A3 | `node scripts/verify.mjs` exit 0，项数 = 原 22 + 1（`strip`）= **23** |
| A4 | `node scripts/assert-strip.mjs` exit 0（**新脚本**） |
| A5 | 既有断言 `assert-config/assert-shots/assert-pipeline/assert-png/assert-phash` 仍 exit 0（零回归） |
| A6 | Config 字段 = **18**（原 17 + `renderStripOverlays`）；错误码仍 **11**；工具参数仍 **10 键** |
| A7 | `Config.renderStripOverlays=false` 时行为与 v0.4.0 **逐语义一致**（剥离调用次数 = 0） |

## ② 允许写入清单

- `bundle/src/index.ts`
- `bundle/scripts/assert-strip.mjs`（新）
- `bundle/scripts/verify.mjs`（接入 1 项）
- `bundle/scripts/assert-config.mjs`（Config 字段 17 → 18）
- `bundle/package.json`（仅 `version` → `0.5.0`）

只读（禁写）：`Plugin-Spec.md`、`Plugin-Design.md`、`DEV-PLAN.md`、`PIPELINE-STATE.md`、`SHIPPABLE.md`、`evidence/`、`diagrams/`、`preset/`、`bundle/cordis.patch.yml`、`bundle/scripts/build.sh`、`bundle/tsconfig.json`、其他 `bundle/scripts/assert-*.mjs`（**只可读，不可改**）、`C:\deepseek网页抓取\`、`.zcode/`（含密钥，禁读禁写）。

## ③ 冻结基线

- `Plugin-Spec.md` v0.6 §4.2 FR-15、`Plugin-Design.md` v0.6 §17 —— 需求与设计权威（**务必通读 §17.2 / §17.3 / §17.5**）
- `DEV-PLAN.md` v1.0 §13 —— 任务权威（T-28~T-32）
- `bundle/src/index.ts` —— **基线 pin**：version=0.4.0 + sha256=bb1d4e7a73b2565ea695b0027a34be5f4cd222436c155b04d8b8294e79f24a4d（2886 行，未建仓故以 sha256 作基线标识）；**在其上增量修改，禁止重写既有函数语义**
- **目录快照**（文件 + 尺寸B，实施前须复核一致）：
  - `bundle/src/index.ts` (139581B)
  - `bundle/scripts/verify.mjs` (6197B)
  - `bundle/scripts/assert-config.mjs` (1529B)
  - `bundle/package.json` (806B)
- **已验证原型（务必先读，直接移植）**：`workorders/probe-p4-strip.mjs`（含 `STRIP_JS` 常量，实测在真实 kdocs 页面命中 4 个元素、且**页面不重建浮层** → 剥一次长期有效）

## ④ 关联阶段与台账引用

阶段04（第五批 FR-15）。台账 `PIPELINE-STATE.md`（只读，主维护；你只上报）。任务 T-28~T-32 见 `DEV-PLAN.md` §13.3；设计见 `Plugin-Design.md` §17。

## ⑤ 契约摘录（逐条落地）

**T-28 剥离器**（放 `bundle/src/index.ts`）：

```ts
/** 覆盖型浮层剥离启发式（FR-15 / Design §17.2）：四重约束，缺一不剥。
 *  ① class 含 popup|modal|mask|overlay|dialog|guide（忽略大小写）
 *  ② getBoundingClientRect 面积 ≥ 85% 视口
 *  ③ 元素自身文本量 < 300 字
 *  ④ 标签非 CANVAS / IFRAME
 */
export const STRIP_OVERLAYS_JS = `(() => {
  let removed = 0
  const vw = window.innerWidth, vh = window.innerHeight
  const area = vw * vh
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cls = (typeof el.className === 'string' ? el.className : '')
    if (!/popup|modal|mask|overlay|dialog|guide/i.test(cls)) continue
    const t = (el.textContent || '').trim()
    if (t.length > 300) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height < area * 0.85) continue
    if (el.tagName === 'CANVAS' || el.tagName === 'IFRAME') continue
    el.remove(); removed++
  }
  return removed
})()`

/** 剥离覆盖型浮层，返回本次剥离的元素数；异常一律吞掉并返回 0（不中断渲染通道）。 */
export async function stripOverlays(session: CdpSession): Promise<number> {
  try {
    const n = await session.evalJs<number>(STRIP_OVERLAYS_JS)
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
  } catch { return 0 }
}
```
- 阈值 85% 与 300 字**必须是常量**（便于断言做防恒绿抽检）：导出 `export const STRIP_MIN_VIEWPORT_COVERAGE = 0.85` 与 `export const STRIP_MAX_TEXT_LENGTH = 300`，并在 `STRIP_OVERLAYS_JS` 里**引用这两个常量拼进表达式**（例如用模板字符串把数值插进去），使突变常量会真正改变行为。

**T-29 接入**：`captureShots` 内**每屏截图前**调用一次 `stripOverlays(session)`，累加 `overlaysStripped`；`CaptureOutcome` 增 `overlaysStripped: number`；`captureShots` 的 opts 增 `stripOverlays?: boolean`（默认 **false**，由调用方显式传，避免影响既有调用者）。**当 opts.stripOverlays 为 false/undefined 时，一次都不调用**。

**T-30 Config**：z.object 增 `renderStripOverlays: boolean`（默认 `true`）；`CONFIG_FIELDS` 常量数组同步增该字段名（断言只依赖这个常量）。Config 字段总数 **17 → 18**。

**T-31 返回与 manifest**：`RenderSuccess` 增 `overlays_stripped: number`；manifest 类型与 `buildManifest` 增 `overlays_stripped`；`executeRender` 把 `capture.overlaysStripped` 透传；**非 render 路径（api 源 / 无 Edge 降级）不出现该字段**（与 `dedup_method` 现有策略一致：条件展开）。`renderStripOverlays=false` 时该字段为 `0`。

**T-32 断言**：
- 新建 `bundle/scripts/assert-strip.mjs`（exit 54）：用例
  ① 假浮层（class 含 popup + 覆盖 ≥85% + 文本 <300 + 非 canvas）→ 剥离数 = 1
  ② 大文本正文容器（文本 >300 字）→ 剥离数 = **0**
  ③ CANVAS 容器 → 剥离数 = **0**
  ④ 面积 <85% 的小浮层 → 剥离数 = **0**
  ⑤ 求值抛错 → `stripOverlays` 返回 0 且**不抛**
  ⑥ `captureShots` 连续 3 屏 → 剥离被调用 3 次、累计数正确；`opts.stripOverlays=false` → 调用次数 **0**
- `verify.mjs` 接入 `strip` 一项（共 **23** 项）
- `assert-config.mjs` 的字段数 17 → 18，并断言 `renderStripOverlays` 默认 `true`

## ⑥ 失败约束与头部禁令

- **缺料即停**：拿不准（CDP 会话接口、既有函数签名、manifest 结构）→ 停下如实报告，禁止臆造补全。
- **禁止执行任何命令**（build/tsc/node/npm/bash 由主侧跑）；你的环境无命令权限**不是停工理由**——只写文件，回报里写明"未执行命令"。
- **禁止引入任何新 npm 依赖**：只可用 Node 内置 + 已声明的 `cordis`/`schemastery`/`@deepseek-ai/dsh-tools`。
- **禁止改动任何去重阈值**：`PHASH_MAX_HAMMING=2` / `PHASH_MAX_MAD=1.5` / `PHASH_MAX_CELL_DIFF=24` / `PHASH_UNIFORM_STDDEV=3` 一个都不能动。
- 既有函数（`writeDoc`/`cleanMarkdown`/`slugify`/`fetchOne`/`resolveApiKey`/`crawlChildren`/`renderMerged`/`waitForTextLongest`/`waitForScrollableContent`/`pickScrollingElement`/`decideTextSource`/`captureShots` 的去重逻辑/`isNearDuplicate`）语义**零改动**，只做增量。
- **禁止**修改 `assert-shots/assert-pipeline/assert-png/assert-phash`（只读）；只允许改 `assert-config.mjs` 与 `verify.mjs`。
- 测试失败必须原样输出完整报错，禁止筛选/美化。
- 断言写成独立 `.mjs` 文件（`cat > f <<'EOF'`），**不要**用 `node -e`。
- 禁止改门禁/断言以求通过；禁止放宽 schema 或错误码。

## ⑦ 缺陷清单

（首轮为空）
