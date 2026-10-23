// 审查 P2-11 取证：真实站点上，究竟是哪 4 个元素被剥离？（class / rect / 视口占比 / 定位 / 文本长度）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const m = await import(pathToFileURL('C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').href)
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL_ = 'https://www.kdocs.cn/l/cgJRsrQzOc1S'
const PORT = 9557
const UDD = 'C:/project-study/dsh-deepseek-fetch/workorders/.edge-audit'

fs.rmSync(UDD, { recursive: true, force: true })
fs.mkdirSync(UDD, { recursive: true })
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
  `--user-data-dir=${UDD}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--window-size=1440,900', URL_], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 只**列举**不删除（与生产表达式同样四+一约束），便于审计
const LIST_JS = `(() => {
  const out = []
  const vw = window.innerWidth, vh = window.innerHeight
  const area = vw * vh
  if (!(area > 0)) return out
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cls = (typeof el.className === 'string' ? el.className : '')
    if (!/popup|modal|mask|overlay|dialog|guide/i.test(cls)) continue
    const t = (el.textContent || '').trim()
    if (t.length >= ${m.STRIP_MAX_TEXT_LENGTH}) continue
    if (el.tagName === 'CANVAS' || el.tagName === 'IFRAME') continue
    const pos = getComputedStyle(el).position
    if (pos !== 'fixed' && pos !== 'absolute' && pos !== 'sticky') continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height < area * ${m.STRIP_MIN_VIEWPORT_COVERAGE}) continue
    out.push({ tag: el.tagName, cls: cls.slice(0, 46), pos,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      cover: +(r.width * r.height / area * 100).toFixed(1), textLen: t.length })
  }
  return out
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
  await sleep(1500)

  const list = await ev(LIST_JS)
  console.log(`命中全部约束的元素数 = ${list.length}`)
  list.forEach((e, i) => {
    console.log(`  ${i + 1}. <${e.tag}> .${e.cls}`)
    console.log(`     rect=${JSON.stringify(e.rect)}  覆盖=${e.cover}%  position=${e.pos}  文本长度=${e.textLen}`)
  })
} catch (e) {
  console.log('ERR', String(e))
} finally {
  try { edge.kill() } catch { /* 已退出 */ }
  await sleep(1200)
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } catch { /* 残留 */ }
}
