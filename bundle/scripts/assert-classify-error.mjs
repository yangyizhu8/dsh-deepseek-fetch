#!/usr/bin/env node
// assert-classify-error.mjs — T-04 断言：classifyError 状态码映射 + extractRequestId 提取。
// E_INVALID_URL/E_NO_KEY/E_EMPTY_CONTENT/E_IO 四码由 execute 前置/后置分支产生，
// E_NO_EDGE/E_RENDER_TIMEOUT/E_RENDER_FAILED 三码由 P2 渲染通道产生（Design §15）——均不归
// classifyError 管辖；其完整性由 verify.mjs 的 error-codes 项以 ERROR_CODES 常量断言，合成 11 码全覆盖。
// 单独运行：node scripts/assert-classify-error.mjs（失败 exit 1）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 1
  throw e
}

export async function run() {
  const cases = [
    [401, '', 'E_AUTH'],
    [403, '', 'E_AUTH'],
    [404, 'failed to fetch URL, request_id=x', 'E_FETCH_FAILED'],
    [404, 'some other upstream message', 'E_FETCH_FAILED'], // 404 无特定 message → 同码兜底
    [400, "'url' must be a valid HTTP or HTTPS URL", 'E_FETCH_FAILED'], // 其余 4xx 兜底
    [429, '', 'E_RATE_LIMIT'],
    [500, '', 'E_UPSTREAM'],
    [503, '', 'E_UPSTREAM'],
  ]
  for (const [s, msg, want] of cases) {
    if (m.classifyError(s, msg) !== want) {
      fail(`classifyError(${s}, ${JSON.stringify(msg)}) !== ${want}`)
    }
  }
  if (m.extractRequestId('failed to fetch URL, request_id=abc-123') !== 'abc-123') {
    fail("extractRequestId 应从 message 尾部提取 'abc-123'")
  }
  if (m.extractRequestId('no id here') !== null) {
    fail('extractRequestId 无 request_id 时应返回 null')
  }
  console.log('classifyError-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
