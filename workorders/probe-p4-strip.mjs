// P4 决定性实验：渲染期剥离全屏浮层后，同内容帧是否变干净（去重分辨力是否恢复）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import zlib from 'node:zlib'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL_ = 'https://www.kdocs.cn/l/cgJRsrQzOc1S'
const PORT = 9533
const UDD = 'C:/project-study/dsh-deepseek-fetch/workorders/.edge-strip'
const OUT = 'C:/project-study/dsh-deepseek-fetch/workorders/strip-frames'

fs.rmSync(UDD, { recursive: true, force: true })
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(UDD, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
  `--user-data-dir=${UDD}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--window-size=1440,900', URL_], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 剥离启发式：移除覆盖≥85%视口、文本较短、class 含 popup/modal/mask/overlay 的元素 */
const STRIP_JS = `(() => {
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

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch { await sleep(500) } }
  await sleep(11000)
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page' && t.url.includes('kdocs.cn')) ?? targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => { const x = JSON.parse(ev.data); if (x.id !== undefined && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id) } })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })) })
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.result?.value
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  // 滚动容器 + 逐屏：每屏先剥离浮层再截图
  const cands = await ev(`(() => {
    const out = []
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
        const r = el.getBoundingClientRect()
        out.push({ area: Math.round(r.width * r.height), w: Math.round(r.width), h: Math.round(r.height), sh: el.scrollHeight, ch: el.clientHeight })
      }
    }
    out.sort((a, b) => b.area - a.area)
    return out.slice(0, 4)
  })()`)
  console.log('候选滚动容器:', JSON.stringify(cands))
  const target = cands?.[0]
  if (!target) throw new Error('未找到滚动容器')

  const SCROLL_JS = `(() => {
    let best = null, bestArea = 0
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
        const r = el.getBoundingClientRect(); const a = r.width * r.height
        if (a > bestArea) { bestArea = a; best = el }
      }
    }
    if (!best) return { mode: 'window', y: window.scrollY, sh: document.documentElement.scrollHeight, ch: window.innerHeight }
    best.scrollTop = Math.min(best.scrollHeight - best.clientHeight, best.scrollTop + 540)
    return { mode: 'element', y: best.scrollTop, sh: best.scrollHeight, ch: best.clientHeight }
  })()`

  const frames = []
  for (let i = 0; i < 12; i++) {
    const removed = await ev(STRIP_JS)
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const buf = Buffer.from(shot.result.data, 'base64')
    const f = `${OUT}/f${String(i + 1).padStart(2, '0')}.png`
    fs.writeFileSync(f, buf)
    frames.push({ f, removed, bytes: buf.length })
    const info = await ev(SCROLL_JS)
    await sleep(700)
    if (info.y + info.ch >= info.sh - 5) { console.log('滚到底'); break }
  }
  console.log('\n剥离情况:', frames.map((x) => `${x.f.split('/').pop()}:removed=${x.removed},${Math.round(x.bytes / 1024)}KB`).join('  '))

  // 逐对比较（用插件现成的指纹）
  const m = await import('C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js')
  const fps = frames.map((x) => ({ n: x.f.split('/').pop(), fp: m.fingerprintFrame(fs.readFileSync(x.f)) }))
  console.log('\n相邻帧差异（剥离浮层后）：')
  for (let i = 1; i < fps.length; i++) {
    const a = fps[i - 1].fp, b = fps[i].fp
    console.log(`  ${fps[i - 1].n} vs ${fps[i].n}: sha1同=${a.sha1 === b.sha1} hamming=${m.hammingBig(a.dhash, b.dhash)} MAD=${m.meanAbsDiff(a.gray, b.gray).toFixed(3)} maxCell=${m.maxCellDiff(a.gray, b.gray).toFixed(0)} → isNearDuplicate=${m.isNearDuplicate(a, b)}`)
  }
} catch (e) {
  console.log('ERR', String(e))
} finally {
  try { edge.kill() } catch { /* 已退出 */ }
  await sleep(1200)
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } catch { /* 残留 */ }
}
