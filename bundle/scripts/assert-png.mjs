#!/usr/bin/env node
// assert-png.mjs — T-23 断言：PNG 解码器（Design §16.4 / DEV-PLAN T-23 验收；workorders/proto-phash.mjs 移植）。
//  ① 真实素材包前 5 张（只读，避免慢）全部解码成功：1440×900、channels=4、pixels 长度吻合
//  ② 手工构造 Sub/Up/Average/Paeth 四种行滤波的 2×2 RGBA PNG（zlib.deflateSync 造 IDAT）→ 解码像素逐字节正确
//  ③ 隔行 / 16-bit / 未知 colorType 桩 → 抛 PngUnsupportedError（绝不静默返回错数据）
//  ④ 签名不符 / 缓冲过短 → 抛 PngUnsupportedError
// 真实 PNG 引用均为只读。单独运行：node scripts/assert-png.mjs（失败 exit 54）；由 verify.mjs 汇总调用。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 54
  throw e
}

/** 断言 fn 抛的是 PngUnsupportedError（而非别的异常或正常返回）。 */
function assertThrowsPng(fn, message) {
  try {
    fn()
  } catch (e) {
    if (e instanceof m.PngUnsupportedError && e.name === 'PngUnsupportedError') return
    return fail(`${message}——但抛出的是 ${e?.constructor?.name ?? typeof e}：${e?.message}`)
  }
  fail(`${message}——实际未抛出`)
}

// ── 最小 PNG 构造器（仅测试用：filter 字节 + 像素行由调用方给，IDAT 用 deflateSync 造，CRC 查表算）──

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function buildPng({ width, height, raw, bitDepth = 8, colorType = 6, interlace = 0 }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter method
  ihdr[12] = interlace
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export async function run() {
  // ── ① 真实素材包（只读，前 5 张）──
  const dir = 'C:/deepseek网页抓取/交易回战-·-AI自进化&可解释量化交易-3.shots'
  const names = readdirSync(dir).filter((n) => n.endsWith('.png')).sort().slice(0, 5)
  if (names.length < 5) fail(`① 素材包应有至少 5 张 PNG（${dir}），实际 ${names.length}`)
  for (const n of names) {
    let img
    try {
      img = m.decodePng(readFileSync(join(dir, n)))
    } catch (e) {
      return fail(`① 真实截图 ${n} 解码失败（原型已验证 45 张全可解）：${e?.message}`)
    }
    if (img.width !== 1440 || img.height !== 900) fail(`① ${n} 尺寸应为 1440×900，实际 ${img.width}×${img.height}`)
    if (img.channels !== 4) fail(`① ${n} channels 应为 4（RGBA），实际 ${img.channels}`)
    if (img.pixels.length !== 1440 * 900 * 4) fail(`① ${n} pixels 长度应为 ${1440 * 900 * 4}，实际 ${img.pixels.length}`)
  }

  // ── ② 四种行滤波的 2×2 RGBA（colorType 6）手工桩 ──
  // 目标像素（反滤波后应逐字节相等）：
  //   row0: (1,2,3,4) (5,6,7,8) / row1: (9,10,11,12) (13,14,15,16)
  const expected = Buffer.from([
    1, 2, 3, 4, 5, 6, 7, 8,
    9, 10, 11, 12, 13, 14, 15, 16,
  ])
  const cases = [
    {
      name: 'Sub（filter=1，两行）',
      // raw = 目标 − 左邻：row0 首像素无左邻原样；第二像素减去 (1,2,3,4)
      raw: Buffer.from([1, 1, 2, 3, 4, 4, 4, 4, 4, 1, 9, 10, 11, 12, 4, 4, 4, 4]),
    },
    {
      name: 'Up（filter=2，第二行）',
      // row0 用 None 原样；row1 = 目标 − 上一行解码值 (1..8)
      raw: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 2, 8, 8, 8, 8, 8, 8, 8, 8]),
    },
    {
      name: 'Average（filter=3，两行）',
      // row0: 首像素 avg(0,0)=0 原样；第二像素减 floor((1..4+0)/2)=(0,1,1,2)
      // row1: 首像素减 floor((0+1..4)/2)=(0,1,1,2)；第二像素减 floor(((9..12)+(5..8))/2)=(7,8,9,10)
      raw: Buffer.from([3, 1, 2, 3, 4, 5, 5, 6, 6, 3, 9, 9, 10, 10, 6, 6, 6, 6]),
    },
    {
      name: 'Paeth（filter=4，两行）',
      // row0: 首像素 predictor=0 原样；第二像素 predictor=a=(1,2,3,4)
      // row1: 首像素 predictor=b=(1,2,3,4)；第二像素 p=a+b-c → pa 最小 → predictor=a=(9,10,11,12)
      raw: Buffer.from([4, 1, 2, 3, 4, 4, 4, 4, 4, 4, 8, 8, 8, 8, 4, 4, 4, 4]),
    },
  ]
  for (const c of cases) {
    const img = m.decodePng(buildPng({ width: 2, height: 2, raw: c.raw }))
    if (img.width !== 2 || img.height !== 2 || img.channels !== 4) {
      fail(`② ${c.name} 头部解析错：${img.width}×${img.height} channels=${img.channels}`)
    }
    if (!img.pixels.equals(expected)) {
      fail(`② ${c.name} 反滤波像素不符：${img.pixels.toString('hex')}（期望 ${expected.toString('hex')}）`)
    }
  }
  // None（filter=0）由 ① 的真实图与 Up 桩的 row0 顺带覆盖

  // ── ③ 不支持项桩 → 必须 PngUnsupportedError（不得静默返回错数据）──
  assertThrowsPng(() => m.decodePng(buildPng({ width: 1, height: 1, raw: Buffer.alloc(5), interlace: 1 })), '③ 隔行 PNG 应抛 PngUnsupportedError')
  assertThrowsPng(() => m.decodePng(buildPng({ width: 1, height: 1, raw: Buffer.alloc(5), bitDepth: 16 })), '③ 16-bit PNG 应抛 PngUnsupportedError')
  assertThrowsPng(() => m.decodePng(buildPng({ width: 1, height: 1, raw: Buffer.alloc(5), colorType: 5 })), '③ 未知 colorType 应抛 PngUnsupportedError')

  // ── ④ 签名不符 ──
  {
    const good = buildPng({ width: 1, height: 1, raw: Buffer.from([0, 10, 20, 30, 255]) })
    const badSig = Buffer.from(good)
    badSig[0] = 0x88
    assertThrowsPng(() => m.decodePng(badSig), '④ 签名首字节损坏应抛 PngUnsupportedError')
    assertThrowsPng(() => m.decodePng(Buffer.alloc(4)), '④ 过短缓冲（<8B）应抛 PngUnsupportedError')
  }

  console.log('png-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
