import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const m = await import(pathToFileURL('C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').href)
const DIR = 'C:/project-study/dsh-deepseek-fetch/workorders/strip-frames'
const names = fs.readdirSync(DIR).filter((n) => n.endsWith('.png')).sort()
const fps = names.map((n) => ({ n, fp: m.fingerprintFrame(fs.readFileSync(`${DIR}/${n}`)), bytes: fs.statSync(`${DIR}/${n}`).size }))

console.log('=== 剥离浮层后：相邻帧差异 ===')
for (let i = 1; i < fps.length; i++) {
  const a = fps[i - 1].fp, b = fps[i].fp
  const same = a.sha1 === b.sha1
  const h = m.hammingBig(a.dhash, b.dhash)
  const mad = m.meanAbsDiff(a.gray, b.gray)
  const cell = m.maxCellDiff(a.gray, b.gray)
  console.log(`  ${fps[i - 1].n} vs ${fps[i].n}: sha1同=${same} hamming=${h} MAD=${mad.toFixed(3)} maxCell=${cell.toFixed(0)} → 判重=${m.isNearDuplicate(a, b)}`)
}
console.log('\n=== 各帧自身信息（stddev / 体积）===')
for (const f of fps) {
  console.log(`  ${f.n}: ${Math.round(f.bytes / 1024)}KB  graySD=${m.grayStdDev(f.fp.gray).toFixed(1)}`)
}
