import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const LIB = 'C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL = 'https://www.kdocs.cn/l/cgJRsrQzOc1S'
const PORT = 9488
const UDD = 'C:/project-study/dsh-deepseek-fetch/workorders/.edge-diag2'

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
  await send('Runtime.enable')

  const raw0 = await ev('document.body ? (document.body.innerText||"") : ""')
  console.log('原始 innerText（11s，未滚）长度 =', raw0.length)
  console.log('  含"三剑客"=', raw0.includes('三剑客'), ' 含"核心价值"=', raw0.includes('核心价值'))

  // 滚 10 步（用插件导出的表达式 + 插件的候选采集）
  const cands = await m.collectScrollCandidates({ evalJs: ev })
  console.log('插件采集到的候选 =', JSON.stringify(cands))
  const pick = m.pickScrollingElement(cands)
  console.log('插件选中 =', pick)
  for (let i = 0; i < 10; i++) {
    const expr = pick === null ? m.windowScrollExpr(840) : m.elementScrollExpr(pick, 840)
    const r = await ev(expr)
    if (i === 0 || i === 9) console.log(`  滚动#${i + 1}:`, JSON.stringify(r))
    await sleep(700)
  }
  const raw1 = await ev('document.body ? (document.body.innerText||"") : ""')
  console.log('滚动 10 步后原始 innerText 长度 =', raw1.length)
  console.log('  含"三剑客"=', raw1.includes('三剑客'), ' 含"核心价值"=', raw1.includes('核心价值'))
  const cleaned = m.cleanRenderedText(raw1)
  console.log('经 cleanRenderedText 后长度 =', cleaned.length, ' 含"三剑客"=', cleaned.includes('三剑客'))
  console.log('--- 清洗后前 400 字 ---')
  console.log(cleaned.slice(0, 400))
  console.log('--- 原始前 400 字 ---')
  console.log(raw1.slice(0, 400))
} catch (e) {
  console.log('ERR', String(e))
} finally {
  try { edge.kill() } catch { /* 已退出 */ }
  await sleep(1200)
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } catch { /* 残留 */ }
}
