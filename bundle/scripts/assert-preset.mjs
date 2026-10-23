#!/usr/bin/env node
// assert-preset.mjs — T-08 断言：preset/ 两文件可被 js-yaml 解析（与 check-plugin-ready.mjs 同源依赖），
// agent.cordis.yml 解析为数组且首行 name 为 '@dsh-external/dsh-deepseek-fetch'（A6），
// preset.yml 的 name/description 非空。
// 单独运行：node scripts/assert-preset.mjs（失败 exit 41/42）；由 verify.mjs 汇总调用。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// js-yaml 候选（Windows 风格路径；首选 check-plugin-ready.mjs 同源的 .pnpm 路径，DEV-PLAN T-08）
const JSYAML_CANDIDATES = [
  'D:/deepseek-harness/node_modules/.pnpm/js-yaml@4.2.0/node_modules/js-yaml/index.js',
  'D:/deepseek-harness/node_modules/js-yaml/index.js',
]

function fail(exitCode, message) {
  const e = new Error(message)
  e.exitCode = exitCode
  throw e
}

function loadJsYaml() {
  const requireFromHere = createRequire(import.meta.url)
  for (const candidate of JSYAML_CANDIDATES) {
    try {
      return requireFromHere(candidate)
    } catch { /* 试下一候选 */ }
  }
  fail(41, `js-yaml 不可用（已尝试：${JSYAML_CANDIDATES.join(' ; ')}）`)
}

export function run() {
  const jsyaml = loadJsYaml()
  const presetDir = fileURLToPath(new URL('../../preset/', import.meta.url))

  const agent = jsyaml.load(readFileSync(presetDir + 'agent.cordis.yml', 'utf8'))
  if (!Array.isArray(agent)) fail(41, `agent.cordis.yml 解析结果不是数组：${JSON.stringify(agent)}`)
  if (agent[0]?.name !== '@dsh-external/dsh-deepseek-fetch') {
    fail(41, `agent.cordis.yml 首行 name 不符：${JSON.stringify(agent[0]?.name)}`)
  }

  const meta = jsyaml.load(readFileSync(presetDir + 'preset.yml', 'utf8'))
  if (typeof meta?.name !== 'string' || meta.name === '') fail(42, 'preset.yml 的 name 为空或缺失')
  if (typeof meta?.description !== 'string' || meta.description === '') fail(42, 'preset.yml 的 description 为空或缺失')
  console.log('preset-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run()
  } catch (e) {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  }
}
