#!/usr/bin/env node
// assert-shots.mjs — T-18 断言：滚动定位与分屏截图（Design §15.5 / DEV-PLAN T-18 验收）
//  + P3/FR-14 增量（T-25）：感知哈希去重接入截图循环（Design §16.4）。
//  ① pickScrollingElement 纯函数：假候选集（合格中取面积最大 / 空集 / 全不合格 / clientHeight≤200 淘汰）
//  ② isDuplicateShot / scrollStep / reachedBottom / shotFileName 纯函数
//  ③ captureShots 端到端（假 CDP 会话，不出网不启 Edge）：
//     容器滚动到底（5 屏 A/B 交替全保留）→ max_shots 截断 → 预算已过（timeout，0 张）→
//     恒同帧 sha1 去重（只留 1 张）→ 无合格容器退化 window.scrollBy
//  ③f 近重复 PNG 帧交替（差 1 灰阶的 64×64 图）→ 只留 1 张且 deduped ≥ 1（P3 感知去重命中）
//  ③g 感知相似阈值外帧交替（全黑 vs 全白：dHash 同为 0、MAD=255）→ 全留且 deduped = 0（MAD 复核兜住）
//  ③h 解码失败帧（非 PNG 字节）恒同 → sha1 去重仍生效且 dedupFallback = true（回退语义）
// 单独运行：node scripts/assert-shots.mjs（失败 exit 52）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 52
  throw e
}

/**
 * 假 CDP 会话：evalJs 按表达式特征分派（collect 含 `__dshScrollEls = top.map`；
 * 容器滚动含 `__dshScrollEls || []`；其余为 window.scrollBy），Page.captureScreenshot
 * 轮流返回 frames 里的帧（字符串 → `PNG-<s>` 假字节；Buffer → 真实 PNG 字节，驱动感知去重）。
 * 容器/窗口各维护一份滚动位置，封顶 sh−ch。
 */
function fakeSession({ mode = 'element', frames = ['A', 'B'], elementSh = 3000, elementCh = 600, windowSh = 2000, windowCh = 600 } = {}) {
  const captured = []
  let elementTop = 0
  let windowY = 0
  return {
    captured,
    async send(method) {
      if (method === 'Page.captureScreenshot') {
        const frame = frames[captured.length % frames.length]
        captured.push(frame)
        const buf = Buffer.isBuffer(frame) ? frame : Buffer.from(`PNG-${frame}`)
        return { result: { data: buf.toString('base64') } }
      }
      return {}
    },
    async evalJs(expression) {
      if (expression.includes('__dshScrollEls = top.map')) {
        // 候选采集：element 模式返回唯一合格容器；window 模式返回空集（触发退化）
        return mode === 'element'
          ? [{ width: 1440, height: elementCh, scrollHeight: elementSh, clientHeight: elementCh }]
          : []
      }
      const dyMatch = /scrollBy\(0, (\d+)\)|scrollTop \+ (\d+)/.exec(expression)
      const dy = Number(dyMatch?.[1] ?? dyMatch?.[2] ?? 0)
      if (expression.includes('__dshScrollEls || []')) {
        elementTop = Math.min(elementTop + dy, elementSh - elementCh)
        return { mode: 'element', y: elementTop, sh: elementSh, ch: elementCh }
      }
      windowY = Math.min(windowY + dy, windowSh - windowCh)
      return { mode: 'window', y: windowY, sh: windowSh, ch: windowCh }
    },
    close() {},
  }
}

const shotOpts = (over = {}) => ({
  maxShots: 40,
  settleMs: 0, // 断言不等待懒加载；deadline 给足
  overlap: 60,
  viewportH: 600,
  deadline: Date.now() + 60_000,
  ...over,
})

// ── 真实 PNG 帧构造（P3/FR-14 感知去重用例；与 assert-png.mjs 同款最小构造器）──

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/**
 * 64×64 RGBA 纯灰 PNG（filter=0 行）：near 帧差 1 灰阶（128 vs 129，仅左上角一像素）——
 * dHash 采样网格含 (0,0)（gx=0→x=0，gy=0→y=0），汉明恰差 1；gray32 也含 (0,0)，MAD=1/1024。
 * black/white：两帧 dHash 同为 0（纯色无比差）但 MAD=255 —— 证明必须 MAD 复核（dHash 单用会误判）。
 */
function solidGrayPng(fill, tweak) {
  const size = 64
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter None
    for (let x = 0; x < size; x++) {
      const o = y * (stride + 1) + 1 + x * 4
      raw[o] = fill
      raw[o + 1] = fill
      raw[o + 2] = fill
      raw[o + 3] = 255
    }
  }
  if (tweak !== undefined) {
    const o = 1 + tweak[0] * 4 // 第 0 行 (x=tweak[0], y=0)
    raw[o] = tweak[1]
    raw[o + 1] = tweak[1]
    raw[o + 2] = tweak[1]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

/**
 * 带纹理 PNG（审查 P1-1 后新增）：近纯色帧会被 `PHASH_UNIFORM_STDDEV` 守卫判为"不可感知判定"，
 * 因此感知去重用例必须用**有真实灰度方差**的帧。纹理由确定性伪随机生成（可复现）。
 * @param {number} seed 纹理种子
 * @param {Array<[number, number, number]>} [patches] 覆盖点 [[x, y, 灰阶], ...]（用于构造"局部变化"）
 */
function texturedPng(seed, patches = []) {
  const size = 64
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  let state = (seed * 2654435761) >>> 0
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter None
    for (let x = 0; x < size; x++) {
      state = (state * 1664525 + 1013904223) >>> 0
      const v = 40 + (state >>> 24) % 180 // 40..219：stddev ≈ 52，远高于 3
      const o = y * (stride + 1) + 1 + x * 4
      raw[o] = v; raw[o + 1] = v; raw[o + 2] = v; raw[o + 3] = 255
    }
  }
  // 增量语义：v += delta（钳制 0..255）
  for (const [x, y, delta] of patches) {
    const o = y * (stride + 1) + 1 + x * 4
    for (let k = 0; k < 3; k++) raw[o + k] = Math.max(0, Math.min(255, raw[o + k] + delta))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

export async function run() {
  // ── ① pickScrollingElement ──
  const candidates = [
    { width: 800, height: 400, scrollHeight: 1200, clientHeight: 350 }, // 合格，面积 320000
    { width: 1000, height: 500, scrollHeight: 2000, clientHeight: 500 }, // 合格，面积 500000（最大）
    { width: 100, height: 100, scrollHeight: 90, clientHeight: 80 }, // sh 未超 ch+50，不合格
    { width: 500, height: 300, scrollHeight: 100, clientHeight: 250 }, // 不可滚
  ]
  if (m.pickScrollingElement(candidates) !== 1) fail('① 应选面积最大的合格容器（下标 1）')
  if (m.pickScrollingElement([]) !== null) fail('① 空候选应返回 null')
  if (m.pickScrollingElement([{ width: 1000, height: 500, scrollHeight: 2000, clientHeight: 150 }]) !== null) {
    fail('① clientHeight ≤ 200 的容器应被淘汰（矮条工具栏类元素）')
  }
  if (m.pickScrollingElement([{ width: 1000, height: 500, scrollHeight: 640, clientHeight: 600 }]) !== null) {
    fail('① scrollHeight ≤ clientHeight+50（几乎不可滚）应不合格')
  }

  // ── ② 纯函数小件 ──
  if (m.isDuplicateShot(null, 'abc') !== false) fail('② 首帧（prev=null）不算重复')
  if (m.isDuplicateShot('abc', 'abc') !== true) fail('② 同 sha1 应判重复')
  if (m.isDuplicateShot('abc', 'abd') !== false) fail('② 异 sha1 不判重复')
  if (m.scrollStep(900, 60) !== 840) fail('② scrollStep(900,60) 应为 840')
  if (m.scrollStep(900, 0) !== 900) fail('② scrollStep(900,0) 应为 900')
  if (m.scrollStep(500, 600) !== 1) fail('② overlap ≥ 视口高时步长下限应为 1（防零/负步长死循环）')
  if (m.reachedBottom(2395, 600, 3000) !== true) fail('② y+ch=sh−5 应判到底（含 5px 容差）')
  if (m.reachedBottom(2394, 600, 3000) !== false) fail('② y+ch<sh−5 不判到底')
  if (m.shotFileName(1) !== '01.png' || m.shotFileName(9) !== '09.png' || m.shotFileName(10) !== '10.png' || m.shotFileName(100) !== '100.png') {
    fail('② 截图文件名应为两位序号补零（100 时自然三位）')
  }

  // ── ③ captureShots 端到端（假会话）──
  // 3a. 容器滚动到底：viewport 600 / overlap 60 → 步长 540；sh=3000 封顶 y=2400 → 5 屏到底
  {
    const s = fakeSession()
    const r = await m.captureShots(s, shotOpts())
    if (r.scrollMode !== 'element') fail(`③a 应为容器滚动，实际 ${r.scrollMode}`)
    if (r.endReason !== 'bottom') fail(`③a 3000px 容器应滚到底，实际 ${r.endReason}`)
    if (r.shots.length !== 5) fail(`③a 应 5 屏（A/B 交替无重复帧），实际 ${r.shots.length}`)
    if (r.shots.map((x) => x.file).join(',') !== '01.png,02.png,03.png,04.png,05.png') {
      fail(`③a 文件名序号不符：${r.shots.map((x) => x.file).join(',')}`)
    }
    if (s.captured.join('') !== 'ABABA') fail(`③a 帧序列应为 ABABA，实际 ${s.captured.join('')}`)
    if (r.shots.some((x) => x.bytes === 0 || typeof x.sha1 !== 'string')) fail('③a 每帧应有 bytes 与 sha1')
  }

  // 3b. max_shots=3 截断：3 张后停止，endReason=max_shots
  {
    const r = await m.captureShots(fakeSession(), shotOpts({ maxShots: 3 }))
    if (r.endReason !== 'max_shots' || r.shots.length !== 3) {
      fail(`③b max_shots=3 应 3 张后停（endReason=max_shots），实际 ${r.shots.length}/${r.endReason}`)
    }
  }

  // 3c. 预算已过：审查 P1-1 修正后的语义——**至少产出 1 屏**再 timeout
  //（否则普通页面会"有 md 无 PNG"；此前为 0 张，属缺陷）
  {
    const r = await m.captureShots(fakeSession(), shotOpts({ deadline: Date.now() - 1 }))
    if (r.endReason !== 'timeout' || r.shots.length !== 1) {
      fail(`③c 预算已过应至少 1 张且 timeout，实际 ${r.shots.length}/${r.endReason}`)
    }
  }

  // 3d. 恒同帧：sha1 去重只留首帧（滚动照常进行直至到底）
  {
    const r = await m.captureShots(fakeSession({ frames: ['X'] }), shotOpts())
    if (r.endReason !== 'bottom') fail(`③d 恒同帧仍应滚到底，实际 ${r.endReason}`)
    if (r.shots.length !== 1) fail(`③d 重复帧应被 sha1 去重只留 1 张，实际 ${r.shots.length}`)
  }

  // 3e. 无合格容器：退化 window.scrollBy（sh=2000 → 3 屏到底）
  {
    const r = await m.captureShots(fakeSession({ mode: 'window' }), shotOpts())
    if (r.scrollMode !== 'window') fail(`③e 空候选应退化窗口滚动，实际 ${r.scrollMode}`)
    if (r.endReason !== 'bottom' || r.shots.length !== 3) {
      fail(`③e 2000px 文档窗口滚动应 3 屏到底，实际 ${r.shots.length}/${r.endReason}`)
    }
  }

  // 3f. 近重复 PNG 帧交替（128 纯灰 vs 仅 (0,0)=129）：感知去重只留首帧
  //（sha1 不同（字节不同）但 dHash 汉明=1 ≤2 且 MAD=1/1024 ≤1.5 → 逐帧判重；prev 不前移 → 后续 sha1 也命中）
  {
    // 用带纹理帧（stddev≈52）：近纯色帧会被 uniform 守卫拒判，无法验证感知去重主路径
    const nearA = texturedPng(1)
    const nearB = texturedPng(1, [[0, 0, 5]]) // 单像素 +5 灰阶：sha1 不同、maxCell=5、MAD≈0

    const r = await m.captureShots(fakeSession({ frames: [nearA, nearB, nearA, nearB, nearA] }), shotOpts())
    if (r.endReason !== 'bottom') fail(`③f 近重复帧仍应滚到底，实际 ${r.endReason}`)
    if (r.shots.length !== 1) fail(`③f 近重复交替应只留 1 张（差 1~2 像素的近似帧不再漏网），实际 ${r.shots.length}`)
    if (r.deduped !== 4) fail(`③f deduped 应为 4（2 感知命中 + 2 sha1 命中），实际 ${r.deduped}`)
    if (r.dedupFallback !== false) fail('③f 真 PNG 帧可解码，dedupFallback 应为 false')
    if (r.shots[0].bytes !== nearA.length) fail(`③f 保留帧 bytes 应为构造 PNG 长度 ${nearA.length}，实际 ${r.shots[0].bytes}`)
  }

  // 3g. 阈值外帧交替（全黑 vs 全白）：dHash 两两同为 0（汉明 0）但 MAD=255 → 不得判重（MAD 复核兜住）
  {
    // 全黑/全白：dHash 同为 0、MAD=255；加固后 uniform 守卫也会拒判 —— 两条防线任一生效都不得判重
    const black = solidGrayPng(0)
    const white = solidGrayPng(255)
    const r = await m.captureShots(fakeSession({ frames: [black, white, black, white, black] }), shotOpts())
    if (r.shots.length !== 5 || r.deduped !== 0) {
      fail(`③g 全黑/全白交替应全保留（deduped=0），实际 ${r.shots.length} 张 / deduped=${r.deduped}`)
    }
    if (r.dedupFallback !== false) fail('③g 真 PNG 帧可解码，dedupFallback 应为 false')
  }

  // 3h. 解码失败帧（非 PNG 字节）恒同：sha1 去重仍生效 + dedupFallback=true（回退语义记账）
  {
    const r = await m.captureShots(fakeSession({ frames: ['X'] }), shotOpts())
    if (r.endReason !== 'bottom' || r.shots.length !== 1) {
      fail(`③h 解码失败帧的 sha1 去重仍应生效（1 张/bottom），实际 ${r.shots.length}/${r.endReason}`)
    }
    if (r.deduped !== 4) fail(`③h 后续恒同帧应被 sha1 去重（deduped=4），实际 ${r.deduped}`)
    if (r.dedupFallback !== true) fail('③h 保留帧无法感知解码，dedupFallback 应为 true（上层据此标 sha1(fallback)）')
  }

  // 3i.（审查 P1-3）比较基准必须是"上一张**保留**帧"而非"上一张采集帧"：
  //   A~B（+20）、B~C（+20）、A!~C（+40 > PHASH_MAX_CELL_DIFF=24 被逐格否决）
  //   → 正解保留 [A, C] 且 deduped=1；若基准错为"上一张采集帧"，C 会与 B 判重而被丢弃（内容丢失）且门禁无感。
  {
    const block = (delta) => {
      const px = []
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) px.push([x, y, delta])
      return px
    }
    const A = texturedPng(7)
    const B = texturedPng(7, block(20))
    const C = texturedPng(7, block(40))
    const r = await m.captureShots(fakeSession({ frames: [A, B, C], elementSh: 1800 }), shotOpts())
    if (r.shots.length !== 2) {
      fail(`③i 应保留 [A, C] 共 2 张（A~B、B~C 判重，A!~C 不判重），实际 ${r.shots.length} 张`)
    }
    if (r.deduped !== 1) fail(`③i deduped 应为 1，实际 ${r.deduped}`)
    if (r.shots[1].bytes !== C.length) {
      fail(`③i 第二张保留帧应为 C（bytes=${C.length}），实际 ${r.shots[1].bytes}（若为 ${B.length} 说明基准错成了采集帧）`)
    }
  }

  // 3j.（审查 P1-1 的守护断言）**小面积但高对比**的内容变化不得被判重：
  //   实测 1440×900 仅 30×30px 变黑 → 均值 MAD 仅 0.249（远低于 1.5），单靠均值会被误删。
  //   本用例 64×64 帧上做 12×12 块 Δ=60（32×32 网格覆盖 ~6×3 格）→ 逐格否决必须生效 → 全保留。
  {
    const px = []
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) px.push([x, y, 60])
    const base = texturedPng(21)
    const changed = texturedPng(21, px) // 局部高对比变化（maxCell=60 > PHASH_MAX_CELL_DIFF=24）
    const r = await m.captureShots(fakeSession({ frames: [base, changed], elementSh: 1800 }), shotOpts())
    if (r.deduped !== 0) {
      fail(`③j 局部高对比变化（Δ=60）必须**不**判重（否则真内容被删），实际 deduped=${r.deduped} / 留 ${r.shots.length} 张`)
    }
    if (r.shots.length < 2) fail(`③j 应保留两类帧（≥2 张），实际 ${r.shots.length}`)
  }

  // 3k.（审查 P1-1 另一侧）近纯色帧不得被感知判定：两个几乎相同的纯灰帧（非 sha1 相同）
  //   纯色帧 dHash 无梯度、均值 MAD 无分辨力 → uniform 守卫必须拒判（只认 sha1）
  {
    const g1 = solidGrayPng(128)
    const g2 = solidGrayPng(128, [0, 129]) // 单像素差 1 → sha1 不同
    const r = await m.captureShots(fakeSession({ frames: [g1, g2], elementSh: 1800 }), shotOpts())
    if (r.deduped !== 0) {
      fail(`③k 近纯色帧（stddev=0）应被 uniform 守卫拒判，实际 deduped=${r.deduped}`)
    }
  }

  console.log('shots-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
