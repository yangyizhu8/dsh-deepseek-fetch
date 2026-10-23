#!/usr/bin/env node
// assert-robots.mjs — 阶段05 独立审查驱动的定点断言（纯函数，无网络）：
//   ① robots 通配符 `*` 与 `$` 尾锚（审查 P1-2：此前按字面前缀比较 → 规则静默失效=越界抓取）
//   ② robots 路径段边界（`/a` 不拦 `/abc`）（审查 P2-4）
//   ③ robots UA 分组的空行边界（审查 P2-3：空组泄漏到下一组 → 误拒）
//   ④ 锚点抽取容错：`data-href` / `<script>` / 注释 / 属性值含 `>`（审查 P2-6、P2-7）
// 单独运行：node scripts/assert-robots.mjs（失败 exit 81~85）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

const eq = (actual, expected, code, label) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) fail(code, `${label}：期望 ${b}，实际 ${a}`)
}

export async function run() {
  // ── ① 通配符与尾锚 ──
  const rules = m.parseRobots([
    'User-agent: *',
    'Disallow: /*.pdf$',
    'Disallow: /private$',
    'Disallow: /a',
    'Allow: /a/allowed',
  ].join('\n'))
  if (m.robotsAllows(rules, '/x.pdf')) fail(81, '通配符规则 /*.pdf$ 应拦 /x.pdf')
  if (m.robotsAllows(rules, '/a/b.pdf')) fail(81, '通配符规则应拦 /a/b.pdf')
  if (m.robotsAllows(rules, '/private')) fail(81, '$ 尾锚规则应拦 /private')
  if (!m.robotsAllows(rules, '/privateX')) fail(81, '$ 尾锚不应拦 /privateX')

  // ── ② 路径段边界 ──
  if (!m.robotsAllows(rules, '/abc')) fail(82, '路径段语义：/a 不应拦 /abc')
  if (!m.robotsAllows(rules, '/a/allowed')) fail(82, '更长的 Allow 应放行')
  if (m.robotsAllows(rules, '/a/x')) fail(82, '/a 应拦 /a/x')
  if (!m.robotsAllows(rules, '/ok')) fail(82, '未命中应放行')

  // ── ③ UA 分组空行边界（空组不得泄漏到下一组）──
  const grouped = m.parseRobots(['User-agent: *', '', 'User-agent: EvilBot', 'Disallow: /secret'].join('\n'))
  if (grouped.disallow.includes('/secret')) fail(83, '非本 UA 分组的规则不应被收集（空行分组边界）')
  if (!m.robotsAllows(grouped, '/secret')) fail(83, '非本 UA 分组规则不应产生拦截')

  // ── ④ 锚点容错 ──
  const html = [
    '<a href="/ok">ok</a>',
    '<a data-href="/lazy">lazy</a>',
    '<script>var s = "<a href=\'/evil\'>"</script>',
    '<!-- <a href="/comment">c</a> -->',
    '<a title="a > b" href="/gt">gt</a>',
  ].join('\n')
  eq(m.extractAnchors(html), ['/ok', '/gt'], 84, '锚点抽取（去伪链接 + 属性含 > 不漏抽）')

  // ── ⑤ 空 Disallow = 放行 ──
  if (!m.robotsAllows(m.parseRobots('User-agent: *\nDisallow:'), '/anything')) fail(85, '空 Disallow 应放行')

  console.log('robots-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
