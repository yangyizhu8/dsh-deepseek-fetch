#!/usr/bin/env node
// assert-arbiter.mjs — T-19 断言：择源器 + 渲染文字清洗 + manifest 契约
// （Design §15.3 / §15.6 / DEV-PLAN T-19 验收 ①~⑤）。
//  ① auto + canvasRatio ≥ 0.3 → render（判据①）
//  ② auto + 低占比 + 干净长文 → api；②b API 文字命中编辑器 UI 噪声 → render（判据②）；
//     ②c API 文字 < 200 字 → render（判据③）
//  ③ auto + 无 Edge → api(fallback) + 非空 warning（降级而非失败）
//  ④ render + 无 Edge → {error:'E_NO_EDGE'}（唯一显式失败）；render + 有 Edge → render；api 显式 → api
//  ⑤ buildManifest：merge_hint 严格等于固定文案（形态 A：图文合并由 agent 视觉能力完成）、
//     shots/shots_total 一致、固定字段齐备、partial/end_reason/warning 仅在有值时出现
//  补充：cleanRenderedText（UI 行黑名单/重复页眉/相邻重复折叠）与 parseViewport/hitsEditorNoise
// 单独运行：node scripts/assert-arbiter.mjs（失败 exit 53）；由 verify.mjs 汇总调用。
import { pathToFileURL } from 'node:url'

const m = await import('../lib/index.js')

function fail(message) {
  const e = new Error(message)
  e.exitCode = 53
  throw e
}

/** 干净长文：480 字、不含任何噪声标记（判据②③的阴性输入）。 */
const CLEAN_LONG = '这是一段干净的正文内容。'.repeat(60)

export async function run() {
  // ── ① 判据①：canvas 占比 ≥ 阈值 → render ──
  {
    const d = m.decideTextSource({ text_source: 'auto', apiText: CLEAN_LONG, canvasRatio: 0.5, edgeAvailable: true })
    if (d.source !== 'render') fail(`① canvasRatio=0.5 应选 render，实际 ${JSON.stringify(d)}`)
  }
  {
    const d = m.decideTextSource({ text_source: 'auto', apiText: CLEAN_LONG, canvasRatio: 0.3, edgeAvailable: true })
    if (d.source !== 'render') fail(`① canvasRatio=0.3（恰等于阈值）应选 render，实际 ${JSON.stringify(d)}`)
  }
  // canvasRatio 未知（null，探测失败）→ 不命中判据①
  {
    const d = m.decideTextSource({ text_source: 'auto', apiText: CLEAN_LONG, canvasRatio: null, edgeAvailable: true })
    if (d.source !== 'api') fail(`① canvasRatio=null（未知）不应触发 render，实际 ${JSON.stringify(d)}`)
  }

  // ── ② 三判据的阴性/阳性 ──
  {
    const d = m.decideTextSource({ text_source: 'auto', apiText: CLEAN_LONG, canvasRatio: 0.1, edgeAvailable: true })
    if (d.source !== 'api') fail(`② 低占比+干净长文应选 api，实际 ${JSON.stringify(d)}`)
    if (d.warning !== undefined) fail('② api 命中不应带 warning')
  }
  {
    const d = m.decideTextSource({ text_source: 'auto', apiText: `${CLEAN_LONG}点赞`, canvasRatio: 0.1, edgeAvailable: true })
    if (d.source !== 'render') fail(`②b API 文字混入「点赞」浮层文案应选 render，实际 ${JSON.stringify(d)}`)
  }
  {
    const d = m.decideTextSource({ text_source: 'auto', apiText: '太短', canvasRatio: 0.1, edgeAvailable: true })
    if (d.source !== 'render') fail(`②c 200 字以下短正文应选 render，实际 ${JSON.stringify(d)}`)
  }
  if (!m.hitsEditorNoise('顶部工具栏已关闭')) fail('②b hitsEditorNoise 应命中「顶部工具栏已关闭」')
  if (m.hitsEditorNoise(CLEAN_LONG)) fail('②b hitsEditorNoise 不应误报干净长文')
  if (m.EDITOR_NOISE_MARKERS.length !== 8) fail(`②b 噪声标记应为 8 项，实际 ${m.EDITOR_NOISE_MARKERS.length}`)

  // ── ③ auto + 无 Edge：降级而非失败 ──
  {
    const d = m.decideTextSource({ text_source: 'auto', apiText: CLEAN_LONG, canvasRatio: 0.5, edgeAvailable: false })
    if (d.source !== 'api(fallback)') fail(`③ 无 Edge 的 auto 应降级 api(fallback)，实际 ${JSON.stringify(d)}`)
    if (typeof d.warning !== 'string' || d.warning === '') fail('③ 降级必须携带非空 warning')
    if (d.error !== undefined) fail('③ 降级不是失败，不应带 error')
  }

  // ── ④ 显式模式 ──
  {
    const d = m.decideTextSource({ text_source: 'render', apiText: '', canvasRatio: null, edgeAvailable: false })
    if (d.error !== 'E_NO_EDGE') fail(`④ render+无 Edge 应报 E_NO_EDGE，实际 ${JSON.stringify(d)}`)
  }
  {
    const d = m.decideTextSource({ text_source: 'render', apiText: CLEAN_LONG, canvasRatio: 0, edgeAvailable: true })
    if (d.source !== 'render') fail(`④ render+有 Edge 应选 render（判据不参与显式模式），实际 ${JSON.stringify(d)}`)
  }
  {
    const d = m.decideTextSource({ text_source: 'api', apiText: '', canvasRatio: 0.9, edgeAvailable: false })
    if (d.source !== 'api') fail(`④ 显式 api 恒为 api，实际 ${JSON.stringify(d)}`)
  }

  // ── ⑤ buildManifest 契约 ──
  {
    const shots = [
      { file: '01.png', bytes: 111 },
      { file: '02.png', bytes: 222 },
    ]
    const mf = m.buildManifest({
      url: 'https://example.com/doc', title: '示例文档', text_source: 'render', text_chars: 480, shots,
    })
    if (mf.merge_hint !== m.MERGE_HINT) fail('⑤ merge_hint 必须逐字等于固定文案常量')
    if (!mf.merge_hint.includes('视觉能力') || !mf.merge_hint.includes('图文合并终稿')) {
      fail(`⑤ merge_hint 文案异常：${mf.merge_hint}`)
    }
    if (mf.shots_total !== 2 || mf.shots.length !== 2) fail(`⑤ shots 与 shots_total 应一致为 2，实际 ${mf.shots.length}/${mf.shots_total}`)
    if (mf.shots[0].file !== '01.png' || mf.shots[1].bytes !== 222) fail('⑤ shots 条目应保留 file/bytes')
    for (const field of ['url', 'title', 'text_source', 'text_chars', 'captured_at']) {
      if (mf[field] === undefined) fail(`⑤ 缺固定字段 ${field}`)
    }
    if (mf.partial !== undefined || mf.end_reason !== undefined || mf.warning !== undefined) {
      fail('⑤ 未传 partial/endReason/warning 时字段应缺省（不出现键）')
    }
    const mp = m.buildManifest({
      url: 'https://example.com/doc', title: '示例文档', text_source: 'render', text_chars: 480, shots: [],
      partial: true, endReason: 'timeout', warning: '截图提前终止',
    })
    if (mp.partial !== true || mp.end_reason !== 'timeout' || mp.warning !== '截图提前终止') {
      fail(`⑤ partial/end_reason/warning 应在有值时出现，实际 ${JSON.stringify(mp)}`)
    }
    if (mp.shots_total !== 0 || mp.shots.length !== 0) fail('⑤ 空 shots 应为 0（显式 api 源素材包）')
  }

  // ── 补充：cleanRenderedText（原型 kdocs-clean.mjs 语义移植）──
  {
    const header = '这是一个重复出现的页眉行'
    const raw = [
      '第一段正文', '仅查看', '点赞', '', '', '第二段正文', header,
      header, '第三段正文', header, '第二段正文', '', '',
    ].join('\n')
    const out = m.cleanRenderedText(raw)
    if (out.includes('仅查看') || out.includes('点赞')) fail('补充 UI 行黑名单应剔除「仅查看」「点赞」')
    if (out.split(header).length - 1 !== 1) fail(`补充 重复页眉（出现 3 次）应只留首次：${JSON.stringify(out)}`)
    if ((out.match(/^第二段正文$/gm) || []).length !== 2) {
      fail(`补充 非相邻重复段（页眉隔断）应原样保留 2 份：${JSON.stringify(out)}`)
    }
    if (/\n\n\n/.test(out) || out.endsWith('\n')) fail(`补充 连续空行应压一且无尾随空行：${JSON.stringify(out)}`)
    if (!out.includes('第一段正文') || !out.includes('第三段正文')) fail('补充 正文段落必须保留')
  }
  {
    // 短行重复不参与页眉判定（<6 字）：如实保留，不误伤正文短句
    const out = m.cleanRenderedText('好\n好\n好')
    if ((out.match(/^好$/gm) || []).length !== 1) fail('补充 相邻重复短行仍应折叠为一条')
  }

  // ── 补充：parseViewport（Config.renderViewport 运行时兜底）──
  {
    const v = m.parseViewport('1440x900')
    if (v === null || v.width !== 1440 || v.height !== 900) fail('补充 parseViewport 应解析 1440x900')
    if (m.parseViewport('900') !== null) fail('补充 缺 x 分隔应返回 null')
    if (m.parseViewport('1440x900x7') !== null) fail('补充 多段应返回 null')
    if (m.parseViewport('1x90') !== null) fail('补充 个位数宽应返回 null（{2,5} 位下限）')
    const v2 = m.parseViewport('14x90')
    if (v2 === null || v2.width !== 14 || v2.height !== 90) fail('补充 两位 x 两位（下界）应合法解析')
  }

  console.log('arbiter-ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e)
    process.exit(typeof e?.exitCode === 'number' ? e.exitCode : 1)
  })
}
