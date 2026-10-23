#!/usr/bin/env node
// assert-render.mjs — T-17 断言：渲染器基建（Design §15.4 / DEV-PLAN T-17 验收 ①~④）。
//  ① Edge 探测：默认探测命中则必真实存在；Config.edgePath 覆盖（临时文件）生效；
//     edgePath 指向不存在路径 → 回退默认探测（绝不返回不存在的路径）
//  ② measureCanvasRatio 纯函数：假 canvas 集驱动（占比/取最大/满视口/空集/零视口）
//  ③ pickFreePort 两次取值互异且落在 1024–65535
//  ④ buildEdgeArgs：--headless=new 首参、随机调试端口参数、user-data-dir 反斜杠输入 → 正斜杠输出、
//     --remote-allow-origins=*、--window-size=W,H、URL 恒为最后一个参数
// 不出网、不真启动 Edge（launchEdge/cdpConnect 的真进程链路由主侧人工验收，见工单「未验证」节）。
// 单独运行：node scripts/assert-render.mjs（失败 exit 51）；由 verify.mjs 汇总调用。
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 51
  throw e
}

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

export async function run() {
  // ── ① Edge 探测 ──
  // 审查 P2-4：原断言是"命中则…"的条件式（无 Edge 机器上空过）。
  // 改为**无条件**断言候选清单本身（顺序与内容），再断言命中（若命中）必属清单。
  const candidates = m.edgeCandidatePaths({ edgePath: '' })
  if (candidates.length < 2) fail(`① 默认候选清单至少应含两个 Program Files 路径，实际 ${JSON.stringify(candidates)}`)
  if (!/Edge\/Application\/msedge\.exe$/i.test(candidates[0]) || !/Edge\/Application\/msedge\.exe$/i.test(candidates[1])) {
    fail(`① 候选清单前两项应为 Program Files 下的 msedge.exe，实际 ${JSON.stringify(candidates)}`)
  }
  const def = m.findEdgeExecutable({ edgePath: '' })
  if (def !== null && !existsSync(def)) fail(`① 默认探测命中但文件不存在：${def}`)
  if (def !== null && !candidates.includes(def)) fail(`① 默认探测命中必须来自候选清单：${def}`)

  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-dsf-assert-render-'))
  try {
    const fakeEdge = join(tmpDir, 'msedge.exe')
    writeFileSync(fakeEdge, 'x')
    const hit = m.findEdgeExecutable({ edgePath: fakeEdge })
    if (hit !== fakeEdge) fail(`① edgePath 覆盖应原样命中：${hit} ≠ ${fakeEdge}`)

    const bogus = 'Z:/definitely-not-here/msedge.exe'
    const fb = m.findEdgeExecutable({ edgePath: bogus })
    if (fb === bogus) fail('① edgePath 不存在时不得返回该路径（应回退默认探测）')
    if (fb !== null && !existsSync(fb)) fail(`① 回退结果必须真实存在或 null：${fb}`)
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 残留不影响断言 */ }
  }

  // 空白 edgePath 等价未配置：候选不含空串
  if (m.edgeCandidatePaths({ edgePath: '   ' }).some((c) => c.trim() === '')) {
    fail('① 空白 edgePath 不应产生空候选')
  }

  // ── ② measureCanvasRatio 纯函数（择源判据①的核）──
  if (m.measureCanvasRatio([{ width: 720, height: 450 }], { width: 1440, height: 900 }) !== 0.25) {
    fail('② 720x450 canvas @1440x900 视口应占比 0.25')
  }
  if (!approx(m.measureCanvasRatio([{ width: 10, height: 10 }, { width: 200, height: 300 }], { width: 1000, height: 1000 }), 0.06)) {
    fail('② 多 canvas 应取面积最大者（60000/1000000 = 0.06）')
  }
  if (m.measureCanvasRatio([{ width: 1440, height: 900 }], { width: 1440, height: 900 }) !== 1) {
    fail('② 满视口 canvas 应占比 1')
  }
  if (m.measureCanvasRatio([], { width: 1440, height: 900 }) !== 0) fail('② 空 canvas 集应占比 0')
  if (m.measureCanvasRatio([{ width: 1440, height: 900 }], { width: 0, height: 0 }) !== 0) {
    fail('② 零视口应返回 0（除零防护）')
  }
  if (m.CANVAS_RATIO_THRESHOLD !== 0.3) fail(`② 择源阈值应为 0.3，实际 ${m.CANVAS_RATIO_THRESHOLD}`)

  // ── ③ 随机空闲端口 ──
  const p1 = await m.pickFreePort()
  const p2 = await m.pickFreePort()
  if (p1 === p2) fail(`③ 两次随机端口不应相同：${p1}`)
  if (p1 < 1024 || p1 > 65535 || p2 < 1024 || p2 > 65535) fail(`③ 端口越界：${p1} / ${p2}`)

  // ── ④ 启动参数（实测坑固化：--headless=new + 正斜杠 user-data-dir + URL 收尾）──
  const args = m.buildEdgeArgs({
    userDataDir: 'C:\\tmp\\profile-x',
    port: 51777,
    width: 1440,
    height: 900,
    url: 'https://example.com/doc',
  })
  if (args[0] !== '--headless=new') fail(`④ 首参数必须是 --headless=new（旧版 --headless 不暴露 CDP 端口），实际 ${args[0]}`)
  if (!args.includes('--remote-debugging-port=51777')) fail(`④ 缺 --remote-debugging-port=51777：${args.join(' ')}`)
  if (!args.includes('--user-data-dir=C:/tmp/profile-x')) {
    fail(`④ user-data-dir 反斜杠输入必须输出正斜杠：${args.join(' ')}`)
  }
  if (!args.includes('--remote-allow-origins=*')) fail('④ 缺 --remote-allow-origins=*（Node WebSocket 无 Origin 豁禁会被 CDP 拒连）')
  if (!args.includes('--window-size=1440,900')) fail('④ 缺 --window-size=1440,900')
  if (args[args.length - 1] !== 'https://example.com/doc') fail(`④ URL 必须是最后一个参数：${args.join(' ')}`)

  // ── ⑤ 正文级滚动容器判定（防"采集过早只拿到轮廓面板"回归）──
  // 实测 kdocs：正文容器 scrollHeight/clientHeight ≈ 56，轮廓面板 ≈ 2 → 阈值取 3
  const docContainer = { width: 1360, height: 687, scrollHeight: 38591, clientHeight: 687 }
  const outlinePanel = { width: 261, height: 625, scrollHeight: 1260, clientHeight: 625 }
  if (!m.hasSubstantialScroll([docContainer])) fail('⑤ 文档级容器（sh/ch≈56）应判定为 substantial')
  if (m.hasSubstantialScroll([outlinePanel])) fail('⑤ 轮廓面板（sh/ch=2）不应判定为 substantial')
  if (m.hasSubstantialScroll([])) fail('⑤ 空候选不应判定为 substantial')

  // ── ⑥ 两阶段视口：取文字视口必须高于截图视口 ──
  // 审查 P2-3：原断言解析脚本内**硬写字面量**，与 Config 默认值无绑定（把默认改回 900 仍 PASS）。
  // 此处从**被测对象**（Config 默认值）取真值，断言"高视口 > 截图视口"这一不变量。
  const defaults = m.Config({})
  const shotVp = m.parseViewport(defaults.renderViewport)
  const textVp = m.parseViewport(defaults.renderTextViewport)
  if (shotVp === null || textVp === null) fail('⑥ Config 默认视口应可解析为 WxH')
  if (!(textVp.height > shotVp.height)) {
    fail(`⑥ Config 默认的取文字视口（${defaults.renderTextViewport}）必须高于截图视口（${defaults.renderViewport}）——否则 WebOffice 正文不进 DOM，静默丢正文`)
  }

  console.log('render-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
