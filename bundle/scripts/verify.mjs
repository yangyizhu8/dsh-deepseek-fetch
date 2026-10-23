#!/usr/bin/env node
// verify.mjs — T-09/T-15/T-20/T-26/T-32 汇总断言门禁（唯一门禁入口；P5 后共 23 项 = P3 22 项 + strip）。
// 覆盖：① 模块可加载（name/inject/Config/apply 在位）；② 工具契约（工具名 + 参数键集合
// 恰为 {url, output_dir, clean, children, max_depth, max_pages, render, text_source, max_shots,
// render_settle_ms}，无 filename 等越界参数——A5/A6）；⑤ 11 错误码常量完整性（ERROR_CODES = P0 8 码 + P2 渲染 3 码）；
// 以及 T-03~T-08、T-11~T-14 与 T-17~T-19 各分项
// （复用 assert-*.mjs 的 run()，单一事实源；assert-bfs 自带本地 http 桩，测完即关；
//   assert-render/assert-shots/assert-arbiter/assert-pipeline 不出网、不启动真 Edge——假会话/纯函数/依赖注入驱动；
//   assert-png/assert-phash 为 P3 纯函数层断言：解码器手造样张 + 感知哈希阈值判定，png 项另读
//   C:\deepseek网页抓取\ 下真实截图的**前 5 张**（只读，验证 1440×900/colorType=6 真机样张可解码）；
//   assert-strip 为 P5 断言：覆盖型浮层剥离器四重约束 + 阈值常量插值自检 + captureShots 接入 +
//   管线级 overlays_stripped 贯通（假会话/依赖注入驱动，不出网、不启动真 Edge））。
// 用法：cd bundle && node scripts/verify.mjs（需先 DSH_CHECKOUT=... bash scripts/build.sh 产出 lib/）。
// 通过：逐项 <item>-ok + "verify: PASS"，exit 0；任一失败：原样打印错误、exit 1（防恒绿）。
// 输出不含任何 API Key 值。
import { pathToFileURL } from 'node:url'
import { run as assertValidateUrl } from './assert-validate-url.mjs'
import { run as assertResolveApiKey } from './assert-resolve-apikey.mjs'
import { run as assertClassifyError } from './assert-classify-error.mjs'
import { run as assertClean } from './assert-clean.mjs'
import { run as assertSlugify } from './assert-slugify.mjs'
import { run as assertConfig } from './assert-config.mjs'
import { run as assertPreset } from './assert-preset.mjs'
import { run as assertDiscover } from './assert-discover.mjs'
import { run as assertRobots } from './assert-robots.mjs'
import { run as assertEdge } from './assert-edge.mjs'
import { run as assertBfs } from './assert-bfs.mjs'
import { run as assertMerge } from './assert-merge.mjs'
import { run as assertRender } from './assert-render.mjs'
import { run as assertShots } from './assert-shots.mjs'
import { run as assertPng } from './assert-png.mjs'
import { run as assertPhash } from './assert-phash.mjs'
import { run as assertArbiter } from './assert-arbiter.mjs'
import { run as assertPipeline } from './assert-pipeline.mjs'
import { run as assertStrip } from './assert-strip.mjs'
import fs from 'node:fs'

const m = await import('../lib/index.js')

// ── verify 内置四项 ──────────────────────────────────────────────────────────

/** 产物新鲜度：lib 必须不早于 src（否则测的是过期产物，审查 P2-12）。 */
function checkFreshness() {
  const srcPath = new URL('../src/index.ts', import.meta.url)
  const libPath = new URL('../lib/index.js', import.meta.url)
  const srcTime = fs.statSync(srcPath).mtimeMs
  const libTime = fs.statSync(libPath).mtimeMs
  if (libTime < srcTime) {
    throw new Error('lib/index.js 早于 src/index.ts —— 产物过期，请先 bash scripts/build.sh')
  }
  console.log('freshness-ok')
}

function checkModule() {
  if (m.name !== '@dsh-external/dsh-deepseek-fetch') throw new Error(`name = ${JSON.stringify(m.name)}`)
  if (!Array.isArray(m.inject) || !m.inject.includes('tools')) {
    throw new Error(`inject = ${JSON.stringify(m.inject)}（应为含 'tools' 的数组）`)
  }
  if (typeof m.Config !== 'function') throw new Error('Config 不在位（typeof !== function）')
  if (typeof m.apply !== 'function') throw new Error('apply 不在位（typeof !== function）')
  console.log('module-ok')
}

function checkToolContract() {
  if (m.TOOL_NAME !== 'deepseek_fetch') throw new Error(`TOOL_NAME = ${JSON.stringify(m.TOOL_NAME)}`)
  const keys = Object.keys(m.TOOL_PARAMETERS).sort().join(',')
  if (keys !== 'children,clean,max_depth,max_pages,max_shots,output_dir,render,render_settle_ms,text_source,url') {
    throw new Error(`工具参数键集合 = ${keys}（应恰为 10 键：url, output_dir, clean, children, max_depth, max_pages, render, text_source, max_shots, render_settle_ms）`)
  }
  if ('filename' in m.TOOL_PARAMETERS) throw new Error('禁止的参数出现在工具 schema：filename')
  console.log('tool-contract-ok')
}

function checkErrorCodes() {
  const expected = ['E_AUTH', 'E_EMPTY_CONTENT', 'E_FETCH_FAILED', 'E_INVALID_URL', 'E_IO', 'E_NO_EDGE', 'E_NO_KEY', 'E_RATE_LIMIT', 'E_RENDER_FAILED', 'E_RENDER_TIMEOUT', 'E_UPSTREAM']
  const got = [...m.ERROR_CODES].sort()
  if (got.length !== 11) throw new Error(`ERROR_CODES 长度 ${got.length} ≠ 11（P0 8 码 + P2 渲染通道 3 码）`)
  if (got.join(',') !== expected.join(',')) throw new Error(`ERROR_CODES = ${got.join(',')}`)
  console.log('error-codes-ok')
}

// ── 汇总执行（任一项抛错即计失败，不中断后续项）──────────────────────────────

const checks = [
  ['module', checkModule],
  ['freshness', checkFreshness],
  ['tool-contract', checkToolContract],
  ['error-codes', checkErrorCodes],
  ['validateUrl', assertValidateUrl],
  ['resolveApiKey', assertResolveApiKey],
  ['classifyError', assertClassifyError],
  ['cleanMarkdown', assertClean],
  ['slugify', assertSlugify],
  ['config-fields', assertConfig],
  ['preset', assertPreset],
  ['discover', assertDiscover],
  ['robots', assertRobots],
  ['edge', assertEdge],
  ['bfs', assertBfs],
  ['merge', assertMerge],
  ['render', assertRender],
  ['shots', assertShots],
  ['png', assertPng],
  ['phash', assertPhash],
  ['arbiter', assertArbiter],
  ['pipeline', assertPipeline],
  ['strip', assertStrip],
]

const failedItems = []
for (const [item, fn] of checks) {
  try {
    await fn()
  } catch (e) {
    failedItems.push(item)
    console.error(`verify: FAIL [${item}] ${e?.message ?? e}`)
  }
}

if (failedItems.length === 0) {
  console.log(`verify: PASS（${checks.length} 项）`)
  process.exit(0)
}
console.error(`verify: FAIL（${failedItems.length} 项失败：${failedItems.join(', ')}）`)
process.exit(1)
