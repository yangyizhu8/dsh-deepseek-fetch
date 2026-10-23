#!/usr/bin/env node
// assert-merge.mjs — T-14 断言（纯函数，无网络）：renderMerged 合集结构 + mergedSlug 命名回退
// （Design §14.6/§14.7；DEV-PLAN T-14 验收）。
// 结构用**整串严格相等**比对（不只查子串）：根页 `#`、子页 `##`、来源行 `> 来源: <url>`、
// 页间 `\n\n---\n\n`、文末「## 未抓取清单」（skipped 非空才出现）、页内标题不重写。
// 单独运行：node scripts/assert-merge.mjs（失败 exit 71~75）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

export async function run() {
  // ── 结构整串比对：根 # / 子 ## / 来源行 / 分隔 / 未抓取清单 / 页内标题原样保留 ──
  const root = { url: 'http://r.example/', title: '根页', content: 'R正文' }
  const child = { url: 'http://r.example/c', title: '子页', content: 'C正文\n\n# 页内一级标题保持原样' }
  const skipped = [{ url: 'http://r.example/x', reason: 'robots.txt 禁止' }]
  const expected = [
    '# 根页', '', '> 来源: http://r.example/', '', 'R正文',
    '', '---', '',
    '## 子页', '', '> 来源: http://r.example/c', '', 'C正文', '', '# 页内一级标题保持原样',
    '', '---', '',
    '## 未抓取清单', '',
    '- http://r.example/x — robots.txt 禁止',
  ].join('\n')
  const got = m.renderMerged(root, [child], skipped)
  if (got !== expected) fail(71, `合集结构整串不符：\n--期望--\n${expected}\n--实际--\n${got}`)

  // ── skipped 为空 → 无「未抓取清单」节，以正文收尾 ──
  const noSkip = m.renderMerged(root, [child], [])
  if (noSkip.includes('未抓取清单')) fail(72, 'skipped 为空不应输出「未抓取清单」节')
  if (!noSkip.endsWith('# 页内一级标题保持原样')) {
    fail(72, `无清单时应以正文收尾，实际结尾：${JSON.stringify(noSkip.slice(-24))}`)
  }

  // ── 多子页分隔数 = 页数 - 1；未抓取清单前也有一道 `---` ──
  const two = m.renderMerged(root, [child, { url: 'http://r.example/d', title: '子页二', content: 'D' }], [])
  if (two.split('\n\n---\n\n').length !== 3) {
    fail(73, `三页应恰有两个页间分隔，实际 ${two.split('\n\n---\n\n').length} 段`)
  }

  // ── 命名：标题 slug + -合集（T-14 判据原例）──
  if (m.mergedSlug('深度求索 API', 'https://x.example/') !== '深度求索-API-合集') {
    fail(74, `标题命名不符（应为 深度求索-API-合集）：${JSON.stringify(m.mergedSlug('深度求索 API', 'https://x.example/'))}`)
  }
  // ── 命名：URL 形态标题 → host-pathname 回退再拼 -合集（仅合集路径启用；https/http 皆覆盖）──
  if (m.mergedSlug('https://example.com/docs/x', 'https://example.com/docs/x') !== 'example.com-docs-x-合集') {
    fail(75, `https 形态回退不符：${JSON.stringify(m.mergedSlug('https://example.com/docs/x', 'https://example.com/docs/x'))}`)
  }
  if (m.mergedSlug('http://ex.com/a', 'http://ex.com/a') !== 'ex.com-a-合集') {
    fail(75, `http 形态回退不符：${JSON.stringify(m.mergedSlug('http://ex.com/a', 'http://ex.com/a'))}`)
  }

  console.log('merge-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
