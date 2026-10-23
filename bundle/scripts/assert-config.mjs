#!/usr/bin/env node
// assert-config.mjs — T-07/T-11/T-16/T-30 断言：CONFIG_FIELDS 恰为 18 字段
// （P0 七字段 + Design §14.8 增四字段 + §15.7 渲染通道增五字段 + 主侧补 renderTextViewport
//   + §17.3 P5 增 renderStripOverlays）。
// 字段清单只依赖导出常量，不依赖 schemastery 对象内部结构（DEV-PLAN T-07 主侧复核补正）；
// 默认值断言走 schema 的**公开可调用面**（m.Config({}) 即宿主解析配置的同一入口，缺省字段由 default 填充）。
// 单独运行：node scripts/assert-config.mjs（失败 exit 31）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 31
  throw e
}

export async function run() {
  const expected = [
    'defaultOutputDir',
    'endpoint',
    'timeoutMs',
    'retries',
    'defaultClean',
    'apiKeyEnv',
    'apiKey',
    'childrenConcurrency',
    'childrenTimeoutMs',
    'respectRobots',
    'htmlUserAgent',
    'edgePath',
    'renderTimeoutMs',
    'renderViewport',
    'renderTextViewport',
    'renderSettleMs',
    'renderScrollOverlap',
    'renderStripOverlays',
  ]
  const fields = [...m.CONFIG_FIELDS]
  if (fields.length !== 18) fail(`CONFIG_FIELDS 长度 ${fields.length} ≠ 18`)
  for (let i = 0; i < expected.length; i++) {
    if (fields[i] !== expected[i]) fail(`CONFIG_FIELDS[${i}] = ${JSON.stringify(fields[i])} ≠ ${expected[i]}`)
  }
  // T-30：renderStripOverlays 默认 true（Design §17.3——false 才是"回退 v0.4.0 行为"的显式开关）。
  // m.Config({}) 是宿主 cordis 解析配置的同一调用面：18 字段全带 default → 空对象进、默认值出。
  const resolved = m.Config({})
  if (resolved?.renderStripOverlays !== true) {
    fail(`renderStripOverlays 默认值应为 true，实际 ${JSON.stringify(resolved?.renderStripOverlays)}`)
  }
  console.log('config-fields-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
