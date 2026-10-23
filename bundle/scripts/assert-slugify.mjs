#!/usr/bin/env node
// assert-slugify.mjs — T-06 断言：slugify 五边界（中文清洗 / 非法字符移除 / Windows 保留名 /
// 空标题回退 host-pathname / 截断 80）。文件名规则见 Plugin-Design §8。
// 单独运行：node scripts/assert-slugify.mjs（失败 exit 21~25）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

export async function run() {
  if (m.slugify('  深度求索 API: 文档 ', 'example.com/x') !== '深度求索-API-文档') {
    fail(21, `中文标题清洗不符：${JSON.stringify(m.slugify('  深度求索 API: 文档 ', 'example.com/x'))}`)
  }
  if (m.slugify('a/b\\c?d*e', 'h/p') !== 'a-b-c-d-e') {
    fail(22, `非法字符替换不符（Spec FR-3：非法字符→\`-\`）：${JSON.stringify(m.slugify('a/b\\c?d*e', 'h/p'))}`)
  }
  if (m.slugify('CON', 'h/p') !== '_CON') {
    fail(23, `Windows 保留名前缀不符：${JSON.stringify(m.slugify('CON', 'h/p'))}`)
  }
  if (m.slugify('', 'example.com/docs/x') !== 'example.com-docs-x') {
    fail(24, `空标题回退不符：${JSON.stringify(m.slugify('', 'example.com/docs/x'))}`)
  }
  if (m.slugify('x'.repeat(200), 'h/p').length !== 80) {
    fail(25, `截断 80 不符：长度 ${m.slugify('x'.repeat(200), 'h/p').length}`)
  }
  console.log('slugify-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
