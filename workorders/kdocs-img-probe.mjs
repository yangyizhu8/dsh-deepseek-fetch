import fs from 'node:fs'

const dom = fs.readFileSync('C:/project-study/dsh-deepseek-fetch/workorders/kdocs-dom.html', 'utf8')

// 1) 统计所有 qwps / wpscdn 图片引用（不止 <img>，含 background/canvas 外的引用）
const refs = [...new Set((dom.match(/https?:\/\/[a-z0-9.\-]*(?:qwps|wpscdn)\.com\/[^"'\\)\s]{10,220}/gi) || []))]
console.log('图片类 URL 引用数=' + refs.length)
for (const r of refs.slice(0, 12)) console.log('  ' + r.slice(0, 150))

// 2) <img> 与 canvas 统计
console.log('\nimg=' + (dom.match(/<img\b/gi) || []).length + ' canvas=' + (dom.match(/<canvas\b/gi) || []).length)
console.log('background-image 出现次数=' + (dom.match(/background-image/gi) || []).length)

// 3) 试取"原图"（去掉 imageMogr2 缩略参数）
const first = refs.find((r) => r.includes('img.qwps.cn'))
if (first) {
  const orig = first.split('?')[0]
  for (const u of [first, orig]) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const b = Buffer.from(await r.arrayBuffer())
      // 读 PNG/JPEG 尺寸
      let dim = '?'
      if (b[0] === 0x89 && b[1] === 0x50) dim = b.readUInt32BE(16) + 'x' + b.readUInt32BE(20)
      else if (b[0] === 0xFF && b[1] === 0xD8) {
        let i = 2
        while (i < b.length - 9) {
          if (b[i] === 0xFF && b[i + 1] >= 0xC0 && b[i + 1] <= 0xCF && b[i + 1] !== 0xC4 && b[i + 1] !== 0xC8 && b[i + 1] !== 0xCC) {
            dim = b.readUInt16BE(i + 7) + 'x' + b.readUInt16BE(i + 5); break
          }
          i += 2 + b.readUInt16BE(i + 2)
        }
      }
      console.log(`\n${u.slice(0, 110)}\n  http=${r.status} type=${r.headers.get('content-type')} bytes=${b.length} dim=${dim}`)
    } catch (e) { console.log('fetch 失败: ' + String(e).slice(0, 80)) }
  }
}
