#!/usr/bin/env node
// assert-resolve-apikey.mjs — T-03 断言：resolveApiKey 三级顺序（Spec FR-7：env → Windows 用户级环境 → config）
// 与全 miss = null。断言的 isWin=false 分支跳过注册表一级，因此覆盖 env → config 的相对顺序。
// 断言全程不打印任何 Key 值（只比较、只报不符）。
// 单独运行：node scripts/assert-resolve-apikey.mjs（失败 exit 1）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 1
  throw e
}

export async function run() {
  const r1 = await m.resolveApiKey({ DSF_X: 'k1' }, { apiKeyEnv: 'DSF_X', apiKey: '' }, false)
  const r2 = await m.resolveApiKey({}, { apiKeyEnv: 'DSF_X', apiKey: 'k2' }, false)
  const r3 = await m.resolveApiKey({}, { apiKeyEnv: 'DSF_NO_SUCH_VAR', apiKey: '' }, false)
  // 一级优先于末级：env 与 config 同时有值时取 env
  const r4 = await m.resolveApiKey({ DSF_X: 'k1' }, { apiKeyEnv: 'DSF_X', apiKey: 'k2' }, false)
  if (r1 !== 'k1' || r2 !== 'k2' || r3 !== null || r4 !== 'k1') {
    fail('resolveApiKey 顺序不符（Spec FR-7：env → win 用户级环境 → config；全 miss = null）——不打印任何 Key 值')
  }
  console.log('resolveApiKey-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
