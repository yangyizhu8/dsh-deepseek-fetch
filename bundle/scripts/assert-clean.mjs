#!/usr/bin/env node
// assert-clean.mjs — T-05 断言：cleanMarkdown 围栏内保留 / 围栏外剥离（FR-2）。
// 本文件以真实字符写断言（不用 node -e，避免 bash 双引号吞反斜杠——DEV-PLAN §3 前言）。
// 注意：下面的字符串字面量中 '\\#' 是两个字符（反斜杠+#），JS 解析后为 '\#'。
// 单独运行：node scripts/assert-clean.mjs（失败 exit 11/12/13/14）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

export async function run() {
  // T-05 判据原例：块外 \# 与 \[ \] 剥离；```bash 围栏内（含反斜杠路径与 \\）原样保留
  const input = '\\# 标题\n\n```bash\nls C:\\dir \\\\ x\n```\n\n\\[链接\\]'
  const out = m.cleanMarkdown(input)
  if (!out.startsWith('# 标题')) fail(11, `块外剥离失败：开头应为 '# 标题'，实际 ${JSON.stringify(out.slice(0, 16))}`)
  if (!out.includes('ls C:\\dir \\\\ x')) fail(12, '围栏内保留失败：代码块内容被改动')
  if (!out.endsWith('[链接]')) fail(13, `块外剥离失败：结尾应为 '[链接]'，实际 ${JSON.stringify(out.slice(-8))}`)
  // 附加：块外 Windows 路径（\+字母，非标点）原样保留——R-08 误伤防护
  const pathLine = '路径是 C:\\dir\\x 末尾'
  if (m.cleanMarkdown(pathLine) !== pathLine) fail(14, '块外 \\+字母 被误伤（Windows 路径应原样保留）')
  console.log('cleanMarkdown-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
