#!/usr/bin/env node
// assert-validate-url.mjs — T-03 断言：validateUrl 三形态拒 / 一形态过（B5 用例 D/E/F/G）。
// 单独运行：node scripts/assert-validate-url.mjs（失败 exit 1）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 1
  throw e
}

export async function run() {
  const bad = [
    ['not-a-url', '无法解析'],
    ['ftp://a.com', '非 http(s)'],
    ['https://user:pass@example.com', '含凭证'],
    ['', '空'],
    ['x'.repeat(8193), '超长（>8192）'],
  ]
  for (const [u, why] of bad) {
    const r = m.validateUrl(u)
    if (r.ok) fail(`validateUrl 应拒绝（${why}）：${JSON.stringify(u.slice(0, 40))}`)
  }
  const okCases = ['https://example.com', 'http://example.com/a?b=1']
  for (const u of okCases) {
    const r = m.validateUrl(u)
    if (!r.ok) fail(`validateUrl 应放行：${u}（reason=${r.reason}）`)
  }
  console.log('validateUrl-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
