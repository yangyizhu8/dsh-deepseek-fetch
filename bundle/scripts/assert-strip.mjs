#!/usr/bin/env node
// assert-strip.mjs — T-28/T-29/T-31/T-32 断言：覆盖型浮层剥离器（P5/FR-15 · Design §17.2/§17.3/§17.5）。
// ⓪ 阈值常量与插值自检：STRIP_MIN_VIEWPORT_COVERAGE=0.85 / STRIP_MAX_TEXT_LENGTH=300 必须真的插值进
//    STRIP_OVERLAYS_JS（主侧防恒绿抽检的前提——改常量必须改变页内行为）。
// ①~④ 四重约束行为：用 new Function + 最小假 DOM 直接求值**生产表达式** m.STRIP_OVERLAYS_JS
//    （不是在测试里重写启发式）：class 关键词 / 面积 ≥85% 视口 / 文本 ≤300 字 / 非 CANVAS·IFRAME。
//    主侧抽检把 0.85 改 0.0 → 用例④（小面积浮层不得剥）必失败；把 300 改大 → 用例②（长文本不剥）必失败。
// ⑤ 求值抛错 / 非数值 / 负数 → stripOverlays 一律吞掉返回 0，绝不中断渲染通道（Design §17.2 失败语义）。
// ⑥ captureShots 接入（T-29）：stripOverlays=true 连续 3 屏 → 剥离恰被调 3 次、累计数正确；
//    false / 缺省 → 一次都不调用、计数 0（A7：缺省 false 不影响既有调用者）。
// ⑦ T-31 管线级（依赖注入假会话，同 assert-pipeline ⑧d 模式）：render 源返回与 manifest 的
//    overlays_stripped 同值；renderStripOverlays=false → 字段在但为 0 且剥离 0 次调用；
//    api 源 / 无 Edge 降级 → 返回与 manifest 均不出现该字段（与 dedup_method 同为条件展开策略）。
// 单独运行：node scripts/assert-strip.mjs（失败 exit 54）；由 verify.mjs 汇总调用。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 54
  throw e
}

/** 构造一份完整 Config（同 assert-pipeline.mjs 的 17 字段 + P5 增 renderStripOverlays，共 18）。 */
function makeConfig(dir, over = {}) {
  return {
    defaultOutputDir: dir,
    endpoint: 'https://api.deepseek.com/v1/tools/fetch',
    timeoutMs: 5000,
    retries: 0,
    defaultClean: true,
    apiKeyEnv: 'DSH_TEST_KEY_UNSET',
    apiKey: 'sk-test-placeholder',
    childrenConcurrency: 1,
    childrenTimeoutMs: 5000,
    respectRobots: false,
    htmlUserAgent: 'test-ua',
    edgePath: '',
    renderTimeoutMs: 8000,
    renderViewport: '1440x900',
    renderTextViewport: '1440x2400',
    renderSettleMs: 0,
    renderScrollOverlap: 60,
    renderStripOverlays: true,
    ...over,
  }
}

/**
 * 最小假 DOM + new Function：在 Node 里直接求值**生产表达式** m.STRIP_OVERLAYS_JS。
 * 元素形如 { tag, cls, text, w, h }（w/h 即 getBoundingClientRect 尺寸）；返回剥离数与被移除清单。
 */
function evalStripJs(elements, viewport = { w: 1440, h: 900 }) {
  const removed = []
  const els = elements.map((e) => ({
    tagName: e.tag,
    className: e.cls,
    textContent: e.text,
    getBoundingClientRect: () => ({ width: e.w, height: e.h }),
    remove: () => { removed.push(`${e.tag}#${e.cls}`) },
  }))
  const fakeWindow = { innerWidth: viewport.w, innerHeight: viewport.h }
  const fakeDocument = { querySelectorAll: (sel) => (sel === 'body *' ? els : []) }
  // 审查 P2-5 后新增第五重约束（computed position ∈ fixed/absolute/sticky）→ 假 DOM 必须提供
  //   getComputedStyle，否则生产表达式在 Node 里会 ReferenceError（真站点有该全局，不受影响）。
  const positions = new Map(elements.map((e, i) => [els[i], e.position ?? 'absolute']))
  const fakeGetComputedStyle = (el) => ({ position: positions.get(el) ?? 'absolute' })
  const fn = new Function('window', 'document', 'getComputedStyle', `return ${m.STRIP_OVERLAYS_JS}`)
  const n = fn(fakeWindow, fakeDocument, fakeGetComputedStyle)
  return { n, removed }
}

/**
 * 假 CDP 会话（captureShots 直调与 executeRender 管线两用；分派次序同 assert-pipeline ⑧d——
 * 就绪判据（readyState/children.length）必须先于 canvas 分支，否则 waitForRenderReady 空等到 deadline）。
 * STRIP_OVERLAYS_JS 精确命中最前：每次返回 stripReturn 并计数（stripCalls）。
 * 容器滚动步长 step 按用例视口给（viewportH 600→540；900→840），封顶 sh−ch。
 */
function fakeSession({ frames = ['A', 'B', 'C'], stripReturn = 1, elementSh = 1800, elementCh = 600, step = 540 } = {}) {
  const stripCalls = []
  const captured = []
  const events = [] // 审查 P2-7(a)：strip / capture 的共享交错序列，用于断言"每屏截图**前**剥离"
  let y = 0
  return {
    stripCalls,
    captured,
    events,
    async send(method) {
      if (method === 'Page.captureScreenshot') {
        const frame = frames[captured.length % frames.length]
        captured.push(frame)
        events.push('capture')
        return { result: { data: Buffer.from(`PNG-${frame}`).toString('base64') } }
      }
      return {}
    },
    async evalJs(expression) {
      const s = String(expression)
      if (s === m.STRIP_OVERLAYS_JS) {
        stripCalls.push(stripCalls.length)
        events.push('strip')
        return stripReturn
      }
      if (s.includes('__dshScrollEls = top.map')) {
        return [{ width: 1200, height: elementCh, scrollHeight: elementSh, clientHeight: elementCh }]
      }
      const dyMatch = /scrollBy\(0, (\d+)\)|scrollTop \+ (\d+)/.exec(s)
      const dy = Number(dyMatch?.[1] ?? dyMatch?.[2] ?? 0)
      if (s.includes('__dshScrollEls')) {
        y = Math.min(elementSh - elementCh, y + (dy || step))
        return { mode: 'element', y, sh: elementSh, ch: elementCh }
      }
      // 就绪判据 JS_RENDER_READY 内部也含 "canvas" 字样 → 必须先于 canvas 分支命中（⑧d 的教训）
      if (s.includes('readyState') || s.includes('children.length')) return 1
      if (s.includes('canvas')) return 0
      if (s.includes('innerText')) return `渲染正文占位。${'内容'.repeat(300)}`
      if (s.trim() === 'document.title') return '测试标题'
      return 1
    },
    close() {},
  }
}

/** 假 fetchOne（API 通道，同 assert-pipeline.mjs）。 */
const fakeFetchOne = (content) => async () => ({ ok: true, title: 'API 标题', content, request_id: null, elapsed_ms: 1 })

export async function run() {
  // ── ⓪ 阈值常量与插值自检（防恒绿机制的前提：常量必须真的进表达式）──
  if (m.STRIP_MIN_VIEWPORT_COVERAGE !== 0.85) fail(`⓪ STRIP_MIN_VIEWPORT_COVERAGE 应为 0.85，实际 ${m.STRIP_MIN_VIEWPORT_COVERAGE}`)
  if (m.STRIP_MAX_TEXT_LENGTH !== 300) fail(`⓪ STRIP_MAX_TEXT_LENGTH 应为 300，实际 ${m.STRIP_MAX_TEXT_LENGTH}`)
  if (!m.STRIP_OVERLAYS_JS.includes(String(m.STRIP_MIN_VIEWPORT_COVERAGE))) fail('⓪ STRIP_MIN_VIEWPORT_COVERAGE 未插值进 STRIP_OVERLAYS_JS')
  if (!m.STRIP_OVERLAYS_JS.includes(String(m.STRIP_MAX_TEXT_LENGTH))) fail('⓪ STRIP_MAX_TEXT_LENGTH 未插值进 STRIP_OVERLAYS_JS')

  // ── ① class 关键词约束：命中全四重约束的假浮层（kdocs「快捷登录并查看」形态）恰剥 1 个 ──
  {
    const { n, removed } = evalStripJs([
      { tag: 'DIV', cls: 'component-popup component-login-modal-pop', text: '快捷登录并查看', w: 1440, h: 900 },
    ])
    if (n !== 1) fail(`① 命中四重约束的假浮层应剥离 1 个，实际 ${n}`)
    if (removed.length !== 1) fail(`① 被移除清单应有 1 项，实际 ${JSON.stringify(removed)}`)
  }
  // ①b 不含关键词的全屏短文本容器（正文容器形态）不得剥离
  {
    const { n } = evalStripJs([{ tag: 'DIV', cls: 'article-body', text: '短', w: 1440, h: 900 }])
    if (n !== 0) fail(`①b 不含 popup/modal/mask/overlay/dialog/guide 的容器不得剥离（约束①），实际 ${n}`)
  }

  // ── ② 自身文本 >300 字的容器不得剥离（约束③：正文容器保护，即使 class 含关键词）──
  {
    const { n } = evalStripJs([
      { tag: 'DIV', cls: 'popup-content-wrap', text: '正'.repeat(301), w: 1440, h: 900 },
    ])
    if (n !== 0) fail(`② 301 字正文容器不得被剥离（约束③），实际剥离 ${n}`)
  }

  // ── ③ CANVAS / IFRAME 容器不得剥离（约束④：正文渲染载体）──
  {
    const { n } = evalStripJs([
      { tag: 'CANVAS', cls: 'overlay-canvas', text: '', w: 1440, h: 900 },
      { tag: 'IFRAME', cls: 'modal-frame', text: '嵌入视图', w: 1440, h: 900 },
    ])
    if (n !== 0) fail(`③ CANVAS/IFRAME 容器不得被剥离（约束④），实际剥离 ${n}`)
  }

  // ── ④ 面积 <85% 视口的小浮层不得剥离（约束②）——主侧防恒绿抽检点（0.85→0.0 时此处必失败）──
  {
    const { n } = evalStripJs([
      { tag: 'DIV', cls: 'modal-drawer', text: '抽屉', w: 500, h: 400 }, // 500×400 / 1440×900 ≈ 15% 视口
    ])
    if (n !== 0) fail(`④ 面积 ≈15% 的小浮层不得被剥离（约束②；若阈值插值失效即此处失败），实际剥离 ${n}`)
  }

  // ── ④b 第五重约束（审查 P2-5）：文档流内（position:static）的同名短区块**不得**剥离 ──
  {
    const { n } = evalStripJs([
      { tag: 'DIV', cls: 'guide-content', text: '八字的短指南', w: 1440, h: 900, position: 'static' },
    ])
    if (n !== 0) fail(`④b 流内区块（position:static）不得被剥离，实际 ${n}`)
    const ok = evalStripJs([
      { tag: 'DIV', cls: 'guide-content', text: '八字的短指南', w: 1440, h: 900, position: 'fixed' },
    ])
    if (ok.n !== 1) fail(`④b 同区块改为 fixed 定位后应被剥离 1 个，实际 ${ok.n}`)
  }

  // ── ④c 零视口守卫（审查 P2-4）：area=0 时面积约束会失效，必须直接返回 0 ──
  {
    const { n } = evalStripJs([
      { tag: 'DIV', cls: 'modal-tip', text: '小提示', w: 5, h: 5 },
    ], { w: 0, h: 0 })
    if (n !== 0) fail(`④c 视口面积为 0 时必须返回 0（否则约束②被架空），实际 ${n}`)
  }

  // ── ④d 文本量边界（审查 P2-2）：文档口径是"文本 <300 才剥"，故恰好 300 字不得剥离 ──
  {
    const at300 = evalStripJs([{ tag: 'DIV', cls: 'modal-body', text: '字'.repeat(300), w: 1440, h: 900 }])
    if (at300.n !== 0) fail(`④d 文本恰为 ${m.STRIP_MAX_TEXT_LENGTH} 字不得剥离（口径：<300 才剥），实际 ${at300.n}`)
    const at299 = evalStripJs([{ tag: 'DIV', cls: 'modal-body', text: '字'.repeat(299), w: 1440, h: 900 }])
    if (at299.n !== 1) fail(`④d 文本 299 字应被剥离 1 个，实际 ${at299.n}`)
  }

  // ── ④e 关键词大小写不敏感 ──
  {
    const { n } = evalStripJs([{ tag: 'DIV', cls: 'POPUP-ROOT', text: 'x', w: 1440, h: 900 }])
    if (n !== 1) fail(`④e 大写关键词 POPUP 应命中（/i 不敏感），实际 ${n}`)
  }

  // ── ⑤ 求值异常与非数值结果一律吞掉返回 0；正常数值原样返回 ──
  {
    const throwing = { async send() { return {} }, async evalJs() { throw new Error('页面结构异常') }, close() {} }
    if ((await m.stripOverlays(throwing)) !== 0) fail('⑤ 求值抛错应返回 0（不中断渲染通道）')
    const nullish = { async send() { return {} }, async evalJs() { return null }, close() {} }
    if ((await m.stripOverlays(nullish)) !== 0) fail('⑤ 求值返回 null 应折叠为 0')
    const negative = { async send() { return {} }, async evalJs() { return -3 }, close() {} }
    if ((await m.stripOverlays(negative)) !== 0) fail('⑤ 求值返回负数应折叠为 0')
    const fine = { async send() { return {} }, async evalJs() { return 3 }, close() {} }
    if ((await m.stripOverlays(fine)) !== 3) fail('⑤ 正常数值应原样返回 3')
    // 审查 P2-6：非整数必须折叠为 0（元素数语义）
    const fraction = { async send() { return {} }, async evalJs() { return 2.5 }, close() {} }
    if ((await m.stripOverlays(fraction)) !== 0) fail('⑤ 非整数 2.5 应折叠为 0（元素数语义）')
  }

  // ── ⑥ captureShots 接入（T-29）：3 屏 → 剥离恰 3 次且累计正确；关闭/缺省 → 0 次调用 ──
  //（elementSh 1800 / viewportH 600 / overlap 60 → 步长 540；max_shots=3 → 3 屏后 break，帧 A/B/C 互异全保留）
  const shotOpts = (over = {}) => ({
    maxShots: 3, settleMs: 0, overlap: 60, viewportH: 600, deadline: Date.now() + 60_000, ...over,
  })
  {
    const s = fakeSession({ stripReturn: 2 })
    const r = await m.captureShots(s, shotOpts({ stripOverlays: true }))
    if (s.stripCalls.length !== 3) fail(`⑥ 3 屏应恰好调用剥离 3 次，实际 ${s.stripCalls.length}`)
    if (r.overlaysStripped !== 6) fail(`⑥ 每次剥 2 个 × 3 屏 = 6，实际 ${r.overlaysStripped}`)
    if (r.shots.length !== 3) fail(`⑥ 3 屏应截 3 张（A/B/C 互异），实际 ${r.shots.length}`)
  }
  {
    const s = fakeSession()
    const r = await m.captureShots(s, shotOpts({ stripOverlays: false }))
    if (s.stripCalls.length !== 0) fail(`⑥ stripOverlays=false 应一次都不调用，实际 ${s.stripCalls.length}`)
    if (r.overlaysStripped !== 0) fail(`⑥ 关闭时 overlaysStripped 应为 0，实际 ${r.overlaysStripped}`)
  }
  {
    const s = fakeSession() // 缺省（undefined）同 false：既有调用者（assert-shots 等）零回归
    const r = await m.captureShots(s, shotOpts())
    if (s.stripCalls.length !== 0 || r.overlaysStripped !== 0) {
      fail(`⑥ 缺省 stripOverlays 应不调用且计数 0，实际 ${s.stripCalls.length} 次 / ${r.overlaysStripped}`)
    }
  }

  // ── ⑥b（审查 P2-7a）"每屏截图**前**剥离"的动词必须可证伪 ──
  //   若把 stripOverlays 挪到 captureScreenshot 之后（甚至循环末尾），重构前的事件序列会变成 capture,strip——
  //   此断言据 [strip, capture, strip, capture, ...] 的交错形态判定。
  {
    const s2 = fakeSession({ frames: ['A', 'B', 'C'], elementSh: 1800 })
    await m.captureShots(s2, {
      maxShots: 3, viewportH: 600, overlap: 60, settleMs: 0,
      deadline: Date.now() + 8000, stripOverlays: true,
    })
    const seq = s2.events
    if (seq.length < 4) fail(`⑥b 事件序列过短（${seq.join(',')}），无法判定剥离时机`)
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] !== 'capture') continue
      if (seq[i - 1] !== 'strip') fail(`⑥b 第 ${Math.floor(i / 2) + 1} 屏的截图前必须是剥离，实际序列 ${seq.join(',')}`)
    }
    if (seq.filter((e) => e === 'strip').length !== s2.captured.length) {
      fail(`⑥b 剥离次数应等于截图次数（每屏恰好一次），实际 strip=${seq.filter((e) => e === 'strip').length} / capture=${s2.captured.length}`)
    }
  }

  // ── ⑦ T-31 管线级（__executeFetch + 依赖注入假会话）：overlays_stripped 贯通返回与 manifest ──
  //（elementSh 2400 / viewportH 900 / overlap 60 → 步长 840；max_shots=3 → 3 屏（1680+600 < 2395 不触底））
  const base = mkdtempSync(join(tmpdir(), 'dsh-strip-'))
  try {
    // 7a. render 源 + 开启剥离（Config 默认 true）：每次剥 1 个 × 3 屏 → 返回与 manifest 同值 3
    {
      const s = fakeSession({ elementSh: 2400, step: 840 })
      const r = await m.__executeFetch(
        { url: 'https://example.com/strip-a', render: true, text_source: 'render', max_shots: 3 },
        makeConfig(base, { renderTimeoutMs: 30000 }),
        undefined,
        { findEdge: () => 'C:/fake/msedge.exe', openSession: async () => s },
      )
      if (r.ok !== true) fail(`⑦a 管线应成功，实际 ${JSON.stringify(r).slice(0, 160)}`)
      if (s.stripCalls.length !== 3) fail(`⑦a 剥离应被调 3 次，实际 ${s.stripCalls.length}`)
      if (r.overlays_stripped !== 3) fail(`⑦a 3 屏 × 1 个 → overlays_stripped 应为 3，实际 ${r.overlays_stripped}`)
      const mf = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if (mf.overlays_stripped !== 3) fail(`⑦a manifest.overlays_stripped 应为 3，实际 ${mf.overlays_stripped}`)
    }

    // 7b. renderStripOverlays=false：字段在但为 0，且一次都不调用（A7：行为回退 v0.4.0）
    {
      const s = fakeSession({ elementSh: 2400, step: 840 })
      const r = await m.__executeFetch(
        { url: 'https://example.com/strip-b', render: true, text_source: 'render', max_shots: 3 },
        makeConfig(base, { renderTimeoutMs: 30000, renderStripOverlays: false }),
        undefined,
        { findEdge: () => 'C:/fake/msedge.exe', openSession: async () => s },
      )
      if (r.ok !== true) fail(`⑦b 管线应成功，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if (s.stripCalls.length !== 0) fail(`⑦b 关闭剥离应一次都不调用，实际 ${s.stripCalls.length}`)
      if (r.overlays_stripped !== 0) fail(`⑦b 关闭剥离时字段应为 0，实际 ${r.overlays_stripped}`)
      const mf = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if (mf.overlays_stripped !== 0) fail(`⑦b manifest.overlays_stripped 应为 0，实际 ${mf.overlays_stripped}`)
    }

    // 7c. api 源：返回与 manifest 均不得出现 overlays_stripped（条件展开，与 dedup_method 同策略）
    {
      const r = await m.__executeFetch(
        { url: 'https://example.com/strip-c', render: true, text_source: 'api' },
        makeConfig(base),
        undefined,
        { fetchOne: fakeFetchOne(`API 正文占位。${'甲乙'.repeat(200)}`) },
      )
      if (r.ok !== true) fail(`⑦c api 源管线应成功，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if ('overlays_stripped' in r) fail(`⑦c api 源返回不得出现 overlays_stripped，实际 ${JSON.stringify(r.overlays_stripped)}`)
      const mf = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if ('overlays_stripped' in mf) fail('⑦c api 源 manifest 不得出现 overlays_stripped')
    }

    // 7d. 无 Edge 降级（auto → api(fallback)）：同样不出现该字段
    {
      const r = await m.__executeFetch(
        { url: 'https://example.com/strip-d', render: true, text_source: 'auto' },
        makeConfig(base),
        undefined,
        { findEdge: () => null, fetchOne: fakeFetchOne(`API 正文占位。${'甲乙'.repeat(200)}`) },
      )
      if (r.ok !== true || r.text_source !== 'api(fallback)') {
        fail(`⑦d 无 Edge 应降级 api(fallback) 成功，实际 ${JSON.stringify(r).slice(0, 160)}`)
      }
      if ('overlays_stripped' in r) fail('⑦d 无 Edge 降级返回不得出现 overlays_stripped')
      const mf = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if ('overlays_stripped' in mf) fail('⑦d 无 Edge 降级 manifest 不得出现 overlays_stripped')
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  console.log('strip-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
