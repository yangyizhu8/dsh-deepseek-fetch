#!/usr/bin/env node
// assert-pipeline.mjs — 审查 P1-2 补丁：**管线级**断言（此前三个新断言全在纯函数层，
// executeRender 的分支接线零覆盖，而 P2 现场修的 3 个缺陷全落在这个盲区）。
//
// 通过 RenderDeps 注入假实现（假 Edge 探测 / 假 API 抓取 / 假 CDP 会话），
// 断言管线行为而不出网、不启动真 Edge、不写用户目录（全部落在临时目录）。
//
// 覆盖：
//  ① render × children 互斥被拒（码 E_INVALID_URL，hint 指向参数而非 URL）
//  ② text_source 枚举 / max_shots 范围 被拒（同上，且 hint 不得含"URL"）
//  ③ 显式 text_source='render' + 无 Edge → E_NO_EDGE（**不得**降级为 api(fallback)）
//  ④ auto + 无 Edge → api(fallback) + warning 非空（降级而非失败）
//  ⑤ 两阶段视口：切到高视口取文字 → 切回截图视口（调用序列含 2400×… 后 900×…）
//  ⑥ 编辑噪声标记：API 文字命中标记时 auto 选 render（判据②）
//  ⑦ 取文字取"窗口内最长"而非首个平台期（P2 现场缺陷回归）
//  ⑧ P3/FR-13 参数与预算联动（Design §16.2/§16.3）：不传 settle → 回显 Config 值且预算 = Config.renderTimeoutMs
//     （P2 零回归）；传 2500 → 回显 2500 且预算 ≥ ⌈shots×2500×1.6⌉+20000；越界/非整数 → E_INVALID_URL
//     + 参数专属 hint（不含"修正 URL"）；⑧d 感知去重计数贯通返回与 manifest（dedup_method=sha1+phash）
//
// 单独运行：node scripts/assert-pipeline.mjs（失败 exit 53）；由 verify.mjs 汇总调用。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 53
  throw e
}

/** 构造一份完整 Config（不依赖 schemastery 默认值，显式给全 17 字段）。 */
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
    ...over,
  }
}

/**
 * 假 CDP 会话：记录调用序列与视口设置；evalJs 按表达式特征回答。
 * - 就绪判据 → 立即 true
 * - innerText → 固定正文（含足够长度，避免 E_EMPTY_CONTENT）
 * - canvas 面积统计 → 可配置（控制判据①）
 * - 滚动候选采集 → 返回一个"正文级"容器（sh/ch≥3）与当前页内文本
 */
function fakeSession(opts = {}) {
  const canvasRatio = opts.canvasRatio ?? 0
  const innerText = opts.innerText ?? `渲染正文占位。${'内容'.repeat(300)}`
  const calls = []
  const metrics = []
  let y = 0
  const sh = 3000
  const ch = 600
  return {
    calls,
    metrics,
    async send(method, params = {}) {
      calls.push({ method, params })
      if (method === 'Emulation.setDeviceMetricsOverride') metrics.push(`${params.width}x${params.height}`)
      if (method === 'Page.captureScreenshot') return { result: { data: Buffer.from(`frame-${y}`).toString('base64') } }
      return {}
    },
    async evalJs(expr) {
      const s = String(expr)
      if (s.includes('__dshScrollEls = top.map')) {
        return [{ width: 1200, height: 600, scrollHeight: sh, clientHeight: ch }]
      }
      if (s.includes('__dshScrollEls')) {
        y = Math.min(sh - ch, y + 540)
        return { mode: 'element', y, sh, ch }
      }
      if (s.includes('canvas')) return canvasRatio
      if (s.includes('innerText')) return innerText
      if (s.trim() === 'document.title') return '测试标题'
      if (s.includes('readyState') || s.includes('children.length')) return 1
      return 1
    },
    close() {},
  }
}

/** 假 fetchOne（API 通道）：内容与标题可配置。 */
function fakeFetchOne(content) {
  return async () => ({ ok: true, title: 'API 标题', content, request_id: null, elapsed_ms: 1 })
}

// ── 真实 PNG 帧构造（⑧d 感知去重用例；与 assert-png.mjs 同款最小构造器）──

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

/** 64×64 RGBA 纯灰 PNG（filter=0）；tweak=[x, y, v] 把 (x,y) 的 RGB 改为 v（差 1~2 像素的近似帧）。 */
function solidGrayPng(fill, tweak) {
  const size = 64
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < size; x++) {
      const o = y * (stride + 1) + 1 + x * 4
      raw[o] = fill
      raw[o + 1] = fill
      raw[o + 2] = fill
      raw[o + 3] = 255
    }
  }
  if (tweak !== undefined) {
    const o = tweak[1] * (stride + 1) + 1 + tweak[0] * 4
    raw[o] = tweak[2]
    raw[o + 1] = tweak[2]
    raw[o + 2] = tweak[2]
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
 * 假会话：innerText 长度按给定序列返回（模拟"渲染中途有平台期、之后还有跃升"）。
 * 用于验证取文字策略取的是**窗口内最长的一份**，而不是"第一次看起来稳定的"。
 */
function growingSession(lengths) {
  let i = 0
  return {
    async send(method, params = {}) {
      if (method === 'Page.captureScreenshot') return { result: { data: Buffer.from('frame').toString('base64') } }
      if (method === 'Emulation.setDeviceMetricsOverride') return {}
      return {}
    },
    async evalJs(expr) {
      const s = String(expr)
      if (s.includes('innerText')) {
        const len = lengths[Math.min(i, lengths.length - 1)]
        i++
        return '字'.repeat(len)
      }
      if (s.includes('__dshScrollEls = top.map')) {
        return [{ width: 1200, height: 600, scrollHeight: 2000, clientHeight: 600 }]
      }
      if (s.includes('__dshScrollEls')) return { mode: 'element', y: 600, sh: 2000, ch: 600 }
      if (s.trim() === 'document.title') return '测试标题'
      return 1
    },
    close() {},
  }
}

/** 带纹理 64×64 PNG（stddev≈52，避开 uniform 守卫；审查 P1-1 后感知用例必须用它）。 */
function texturedFrame(seed, patches = []) {
  const size = 64
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  let state = (seed * 2654435761) >>> 0
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < size; x++) {
      state = (state * 1664525 + 1013904223) >>> 0
      const v = 40 + (state >>> 24) % 180
      const o = y * (stride + 1) + 1 + x * 4
      raw[o] = v; raw[o + 1] = v; raw[o + 2] = v; raw[o + 3] = 255
    }
  }
  // 增量语义：v += delta（钳制 0..255）——保证相邻帧逐格差可控（≤ PHASH_MAX_CELL_DIFF）
  for (const [px, py, delta] of patches) {
    const o = py * (stride + 1) + 1 + px * 4
    for (let k = 0; k < 3; k++) raw[o + k] = Math.max(0, Math.min(255, raw[o + k] + delta))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const crcTable = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crc])
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export async function run() {
  const base = mkdtempSync(join(tmpdir(), 'dsh-pipe-'))
  try {
    // ── ① render × children 互斥 ──
    {
      const r = await m.__executeFetch(
        { url: 'https://example.com/a', render: true, children: true },
        makeConfig(base),
      )
      if (r.ok !== false || r.code !== 'E_INVALID_URL') fail(`① render×children 应被拒（E_INVALID_URL），实际 ${JSON.stringify(r).slice(0, 120)}`)
      if (!String(r.hint).includes('互斥')) fail(`① 互斥拒绝的 hint 应说明互斥，实际 ${JSON.stringify(r.hint)}`)
      if (String(r.hint).includes('修正 URL')) fail('① 互斥拒绝不得复用"修正 URL"提示（会误导改 URL）')
    }

    // ── ② 枚举 / 范围拒绝 ──
    {
      const r = await m.__executeFetch(
        { url: 'https://example.com/a', render: true, text_source: 'bogus' },
        makeConfig(base),
      )
      if (r.ok !== false || r.code !== 'E_INVALID_URL') fail(`② text_source 非法值应被拒，实际 ${JSON.stringify(r).slice(0, 120)}`)
      if (String(r.hint).includes('修正 URL')) fail('② 枚举拒绝不得复用"修正 URL"提示')

      const r2 = await m.__executeFetch(
        { url: 'https://example.com/a', render: true, max_shots: 0 },
        makeConfig(base),
      )
      if (r2.ok !== false || r2.code !== 'E_INVALID_URL') fail(`② max_shots=0 应被拒，实际 ${JSON.stringify(r2).slice(0, 120)}`)

      const r3 = await m.__executeFetch(
        { url: 'https://example.com/a', render: true, max_shots: 101 },
        makeConfig(base),
      )
      if (r3.ok !== false || r3.code !== 'E_INVALID_URL') fail(`② max_shots=101 应被拒，实际 ${JSON.stringify(r3).slice(0, 120)}`)
    }

    // ── ③ 显式 render + 无 Edge → E_NO_EDGE（不降级）──
    {
      const r = await m.__executeFetch(
        { url: 'https://example.com/a', render: true, text_source: 'render' },
        makeConfig(base),
        undefined,
        { findEdge: () => null },
      )
      if (r.ok !== false || r.code !== 'E_NO_EDGE') fail(`③ 无 Edge 且显式 render 应 E_NO_EDGE，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if (JSON.stringify(r).includes('api(fallback)')) fail('③ 显式 render 失败**不得**降级为 api(fallback)')
    }

    // ── ④ auto + 无 Edge → api(fallback) + warning ──
    {
      const r = await m.__executeFetch(
        { url: 'https://example.com/a', render: true, text_source: 'auto' },
        makeConfig(base),
        undefined,
        {
          findEdge: () => null,
          fetchOne: fakeFetchOne(`API 正文。${'甲乙'.repeat(200)}`),
        },
      )
      if (r.ok !== true) fail(`④ auto + 无 Edge 应降级成功，实际 ${JSON.stringify(r).slice(0, 160)}`)
      if (r.text_source !== 'api(fallback)') fail(`④ 降级来源应 api(fallback)，实际 ${r.text_source}`)
      if (typeof r.warning !== 'string' || r.warning.trim() === '') fail('④ 降级必须带非空 warning（用户可察觉）')
      if (r.shots_total !== 0) fail(`④ 无 Edge 时不应有截图，实际 ${r.shots_total}`)
    }

    // ── ⑤ 两阶段视口 + 判据②（编辑噪声）→ render ──
    {
      const session = fakeSession({ canvasRatio: 0 })
      const noisyApi = `交易回战 · 示例\n仅查看\n立即登录\n表情与角色\n${'噪声'.repeat(200)}`
      const r = await m.__executeFetch(
        { url: 'https://example.com/doc', render: true, text_source: 'auto', max_shots: 2 },
        makeConfig(base),
        undefined,
        {
          findEdge: () => 'C:/fake/msedge.exe',
          fetchOne: fakeFetchOne(noisyApi),
          openSession: async () => session,
        },
      )
      if (r.ok !== true) fail(`⑤ 管线应成功，实际 ${JSON.stringify(r).slice(0, 160)}`)
      if (r.text_source !== 'render') fail(`⑤ API 文字命中编辑噪声标记时 auto 应选 render，实际 ${r.text_source}`)
      const seq = session.metrics.join(' → ')
      if (!(session.metrics[0] === '1440x2400')) fail(`⑤ 阶段 A 应先切高视口取文字，实际序列 ${seq}`)
      if (!session.metrics.includes('1440x900')) fail(`⑤ 阶段 B 应切回截图视口，实际序列 ${seq}`)
      const iText = session.metrics.indexOf('1440x2400')
      const iShot = session.metrics.indexOf('1440x900')
      if (!(iText < iShot)) fail(`⑤ 高视口必须在截图视口之前，实际序列 ${seq}`)
      if (typeof r.manifest_path !== 'string') fail('⑤ 应产出 manifest_path')
      const manifest = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if (manifest.text_source !== 'render') fail(`⑤ manifest.text_source 应为 render，实际 ${manifest.text_source}`)
      if (typeof manifest.merge_hint !== 'string' || manifest.merge_hint === '') fail('⑤ manifest 必须含 merge_hint')
      // P2-8：manifest 落盘的 URL 必须剥离 query（防签名/临时 token 留盘）
      if (manifest.url.includes('?')) fail(`⑤ manifest.url 不应含 query，实际 ${manifest.url}`)
    }

    // ── ⑥ 高视口未大于截图视口时，应给出可感知告警（P2-10）──
    {
      const session = fakeSession({ canvasRatio: 0 })
      const r = await m.__executeFetch(
        { url: 'https://example.com/doc2', render: true, text_source: 'render', max_shots: 1 },
        makeConfig(base, { renderTextViewport: '1440x900' }),
        undefined,
        { findEdge: () => 'C:/fake/msedge.exe', openSession: async () => session },
      )
      if (r.ok !== true) fail(`⑥ 视口配反仍应产出（退化单阶段），实际 ${JSON.stringify(r).slice(0, 140)}`)
      const warned = Array.isArray(r.warnings) && r.warnings.some((w) => String(w).includes('renderTextViewport'))
      if (!warned) fail('⑥ 视口配反必须给 warnings（不得静默退化）')
    }

    // ── ⑦ 取文字必须取"窗口内最长的一份"，而非"第一次看起来稳定的" ──
    // 真实缺陷：WebOffice 渲染中途存在平台期（长度两次相同即被我误判为稳定），
    // 导致同一文档两次抓取得到 1693 与 2423 两种残缺程度不同的正文。
    {
      // 长度序列模拟：1375（旧内容）→ 1750（平台期，连续两次）→ 2654（跃升）→ 2670（最终）
      const s = growingSession([1375, 1750, 1750, 2654, 2670, 2670, 2670])
      const got = await m.waitForTextLongest(s, Date.now() + 8000, 10, 200, 0)
      if (got.length !== 2670) fail(`⑦ 应取窗口内最长的 2670 字，实际 ${got.length}（平台期被误判为稳定就会更短）`)
    }
    {
      // 管线级：正文最终长度应反映"最长"而非首个平台期
      const s = growingSession([1750, 1750, 2654, 2670])
      const r = await m.__executeFetch(
        { url: 'https://example.com/doc3', render: true, text_source: 'render', max_shots: 1 },
        makeConfig(base),
        undefined,
        { findEdge: () => 'C:/fake/msedge.exe', openSession: async () => s },
      )
      if (r.ok !== true) fail(`⑦ 管线应成功，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if (r.text_chars < 2600) fail(`⑦ 管线正文应取到最长的约 2670 字，实际 ${r.text_chars}`)
    }

    // ── ⑧ P3/FR-13：render_settle_ms 覆盖与预算联动（Design §16.2/§16.3）──
    // 8a. 不传 → 回显 Config 值（700）且预算 = Config.renderTimeoutMs（不联动，P2 零回归）
    {
      const r = await m.__executeFetch(
        { url: 'https://example.com/settle-a', render: true, text_source: 'api' },
        makeConfig(base, { renderSettleMs: 700 }),
        undefined,
        { fetchOne: fakeFetchOne(`API 正文。${'甲乙'.repeat(200)}`) },
      )
      if (r.ok !== true) fail(`⑧a 管线应成功，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if (r.render_settle_ms !== 700) fail(`⑧a 不传时应回显 Config.renderSettleMs=700，实际 ${r.render_settle_ms}`)
      if (r.render_timeout_ms !== 8000) fail(`⑧a 不传时预算应恰等于 Config.renderTimeoutMs=8000（零回归），实际 ${r.render_timeout_ms}`)
      const manifest = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if (manifest.render_settle_ms !== 700 || manifest.render_timeout_ms !== 8000) {
        fail(`⑧a manifest 应回显实际生效值，实际 ${manifest.render_settle_ms}/${manifest.render_timeout_ms}`)
      }
    }

    // 8b. 传 2500 → 回显 2500 且预算 ≥ ⌈shots×settle×1.6⌉+20000（联动生效；与实现同式，FP 偏差两侧一致）
    {
      const shots = 4
      const r = await m.__executeFetch(
        { url: 'https://example.com/settle-b', render: true, text_source: 'api', max_shots: shots, render_settle_ms: 2500 },
        makeConfig(base, { renderSettleMs: 700 }),
        undefined,
        { fetchOne: fakeFetchOne(`API 正文。${'甲乙'.repeat(200)}`) },
      )
      if (r.ok !== true) fail(`⑧b 管线应成功，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if (r.render_settle_ms !== 2500) fail(`⑧b 应回显覆盖值 2500，实际 ${r.render_settle_ms}`)
      const need = Math.ceil(shots * 2500 * 1.6) + 20000
      if (r.render_timeout_ms < need) fail(`⑧b 预算应 ≥ ${need}（⌈${shots}×2500×1.6⌉+20000），实际 ${r.render_timeout_ms}`)
      if (r.render_timeout_ms > 600000) fail(`⑧b 预算上限 600000，实际 ${r.render_timeout_ms}`)
    }

    // 8c. 越界 / 负数 / 非整数 → E_INVALID_URL + 参数专属 hint（不得复用"修正 URL"）
    for (const bad of [6000, -1, 700.5]) {
      const r = await m.__executeFetch(
        { url: 'https://example.com/settle-c', render: true, render_settle_ms: bad },
        makeConfig(base),
      )
      if (r.ok !== false || r.code !== 'E_INVALID_URL') fail(`⑧c render_settle_ms=${bad} 应被拒（E_INVALID_URL），实际 ${JSON.stringify(r).slice(0, 120)}`)
      if (String(r.hint).includes('修正 URL')) fail(`⑧c 参数专属 hint 不得含"修正 URL"，实际 ${JSON.stringify(r.hint)}`)
      if (!String(r.hint).includes('参数') || !String(r.hint).includes('0–5000')) fail(`⑧c hint 应指向参数与合法范围，实际 ${JSON.stringify(r.hint)}`)
    }

    // 8d. 感知去重贯通：render 源 + 近重复真 PNG 帧交替 → 只留 1 张，shots_deduped/dedup_method 进返回与 manifest
    {
      // 审查 P1-1 后：近纯色帧被 uniform 守卫拒判，感知去重主路径必须用带纹理帧（stddev≈52）
      const nearA = texturedFrame(11)
      const nearB = texturedFrame(11, [[0, 0, 5]]) // 单像素 +5 灰阶：sha1 不同、maxCell=5、MAD≈0 → 判重
      const seqFrames = [nearA, nearB, nearA, nearB, nearA]
      let sent = 0
      let y = 0
      const dedupSession = {
        async send(method) {
          if (method === 'Page.captureScreenshot') {
            const buf = seqFrames[Math.min(sent, seqFrames.length - 1)]
            sent += 1
            return { result: { data: buf.toString('base64') } }
          }
          return {}
        },
        async evalJs(expr) {
          const s = String(expr)
          if (s.includes('__dshScrollEls = top.map')) return [{ width: 1200, height: 600, scrollHeight: 3000, clientHeight: 600 }]
          if (s.includes('__dshScrollEls')) { y = Math.min(2400, y + 540); return { mode: 'element', y, sh: 3000, ch: 600 } }
          // 就绪判据 JS_RENDER_READY 内部也含 "canvas" 字样 → 必须**先于** canvas 分支命中，
          // 否则就绪探测被误答成 0 → waitForRenderReady 空等到 deadline（本次 ⑧d 失败的真因）
          if (s.includes('readyState') || s.includes('children.length')) return 1
          if (s.includes('canvas')) return 0
          if (s.includes('innerText')) return `渲染正文占位。${'内容'.repeat(300)}`
          if (s.trim() === 'document.title') return '测试标题'
          return 1
        },
        close() {},
      }
      const r = await m.__executeFetch(
        { url: 'https://example.com/settle-d', render: true, text_source: 'render', max_shots: 5 },
        makeConfig(base, { renderSettleMs: 0, renderTimeoutMs: 30000 }), // settle=0（config）+ 预算给足：5 屏全截到
        undefined,
        { findEdge: () => 'C:/fake/msedge.exe', openSession: async () => dedupSession },
      )
      if (r.ok !== true) fail(`⑧d 管线应成功，实际 ${JSON.stringify(r).slice(0, 160)}`)
      if (r.shots_total !== 1 || r.shots_deduped !== 4) fail(`⑧d 近重复帧应只留 1 张（deduped=4），实际 ${r.shots_total}/${r.shots_deduped}`)
      if (r.dedup_method !== 'sha1+phash') fail(`⑧d 正常感知去回应标 sha1+phash，实际 ${r.dedup_method}`)
      if (r.render_settle_ms !== 0) fail(`⑧d 不传 settle 应回显 config 值 0，实际 ${r.render_settle_ms}`)
      const mf = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if (mf.shots_deduped !== 4 || mf.dedup_method !== 'sha1+phash') {
        fail(`⑧d manifest 应贯通去重计数与方法，实际 ${JSON.stringify({ shots_deduped: mf.shots_deduped, dedup_method: mf.dedup_method })}`)
      }
    }

    // 8e.（审查 P2-1）resolveRenderBudget 精确值：直调断言，覆盖 config 胜出 / 联动胜出 / 上限夹断三分支
    {
      const cases = [
        { maxShots: 3, settleMs: 120, configTimeoutMs: 90000, want: 90000, why: 'config 胜出（need=25760 < 90000）' },
        { maxShots: 50, settleMs: 2500, configTimeoutMs: 90000, want: 220000, why: '联动胜出（⌈50×2500×1.6⌉+20000）' },
        { maxShots: 100, settleMs: 5000, configTimeoutMs: 90000, want: 600000, why: '上限夹断（need=820000 > 600000）' },
        { maxShots: 4, settleMs: 2500, configTimeoutMs: 8000, want: 36000, why: '联动胜出（⌈4×2500×1.6⌉+20000=36000）' },
      ]
      for (const c of cases) {
        const got = m.resolveRenderBudget(c)
        if (got !== c.want) fail(`⑧e resolveRenderBudget(${JSON.stringify(c)}) 应为 ${c.want}（${c.why}），实际 ${got}`)
      }
    }

    // 8f.（审查 P2-2）覆盖值必须**真正作用于截图等待**：相邻两次滚动的间隔应 ≥ settle
    //   （若 captureShots 仍用 config.renderSettleMs=0，间隔会接近 0 → 本用例失败）
    {
      const tt = []
      const s2 = {
        async send(method) {
          if (method === 'Page.captureScreenshot') return { result: { data: texturedFrame(3).toString('base64') } }
          return {}
        },
        async evalJs(expr) {
          const e = String(expr)
          if (e.includes('__dshScrollEls = top.map')) return [{ width: 1200, height: 600, scrollHeight: 3000, clientHeight: 600 }]
          if (e.includes('__dshScrollEls')) { tt.push(Date.now()); return { mode: 'element', y: Math.min(2400, 600 * tt.length), sh: 3000, ch: 600 } }
          if (e.includes('readyState') || e.includes('children.length')) return 1
          if (e.includes('canvas')) return 0
          if (e.includes('innerText')) return `正文。${'内容'.repeat(300)}`
          if (e.trim() === 'document.title') return 'T'
          return 1
        },
        close() {},
      }
      const r = await m.__executeFetch(
        { url: 'https://example.com/settle-f', render: true, text_source: 'render', max_shots: 3, render_settle_ms: 150 },
        makeConfig(base),
        undefined,
        { findEdge: () => 'C:/fake/msedge.exe', openSession: async () => s2 },
      )
      if (r.ok !== true) fail(`⑧f 管线应成功，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if (r.render_settle_ms !== 150) fail(`⑧f 应回显 settle=150，实际 ${r.render_settle_ms}`)
      if (tt.length < 2) fail(`⑧f 滚动次数过少（${tt.length}），无法验证间隔`)
      const gaps = tt.slice(1).map((v, i) => v - tt[i])
      const minGap = Math.min(...gaps)
      if (minGap < 130) fail(`⑧f 相邻滚动间隔应 ≥ settle(150)（留 20ms 容差），实际最小 ${minGap}ms —— 覆盖值未真正作用于截图等待`)
    }

    // 8g.（审查 P1-2）非 PNG 帧 → 去重退化为仅 sha1，且 dedup_method 端到端贯通到返回与 manifest
    {
      let sent = 0
      const s3 = {
        async send(method) {
          if (method === 'Page.captureScreenshot') {
            sent += 1
            return { result: { data: Buffer.from('NOT-A-PNG-BYTES').toString('base64') } }
          }
          return {}
        },
        async evalJs(expr) {
          const e = String(expr)
          if (e.includes('__dshScrollEls = top.map')) return [{ width: 1200, height: 600, scrollHeight: 3000, clientHeight: 600 }]
          if (e.includes('__dshScrollEls')) return { mode: 'element', y: Math.min(2400, 600 * sent), sh: 3000, ch: 600 }
          if (e.includes('readyState') || e.includes('children.length')) return 1
          if (e.includes('canvas')) return 0
          if (e.includes('innerText')) return `正文。${'内容'.repeat(300)}`
          if (e.trim() === 'document.title') return 'T'
          return 1
        },
        close() {},
      }
      const r = await m.__executeFetch(
        { url: 'https://example.com/settle-g', render: true, text_source: 'render', max_shots: 3 },
        makeConfig(base),
        undefined,
        { findEdge: () => 'C:/fake/msedge.exe', openSession: async () => s3 },
      )
      if (r.ok !== true) fail(`⑧g 管线应成功，实际 ${JSON.stringify(r).slice(0, 140)}`)
      if (r.dedup_method !== 'sha1(fallback)') fail(`⑧g 非 PNG 帧应回退标 sha1(fallback)，实际 ${r.dedup_method}`)
      if (r.shots_total !== 1 || r.shots_deduped !== 2) {
        fail(`⑧g 恒同非 PNG 帧应只留 1 张且 deduped=2，实际 ${r.shots_total}/${r.shots_deduped}`)
      }
      if (!Array.isArray(r.warnings) || r.warnings.filter((w) => String(w).includes('sha1')).length !== 1) {
        fail(`⑧g warning 应恰好出现一次（含 sha1 字样），实际 ${JSON.stringify(r.warnings)}`)
      }
      const mf = JSON.parse(readFileSync(r.manifest_path, 'utf8'))
      if (mf.dedup_method !== 'sha1(fallback)') fail(`⑧g manifest.dedup_method 应贯通为 sha1(fallback)，实际 ${mf.dedup_method}`)
      if (mf.shots_deduped !== 2) fail(`⑧g manifest.shots_deduped 应为 2，实际 ${mf.shots_deduped}`)
    }

    console.log('pipeline-ok')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
