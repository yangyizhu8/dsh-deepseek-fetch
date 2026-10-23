#!/usr/bin/env node
// assert-discover.mjs — T-12 断言（纯函数，无网络）：发现层 7 类锚点样例 + robots 4 类样例
// （Design §14.3/§14.4；DEV-PLAN T-12 验收）。
// 锚点覆盖：相对链接 / 绝对链接 / #anchor / mailto: 等非白名单协议 / 跨 host（严格同 host）/
// 扩展名黑名单 / origin+pathname 去重；另含实体最小解码。
// robots 覆盖：Disallow: / 全站拒 / 最长前缀 Allow 覆盖 Disallow（含同长 Allow 优先）/
// User-agent 分组（* 与本插件 token 两组都收集）/ 空规则放行。
// 单独运行：node scripts/assert-discover.mjs（失败 exit 51~59）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

export async function run() {
  // ── 锚点抽取：单/双引号、无 href、空 href、实体最小解码（&amp; → &）──
  const anchors = m.extractAnchors('<a href="/a?x=1&amp;y=2">A</a> <a href=\'/b\'>B</a> <a name="n">无href</a> <a href="">空</a>')
  if (anchors.length !== 2) fail(51, `锚点抽取数量 ${anchors.length} ≠ 2：${JSON.stringify(anchors)}`)
  if (anchors[0] !== '/a?x=1&y=2') fail(52, `实体最小解码不符（&amp; 应解为 &）：${JSON.stringify(anchors)}`)
  if (anchors[1] !== '/b') fail(52, `单引号 href 未识别：${JSON.stringify(anchors)}`)

  // ── ① 相对链接：基于页 URL 解析（页路径以 / 结尾时拼接在目录下）──
  if (m.normalizeLink('docs/a', 'http://ex.com/guide/') !== 'http://ex.com/guide/docs/a') {
    fail(53, `相对链接解析不符：${JSON.stringify(m.normalizeLink('docs/a', 'http://ex.com/guide/'))}`)
  }
  // ── ② 绝对链接：直接采用（跨 base host 也保留；host 过滤是 sameHost 的职责）──
  if (m.normalizeLink('https://other.net/x', 'http://ex.com/') !== 'https://other.net/x') {
    fail(53, `绝对链接解析不符：${JSON.stringify(m.normalizeLink('https://other.net/x', 'http://ex.com/'))}`)
  }
  // ── ③ #fragment：去除后等于页 URL 本身 ──
  if (m.normalizeLink('#top', 'http://ex.com/page') !== 'http://ex.com/page') {
    fail(53, `fragment 去除不符：${JSON.stringify(m.normalizeLink('#top', 'http://ex.com/page'))}`)
  }
  // ── ④ 非白名单协议：mailto/tel/javascript/data/blob → null ──
  for (const scheme of ['mailto:a@b.c', 'tel:+10086', 'javascript:alert(1)', 'data:text/plain,hi', 'blob:x-y']) {
    const got = m.normalizeLink(scheme, 'http://ex.com/')
    if (got !== null) fail(54, `${scheme} 应被丢弃（null），实际 ${JSON.stringify(got)}`)
  }
  // ── ⑤ 严格同 host：不跨子域、端口参与、大小写不敏感 ──
  if (!m.sameHost('http://ex.com/a', 'ex.com')) fail(55, '同 host 应放行：http://ex.com/a vs ex.com')
  if (m.sameHost('http://sub.ex.com/a', 'ex.com')) fail(55, '子域不应放行（严格同 host，不跨子域）')
  if (m.sameHost('http://ex.com:8080/a', 'ex.com')) fail(55, '端口不同不应放行')
  if (!m.sameHost('http://EX.com/a', 'ex.com')) fail(55, 'host 大小写应不敏感')
  // ── ⑥ 扩展名黑名单（大小写不敏感；不误伤无扩展名/其它扩展名路径）──
  for (const p of ['/i/x.PNG', '/i/a.jpeg', '/v/a.mp4', '/static/f.js', '/d/doc.docx', '/f/x.woff2', '/s/ico.ico']) {
    if (!m.BLOCKED_EXT.test(p)) fail(56, `黑名单扩展名未命中：${p}`)
  }
  for (const p of ['/docs/page', '/a.markdown', '/mp3x', '/docs/page.jsonx']) {
    if (m.BLOCKED_EXT.test(p)) fail(56, `非黑名单路径被误伤：${p}`)
  }
  // ── ⑦ 去重键 origin+pathname（query 不参与判重）──
  if (m.dedupeKey('http://ex.com/a?x=1') !== m.dedupeKey('http://ex.com/a?y=2')) {
    fail(57, '同 pathname 不同 query 应产生相同去重键')
  }
  if (m.dedupeKey('http://ex.com/a') === m.dedupeKey('http://ex.com/b')) {
    fail(57, '不同 pathname 应产生不同去重键')
  }

  // ── robots ① Disallow: / 全站拒 ──
  const r1 = m.parseRobots('User-agent: *\nDisallow: /')
  if (m.robotsAllows(r1, '/anything/here')) fail(58, 'Disallow: / 应全站拒绝')
  // ── robots ② 最长前缀：更长 Allow 覆盖 Disallow；同长 Allow 优先 ──
  const r2 = m.parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b')
  if (!m.robotsAllows(r2, '/a/b/c')) fail(58, '更长 Allow 前缀应放行 /a/b/c')
  if (m.robotsAllows(r2, '/a/c')) fail(58, 'Disallow /a 应拒绝 /a/c')
  if (!m.robotsAllows({ disallow: ['/a'], allow: ['/a'] }, '/a/x')) fail(58, '同长 Allow 应优先于同长 Disallow')
  // ── robots ③ User-agent 分组：* 组与本插件 token 组规则都收集 ──
  const r3 = m.parseRobots('User-agent: *\nDisallow: /private\n\nUser-agent: dsh-deepseek-fetch\nDisallow: /tmp')
  if (m.robotsAllows(r3, '/private/x')) fail(59, '* 组 Disallow /private 未生效')
  if (m.robotsAllows(r3, '/tmp/x')) fail(59, '本插件 token 组 Disallow /tmp 未生效')
  if (!m.robotsAllows(r3, '/open')) fail(59, '未命中任何规则应放行')
  // ── robots ④ 空规则放行（对应 robots.txt 取不到/为空的保守面）──
  if (!m.robotsAllows(m.parseRobots(''), '/x')) fail(59, '空规则应放行')

  console.log('discover-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
