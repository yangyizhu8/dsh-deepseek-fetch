// P4 关键实验2：能否把"无信息空白帧"与"有内容帧"分开
// 手段：排除编辑�� chrome（顶部工具栏 / 左侧大纲 / 中心登录浮层）后，看内容区方差
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const m = await import(pathToFileURL('C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').href)
const DIR = 'C:/deepseek网页抓取/交易回战-·-AI自进化&可解释量化交易-3.shots'
const names = fs.readdirSync(DIR).filter((n) => n.endsWith('.png')).sort()

function grayOf(file) {
  const { width, height, channels, pixels } = m.decodePng(fs.readFileSync(`${DIR}/${file}`))
  const g = new Float64Array(width * height)
  for (let i = 0, p = 0; i < g.length; i++, p += channels) {
    g[i] = channels >= 3 ? 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2] : pixels[p]
  }
  return { width, height, g }
}

/** 内容区统计：排除顶部工具栏(y<90)、左侧大纲(x<340)、中心浮层矩形 */
function contentStats(img, popup) {
  const { width, height, g } = img
  const vals = []
  for (let y = 90; y < height - 10; y += 3) {
    for (let x = 340; x < width - 10; x += 3) {
      if (popup && x >= popup.x0 && x <= popup.x1 && y >= popup.y0 && y <= popup.y1) continue
      vals.push(g[y * width + x])
    }
  }
  let s = 0
  for (const v of vals) s += v
  const mean = s / vals.length
  let v2 = 0
  for (const v of vals) v2 += (v - mean) ** 2
  return { count: vals.length, mean, sd: Math.sqrt(v2 / vals.length) }
}

const POPUPS = {
  '无排除（仅 top+left）': null,
  '排除中心 760x790 @340,80': { x0: 340, y0: 80, x1: 1100, y1: 870 },
  '排除中心 560x520 @490,220': { x0: 490, y0: 220, x1: 1050, y1: 740 },
}

const cache = new Map()
const G = (n) => { if (!cache.has(n)) cache.set(n, grayOf(n)); return cache.get(n) }

// 已知"疑似空白"屏（阶段05 记录：27-32、36-40 为空白画布）与"有内容"屏
const BLANK_HINT = new Set(['27.png', '28.png', '29.png', '30.png', '31.png', '32.png', '36.png', '37.png', '38.png', '39.png', '40.png'])

for (const [label, popup] of Object.entries(POPUPS)) {
  const rows = names.map((n) => ({ n, ...contentStats(G(n), popup) }))
  rows.sort((a, b) => a.sd - b.sd)
  console.log(`\n########## ${label} ##########`)
  console.log('  标准差最小的 12 帧：')
  for (const r of rows.slice(0, 12)) {
    console.log(`    ${r.n}  sd=${r.sd.toFixed(2)} mean=${r.mean.toFixed(1)} ${BLANK_HINT.has(r.n) ? '(疑似空白)' : ''}`)
  }
  const blank = rows.filter((r) => BLANK_HINT.has(r.n)).map((r) => r.sd)
  const content = rows.filter((r) => !BLANK_HINT.has(r.n)).map((r) => r.sd)
  const maxBlank = Math.max(...blank), minContent = Math.min(...content)
  console.log(`  疑似空白组 sd 范围: ${Math.min(...blank).toFixed(2)} ~ ${maxBlank.toFixed(2)}`)
  console.log(`  其余组     sd 范围: ${minContent.toFixed(2)} ~ ${Math.max(...content).toFixed(2)}`)
  console.log(`  可分离? ${maxBlank < minContent ? '✓ 是（阈值可取 ' + ((maxBlank + minContent) / 2).toFixed(1) + '）' : '✗ 否（区间重叠）'}`)
}
