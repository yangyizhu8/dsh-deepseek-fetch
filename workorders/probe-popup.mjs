// 探针：WPS「快捷登录并查看」浮层能否在渲染期关闭（决定 P4 走哪条路）
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL_ = 'https://www.kdocs.cn/l/cgJRsrQzOc1S'
const PORT = 9522
const UDD = 'C:/project-study/dsh-deepseek-fetch/workorders/.edge-popup'

fs.rmSync(UDD, { recursive: true, force: true })
fs.mkdirSync(UDD, { recursive: true })
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
  `--user-data-dir=${UDD}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--window-size=1440,900', URL_], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

  console.log('=== 页面结构 ===')
  console.log(JSON.stringify(await ev(`(() => ({
    canvas: document.querySelectorAll('canvas').length,
    iframe: document.querySelectorAll('iframe').length,
    bodyChildren: document.body ? document.body.children.length : -1,
    title: document.title,
  }))()`), null, 1))

  console.log('\n=== 含「快捷登录」的元素 ===')
  console.log(JSON.stringify(await ev(`(() => {
    const out = []
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '').trim()
      if (t.includes('快捷登录') && t.length < 40) {
        const r = el.getBoundingClientRect()
        out.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: t.slice(0, 24) })
      }
    }
    return out.slice(0, 8)
  })()`), null, 1))

  console.log('\n=== 浮层容器（含「用 WPS 打开文档」的外层）===')
  console.log(JSON.stringify(await ev(`(() => {
    const out = []
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '')
      if (t.includes('用 WPS 打开文档') && t.length < 400) {
        const r = el.getBoundingClientRect()
        let chain = [], p = el
        for (let i = 0; i < 5 && p; i++) {
          const rr = p.getBoundingClientRect()
          chain.push({ tag: p.tagName, cls: (typeof p.className === 'string' ? p.className : '').slice(0, 70), rect: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)], pos: getComputedStyle(p).position })
          p = p.parentElement
        }
        out.push(chain)
      }
    }
    return out.slice(0, 2)
  })()`), null, 1))

  console.log('\n=== 候选关闭按钮（class/aria 含 close/关闭）===')
  console.log(JSON.stringify(await ev(`(() => {
    const out = []
    for (const el of document.querySelectorAll('[class*="close" i], [aria-label*="关闭"], [class*="icon-close" i], [class*="popup" i], [class*="mask" i], [class*="modal" i]')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })
    }
    return out.slice(0, 12)
  })()`), null, 1))
} catch (e) {
  console.log('ERR', String(e))
} finally {
  try { edge.kill() } catch { /* 已退出 */ }
  await sleep(1200)
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } catch { /* 残留 */ }
}
