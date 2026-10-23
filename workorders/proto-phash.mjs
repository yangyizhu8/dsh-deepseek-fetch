// 可行性原型：纯 Node（zlib）解码 PNG → dHash 感知哈希 → 近重复判定
import fs from 'node:fs'
import zlib from 'node:zlib'

/** 解码 8-bit 非隔行 PNG（RGBA/RGB/灰度）→ {width,height,channels,pixels} */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('非 PNG')
  let off = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`不支持位深 ${bitDepth}`)
  if (interlace !== 0) throw new Error('不支持隔行')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (channels === 0) throw new Error(`不支持颜色类型 ${colorType}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride); pos += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      } else if (filter !== 0) throw new Error(`未知行滤波 ${filter}`)
      cur[x] = v & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

/** dHash：9×8 灰度差分 → 64bit */
export function dHash(img) {
  const { width, height, channels, pixels } = img
  const gray = new Float64Array(9 * 8)
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 9; gx++) {
      const x = Math.min(width - 1, Math.floor((gx * width) / 9))
      const y = Math.min(height - 1, Math.floor((gy * height) / 8))
      const i = (y * width + x) * channels
      let r = pixels[i], g = pixels[i], b = pixels[i]
      if (channels >= 3) { r = pixels[i]; g = pixels[i + 1]; b = pixels[i + 2] }
      gray[gy * 9 + gx] = 0.299 * r + 0.587 * g + 0.114 * b
    }
  }
  let bits = ''
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) bits += gray[gy * 9 + gx] > gray[gy * 9 + gx + 1] ? '1' : '0'
  return BigInt('0b' + bits)
}

export function hamming(a, b) {
  let x = a ^ b
  let c = 0
  while (x) { c += Number(x & 1n); x >>= 1n }
  return c
}

// 32×32 灰度降采样 → 用于像素级 MAD 复核（区分"同内容"与"版式相似"）
export function madHash32(img) {
  const { width, height, channels, pixels } = img
  const g = new Float64Array(32 * 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / 32))
      const sy = Math.min(height - 1, Math.floor((y * height) / 32))
      const i = (sy * width + sx) * channels
      let v = pixels[i]
      if (channels >= 3) v = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
      g[y * 32 + x] = v
    }
  }
  return g
}
export function mad(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

// ── 实测：kdocs 素材包的两组帧 ──
const dir = 'C:/deepseek网页抓取/交易回战-·-AI自进化&可解释量化交易-3.shots'
const names = fs.readdirSync(dir).filter((n) => n.endsWith('.png')).sort()
const hashes = new Map()
const t0 = Date.now()
for (const n of names) {
  const buf = fs.readFileSync(`${dir}/${n}`)
  const img = decodePng(buf)
  hashes.set(n, { h: dHash(img), m: madHash32(img), w: img.width, h2: img.height, c: img.channels, bytes: buf.length })
}
console.log(`解码+哈希 ${names.length} 张耗时 ${Date.now() - t0}ms`)
const s = hashes.get(names[0])
console.log(`样例 ${names[0]}: ${s.w}x${s.h2} channels=${s.c} hash=${s.h.toString(16).padStart(16, '0')}`)

// 旧包里已知"只差 2 像素"的空白帧：在新包里找近似群
const groups = []
for (const [n, v] of hashes) {
  let g = groups.find((x) => hamming(x.h, v.h) <= 2)
  if (!g) { g = { h: v.h, items: [] }; groups.push(g) }
  g.items.push(n)
}
console.log(`\n[dHash 预筛] Hamming ≤ 2：共 ${groups.length} 组（近似组 ${groups.filter((x) => x.items.length > 1).length} 个）`)
for (const g of groups.filter((x) => x.items.length > 1)) console.log('  候选组: ' + g.items.join(', '))

// 加 MAD 复核后的真判定
console.log('\n[MAD 复核] 逐对看像素级平均绝对差（0-255）：')
const pairs = []
for (const g of groups) {
  for (let i = 0; i < g.items.length; i++) for (let j = i + 1; j < g.items.length; j++) {
    const a = hashes.get(g.items[i]), b = hashes.get(g.items[j])
    pairs.push({ a: g.items[i], b: g.items[j], dhash: hamming(a.h, b.h), mad: mad(a.m, b.m) })
  }
}
pairs.sort((x, y) => x.mad - y.mad)
for (const p of pairs) console.log(`  ${p.a} vs ${p.b}  dHash=${p.dhash}  MAD=${p.mad.toFixed(3)}`)
console.log(`\n真重复判定阈值候选：MAD ≤ ${(pairs.filter((p) => p.mad < 1).length)} 对 < 1；MAD 分布最小值=${pairs[0]?.mad.toFixed(4)} 最大值=${pairs[pairs.length - 1]?.mad.toFixed(3)}`)
