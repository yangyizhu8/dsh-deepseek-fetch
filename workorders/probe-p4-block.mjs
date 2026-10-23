// P4 关键实验：32×32 点采样 vs 8×8 块采样，能否分开"真重复"与"真内容"
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const LIB = 'C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js'
const m = await import(pathToFileURL(LIB).href)
const DIR = 'C:/deepseek网页抓取/交易回战-·-AI自进化&可解释量化交易-3.shots'
const names = fs.readdirSync(DIR).filter((n) => n.endsWith('.png')).sort()

/** 解码为灰度全图（1440×900），供块级比较 */
function grayOf(file) {
  const img = m.decodePng(fs.readFileSync(`${DIR}/${file}`))
  const { width, height, channels, pixels } = img
  const g = new Float64Array(width * height)
  for (let i = 0, p = 0; i < g.length; i++, p += channels) {
    g[i] = channels >= 3 ? 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2] : pixels[p]
  }
  return { width, height, g }
}

/** 块级差分：block×block 像素取均值后比较 → { maxBlock, meanBlock, nonzero } */
function blockDiff(a, b, block = 8) {
  const bw = Math.floor(a.width / block), bh = Math.floor(a.height / block)
  let max = 0, sum = 0, nz = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sa = 0, sb = 0
      for (let y = 0; y < block; y++) {
        const rowA = (by * block + y) * a.width + bx * block
        const rowB = (by * block + y) * b.width + bx * block
        for (let x = 0; x < block; x++) { sa += a.g[rowA + x]; sb += b.g[rowB + x] }
      }
      const d = Math.abs(sa - sb) / (block * block)
      if (d > 0.001) nz++
      sum += d
      if (d > max) max = d
    }
  }
  return { max, mean: sum / (bw * bh), nz, total: bw * bh, nzFrac: nz / (bw * bh) }
}

const cache = new Map()
const G = (n) => { if (!cache.has(n)) cache.set(n, grayOf(n)); return cache.get(n) }

const groups = [
  ['真重复/近似（应判重）', [['28.png', '30.png'], ['28.png', '32.png'], ['29.png', '30.png'], ['30.png', '32.png'], ['27.png', '28.png']]],
  ['必须保留（内容不同）', [['38.png', '42.png'], ['41.png', '43.png'], ['26.png', '27.png'], ['01.png', '02.png'], ['28.png', '44.png'], ['25.png', '26.png'], ['27.png', '29.png']]],
]

for (const block of [8, 4]) {
  console.log(`\n########## 块级 ${block}×${block} 像素 ##########`)
  for (const [label, pairs] of groups) {
    console.log(`\n=== ${label} ===`)
    for (const [x, y] of pairs) {
      const d = blockDiff(G(x), G(y), block)
      console.log(`  ${x} vs ${y}: maxBlock=${d.max.toFixed(2)} meanBlock=${d.mean.toFixed(3)} 非零块占比=${(d.nzFrac * 100).toFixed(2)}%`)
    }
  }
}
