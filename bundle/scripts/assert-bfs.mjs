#!/usr/bin/env node
// assert-bfs.mjs — T-13 断言：crawlChildren 的 BFS / 预算 / 取消 / robots / 降级（Design §14.4/§14.5）。
// 用 node:http 在 127.0.0.1 随机端口起本地桩（三合一：GET /robots.txt、GET 页面 HTML、POST /api 内容端点），
// 不出网、不发真实 DeepSeek 请求（config.endpoint 指向桩）；测完 finally close + closeAllConnections。
// 用例（T-13 验收 ①~⑤ + robots/空正文/降级补充）：
//  ① 深度 1 只抓根+直链（二层页与外链/png 不触碰）；② max_pages=3 截断且余页记页数预算；
//  ③ 子页 500 → skipped 记 E_UPSTREAM 且整体继续；④ 预算 300ms（桩每内容请求延迟 200ms、并发 1）
//    → budgetExhausted=true 且已抓页保留；⑤ 预取消信号 → 零请求零页面；
//  ⑥ robots Disallow: / 拒根页 → rootFailure E_FETCH_FAILED 且不发内容请求；⑦ robots 拒子树 → 记清单其余照抓；
//  ⑧ 空正文子页 → E_EMPTY_CONTENT 记清单；⑨ 根页 HTML 404（发现通道失败）→ 降级单页并记原因。
// 单独运行：node scripts/assert-bfs.mjs（失败 exit 61~69）；由 verify.mjs 汇总调用。
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

/**
 * 起桩：state 为可变单例（用例间重置字段）；hits 记录所有请求（`METHOD path`）供断言。
 * 页面图：/ → a,b,c（另含外链与 .png 诱饵）；/a → d,e；/b /c /d /e 无出链。
 */
function startStub() {
  const state = {
    robots: 'User-agent: *\nAllow: /\n', // null → 404（视为放行）
    pages: {
      '/': '<a href="/a">a</a> <a href="/b">b</a> <a href="/c">c</a> <a href="https://elsewhere.net/x">外链</a> <a href="/img/logo.png">图</a>',
      '/a': '<a href="/d">d</a> <a href="/e">e</a>',
      '/b': '',
      '/c': '',
      '/d': '',
      '/e': '',
    },
    apiDelayMs: 0,
    apiFailPaths: [],
    apiEmptyPaths: [],
    hits: [],
  }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      let pathname = '/'
      try { pathname = new URL(req.url, 'http://stub').pathname } catch { /* 保底 '/' */ }
      state.hits.push(`${req.method} ${pathname}`)
      const send = (status, type, body) => {
        res.writeHead(status, { 'Content-Type': type })
        res.end(body)
      }
      if (req.method === 'GET' && pathname === '/robots.txt') {
        if (state.robots === null) { send(404, 'text/plain', 'gone'); return }
        send(200, 'text/plain', state.robots)
        return
      }
      if (req.method === 'GET') {
        const html = state.pages[pathname]
        if (html === undefined) { send(404, 'text/plain', 'no page'); return }
        send(200, 'text/html', html)
        return
      }
      if (req.method === 'POST' && pathname === '/api') {
        let targetPath = '/'
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          targetPath = new URL(String(body.url ?? '/')).pathname
        } catch { /* 保底 '/' */ }
        const late = (fn) => setTimeout(fn, state.apiDelayMs)
        if (state.apiFailPaths.some((p) => targetPath.includes(p))) {
          late(() => send(500, 'application/json', JSON.stringify({ error: { message: 'stub upstream boom' } })))
          return
        }
        if (state.apiEmptyPaths.some((p) => targetPath.includes(p))) {
          late(() => send(200, 'application/json', JSON.stringify({ title: `空页${targetPath}`, content: '   ' })))
          return
        }
        late(() => send(200, 'application/json', JSON.stringify({ title: `标题${targetPath}`, content: `正文(${targetPath})` })))
        return
      }
      send(404, 'text/plain', 'no route')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }))
  })
}

/** 测试配置：endpoint 指向桩；并发 1 保证 FIFO 序确定；retries 0 避免失败重试拖慢用例。 */
function makeConfig(port, overrides = {}) {
  return {
    defaultOutputDir: 'C:\\deepseek网页抓取',
    endpoint: `http://127.0.0.1:${port}/api`,
    timeoutMs: 5000,
    retries: 0,
    defaultClean: false,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKey: 'sk-stub-not-real',
    childrenConcurrency: 1,
    childrenTimeoutMs: 60000,
    respectRobots: true,
    htmlUserAgent: 'Mozilla/5.0 (dsh-deepseek-fetch/0.2)',
    ...overrides,
  }
}

export async function run() {
  const { server, state, port } = await startStub()
  try {
    const base = `http://127.0.0.1:${port}`
    const rootUrl = `${base}/`
    const key = 'sk-stub-not-real'

    // ① 深度 1：根 + 直链 a/b/c；d/e（二层）、外链、png 均不触碰
    {
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), undefined, { maxDepth: 1, maxPages: 30 })
      if (r.rootFailure !== undefined) fail(61, `① 根页不应失败：${JSON.stringify(r.rootFailure)}`)
      const order = r.pages.map((p) => p.url).join(' ')
      if (r.pages.length !== 4) fail(61, `① 深度1 应抓 4 页（根+a/b/c），实际 ${r.pages.length}：${order}`)
      if (order !== `${rootUrl} ${base}/a ${base}/b ${base}/c`) fail(61, `① FIFO 顺序不符：${order}`)
      if (state.hits.some((h) => h.endsWith('/d') || h.endsWith('/e'))) fail(61, `① 深度1 不应触碰二层页：${JSON.stringify(state.hits)}`)
      if (r.budgetExhausted !== false) fail(61, '① 不应耗尽预算')
    }

    // ② max_pages=3：根+a+b；c 进入未抓取清单（页数预算）
    {
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), undefined, { maxDepth: 1, maxPages: 3 })
      if (r.pages.length !== 3) fail(62, `② 应截断为 3 页，实际 ${r.pages.length}`)
      const c = r.skipped.find((s) => s.url === `${base}/c`)
      if (c === undefined || !c.reason.includes('max_pages=3')) fail(62, `② c 应记页数预算：${JSON.stringify(r.skipped)}`)
    }

    // ③ 子页 500 → skipped 记 E_UPSTREAM 且整体继续（根/a/c 保留）
    {
      state.apiFailPaths = ['/b']
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), undefined, { maxDepth: 1, maxPages: 30 })
      state.apiFailPaths = []
      if (r.pages.length !== 3) fail(63, `③ b 失败后应保留 根/a/c 共 3 页，实际 ${r.pages.length}`)
      const b = r.skipped.find((s) => s.url === `${base}/b`)
      if (b === undefined || !b.reason.includes('E_UPSTREAM')) fail(63, `③ b 应记 E_UPSTREAM：${JSON.stringify(r.skipped)}`)
      if (r.pagesFailed !== 1) fail(63, `③ pagesFailed 应为 1，实际 ${r.pagesFailed}`)
    }

    // ④ 预算 300ms + 桩每内容请求延迟 200ms + 并发 1 → 抓到第 2 页后耗尽；已抓页保留
    {
      state.apiDelayMs = 200
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port, { childrenTimeoutMs: 300 }), undefined, { maxDepth: 2, maxPages: 30 })
      state.apiDelayMs = 0
      if (r.budgetExhausted !== true) fail(64, `④ 应标记预算耗尽：${JSON.stringify({ pages: r.pages.length, skipped: r.skipped })}`)
      if (r.pages.length < 1 || r.pages.length > 2) {
        fail(64, `④ 应保留根页（~+首个子页，1~2 页），实际 ${r.pages.length}：${r.pages.map((p) => p.url).join(' ')}`)
      }
      if (!r.skipped.every((s) => s.reason === '超出时间预算')) {
        fail(64, `④ 余队（未抓子页）应全部记超出时间预算：${JSON.stringify(r.skipped)}`)
      }
    }

    // ⑤ 调用前已取消 → 零请求、零页面、无 rootFailure
    {
      const before = state.hits.length
      const ctrl = new AbortController()
      ctrl.abort()
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), ctrl.signal, { maxDepth: 1, maxPages: 30 })
      if (state.hits.length !== before) fail(65, `⑤ 取消后不应发任何请求：${JSON.stringify(state.hits.slice(before))}`)
      if (r.pages.length !== 0) fail(65, '⑤ 取消后不应有已抓页')
      if (r.rootFailure !== undefined) fail(65, `⑤ 不应产生 rootFailure：${JSON.stringify(r.rootFailure)}`)
    }

    // ⑥ robots Disallow: / 拒根页 → rootFailure E_FETCH_FAILED，且不发任何内容请求
    {
      state.robots = 'User-agent: *\nDisallow: /\n'
      const before = state.hits.length
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), undefined, { maxDepth: 1, maxPages: 30 })
      state.robots = 'User-agent: *\nAllow: /\n'
      if (r.rootFailure?.code !== 'E_FETCH_FAILED') fail(66, `⑥ 根页被拒应返回 E_FETCH_FAILED：${JSON.stringify(r.rootFailure)}`)
      if (r.pages.length !== 0) fail(66, '⑥ 拒根页不应有已抓页')
      if (state.hits.slice(before).some((h) => h.startsWith('POST'))) fail(66, `⑥ 拒根页不应发内容请求：${JSON.stringify(state.hits.slice(before))}`)
    }

    // ⑦ robots 拒子树 /c → c 记「robots.txt 禁止」，其余照抓
    {
      state.robots = 'User-agent: *\nDisallow: /c\n'
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), undefined, { maxDepth: 1, maxPages: 30 })
      state.robots = 'User-agent: *\nAllow: /\n'
      if (r.pages.length !== 3) fail(67, `⑦ 应抓 根/a/b 共 3 页，实际 ${r.pages.length}`)
      const c = r.skipped.find((s) => s.url === `${base}/c`)
      if (c === undefined || c.reason !== 'robots.txt 禁止') fail(67, `⑦ c 应记 robots 拒：${JSON.stringify(r.skipped)}`)
    }

    // ⑧ 空正文子页 → E_EMPTY_CONTENT 记清单（fetchOne ok 但 content 纯空白）
    {
      state.apiEmptyPaths = ['/b']
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), undefined, { maxDepth: 1, maxPages: 30 })
      state.apiEmptyPaths = []
      const b = r.skipped.find((s) => s.url === `${base}/b`)
      if (b === undefined || !b.reason.includes('E_EMPTY_CONTENT')) fail(68, `⑧ b 应记 E_EMPTY_CONTENT：${JSON.stringify(r.skipped)}`)
      if (r.pagesFailed !== 1) fail(68, `⑧ pagesFailed 应为 1，实际 ${r.pagesFailed}`)
    }

    // ⑨ 根页 HTML 404（发现通道失败）→ 降级单页：仅根页，清单记「子页发现失败」
    {
      delete state.pages['/']
      const r = await m.crawlChildren(rootUrl, key, makeConfig(port), undefined, { maxDepth: 1, maxPages: 30 })
      state.pages['/'] = '<a href="/a">a</a> <a href="/b">b</a> <a href="/c">c</a> <a href="https://elsewhere.net/x">外链</a> <a href="/img/logo.png">图</a>'
      if (r.pages.length !== 1 || r.pages[0].url !== rootUrl) {
        fail(69, `⑨ 发现失败应降级单页，实际 ${JSON.stringify(r.pages.map((p) => p.url))}`)
      }
      const d = r.skipped.find((s) => s.url === rootUrl)
      if (d === undefined || !d.reason.startsWith('子页发现失败')) fail(69, `⑨ 应记子页发现失败：${JSON.stringify(r.skipped)}`)
    }

    console.log('bfs-ok')
  } finally {
    server.close()
    server.closeAllConnections?.()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
