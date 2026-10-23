// P4 可行性实测：真实帧上，"浮层容差判重"能否把真重复对与真内容对分开
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const m = await import(pathToFileURL('C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').href)
const DIR = 'C:/deepseek网页抓取/交易回战-·-AI自进化&可解释量化交易-3.shots'
const names = fs.readdirSync(DIR).filter((n) => n.endsWith('.png')).sort()
const fp = new Map(names.map((n) => [n, m.fingerprintFrame(fs.readFileSync(`${DIR}/${n}`))]))

/** 逐格差图（32×32）：返回超阈值格的 bbox / 数量 / 填充率 / 面积占比 */
function diffMap(a, b, thr = 24) {
  const A = a.gray, B = b.gray
  let minX = 99, minY = 99, maxX = -1, maxY = -1, k = 0
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (Math.abs(A[y * 32 + x] - B[y * 32 + x]) > thr) {
        k++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (k === 0) return { k: 0, bbox: null, fill: 0, areaFrac: 0, center: false }
  const bw = maxX - minX + 1, bh = maxY - minY + 1
  const bboxCells = bw * bh
  const cx = (minX + maxX) / 2 / 31, cy = (minY + maxY) / 2 / 31 // 0..1 归一化中心
  return {
    k,
    bbox: { x: minX, y: minY, w: bw, h: bh },
    fill: k / bboxCells,
    areaFrac: bboxCells / 1024,
    center: cx > 0.3 && cx < 0.7 && cy > 0.2 && cy < 0.8,
    cx: +cx.toFixed(2), cy: +cy.toFixed(2),
  }
}

const groups = [
  ['真重复对(同变体)', [['27.png', '29.png'], ['27.png', '31.png'], ['28.png', '30.png'], ['28.png', '32.png']]],
  ['近似对(差2px)', [['27.png', '28.png'], ['28.png', '29.png'], ['29.png', '30.png']]],
  ['必须保留(内容不同)', [['26.png', '27.png'], ['38.png', '42.png'], ['41.png', '43.png'], ['28.png', '44.png'], ['01.png', '02.png'], ['25.png', '26.png']]],
]

for (const [label, pairs] of groups) {
  console.log(`\n=== ${label} ===`)
  for (const [x, y] of pairs) {
    const a = fp.get(x), b = fp.get(y)
    if (!a || !b) { console.log(`  ${x} vs ${y}: 缺帧`); continue }
    const d = diffMap(a, b)
    const mad = m.meanAbsDiff(a.gray, b.gray).toFixed(3)
    const cell = m.maxCellDiff(a.gray, b.gray).toFixed(0)
    console.log(`  ${x} vs ${y}: hamming=${m.hammingBig(a.dhash, b.dhash)} MAD=${mad} maxCell=${cell} | 超阈格 k=${d.k} bbox=${d.bbox ? `${d.bbox.w}x${d.bbox.h}@${d.bbox.x},${d.bbox.y}` : '-'} fill=${d.fill.toFixed(2)} areaFrac=${d.areaFrac.toFixed(3)} center=${d.center} (cx=${d.cx} cy=${d.cy})`)
  }
}
