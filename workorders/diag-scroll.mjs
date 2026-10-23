// 对照探针：复刻插件的采集+选取+滚动，定位"正文只拿到目录"的原因
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const LIB = 'C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL = 'https://www.kdocs.cn/l/cgJRsrQzOc1S'
const PORT = 9477
const UDD = 'C:/project-study/dsh-deepseek-fetch/workorders/.edge-diag'

fs.rmSync(UDD, { recursive: true, force: true })
fs.mkdirSync(UDD, { recursive: true })
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
  `--user-data-dir=${UDD}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--window-size=1440,900', URL], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const m = await import(pathToFileURL(LIB).href)

const COLLECT = `(() => {
  const all = []
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
      const r = el.getBoundingClientRect()
      all.push({ el: el, w: Math.round(r.width), h: Math.round(r.height), sh: el.scrollHeight, ch: el.clientHeight, tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40) })
    }
  }
  all.sort((a, b) => (b.w * b.h) - (a.w * a.h))
  window.__dshDiag = all
  return all.slice(0, 6).map((x) => ({ w: x.w, h: x.h, sh: x.sh, ch: x.ch, area: x.w * x.h, tag: x.tag, cls: x.cls }))
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
  await send('Runtime.enable')

  const cands = await ev(COLLECT)
  console.log('候选容器 top6:')
  for (const c of cands) console.log('  ', JSON.stringify(c))
  const pick = m.pickScrollingElement(cands ?? [])
  console.log('插件逻辑选中下标 =', pick)

  const before = await ev('document.body ? (document.body.innerText||"").length : -1')
  console.log('滚动前 innerText 长度 =', before)

  // 用插件导出的滚动表达式滚 5 步
  for (let i = 0; i < 5; i++) {
    const expr = pick === null ? m.windowScrollExpr(840) : m.elementScrollExpr(pick, 840)
    const r = await ev(expr)
    console.log(`  滚动 #${i + 1}:`, JSON.stringify(r))
    await sleep(700)
  }
  const after = await ev('document.body ? (document.body.innerText||"").length : -1')
  console.log('滚动后 innerText 长度 =', after)
  // 直接在页内看"被选元素"的可滚信息与文本量
  const diag = await ev(`(() => {
    const el = (window.__dshDiag || [])[${pick ?? 0}]
    if (!el) return { none: true }
    const t = (el.innerText || '').length
    return { tag: el.tag, sh: el.scrollHeight, ch: el.clientHeight, innerTextLen: t, scrollTop: el.scrollTop, bodyLen: (document.body.innerText||'').length }
  })()`)
  console.log('被选容器详情:', JSON.stringify(diag))
} catch (e) {
  console.log('ERR', String(e))
} finally {
  try { edge.kill() } catch { /* 已退出 */ }
  await sleep(1200)
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } catch { /* 残留 */ }
}
