const KEY = process.env.DEEPSEEK_API_KEY
const API = 'https://api.deepseek.com/v1/tools/fetch'
const UA = 'Mozilla/5.0 (dsh-deepseek-fetch/0.2)'
const BASE = 'https://www.kdocs.cn/l/cgJRsrQzOc1S'

// 有效内容标记 vs 编辑器噪声标记
const HAS_BODY = '三剑客各司其职'      // 正文小节名
const HAS_ART2 = '第 2 战'              // 目录中的第 2 战
const NOISE = '表情与角色'              // WPS emoji 面板

const variants = [
  ['原链接', BASE],
  ['?print=1', `${BASE}?print=1`],
  ['?print=true', `${BASE}?print=true`],
  ['?view=print', `${BASE}?view=print`],
  ['?export=1', `${BASE}?export=1`],
  ['?from=docs&print=1', `${BASE}?from=docs&print=1`],
  ['?r=1(破缓存)', `${BASE}?r=1`],
  ['/print 路径', `${BASE}/print`],
  ['m.移动版', 'https://m.kdocs.cn/l/cgJRsrQzOc1S'],
]

async function deepSeekFetch(url) {
  const t0 = Date.now()
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const j = await res.json().catch(() => null)
  if (!j || typeof j.content !== 'string') return { http: res.status, ms: Date.now() - t0, err: JSON.stringify(j).slice(0, 120) }
  const c = j.content
  return {
    http: res.status,
    ms: Date.now() - t0,
    title: j.title,
    len: c.length,
    lines: c.split('\n').length,
    hasBody: c.includes(HAS_BODY),
    hasArt2: c.includes(HAS_ART2),
    noise: c.includes(NOISE),
    noiseIdx: c.indexOf(NOISE),
    head: c.split('\n').slice(0, 3).join(' / ').slice(0, 80),
  }
}

async function rawHtml(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    const html = await res.text()
    return {
      http: res.status,
      bytes: html.length,
      hasBodyText: html.includes(HAS_BODY),
      hasArt2: html.includes(HAS_ART2),
      hasEmojiPanel: html.includes(NOISE),
      jsonBlobs: ['__INITIAL_STATE__', '__NEXT_DATA__', 'window.DATA', 'pageData', 'docData', 'content']
        .filter((k) => html.includes(k)),
      title: (/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] ?? '',
    }
  } catch (e) {
    return { err: String(e).slice(0, 100) }
  }
}

for (const [label, url] of variants) {
  const a = await deepSeekFetch(url)
  const b = await rawHtml(url)
  console.log(`\n### ${label}  ${url}`)
  console.log('  API : ' + JSON.stringify(a))
  console.log('  HTML: ' + JSON.stringify(b))
}
