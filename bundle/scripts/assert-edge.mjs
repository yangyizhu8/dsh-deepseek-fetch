#!/usr/bin/env node
// assert-edge.mjs — 阶段05 独立审查驱动的定点断言：
//   ① 发现通道重定向越界 → 必须拒绝，且**目标端口零请求**（审查 P1-1：跟随 302 → 本机盲打 SSRF）
//   ② 同 host 重定向 → 允许跟随（不能把正常跳转也堵死）
//   ③ 合集标题为空 → 回退 host+pathname（审查 P2-5：出现空的 `# ` 标题层级）
//   ④ 未抓取清单条数超上限 → 逐条部分截断 + 汇总行（审查 P2-8：清单与返回值体积必须有界）
// 单独运行：node scripts/assert-edge.mjs（失败 exit 91~95）；由 verify.mjs 汇总调用。
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

/** 起一个 127.0.0.1 随机端口的桩；handler 由调用方给。 */
function startServer(handler) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    handler(req, res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }))
  })
}

export async function run() {
  // ── ① 目标端口（模拟内网/他人服务）──
  const target = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('INTERNAL-SECRET-BODY')
  })
  // ── 源端口：302 跳到目标端口（host 不同）──
  const source = await startServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/internal-secret` })
    res.end()
  })
  try {
    const res = await m.fetchHtml(
      `http://127.0.0.1:${source.port}/page`,
      5000,
      undefined,
      'Mozilla/5.0 (dsh-deepseek-fetch/0.2)',
      `127.0.0.1:${source.port}`,
    )
    if (res.ok) fail(91, '重定向到不同 host 应当被拒绝（SSRF 防护）')
    if (!String(res.reason ?? '').includes('重定向越界')) fail(91, `失败原因应说明重定向越界，实际：${res.reason ?? '(无)'}`)
    if (target.hits.length !== 0) fail(92, `越界目标端口被访问了 ${target.hits.length} 次：${target.hits.join(',')}`)

    // ── ② 同 host 重定向：允许跟随 ──
    const same = await startServer((req, res) => {
      if (req.url === '/from') {
        res.writeHead(302, { Location: '/to' })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html>ok</html>')
    })
    try {
      const res2 = await m.fetchHtml(
        `http://127.0.0.1:${same.port}/from`,
        5000,
        undefined,
        'Mozilla/5.0 (dsh-deepseek-fetch/0.2)',
        `127.0.0.1:${same.port}`,
      )
      if (!res2.ok) fail(93, `同 host 重定向应当被跟随，实际失败：${res2.reason ?? res2.status}`)
      if (!String(res2.html ?? '').includes('ok')) fail(93, '同 host 重定向后应取到目标页内容')
    } finally {
      same.server.close()
      same.server.closeAllConnections()
    }
  } finally {
    source.server.close()
    source.server.closeAllConnections()
    target.server.close()
    target.server.closeAllConnections()
  }

  // ── ③ 空标题回退 ──
  const merged = m.renderMerged({ url: 'https://h.example/docs/x', title: '', content: 'C' }, [], [])
  if (!merged.startsWith('# h.example/docs/x')) fail(94, `空标题应回退为 host+pathname，实际：${JSON.stringify(merged.slice(0, 40))}`)

  // ── ④ 清单条数上限：逐条截断 + 汇总行 ──
  const many = Array.from({ length: 260 }, (_v, i) => ({ url: `https://h.example/${i}`, reason: 'x' }))
  const capped = m.renderMerged({ url: 'https://h.example/', title: 'T', content: 'C' }, [], many, many.length)
  if (!capped.includes('## 未抓取清单')) fail(95, '清单节应存在')
  if (!capped.includes('另有')) fail(95, '超出上限时应给出「另有 N 条未逐条列出」的汇总行')
  const listed = (capped.match(/^- https:\/\/h\.example\//gm) || []).length
  if (listed > 200) fail(95, `逐条列出的条数 ${listed} 超过上限 200`)
  console.log('edge-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
