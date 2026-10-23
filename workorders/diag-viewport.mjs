import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const LIB = 'C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL = 'https://www.kdocs.cn/l/cgJRsrQzOc1S'
const PORT = 9499
const UDD = 'C:/project-study/dsh-deepseek-fetch/workorders/.edge-diag3'

fs.rmSync(UDD, { recursive: true, force: true })
fs.mkdirSync(UDD, { recursive: true })
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
  `--user-data-dir=${UDD}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--window-size=1440,900', URL], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const m = await import(pathToFileURL(LIB).href)

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch { await sleep(500) } }
  await sleep(9000)
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

  const probe = async (label) => {
    const raw = await ev('document.body ? (document.body.innerText||"") : ""')
    console.log(`${label}: len=${raw.length} 三剑客=${raw.includes('三剑客')} 量化策略每天都在运行=${raw.includes('量化策略每天都在运行')} 核心价值=${raw.includes('核心价值')}`)
    return raw
  }

  // A) 900 高
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(3000)
  await probe('A 视口900 ')

  // B) 1600 高
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false })
  await sleep(3000)
  await probe('B 视口1600')

  // C) 2400 高
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false })
  await sleep(3000)
  const raw2400 = await probe('C 视口2400')

  console.log('--- 2400 视口下是否含正文段落 ---')
  console.log('含"量化策略每天都在运行":', raw2400.includes('量化策略每天都在运行'))
  console.log('含"没有复盘 = 黑盒印钞":', raw2400.includes('没有复盘'))
  console.log('清洗后长度:', m.cleanRenderedText(raw2400).length)
} catch (e) {
  console.log('ERR', String(e))
} finally {
  try { edge.kill() } catch { /* 已退出 */ }
  await sleep(1200)
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } catch { /* 残留 */ }
}
