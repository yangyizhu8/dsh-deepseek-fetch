// 原型验证：无头 Edge + CDP 跨页滚动分屏截图（形态 A 的地基）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import crypto from 'node:crypto'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL = process.argv[2] ?? 'https://www.kdocs.cn/l/cgJRsrQzOc1S'
const PORT = 9455
const UDD = 'C:/project-study/dsh-deepseek-fetch/workorders/.edge-proto'
const SHOTS = 'C:/project-study/dsh-deepseek-fetch/workorders/proto-shots'
const VIEW_W = 1440
const VIEW_H = 900
const MAX_SHOTS = 40

fs.rmSync(UDD, { recursive: true, force: true })
fs.rmSync(SHOTS, { recursive: true, force: true })
fs.mkdirSync(UDD, { recursive: true })
fs.mkdirSync(SHOTS, { recursive: true })

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
  '--disable-background-networking', '--hide-scrollbars',
  `--user-data-dir=${UDD}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  `--window-size=${VIEW_W},${VIEW_H}`, URL,
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { url: URL, shots: [], dedup: 0, errors: [] }

try {
  // 等 CDP
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch { /* wait */ }
    await sleep(500)
  }
  await sleep(9000) // 等渲染

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page' && t.url.includes('kdocs.cn')) ?? targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
    return r?.result?.result?.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false })

  // 1) 找滚动容器：documentElement 或面积最大的可滚元素
  const scrollInfo = await evalJs(`(() => {
    const de = document.documentElement
    const cands = []
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
        const r = el.getBoundingClientRect()
        cands.push({ area: Math.round(r.width * r.height), sh: el.scrollHeight, ch: el.clientHeight,
          sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0,2).join('.') : '') })
      }
    }
    cands.sort((a,b) => b.area - a.area)
    return { de: { sh: de.scrollHeight, ch: de.clientHeight }, top: cands[0] ?? null, count: cands.length }
  })()`)
  report.scrollInfo = scrollInfo

  // 2) 决定滚动目标（容器或文档）
  const useContainer = scrollInfo.top !== null
  const sel = scrollInfo.top?.sel ?? ''
  const scrollExpr = useContainer
    ? `(() => { const el = ${sel.startsWith('div') || sel.startsWith('section') || sel.startsWith('main') ? sel : 'null'}; return null })()`
    : 'null'

  // 简化：直接在页面里滚最大的那个元素（用 querySelector 逐个匹配 scrollHeight 最大的）
  const scrollBy = async (dy) => evalJs(`(() => {
    let best = null, bestArea = 0
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
        const r = el.getBoundingClientRect(); const a = r.width * r.height
        if (a > bestArea) { bestArea = a; best = el }
      }
    }
    if (!best) { window.scrollBy(0, ${dy}); return { mode: 'window', y: window.scrollY } }
    const before = best.scrollTop
    best.scrollTop = before + ${dy}
    return { mode: 'element', y: best.scrollTop, sh: best.scrollHeight, ch: best.clientHeight }
  })()`)

  const getTextLen = async () => evalJs('document.body ? (document.body.innerText||"").length : 0')

  let prevHash = null
  let stagnant = 0
  for (let i = 0; i < MAX_SHOTS; i++) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    if (!shot?.result?.data) { report.errors.push(`capture #${i} 无数据`); break }
    const buf = Buffer.from(shot.result.data, 'base64')
    const hash = crypto.createHash('sha1').update(buf).digest('hex')
    const file = `${SHOTS}/shot-${String(i + 1).padStart(2, '0')}.png`
    fs.writeFileSync(file, buf)
    if (hash === prevHash) { report.dedup += 1; fs.unlinkSync(file) } else {
      prevHash = hash
      report.shots.push({ file: file.split('/').pop(), bytes: buf.length })
    }
    const info = await scrollBy(VIEW_H - 60)
    await sleep(700)
    if (info && info.mode === 'element' && info.y + info.ch >= info.sh - 5) { report.endReason = '到达容器底部'; break }
    if (info && info.mode === 'window') { report.endReason = 'window 模式'; break }
  }
  report.textLen = await getTextLen()
} catch (e) {
  report.error = String(e)
} finally {
  console.log(JSON.stringify(report, null, 2))
  try { edge.kill() } catch { /* 已退出 */ }
  await sleep(1200)
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } catch { /* 残留 */ }
}
