#!/usr/bin/env node
// assert-phash.mjs — T-24 断言：感知哈希近重复判定（Design §16.4 / DEV-PLAN T-24 验收）。
//  ① 真近重复对（27 vs 37，原型实测 MAD=0.954）→ isNearDuplicate **true**
//  ② 相似但内容不同的幻灯片对（38vs42 / 41vs43 / 28vs44，原型实测 MAD≥2.791）→ **false**（不得误删，R-26）
//  ③ 不同内容帧（01 vs 02）→ false
//  ④ 解码失败桩（dhash/gray=null）：相同 sha1 → true（快路径）；不同 sha1 → false（回退 sha1 语义，宁可漏删）
//  ⑤ hammingBig 边界：同值=0、全反=64
//  ⑥ meanAbsDiff 边界：相同数组=0
//  另守阈值常量（防恒绿抽检的锚点）：PHASH_MAX_HAMMING=2、PHASH_MAX_MAD=1.5
// 真实 PNG 引用均为只读。单独运行：node scripts/assert-phash.mjs（失败 exit 55）；由 verify.mjs 汇总调用。
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 55
  throw e
}

const DIR = 'C:/deepseek网页抓取/交易回战-·-AI自进化&可解释量化交易-3.shots'

/** 读真实帧并取指纹（真实截图应全部可解码——原型已验证 45 张）。 */
function fpOf(name) {
  const f = m.fingerprintFrame(readFileSync(join(DIR, name)))
  if (typeof f.sha1 !== 'string' || f.sha1.length !== 40) fail(`真实帧 ${name} 的 sha1 应为 40 位十六进制，实际 ${JSON.stringify(f.sha1)}`)
  if (f.dhash === null || f.gray === null) fail(`真实帧 ${name} 应可解码（dhash/gray 非 null）——若失败说明解码器与实测原型出现偏差`)
  return f
}

/** 确定性 CRC32（PNG chunk 用）。 */
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 带纹理 64×64 PNG（stddev≈52，避开 uniform 守卫）；patches 为增量 [[x,y,delta]]。 */
function texturedPng(seed, patches = []) {
  const size = 64, stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  let state = (seed * 2654435761) >>> 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      state = (state * 1664525 + 1013904223) >>> 0
      const v = 40 + (state >>> 24) % 180
      const o = y * (stride + 1) + 1 + x * 4
      raw[o] = v; raw[o + 1] = v; raw[o + 2] = v; raw[o + 3] = 255
    }
  }
  for (const [px, py, delta] of patches) {
    const o = py * (stride + 1) + 1 + px * 4
    for (let k = 0; k < 3; k++) raw[o + k] = Math.max(0, Math.min(255, raw[o + k] + delta))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** 纯灰 64×64 PNG（stddev=0，用于 uniform 守卫用例）；tweak=[x, v] 改单像素。 */
function solidGrayPngLocal(fill, tweak) {
  const size = 64, stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * (stride + 1) + 1 + x * 4
      raw[o] = fill; raw[o + 1] = fill; raw[o + 2] = fill; raw[o + 3] = 255
    }
  }
  if (tweak) {
    const o = 1 + tweak[0] * 4
    raw[o] = tweak[1]; raw[o + 1] = tweak[1]; raw[o + 2] = tweak[1]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export async function run() {
  // ── 阈值常量（防恒绿锚点：改阈值跑本断言会立刻显形）──
  if (m.PHASH_MAX_HAMMING !== 2) fail(`PHASH_MAX_HAMMING 应为 2，实际 ${m.PHASH_MAX_HAMMING}`)
  if (m.PHASH_MAX_MAD !== 1.5) fail(`PHASH_MAX_MAD 应为 1.5，实际 ${m.PHASH_MAX_MAD}`)
  if (m.PHASH_MAX_CELL_DIFF !== 24) fail(`PHASH_MAX_CELL_DIFF 应为 24，实际 ${m.PHASH_MAX_CELL_DIFF}`)
  if (m.PHASH_UNIFORM_STDDEV !== 3) fail(`PHASH_UNIFORM_STDDEV 应为 3，实际 ${m.PHASH_UNIFORM_STDDEV}`)

  // ── ① 逐格否决不变量（审查 P1-1 加固后的正确语义）──
  //   27vs37 均值 MAD 仅 0.954（看似"真重复"），但**含局部大差异**（实测 maxCell≈79 > PHASH_MAX_CELL_DIFF=24）
  //   → 加固后保守**不判重**。这是安全侧行为：均值相近但某块明显不同，一律按"可能内容变化"处理。
  //   （补充事实：这两帧在原序列里相隔 10 帧，顺次去重从不配对，故此判定不影响实际收益。）
  {
    const a = fpOf('27.png')
    const b = fpOf('37.png')
    const cell = m.maxCellDiff(a.gray, b.gray)
    if (cell <= m.PHASH_MAX_CELL_DIFF) fail(`① 本用例前提失效：27vs37 的 maxCell 实测 ${cell.toFixed(1)} 应 > 阈值 ${m.PHASH_MAX_CELL_DIFF}（若 ≤ 说明帧内容已变）`)
    if (m.isNearDuplicate(a, b) !== false) {
      fail(`① maxCell=${cell.toFixed(1)} > ${m.PHASH_MAX_CELL_DIFF} 时必须判"不重复"（逐格否决），实际 true`)
    }
  }

  // ── ①b 真近重复仍必须被抓到（用带纹理帧构造：全帧相同 + 单像素 Δ=5）──
  {
    const base = texturedPng(31)
    const near = texturedPng(31, [[0, 0, 5]])
    const fa = m.fingerprintFrame(base)
    const fb = m.fingerprintFrame(near)
    if (fa.dhash === null || fb.dhash === null) fail('①b 构造帧应可解码')
    if (fa.sha1 === fb.sha1) fail('①b 构造帧的 sha1 应不同（否则走快路径，测不到感知判定）')
    if (m.isNearDuplicate(fa, fb) !== true) {
      const cell = m.maxCellDiff(fa.gray, fb.gray)
      const mad = m.meanAbsDiff(fa.gray, fb.gray)
      fail(`①b 单像素 Δ=5 的近重复帧应判重，实际 false（maxCell=${cell}、MAD=${mad.toFixed(4)}）`)
    }
  }

  // ── ①c 近纯色帧（stddev < PHASH_UNIFORM_STDDEV）→ 只认 sha1，不按感知判重 ──
  {
    const g1 = solidGrayPngLocal(128)
    const g2 = solidGrayPngLocal(128, [0, 129])
    const fa = m.fingerprintFrame(g1)
    const fb = m.fingerprintFrame(g2)
    if (m.isNearDuplicate(fa, fb) !== false) {
      fail(`①c 近纯色帧（stddev=${m.grayStdDev(fa.gray).toFixed(2)}）应被 uniform 守卫拒判，实际 true`)
    }
  }

  // ── ② 版式相似但内容不同的幻灯片对 → 不得误删（R-26 最严重风险）──
  for (const [x, y] of [['38.png', '42.png'], ['41.png', '43.png'], ['28.png', '44.png']]) {
    const a = fpOf(x)
    const b = fpOf(y)
    if (m.isNearDuplicate(a, b) !== false) {
      const h = m.hammingBig(a.dhash, b.dhash)
      const mad = m.meanAbsDiff(a.gray, b.gray)
      fail(`② 相似对 ${x}vs${y} 不得判重（原型实测 MAD≥2.791），实际 true（hamming=${h}、MAD=${mad.toFixed(3)}）`)
    }
  }

  // ── ③ 不同内容帧 → false ──
  {
    const a = fpOf('01.png')
    const b = fpOf('02.png')
    if (m.isNearDuplicate(a, b) !== false) fail('③ 01vs02（不同内容帧）不得判重')
  }

  // ── ④ 解码失败桩：回退 sha1 语义 ──
  {
    const sameA = { sha1: 'a'.repeat(40), dhash: null, gray: null }
    const sameB = { sha1: 'a'.repeat(40), dhash: null, gray: null }
    const diff = { sha1: 'b'.repeat(40), dhash: null, gray: null }
    if (m.isNearDuplicate(null, sameA) !== false) fail('④ prev=null（首帧）应 false')
    if (m.isNearDuplicate(sameA, sameB) !== true) fail('④ 相同 sha1 → true（快路径，与解码成败无关）')
    if (m.isNearDuplicate(sameA, diff) !== false) fail('④ 不同 sha1 且 dhash=null → false（宁可漏删不可误删）')
    // 半桩：prev 有感知指纹、cur 解码失败 → 只能 sha1 比较 → 不同 sha1 不判重
    const real = fpOf('01.png')
    if (m.isNearDuplicate(real, diff) !== false) fail('④ prev 可解码 + cur 解码失败且 sha1 不同 → false')
    // fingerprintFrame 对坏字节：不抛、sha1 仍在、感知位为 null
    const broken = m.fingerprintFrame(Buffer.from('definitely not a png'))
    if (broken.dhash !== null || broken.gray !== null) fail('④ 非法字节流 fingerprintFrame 应置 dhash/gray=null')
    if (typeof broken.sha1 !== 'string' || broken.sha1.length !== 40) fail('④ 非法字节流 fingerprintFrame 仍应产出 sha1')
  }

  // ── ⑤ hammingBig 边界 ──
  {
    if (m.hammingBig(0xdeadbeefn, 0xdeadbeefn) !== 0) fail('⑤ 同值汉明距离应为 0')
    const allOnes = (1n << 64n) - 1n
    const got = m.hammingBig(0n, allOnes)
    if (got !== 64) fail(`⑤ 全反应为 64，实际 ${got}`)
    if (m.hammingBig(0b1010n, 0b0110n) !== 2) fail(`⑤ 局部差异（1010^0110）应为 2，实际 ${m.hammingBig(0b1010n, 0b0110n)}`)
  }

  // ── ⑥ meanAbsDiff 边界 ──
  {
    const g = new Float64Array(1024)
    for (let i = 0; i < g.length; i++) g[i] = i % 256
    if (m.meanAbsDiff(g, g) !== 0) fail('⑥ 相同数组 MAD 应为 0')
    const h = new Float64Array(1024).fill(1)
    const mad = m.meanAbsDiff(g, h) // |i%256 − 1| 均值
    let sum = 0
    for (let i = 0; i < 1024; i++) sum += Math.abs((i % 256) - 1)
    if (Math.abs(mad - sum / 1024) > 1e-12) fail(`⑥ MAD 数值应与逐项手算一致，实际 ${mad}`)
  }

  console.log('phash-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
