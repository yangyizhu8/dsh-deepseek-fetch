/**
 * @dsh-external/dsh-deepseek-fetch — DeepSeek 网页抓取工具包（P0 单页 + P1 合集）。
 * 工具：deepseek_fetch —— URL → DeepSeek 官方 Fetch API → 清洗 → 命名 → 原子落盘 → 结构化回报；
 * children=true 时改为同 host 子页 BFS（独立 HTML 发现层 + robots.txt + 深度/页数/时间预算），
 * 合并为单个合集 Markdown（根 `#` / 子 `##` / 来源行 / 未抓取清单）。
 *
 * 硬约束（Plugin-Spec.md v0.3 FR-1~FR-8 + FR-11 / Plugin-Design.md v0.1（P0）+ v0.3 §14（P1））：
 * - 单页路径（children 缺省/false）：文件内容 = 清洗后的 content 正文本身（无 front matter / 来源行 /
 *   时间头），UTF-8 无 BOM，不追加任何换行/页脚；title/url/request_id 等元信息只走工具返回值。
 *   合集路径（children=true）按设计含 `> 来源:` 行与 `---` 分隔，不适用本条。
 * - 失败一律返回结构化 {ok:false, code, message, ...}，不抛异常（框架级参数校验除外），
 *   且任何失败路径不产生文件、不留临时文件残留。
 * - API Key 只进内存（Authorization 头），不进日志 / 返回值 / 落盘文件。
 * - 资源注册挂 ctx.effect（插件卸载时自动注销工具）；无定时器、无事件订阅、无模块级可变状态。
 * - P1 增量（v0.2 / FR-11）：参数扩为恰 6 键 {url, output_dir, clean, children, max_depth, max_pages}；
 *   children 缺省或 false 时走 P0 单页路径，落盘内容**逐字节不变**（纯正文，无来源行/页标题/front matter）。
 *   不新增错误码（仍 8 个）、不新增工具名/loader entry；filename 仍被显式拒绝。
 * - P2 增量（v0.3 / FR-12 · Design §15）：参数扩为恰 9 键（+render/text_source/max_shots）；render=true
 *   产出素材包三件（<基名>.md + <基名>.shots/NN.png + <基名>.manifest.json），图文合并由 agent 侧用模型
 *   自带视觉能力完成（形态 A，插件不调任何视觉 API）；children 与 render 互斥；错误码 8→11
 *   （+E_NO_EDGE/E_RENDER_TIMEOUT/E_RENDER_FAILED）；auto 模式渲染失败**降级而非失败**（api(fallback)+warning），
 *   仅 text_source='render' 显式报错；渲染超预算/截图中断时已产出素材保留并标注 partial（§15.8——
 *   素材路径是「失败不落盘」约束的显式例外，P0/P1 单页与合集路径不受影响）。
 * - P3 增量（v0.4 / FR-13 · FR-14 / Design §16）：参数扩为恰 10 键（+render_settle_ms，0–5000 整数，越界 →
 *   E_INVALID_URL + 参数专属 hint）；传参时渲染预算按 ⌈shots×settle×1.6⌉+20000 与 Config.renderTimeoutMs
 *   取大联动（夹 [5000,600000]），**不传时预算仍 = Config.renderTimeoutMs（P2 零回归）**；截图去重升级为
 *   sha1 快路径 + dHash64 预筛（汉明≤2）+ 32×32 灰度 MAD≤1.5 复核（PNG 经 Node 内置 zlib 解码，失败回退
 *   sha1 精确比较并记一次 warning）；返回与 manifest 增 render_settle_ms / render_timeout_ms / shots_deduped /
 *   dedup_method；不新增 Config 字段、不新增错误码（仍 11 个）。
 * - P5 增量（v0.5 / FR-15 · Design §17）：render 路径每屏截图前剥离"覆盖型浮层"（四重约束缺一不剥：
 *   class 关键词 popup|modal|mask|overlay|dialog|guide + 面积 ≥85% 视口 + 自身文本 ≤300 字 + 非
 *   CANVAS/IFRAME；求值异常一律吞掉返回 0，绝不中断渲染通道）；Config 增 renderStripOverlays（默认 true，
 *   17→18 字段；false 时剥离调用次数为 0，行为与 v0.4.0 逐语义一致）；返回与 manifest 增 overlays_stripped
 *   （累计剥离元素数；api 源 / 无 Edge 降级路径不出现该字段）；参数仍 10 键、错误码仍 11 个、去重阈值零改动。
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, existsSync, promises as fsp, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { inflateSync } from 'node:zlib'
import type { Context } from 'cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'

export const name = '@dsh-external/dsh-deepseek-fetch'
export const inject = ['tools']

// ── 错误码与 hint 表 ─────────────────────────────────────────────────────────

/** 11 错误码全集（P0 8 个 + P2 渲染通道 3 个；verify.mjs error-codes 项以此常量断言完整性）。 */
export const ERROR_CODES = [
  'E_INVALID_URL',
  'E_NO_KEY',
  'E_AUTH',
  'E_FETCH_FAILED',
  'E_RATE_LIMIT',
  'E_UPSTREAM',
  'E_EMPTY_CONTENT',
  'E_IO',
  'E_NO_EDGE',
  'E_RENDER_TIMEOUT',
  'E_RENDER_FAILED',
] as const

export type ErrorCode = typeof ERROR_CODES[number]

/** 给 agent 的行动建议（静态文案；不含任何动态值，天然无 Key 泄漏面）。 */
const HINTS: Record<ErrorCode, string> = {
  E_INVALID_URL: '修正 URL 后重试：需 http/https、含 host、不带用户名/密码、长度不超过 8192 字符',
  E_NO_KEY: '配置 DEEPSEEK_API_KEY（用户级环境变量）或插件 Config.apiKey 后重试',
  E_AUTH: 'Key 无效或无权限，请检查 DEEPSEEK_API_KEY / Config.apiKey',
  E_FETCH_FAILED: '目标站点拒绝或无法抓取，可改用 site_crawl 等其它抓取通道',
  E_RATE_LIMIT: '触发上游限流，请稍后重试',
  E_UPSTREAM: '上游服务异常或网络超时，可稍后重试',
  E_EMPTY_CONTENT: '该页无正文（可能是 SPA 空壳），可改用 site_crawl 试试',
  E_IO: '换一个落盘目录，或检查目标目录写权限 / 磁盘空间',
  E_NO_EDGE: '本机未找到 Microsoft Edge：可在 Config.edgePath 指定路径，或改用 text_source=api（auto 模式已自动降级为 API 文字）',
  E_RENDER_TIMEOUT: '渲染超预算（Config.renderTimeoutMs）：已产出截图保留在素材包；可提高预算、调大 renderSettleMs 或调小 max_shots 后重试',
  E_RENDER_FAILED: '渲染通道失败（Edge 启动 / CDP / 截图异常）：可改用 text_source=api 或稍后重试',
}

// ── Config（B2 §7 七字段 + Design §14.8 四字段；范围非法 → schemastery 加载期抛错，不静默回退）──

const WINDOWS_DEFAULT_OUTPUT_DIR = 'C:\\deepseek网页抓取'

/** 发现通道默认 UA（robots 分组匹配也基于它的 product token；Config.htmlUserAgent 缺省值）。 */
export const DEFAULT_HTML_USER_AGENT = 'Mozilla/5.0 (dsh-deepseek-fetch/0.2)'

export interface Config {
  /** 默认落盘目录（POSIX 下由实现退化为 ~/deepseek网页抓取） */
  defaultOutputDir: string
  /** DeepSeek Fetch API 端点（可覆盖用于测试/代理） */
  endpoint: string
  /** 单次请求超时（ms） */
  timeoutMs: number
  /** 5xx/网络异常重试次数（429 不重试） */
  retries: number
  /** clean 参数缺省值 */
  defaultClean: boolean
  /** API Key 环境变量名 */
  apiKeyEnv: string
  /** 兜底直配 Key（空 = 不启用；不进日志/回显） */
  apiKey: string
  /** 合集路径并发上限（1–5） */
  childrenConcurrency: number
  /** 合集路径总时间预算（ms，10000–1800000） */
  childrenTimeoutMs: number
  /** 是否遵守目标站点 robots.txt（根页被拒则整体失败） */
  respectRobots: boolean
  /** 发现通道（原始 HTML GET）User-Agent */
  htmlUserAgent: string
  /** Edge 可执行文件路径（空 = 自动探测三处默认路径；P2 渲染通道，Design §15.7） */
  edgePath: string
  /** 渲染通道总预算 ms（覆盖启动 + 渲染等待 + 截图循环，5000–600000） */
  renderTimeoutMs: number
  /** 截图视口，形如 '1440x900' */
  renderViewport: string
  /** 取文字用的高视口，形如 '1440x2400'（WebOffice 类文档只有视口容得下一整页时正文才进 DOM） */
  renderTextViewport: string
  /** 每屏滚动后的等待 ms（等懒加载/重排稳定，0–5000） */
  renderSettleMs: number
  /** 滚动步长 = 视口高 − 该值（重叠防漏行，0–400） */
  renderScrollOverlap: number
  /** 渲染通道每屏截图前是否剥离覆盖型浮层（P5/FR-15，Design §17.3；false = 剥离调用次数为 0，行为与 v0.4.0 逐语义一致） */
  renderStripOverlays: boolean
}

/**
 * Config 字段名清单 —— 断言（assert-config.mjs / verify.mjs）只依赖本常量，
 * 不依赖 schemastery 对象内部结构。与下方 z.object 逐字段同步维护（DEV-PLAN T-07/T-11）。
 */
export const CONFIG_FIELDS = [
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
] as const

export const Config = z.object({
  defaultOutputDir: z.string().pattern(/\S/).default(WINDOWS_DEFAULT_OUTPUT_DIR)
    .description('默认落盘目录（POSIX 下退化为 ~/deepseek网页抓取）'),
  endpoint: z.string().pattern(/^https?:\/\//).default('https://api.deepseek.com/v1/tools/fetch')
    .description('DeepSeek Fetch API 端点（必须 http(s)，可覆盖用于测试/代理）'),
  timeoutMs: z.number().min(1000).max(300000).default(60000)
    .description('单次请求超时（ms），范围 1000–300000'),
  retries: z.number().min(0).max(3).default(1)
    .description('5xx/网络异常重试次数（0–3；429 不重试直接回报）'),
  defaultClean: z.boolean().default(true)
    .description('clean 参数缺省值：是否剥离 Markdown 反斜杠转义'),
  apiKeyEnv: z.string().pattern(/\S/).default('DEEPSEEK_API_KEY')
    .description('API Key 环境变量名'),
  apiKey: z.string().default('')
    .description('兜底直配 Key（空 = 不启用；不进日志/回显，仅建议本地 profile patch 使用）'),
  childrenConcurrency: z.number().min(1).max(5).default(3)
    .description('合集路径（children=true）并发上限，范围 1–5'),
  childrenTimeoutMs: z.number().min(10000).max(1800000).default(300000)
    .description('合集路径总时间预算（ms），范围 10000–1800000；耗尽后停止扩展、已抓页照常合并'),
  respectRobots: z.boolean().default(true)
    .description('是否遵守目标站点 robots.txt（根页被拒 → 整体失败不落盘；子页被拒 → 记入未抓取清单）'),
  htmlUserAgent: z.string().pattern(/\S/).default(DEFAULT_HTML_USER_AGENT)
    .description('发现通道（原始 HTML 抓取）User-Agent；robots 解析按其 product token 分组匹配'),
  edgePath: z.string().default('')
    .description('Edge 可执行文件路径（空 = 自动探测 Program Files 两处 + %LOCALAPPDATA%；非空但不存在时回退自动探测）'),
  renderTimeoutMs: z.number().min(5000).max(600000).default(90000)
    .description('渲染通道总预算（ms），范围 5000–600000；覆盖 Edge 启动 + 渲染等待 + 截图循环，超预算 → E_RENDER_TIMEOUT（已产出截图保留）'),
  renderViewport: z.string().pattern(/^\d{2,5}x\d{2,5}$/).default('1440x900')
    .description('截图视口（形如 WxH，如 1440x900）'),
  renderTextViewport: z.string().pattern(/^\d{2,5}x\d{2,5}$/).default('1440x2400')
    .description('取文字用的高视口（形如 WxH，如 1440x2400）；WebOffice 类文档只有视口容得下一整页时正文才渲染进 DOM（实测 900/1600 视口只得轮廓面板，2400 才得正文）'),
  renderSettleMs: z.number().min(0).max(5000).default(700)
    .description('每屏滚动后的等待（ms），范围 0–5000；等懒加载/重排稳定'),
  renderScrollOverlap: z.number().min(0).max(400).default(60)
    .description('滚动步长 = 视口高 − 该值（防漏行重叠），范围 0–400'),
  renderStripOverlays: z.boolean().default(true)
    .description('渲染通道每屏截图前是否剥离覆盖型浮层（class 关键词 + 面积 ≥85% 视口 + 自身文本 ≤300 字 + 非 CANVAS/IFRAME 四重约束全中才移除；false 时行为与 v0.4.0 完全一致）'),
})

// ── 工具契约常量（注册与断言同源；A5 据此核对参数键集合）──────────────────────

export const TOOL_NAME = 'deepseek_fetch'

const TOOL_DESCRIPTION = '抓取指定网页并由 DeepSeek 官方 Fetch API 转为 Markdown 落盘。'
  + '文件内容即正文（无 front matter / 来源行 / 时间头）；失败不落盘并返回结构化错误码。'
  + 'children=true 时改为同 host 子页 BFS 抓取并合并为单个合集 Markdown（根页 #、子页 ##、含来源行与未抓取清单）。'
  + 'render=true 时输出渲染素材包（正文 md + 分屏截图 PNG + manifest.json）：只出素材，'
  + '图文合并由调用方以自身视觉能力完成（插件不调任何视觉 API）；与 children 互斥。'

/**
 * 参数 schema 恰为 10 键 {url, output_dir, clean, children, max_depth, max_pages, render, text_source,
 * max_shots, render_settle_ms}（P3 后）；`as const satisfies` 保证与 defineTool DSL 逐字面量相符。
 * 数值范围（0–5 / 1–200 / 1–100 / 0–5000）与 text_source 枚举无法用 DSL 表达（无 minimum/maximum/enum）
 * → 写入 description 并在 execute 本地前置拒绝。
 */
export const TOOL_PARAMETERS = {
  url: {
    type: 'string',
    required: true,
    description: '目标网页完整 URL：http/https、含 host、不含用户名/密码、长度不超过 8192 字符',
  },
  output_dir: {
    type: 'string',
    description: '落盘目录（缺省取插件配置 defaultOutputDir）；绝对路径直接使用，相对路径基于会话工作区解析；目录不存在则递归创建',
  },
  clean: {
    type: 'boolean',
    description: '是否剥离 Markdown 反斜杠转义（缺省取插件配置 defaultClean=true）；false 时原文保真落盘；合集路径对每页正文同样生效',
  },
  children: {
    type: 'boolean',
    description: '缺省 false=单页路径（行为与 P0 完全一致，落盘纯正文）；true=合集路径：抓取同 host 子页合并为单个合集 Markdown',
  },
  max_depth: {
    type: 'integer',
    description: '合集路径子页 BFS 最大深度：0=仅根页，1=根页+直接子链接（默认 2；范围 0–5 的整数；仅 children=true 时生效，否则忽略）',
  },
  max_pages: {
    type: 'integer',
    description: '合集路径总页数上限，含根页（默认 30；范围 1–200 的整数；仅 children=true 时生效，否则忽略）',
  },
  render: {
    type: 'boolean',
    description: 'true 启用渲染素材通道（FR-12）：产出素材包三件（正文 md + 分屏截图 PNG + manifest.json），图文合并由调用方完成；缺省 false=纯 API 抓取（行为与 P0/P1 完全一致）；与 children 互斥',
  },
  text_source: {
    type: 'string',
    description: '素材通道文字来源（仅 render=true 时生效）：auto=默认，按特征择源（canvas 占比≥30% / API 文字混入编辑器 UI 噪声 / 正文短于 200 字 → 渲染 innerText，否则 API 文字）；api=只用 DeepSeek 抓取且不启动 Edge；render=只用无头 Edge 渲染（Edge 缺失报 E_NO_EDGE）',
  },
  max_shots: {
    type: 'integer',
    description: '分屏截图张数上限（默认 40；范围 1–100 的整数；仅 render=true 时生效，否则忽略）',
  },
  render_settle_ms: {
    type: 'integer',
    description: '每屏滚动后的等待毫秒（默认取插件配置 renderSettleMs=700；范围 0–5000 的整数；调大可等更重的懒加载/重排，渲染总预算随之自动联动；仅 render=true 时生效，否则忽略）',
  },
} as const satisfies ParameterSchemaSpec

export interface FetchArgs {
  url: string
  output_dir?: string
  clean?: boolean
  /** true 走合集路径；缺省/false 走 P0 单页路径（A7：零变化） */
  children?: boolean
  /** 合集路径 BFS 深度（0–5，缺省 2）；children 非 true 时忽略且不报错 */
  max_depth?: number
  /** 合集路径页数上限（1–200，缺省 30）；children 非 true 时忽略且不报错 */
  max_pages?: number
  /** true 启用渲染素材通道（FR-12，缺省 false）；与 children 互斥 */
  render?: boolean
  /** 素材通道文字来源 auto|api|render（缺省 auto）；render 非 true 时忽略且不报错 */
  text_source?: string
  /** 截图张数上限（1–100，缺省 40）；render 非 true 时忽略且不报错 */
  max_shots?: number
  /** 每屏滚动等待覆盖（0–5000 整数，缺省 Config.renderSettleMs）；render 非 true 时忽略且不报错 */
  render_settle_ms?: number
}

// ── 返回形态（B2 §4.1；对象字面量 type 而非 interface —— 需可赋给 JSON 值类型）──

/** 调用层成功：content 为接口原文（清洗在其后）。 */
export type FetchSuccess = {
  ok: true
  title: string
  content: string
  request_id: string | null
  elapsed_ms: number
}

/** 调用层失败（含 code/message/可选 request_id 与 hint）。 */
export type FetchFailure = {
  ok: false
  code: ErrorCode
  message: string
  request_id?: string
  hint?: string
}

export type FetchResult = FetchSuccess | FetchFailure

/** 工具级成功返回（FR-1：八字段齐全；request_id 在成功路径无上游来源时为 null）。 */
export type ToolSuccess = {
  ok: true
  title: string
  path: string
  bytes: number
  chars: number
  request_id: string | null
  elapsed_ms: number
  /** 相对 output_dir 所用基准目录（P1-2：会话 cwd；无会话上下文时回退进程 cwd，如实回报）。 */
  base_dir: string
}

export type ToolFailure = FetchFailure
export type ToolResult = ToolSuccess | ToolFailure

/**
 * 合集路径成功（Design §14.2 返回增量）：在 ToolSuccess 之上加 pages_total/pages_ok/pages_failed，
 * skipped 仅在有未抓取项时携带；单页路径返回字段不变（向后兼容）。
 */
export type CollectionSuccess = ToolSuccess & {
  /** 实际并入合集的页数（含根页） */
  pages_total: number
  /** 抓取成功页数（= pages_total；失败页只进清单不计数） */
  pages_ok: number
  /** 子页正文抓取失败数（E_FETCH_FAILED / E_UPSTREAM / E_EMPTY_CONTENT） */
  pages_failed: number
  /** 未抓取清单（robots 拒 / 抓取失败 / 预算耗尽 / 发现降级 / 同页多参折叠；空时省略，条数有上限） */
  skipped?: SkippedEntry[]
  /** 未抓取清单总条数（含因上限未逐条列出的部分；P2-8） */
  skipped_total: number
}

export type CollectionResult = CollectionSuccess | ToolFailure

// ── ① 校验层（FR-5 前置：本地拒绝，不消耗外网调用）──────────────────────────

export function validateUrl(url: string): { ok: true } | { ok: false; reason: string } {
  if (typeof url !== 'string' || url.trim() === '') return { ok: false, reason: 'URL 为空' }
  if (url.length > 8192) return { ok: false, reason: `URL 长度 ${url.length} 超过 8192 字符上限` }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: `URL 无法解析：${url.slice(0, 64)}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `仅支持 http/https 协议（当前 ${parsed.protocol}）` }
  }
  if (parsed.hostname === '') return { ok: false, reason: 'URL 缺少 host' }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'URL 含用户名/密码（禁止带凭证）' }
  }
  return { ok: true }
}

// ── ② 凭据层（FR-7：三级解析；Key 只进内存）────────────────────────────────

const execFileAsync = promisify(execFile)

/**
 * 仅 Windows 第三级：`reg query HKCU\Environment /v <name>` 读用户级环境变量。
 * 任何失败（变量不存在 / reg 不可用 / 输出不含该变量）一律返回 null；值做 trim 容错（R-04）。
 */
async function readUserEnvWindows(varName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Environment', '/v', varName], {
      windowsHide: true,
      timeout: 3000, // P2-11：异常环境不得无界挂起
      maxBuffer: 64 * 1024,
    })
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(\S+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line)
      if (match !== null && match[1] === varName) {
        const value = (match[2] ?? '').trim()
        if (value !== '') return value
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 三级凭据解析（**顺序按 Spec FR-7**）：① env[apiKeyEnv] → ② 仅 Windows：用户级环境（reg query）→ ③ config.apiKey。
 * 三级全 miss 返回 null（调用方返回 E_NO_KEY）。Key 绝不出现在任何日志/返回值/文件中。
 */
export async function resolveApiKey(
  env: Record<string, string | undefined>,
  config: { apiKeyEnv: string; apiKey: string },
  isWin: boolean,
): Promise<string | null> {
  const fromEnv = env[config.apiKeyEnv]
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim() // P2-10：与 reg 分支统一 trim
  if (isWin) {
    const fromReg = await readUserEnvWindows(config.apiKeyEnv)
    if (fromReg !== null) return fromReg
  }
  if (typeof config.apiKey === 'string' && config.apiKey.trim() !== '') return config.apiKey
  return null
}

// ── ③ 调用层（FR-1/FR-5：API 调用 + 8 码分类 + 重试）────────────────────────

/**
 * 从上游 message 中容错提取 request_id（实测位于 message 尾部，B5 事实 3）。
 * 取最后一次出现；容忍 `=`、`:`、`：`、空白等分隔写法（R-07 上游措辞漂移容错）。
 */
export function extractRequestId(message: string): string | null {
  const re = /request_id[^A-Za-z0-9_-]*([A-Za-z0-9_-]{4,})/gi
  let match: RegExpExecArray | null = null
  let last: string | null = null
  while ((match = re.exec(message)) !== null) last = match[1] ?? last
  return last
}

/**
 * HTTP 状态 + 上游 message 双信号 → 错误码（B2 §4.1 错误码表）：
 * 401/403→E_AUTH；429→E_RATE_LIMIT；5xx→E_UPSTREAM；
 * 404 且 message 含 "failed to fetch URL"→E_FETCH_FAILED；其余 4xx→E_FETCH_FAILED 兜底。
 * E_INVALID_URL / E_NO_KEY / E_EMPTY_CONTENT / E_IO 由 execute 前置/后置分支产生，不归此函数。
 */
export function classifyError(status: number, message: string): ErrorCode {
  if (status === 401 || status === 403) return 'E_AUTH'
  if (status === 429) return 'E_RATE_LIMIT'
  if (status >= 500) return 'E_UPSTREAM'
  if (status === 404 && message.includes('failed to fetch URL')) return 'E_FETCH_FAILED'
  return 'E_FETCH_FAILED'
}

type EndpointErrorBody = { error?: { message?: unknown } }
type EndpointOkBody = { title?: unknown; content?: unknown }

/** 单次请求（无重试）：超时 + 调用方取消信号（P1-3），finally 清理定时器；任何异常折叠为结构化失败。 */
async function fetchOnce(
  url: string,
  key: string,
  config: Config,
  external?: AbortSignal,
  timeoutMs: number = config.timeoutMs,
): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = external === undefined ? controller.signal : AbortSignal.any([controller.signal, external])
  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`, // Key 只进请求头（仅内存），绝不进日志/错误信息
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal,
    })
    const text = await res.text()
    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        const body = JSON.parse(text) as EndpointErrorBody
        if (typeof body.error?.message === 'string' && body.error.message !== '') message = body.error.message
      } catch { /* 错误体非 JSON：保留 HTTP 状态行 */ }
      const requestId = extractRequestId(message)
      const code = classifyError(res.status, message)
      return {
        ok: false,
        code,
        message,
        ...(requestId !== null ? { request_id: requestId } : {}),
        hint: HINTS[code],
      }
    }
    let body: EndpointOkBody
    try {
      body = JSON.parse(text) as EndpointOkBody
    } catch {
      return { ok: false, code: 'E_UPSTREAM', message: '上游返回 200 但响应体不是合法 JSON', hint: HINTS.E_UPSTREAM }
    }
    return {
      ok: true,
      title: typeof body.title === 'string' ? body.title : '',
      content: typeof body.content === 'string' ? body.content : '',
      request_id: null, // 成功响应体实测不含 request_id（B5），如实为 null，不臆造
      elapsed_ms: 0,
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    const detail = e instanceof Error ? e.message : String(e)
    const cancelled = external?.aborted === true
    return {
      ok: false,
      code: 'E_UPSTREAM',
      message: cancelled ? '调用方已取消本次执行' : aborted ? `请求超时（本预算 ${timeoutMs}ms）` : `网络错误：${detail}`,
      hint: HINTS.E_UPSTREAM,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用 DeepSeek Fetch API：仅 5xx / 网络异常 / 超时（E_UPSTREAM 类）重试 config.retries 次；
 * 429 与其余 4xx 不重试。`timeoutMs` 是**含重试的总预算**（P2-5），elapsed_ms 为实测总耗时。
 */
export async function fetchOne(
  url: string,
  key: string,
  config: Config,
  external?: AbortSignal,
): Promise<FetchResult> {
  const started = Date.now()
  const deadline = started + config.timeoutMs
  let result = await fetchOnce(url, key, config, external, Math.max(1, deadline - Date.now()))
  let attempt = 1
  while (!result.ok && result.code === 'E_UPSTREAM' && !HINTS_ABORTABLE_NO_RETRY.has(result.message) && attempt <= config.retries) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break // 总预算耗尽：不再发起新一次尝试
    result = await fetchOnce(url, key, config, external, remaining)
    attempt += 1
  }
  if (result.ok) return { ...result, elapsed_ms: Date.now() - started }
  return result
}

/** 取消类失败不做无意义重试（调用方已走）。 */
const HINTS_ABORTABLE_NO_RETRY = new Set(['调用方已取消本次执行'])

// ── ④ 清洗层（FR-2：围栏内保留、围栏外剥离转义）────────────────────────────

/** 块外剥离：跳过行内代码（成对反引号），其余位置 `\`+标点 → 标点（P2-14）。 */
function stripEscapes(line: string): string {
  if (!line.includes('\\')) return line
  return line.replace(
    /(`+)([\s\S]*?)\1|\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g,
    (m, ticks: string | undefined) => (ticks !== undefined ? m : m.slice(1)),
  )
}

type FenceMark = { ch: string; len: number }

/** 识别围栏开头（允许 `>` 引用前缀与 ≤3 空格缩进）；反引号围栏的 info string 不得含反引号。 */
function fenceOpen(line: string): FenceMark | null {
  const m = /^(\s*(?:>\s*)*)(`{3,}|~{3,})(.*)$/.exec(line)
  if (m === null) return null
  const marker = m[2]!
  if (marker[0] === '`' && m[3]!.includes('`')) return null
  return { ch: marker[0]!, len: marker.length }
}

/** 闭合判定：同字符、长度 ≥ 开头、且行内无 info string（P2-13：混用 ``` 与 ~~~ 不再误闭合）。 */
function fenceClose(line: string, open: FenceMark): boolean {
  const m = /^(\s*(?:>\s*)*)(`{3,}|~{3,})\s*$/.exec(line)
  return m !== null && m[2]![0] === open.ch && m[2]!.length >= open.len
}

/**
 * Markdown 反斜杠转义清洗（FR-2）：逐行扫描；围栏代码块内**逐字节原样保留**（记录开围栏字符与长度，
 * 同字符且不短于开头且无 info string 才闭合），行内代码内保留；块外剥离 `\`+Markdown 标点。
 * 已知限制：4 空格缩进代码块不被识别（无法与嵌套列表可靠区分），见 SHIPPABLE §3.2。
 */
export function cleanMarkdown(content: string): string {
  if (!content.includes('\\')) return content
  let open: FenceMark | null = null
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (open !== null) {
      if (fenceClose(line, open)) open = null
      continue // 围栏内（含闭合行）原样不动
    }
    const opened = fenceOpen(line)
    if (opened !== null) {
      open = opened
      continue // 开围栏行本身不动
    }
    lines[i] = stripEscapes(line)
  }
  return lines.join('\n')
}

// ── ⑤ 命名层（FR-3：标题 → slug 基名，不含扩展名）──────────────────────────

const ILLEGAL_FS_RE = /[\u0000-\u001f<>:"/\\|?*]/g
const EDGE_DASH_DOT_RE = /^[-.]+|[-.]+$/g
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_FILENAME = 80

/** 标题主路径：文件系统非法字符与控制字符 → `-`（Spec FR-3）→ 空白折叠 `-` → 去首尾 `-`/`.` → 截断 80。 */
function slugifyTitleCore(title: string): string {
  return title
    .replace(ILLEGAL_FS_RE, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(EDGE_DASH_DOT_RE, '')
    .slice(0, MAX_FILENAME)
}

/** 空标题回退：host+pathname 的分隔符（/ \）折叠为 `-`，其余按标题规则处理。 */
function fallbackFromHostPath(fallbackHostPath: string): string {
  let host = fallbackHostPath
  let pathname = ''
  try {
    const u = new URL(fallbackHostPath)
    host = u.hostname || host
    pathname = u.pathname
  } catch { /* 非 URL 形态：按整串处理 */ }
  return slugifyTitleCore(`${host}${pathname}`.replace(/[/\\]+/g, '-'))
}

/**
 * 标题 → 文件名基名（规则见 B2 §8）。空标题回退 host-pathname，仍为空则保险回退 untitled；
 * Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，大小写不敏感）前缀 `_`。
 */
export function slugify(title: string, fallbackHostPath: string): string {
  let slug = slugifyTitleCore(title ?? '')
  if (slug === '') slug = fallbackFromHostPath(fallbackHostPath)
  if (slug === '') slug = 'untitled'
  // Windows 按首个 '.' 前段判设备名：`con.backup` / `aux.v2` 同样需要前缀（P2-15）
  if (WINDOWS_RESERVED_RE.test(slug.split('.')[0] ?? '')) slug = `_${slug}`
  return slug
}

// ── ⑥ 落盘层（FR-3/FR-4/FR-6：目录保障 + 原子写 + 重名序号）─────────────────

export type WriteDocResult = { path: string; bytes: number }

/** 本地时间 -YYYYMMDD-HHmmss（FR-3：序号达上限后的冲突后缀）。 */
function timestampSuffix(now: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
}

/**
 * 落盘（P1-1 修复）：临时文件写满 → **排他占名**（`link` 目标已存在即 EEXIST；不支持硬链接的文件系统
 * 退化为 `copyFile` + `COPYFILE_EXCL`）→ finally 清理临时文件。
 * 刻意不用 `rename`：Windows（MOVEFILE_REPLACE_EXISTING）与 POSIX 的 rename 都会**静默覆盖**已存在目标，
 * 无法提供"绝不覆盖"保证（Spec FR-3 / §5 并发不覆盖）。
 * 文件内容 = content 本身（UTF-8 无 BOM，不追加换行/页脚）。
 */
export async function writeDoc(dir: string, name: string, content: string): Promise<WriteDocResult> {
  const absDir = path.resolve(dir)
  await fsp.mkdir(absDir, { recursive: true }) // 目标是已存在文件（EEXIST/ENOTDIR）或不可写 → 上抛转 E_IO

  const ext = '.md'
  const candidates: string[] = [name + ext]
  for (let i = 2; i <= 99; i++) candidates.push(`${name}-${i}${ext}`)
  // 二阶兜底带毫秒 + 4 位随机（P2-16：同一秒内多次同名请求不再轻易落到 E_IO）
  const suffix = `${timestampSuffix(new Date())}-${String(new Date().getMilliseconds()).padStart(3, '0')}-${Math.random().toString(36).slice(2, 6)}`
  candidates.push(`${name}-${suffix}${ext}`)

  const tmp = path.join(absDir, `.${name}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`)
  try {
    await fsp.writeFile(tmp, content, 'utf8') // Node 的 utf8 写入不含 BOM
    for (const fileName of candidates) {
      const target = path.join(absDir, fileName)
      try {
        await fsp.link(tmp, target) // 排他创建：目标已存在 → EEXIST
        return { path: target, bytes: Buffer.byteLength(content, 'utf8') }
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code
        if (code === 'EEXIST') continue // 目标被占（真实并发，或上一个候选已用）→ 下一候选
        if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS' || code === 'EXDEV') {
          // 文件系统不支持硬链接 → 排他复制（同样不覆盖既有文件）
          try {
            await fsp.copyFile(tmp, target, constants.COPYFILE_EXCL)
            return { path: target, bytes: Buffer.byteLength(content, 'utf8') }
          } catch (e2) {
            const c2 = (e2 as NodeJS.ErrnoException)?.code
            if (c2 === 'EEXIST') continue
            throw e2
          }
        }
        throw e // 权限/磁盘满/路径非法等：换候选名无济于事 → 上抛（execute 转 E_IO）
      }
    }
    throw new Error(`所有候选文件名均被占用（${name}*.md，含时间戳+随机后缀）`)
  } finally {
    await fsp.unlink(tmp).catch(() => { /* 已成功 link 或从未创建 */ })
  }
}

// ── ⑦ 发现层（P1/FR-11：原始 HTML 抽链接 + robots.txt；Design §14.3/§14.4）──
// 独立通道：不复用 DeepSeek fetch 返回的 content（实测不含链接，B5），只读静态 HTML 的 <a href>。

/** HTML 实体最小解码（Design §14.3：仅五个高频实体，不做完整解码）。 */
const MINIMAL_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function decodeMinimalEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39);/g, (whole) => MINIMAL_ENTITIES[whole] ?? whole)
}

/**
 * `<a ... href="...">` 抽取（单/双引号皆收）。
 * 不做 DOM 解析（只服务同 host 子页发现），但**容错扫描**而非单正则（P2-6 / P2-7）：
 * - 先剔除 HTML 注释与 `<script>/<style>/<textarea>` 块，避免其中的伪 `<a>`；
 * - 逐标签扫描，尊重引号内的 `>`（`title="a > b"` 不再整条漏抽）；
 * - `href` 前必须是空白或标签起点（`data-href` 不算）。
 */
export function extractAnchors(html: string): string[] {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, ' ')
  const hrefs: string[] = []
  let i = 0
  while (i < cleaned.length) {
    const lt = cleaned.indexOf('<a', i)
    if (lt < 0) break
    const after = cleaned[lt + 2]
    if (after === undefined || !/[\s/>]/.test(after)) { i = lt + 2; continue } // <abbr / <article 等
    // 扫描到未被引号包裹的 '>'
    let j = lt + 2
    let quote: string | null = null
    while (j < cleaned.length) {
      const ch = cleaned[j]!
      if (quote !== null) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        break
      }
      j++
    }
    const tag = cleaned.slice(lt, j + 1)
    const m = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    if (m !== null) {
      const href = (m[1] ?? m[2] ?? '').trim()
      if (href !== '') hrefs.push(decodeMinimalEntities(href))
    }
    i = j + 1
  }
  return hrefs
}

/**
 * URL 归一（Design §14.3）：基于页 URL 解析相对链接、去 `#fragment`、只留 http/https。
 * `mailto:/tel:/javascript:/data:/blob:` 等非白名单协议一律返回 null（丢弃）。
 */
export function normalizeLink(href: string, baseUrl: string): string | null {
  const trimmed = href.trim()
  if (trimmed === '') return null
  let u: URL
  try {
    u = new URL(trimmed, baseUrl)
  } catch {
    return null
  }
  u.hash = ''
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return u.href
}

/** 严格同 host（用户裁决：不跨子域）。host 含端口参与比较；大小写不敏感（URL 规范化已转小写，双保险）。 */
export function sameHost(url: string, rootHost: string): boolean {
  try {
    return new URL(url).host.toLowerCase() === rootHost.toLowerCase()
  } catch {
    return false
  }
}

/** 扩展名黑名单（Design §14.3：图片/音视频/样式/脚本/压缩/文档二进制；沿用 site-crawl BLOCKED_EXT 思路）。 */
export const BLOCKED_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|map|json|zip|gz|tar|pdf|docx?|xlsx?|pptx?|mp[34]|webm|avi|mov|woff2?|ttf|eot)$/i

/** 去重键：origin + pathname（query 不参与判重——同页多参不重复抓取，Design §14.3）。 */
export function dedupeKey(url: string): string {
  const u = new URL(url)
  return `${u.origin}${u.pathname}`
}

// ── ⑦-2 robots.txt 最小子集（Design §14.4：取 `*` 与本插件 UA token 两组；最长前缀匹配）──

/** 适用于本插件的 Allow/Disallow 前缀集合（两组规则合并收集）。 */
export type RobotsRules = { disallow: string[]; allow: string[] }

/** UA → product token 集合：`Mozilla/5.0 (dsh-deepseek-fetch/0.2)` → `mozilla` / `dsh-deepseek-fetch`。 */
function uaTokens(ua: string): Set<string> {
  const tokens = new Set<string>()
  for (const raw of ua.split(/[\s()]+/)) {
    const product = raw.split('/')[0]!.toLowerCase()
    if (product !== '') tokens.add(product)
  }
  return tokens
}

/**
 * 规则模式 → 匹配器（RFC 9309 §2.2 最小子集）：
 * - `*` = 任意字符序列；
 * - 结尾 `$` = 尾锚（必须整条路径匹配）；
 * - 无 `*` 且无 `$` = 路径段语义：完全相同，或其后紧跟 `/`（`/a` 不拦 `/abc`）。
 * 之前按字面前缀比较 → `/*.pdf$`、`/private$` 这类规则永不命中，等于**静默放行**（审查 P1-2）。
 */
export function robotsPatternMatcher(pattern: string): (pathname: string) => boolean {
  const anchored = pattern.endsWith('$')
  const raw = anchored ? pattern.slice(0, -1) : pattern
  const hasWildcard = raw.includes('*')
  let source = ''
  for (const ch of raw) {
    if (ch === '*') {
      source += '.*'
      continue
    }
    source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  if (anchored) {
    // `$` 尾锚：整条路径匹配（`/private$` 不拦 `/privateX`）
    const re = new RegExp('^' + source + '$')
    return (p) => re.test(p)
  }
  if (hasWildcard) {
    const re = new RegExp('^' + source)
    return (p) => re.test(p)
  }
  if (source.endsWith('/')) {
    // RFC 9309 §2.2.2：规则以 `/` 结尾 → 路径前缀匹配（`/` 拦全站）
    const re = new RegExp('^' + source)
    return (p) => re.test(p)
  }
  // 无通配且不以 `/` 结尾：完全相同，或其后紧跟 `/`（`/a` 不拦 `/abc`）
  const re = new RegExp('^' + source + '(?:/|$)')
  return (p) => re.test(p)
}

/**
 * 解析 robots.txt 最小子集：按 `User-agent` 分组（连续 User-agent 行同属一组，**空行结束一组**）；
 * 取 `*` 与本插件 UA product token 两组的 Allow/Disallow 合并；去注释、去空值。
 */
export function parseRobots(text: string, ua: string = DEFAULT_HTML_USER_AGENT): RobotsRules {
  const tokens = uaTokens(ua)
  const disallow: string[] = []
  const allow: string[] = []
  let applies = false
  let prevWasUserAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') {
      // 空行 = 分组结束：重置分组状态，避免上一组为空时规则泄漏到下一组（审查 P2-3）
      applies = false
      prevWasUserAgent = false
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 0) {
      prevWasUserAgent = false
      continue
    }
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (field === 'user-agent') {
      if (!prevWasUserAgent) applies = false // 新分组开始，先清空适用性
      const agent = value.split('/')[0]!.trim().toLowerCase() // `SomeBot/2.1` 按 `SomeBot` 匹配
      if (agent === '*' || tokens.has(agent)) applies = true
      prevWasUserAgent = true
      continue
    }
    prevWasUserAgent = false
    if (!applies || value === '') continue // 空 Allow/Disallow（如 `Disallow:`）= 无操作
    if (field === 'disallow') disallow.push(value)
    else if (field === 'allow') allow.push(value)
  }
  return { disallow, allow }
}

/**
 * 最长匹配：命中 Disallow 且无**更长或等长**的 Allow → 拒；Allow 更长或等长 → 放行；无命中 → 放行。
 * 特异性以规则串长度近似（通配规则按字面长度）。
 */
export function robotsAllows(rules: RobotsRules, pathname: string): boolean {
  const best = (patterns: string[]): number => {
    let len = -1
    for (const pattern of patterns) {
      if (robotsPatternMatcher(pattern)(pathname) && pattern.length > len) len = pattern.length
    }
    return len
  }
  const disallowLen = best(rules.disallow)
  if (disallowLen < 0) return true
  const allowLen = best(rules.allow)
  if (allowLen >= 0 && allowLen >= disallowLen) return true
  return false
}

/**
 * 原始 HTML GET（发现通道）：超时 + 合并调用方取消信号 + UA；非 2xx / 异常 / 超时一律 `{ok:false}`。
 *
 * **重定向安全（审查 P1-1）**：`redirect:'manual'` 逐跳处理，**每一跳的 Location host 必须等于允许的 host**，
 * 否则直接失败——否则被访问站点可用 302 把本机发现通道导向内网（盲打 GET 型 SSRF）。
 */
export async function fetchHtml(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
  ua: string = DEFAULT_HTML_USER_AGENT,
  allowedHost?: string,
): Promise<{ ok: boolean; html?: string; status?: number; reason?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const merged = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
  try {
    let current = url
    for (let hop = 0; hop <= 3; hop++) {
      const res = await fetch(current, { headers: { 'User-Agent': ua }, signal: merged, redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (location === null) return { ok: false, status: res.status, reason: '重定向缺少 Location' }
        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          return { ok: false, status: res.status, reason: '重定向 Location 非法' }
        }
        if (allowedHost !== undefined && next.host.toLowerCase() !== allowedHost.toLowerCase()) {
          return { ok: false, status: res.status, reason: `重定向越界：目标 host ${next.host} ≠ ${allowedHost}` }
        }
        current = next.href
        continue
      }
      if (!res.ok) return { ok: false, status: res.status }
      return { ok: true, html: await res.text() }
    }
    return { ok: false, reason: '重定向跳数超限' }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

// ── ⑧ 合集 BFS 层（P1/FR-11：FIFO + 深度/页数/时间预算 + 有界并发；Design §14.5）──

/** 单页抓取成果（content 为接口原文；清洗在 execute 侧按 clean 参数统一应用）。 */
export type PageResult = { url: string; title: string; content: string }

/** 未抓取清单条目。 */
export type SkippedEntry = { url: string; reason: string }

/** BFS 预算参数（工具参数缺省：maxDepth=2 / maxPages=30）。 */
export type CrawlLimits = { maxDepth: number; maxPages: number }

/** 未抓取清单条数上限（链接密集站点会把清单撑到十万级 → 合集与返回值体积无界；P2-8）。 */
export const MAX_SKIPPED = 200
/** 每页入队候选上限（P2-8）。 */
export const MAX_CANDIDATES_PER_PAGE = 200

export type CrawlResult = {
  /** 抓取成功的页（含根页 pages[0]，按队列出序；并发>1 时同批完成序可能交错） */
  pages: PageResult[]
  /** 未抓取清单（robots 拒 / 单页抓取失败 / 时间或页数预算 / 根页发现降级） */
  skipped: SkippedEntry[]
  /** 总时间预算耗尽（停止扩展，已抓页保留） */
  budgetExhausted: boolean
  /** 子页正文抓取失败数（E_FETCH_FAILED / E_UPSTREAM / E_EMPTY_CONTENT） */
  pagesFailed: number
  /** 未抓取清单总条数（含因上限未逐条列出的部分；P2-8） */
  skippedTotal: number
  /** 根页级失败（robots 拒根页 / 根页正文抓取失败）→ 整体失败，不产出合集 */
  rootFailure?: FetchFailure
}

/**
 * 同 host 子页 BFS（FR-11）：根页 depth=0，FIFO 出队；`depth >= maxDepth` 不再扩展；
 * 已抓页数 >= maxPages 停止扩展；**发请求前**检查 `Date.now() < deadline`（childrenTimeoutMs 总预算），
 * 超预算 → budgetExhausted=true 并停止（已抓页保留）。每页正文复用既有 fetchOne；
 * 逐页失败 → 记入 skipped 并继续；根页失败 → rootFailure 整体失败。robots 每 host 只取一次
 * （失败/404 视为放行）；根页被拒 → rootFailure E_FETCH_FAILED。发现通道失败（HTML 取不到或 0 链接）
 * → 降级单页：只抓根页，清单记 `子页发现失败：<原因>`。
 */
export async function crawlChildren(
  rootUrl: string,
  key: string,
  config: Config,
  signal?: AbortSignal,
  limits: CrawlLimits = { maxDepth: 2, maxPages: 30 },
): Promise<CrawlResult> {
  const deadline = Date.now() + config.childrenTimeoutMs
  const root = new URL(rootUrl)
  const rootHost = root.host
  const seen = new Set<string>([dedupeKey(rootUrl)])
  const queue: { url: string; depth: number }[] = [{ url: rootUrl, depth: 0 }]
  const pages: PageResult[] = []
  const skipped: SkippedEntry[] = []
  let skippedTotal = 0
  /** 记账入口：清单只保留前 MAX_SKIPPED 条，总数另行累计（P2-8：清单与返回值体积必须有界）。 */
  const pushSkipped = (url: string, reason: string): void => {
    skippedTotal += 1
    if (skipped.length < MAX_SKIPPED) skipped.push({ url, reason })
  }
  const robotsCache = new Map<string, RobotsRules | null>()
  let budgetExhausted = false
  let pagesFailed = 0
  let rootFailure: FetchFailure | undefined

  /** 每 host 只取一次 robots.txt（超时 5s；失败/404 → null = 放行）。 */
  const getRobots = async (origin: string): Promise<RobotsRules | null> => {
    if (!robotsCache.has(origin)) {
      const res = await fetchHtml(`${origin}/robots.txt`, Math.min(5000, config.timeoutMs), signal, config.htmlUserAgent, new URL(origin).host)
      robotsCache.set(origin, res.ok && res.html !== undefined ? parseRobots(res.html, config.htmlUserAgent) : null)
    }
    return robotsCache.get(origin) ?? null
  }

  // robots 根页预检：被拒 → 整体失败（不抓、不落盘，Design §14.4）
  if (config.respectRobots) {
    const rules = await getRobots(root.origin)
    if (rules !== null && !robotsAllows(rules, root.pathname)) {
      return {
        pages: [],
        skipped: [],
        budgetExhausted: false,
        pagesFailed: 0,
        skippedTotal: 0,
        rootFailure: {
          ok: false,
          code: 'E_FETCH_FAILED',
          message: `根页被 robots.txt 禁止抓取（${root.pathname}）`,
          hint: '站点 robots.txt 不允许抓取该路径；可确认 URL、调整 respectRobots 配置或改用 site_crawl',
        },
      }
    }
  }

  const processPage = async (item: { url: string; depth: number }): Promise<void> => {
    // 发请求前复查取消与预算（R-12：超预算/已取消不发新请求；已出队页同样记录原因）
    if (signal?.aborted === true) {
      pushSkipped(item.url, '调用方已取消')
      return
    }
    if (Date.now() >= deadline) {
      budgetExhausted = true
      pushSkipped(item.url, '超出时间预算')
      return
    }

    // 正文：复用既有调用层（含超时/重试/取消转发）
    const fetched = await fetchOne(item.url, key, config, signal)
    if (!fetched.ok || fetched.content.trim() === '') {
      const failure: FetchFailure = fetched.ok
        ? { ok: false, code: 'E_EMPTY_CONTENT', message: '接口返回正文为空或纯空白', hint: HINTS.E_EMPTY_CONTENT }
        : fetched
      if (item.depth === 0) {
        rootFailure = failure // 根页失败 → 整体失败（与 P0 失败语义一致，不产出无根合集）
        return
      }
      pagesFailed += 1
      pushSkipped(item.url, `抓取失败（${failure.code}）：${failure.message}`)
      return
    }
    pages.push({ url: item.url, title: fetched.title, content: fetched.content })

    // 深度/页数已满 → 不再扩展
    if (item.depth >= limits.maxDepth) return
    if (pages.length >= limits.maxPages) return
    if (signal?.aborted) return // 运行期复查（TS 已把上一处窄化为 false|undefined，故用真值判断）
    if (Date.now() >= deadline) {
      budgetExhausted = true
      return
    }

    // 发现层：独立 HTML 通道取链接（失败仅根页记降级，其余页静默不扩展）
    const html = await fetchHtml(item.url, Math.max(1, Math.min(config.timeoutMs, deadline - Date.now())), signal, config.htmlUserAgent, rootHost)
    if (!html.ok || html.html === undefined || html.html === '') {
      if (item.depth === 0) {
        pushSkipped(item.url, `子页发现失败：发现通道请求失败${html.status !== undefined ? `（HTTP ${html.status}）` : ''}`)
      }
      return
    }
    let enrolled = 0
    for (const href of extractAnchors(html.html)) {
      if (enrolled >= MAX_CANDIDATES_PER_PAGE) break // 每页入队候选上限（防链接密集站点把队列撑爆）
      const normalized = normalizeLink(href, item.url)
      if (normalized === null) continue
      let child: URL
      try {
        child = new URL(normalized)
      } catch {
        continue
      }
      if (!sameHost(normalized, rootHost)) continue // 严格同 host：不跨子域、不跟外链
      if (BLOCKED_EXT.test(child.pathname)) continue // 二进制/资源扩展名直接跳过
      const key2 = dedupeKey(normalized)
      if (seen.has(key2)) {
        // 同页多参（仅 query 不同）被折叠：不抓，但**如实记账**，不让内容静默消失（P2-10）
        pushSkipped(normalized, '同页多参已折叠（按 pathname 去重）')
        continue
      }
      seen.add(key2)
      if (config.respectRobots) {
        const rules = await getRobots(child.origin)
        if (rules !== null && !robotsAllows(rules, child.pathname)) {
          pushSkipped(normalized, 'robots.txt 禁止')
          continue
        }
      }
      queue.push({ url: normalized, depth: item.depth + 1 })
      enrolled += 1
    }
    if (item.depth === 0 && enrolled === 0) {
      // Design §14.3-7：解析 0 链接同样视为发现通道失败 → 降级单页并记录
      pushSkipped(item.url, '子页发现失败：未发现可抓取的同 host 子链接')
    }
  }

  while (queue.length > 0 && rootFailure === undefined) {
    if (signal?.aborted === true) break
    if (Date.now() >= deadline) {
      budgetExhausted = true
      break
    }
    if (pages.length >= limits.maxPages) break
    const width = Math.min(config.childrenConcurrency, limits.maxPages - pages.length, queue.length)
    if (width <= 0) break // 防御：并发配置为 0 时不空转
    const batch = queue.splice(0, width)
    await Promise.all(batch.map((item) => processPage(item)))
  }

  // 余下未抓队列 → 未抓取清单（原因按停止条件）
  const drainReason = rootFailure !== undefined
    ? '根页失败，未继续扩展'
    : budgetExhausted
      ? '超出时间预算'
      : signal?.aborted === true
        ? '调用方已取消'
        : `超出页数预算（max_pages=${limits.maxPages}）`
  for (const item of queue.splice(0)) {
    pushSkipped(item.url, drainReason)
  }

  return rootFailure === undefined
    ? { pages, skipped, budgetExhausted, pagesFailed, skippedTotal }
    : { pages, skipped, budgetExhausted, pagesFailed, skippedTotal, rootFailure }
}

// ── ⑨ 合并与命名层（P1/FR-11：单文件合集；Design §14.6/§14.7）────────────────

/**
 * 合集渲染（Design §14.6）：根页 `#`、子页统一 `##`、页间 `\n\n---\n\n`、来源行固定 `> 来源: <url>`；
 * `skipped` 非空才输出「## 未抓取清单」；**不重写页内标题**（正文原样嵌入，页内 `#` 与页标题同级是已知代价）。
 */
/** 标题为空时回退到 host+pathname（与文件名路径一致，避免出现空标题层级；P2-5）。 */
function pageDisplayTitle(page: PageResult): string {
  const title = page.title.trim()
  if (title !== '') return title
  try {
    const u = new URL(page.url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return page.url
  }
}

export function renderMerged(root: PageResult, pages: PageResult[], skipped: SkippedEntry[], skippedTotal: number = skipped.length): string {
  const section = (page: PageResult, heading: '#' | '##'): string =>
    `${heading} ${pageDisplayTitle(page)}\n\n> 来源: ${page.url}\n\n${page.content}`
  const parts = [section(root, '#'), ...pages.map((page) => section(page, '##'))]
  let merged = parts.join('\n\n---\n\n')
  if (skipped.length > 0) {
    const capped = skipped.slice(0, MAX_SKIPPED) // 渲染层再兜一层上限（P2-8：合集与返回值体积必须有界）
    const list = capped.map((s) => `- ${s.url} — ${s.reason}`).join('\n')
    const more = skippedTotal > capped.length ? `\n- （另有 ${skippedTotal - capped.length} 条未逐条列出，合计 ${skippedTotal} 条）` : ''
    merged += `\n\n---\n\n## 未抓取清单\n\n${list}${more}`
  }
  return merged
}

/**
 * 合集基名（Design §14.7）：标题 slug + `-合集`；标题形如 URL（`^https?://`）→ 回退 host-pathname 再拼。
 * 仅合集路径启用此回退（单页路径保持 P0 规则）；最终落盘仍走既有 writeDoc（排他占名 + 序号）。
 */
export function mergedSlug(title: string, url: string): string {
  const base = /^https?:\/\//i.test(title) ? slugify('', url) : slugify(title, url)
  return `${base}-合集`
}

// ── ⑩ 渲染素材层（P2/FR-12：无头 Edge + CDP + 滚动分屏截图 + 择源 + 素材包；Design §15）────────
// 形态 A：插件只产出素材（文字 md + 截图 PNG + manifest），图文合并由 agent 侧用模型自带视觉能力完成；
// 不调任何视觉 API、不引入 puppeteer/playwright（Node 内置 fetch + 全局 WebSocket 自实现 CDP 客户端）。
// 三个原型（workorders/kdocs-cdp.mjs、proto-shots.mjs、kdocs-clean.mjs）已实测可用，此处移植为可单测模块。

/** 渲染通道结构化异常（auto 模式捕获后降级；text_source='render' 模式转错误码返回）。 */
export class RenderError extends Error {
  constructor(readonly renderCode: 'E_NO_EDGE' | 'E_RENDER_TIMEOUT' | 'E_RENDER_FAILED', message: string) {
    super(message)
    this.name = 'RenderError'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 就绪判据（页内执行）：有实质文本（≥200 字）、有 canvas、或已 complete 且有子节点。 */
const JS_RENDER_READY = `(() => {
  try {
    const b = document.body
    if (!b) return 0
    const t = (b.innerText || '').trim().length
    const c = b.querySelectorAll('canvas').length
    if (t >= 200 || c > 0) return 1
    if (document.readyState === 'complete' && b.children.length > 3) return 1
    return 0
  } catch (e) { return 0 }
})()`

/** 单次就绪探测（页内求值失败视为未就绪）。 */
export async function isRenderReady(session: CdpSession): Promise<boolean> {
  try {
    const r = await session.evalJs<unknown>(JS_RENDER_READY)
    return r === 1 || r === true
  } catch { return false }
}

/**
 * 等高视口下的正文就绪并**取窗口内最长的一份**（主侧实测补强，2026-10-22，两轮修正）：
 *
 * 实测曲线（kdocs，切 2400 视口后每 500ms 采样）：
 *   1375 → 2654(0.5s) → 2654 → 2670(2.0s) → 2670 …（稳定到 9.5s）
 * 由此得出两条必须遵守的规则：
 *  ① 切视口后必须给**重排**时间（页面要把正文重新渲染进 DOM），立刻读会拿到旧内容；
 *  ② **不能用"连续两次长度相同"判定稳定**——渲染中途存在"平台期"（如停在 1750 两次），
 *     会被误判为稳定 → 真实抓取因此得到 1693 与 2423 两种结果（正文残缺）。
 *     正确做法：窗口内持续采样，**取最长的一份**（平台期之后往往还有跃升）。
 */
export async function waitForTextLongest(
  session: CdpSession,
  deadline: number,
  pollMs = 400,
  windowMs = 6000,
  initialDelayMs = 2500,
): Promise<string> {
  const delay = Math.min(initialDelayMs, Math.max(0, deadline - Date.now()))
  if (delay > 0) await sleep(delay)
  const stopAt = Math.min(deadline, Date.now() + windowMs)
  let best = ''
  for (;;) {
    try {
      const t = await session.evalJs<unknown>('document.body ? (document.body.innerText || "") : ""')
      if (typeof t === 'string' && t.length > best.length) best = t
    } catch { /* 页面尚未可求值 */ }
    if (Date.now() + pollMs >= stopAt) return best
    await sleep(Math.min(pollMs, Math.max(0, stopAt - Date.now())))
  }
}

/**
 * 渲染就绪轮询（§15.4 补充）：在**总预算内**等页面出现实质内容。
 * 重型 SPA（WebOffice 文档站实测约 9s 才出内容）若只等 renderSettleMs（默认 700ms），
 * 会取到空正文 + 无可滚容器 → 截图只剩 1 帧。此处每 500ms 轮询一次，
 * 直到就绪或预算耗尽；预算耗尽不额外失败（按现状继续，由上层判定）。
 */
export async function waitForRenderReady(session: CdpSession, deadline: number, pollMs = 500): Promise<boolean> {
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    if (await isRenderReady(session)) return true
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
  }
}

// ── ⑩-1 Edge 探测与启动（§15.4；路径一律正斜杠：TS 字符串里反斜杠是转义符，实测坑已固化）────────

/** Windows 默认安装路径（探测顺序即数组顺序）。 */
export const EDGE_PROBE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
] as const

/** 探测候选（有序）：Config.edgePath（非空即最优先）→ 两处 Program Files → %LOCALAPPDATA%。 */
export function edgeCandidatePaths(config: { edgePath?: string }): string[] {
  const candidates: string[] = []
  const configured = typeof config.edgePath === 'string' ? config.edgePath.trim() : ''
  if (configured !== '') candidates.push(configured)
  candidates.push(...EDGE_PROBE_PATHS)
  const localAppData = process.env.LOCALAPPDATA
  if (typeof localAppData === 'string' && localAppData.trim() !== '') {
    candidates.push(`${localAppData.replace(/\\/g, '/')}/Microsoft/Edge/Application/msedge.exe`)
  }
  return candidates
}

/** Edge 探测（§15.4）：候选中首个真实存在者；全不中 → null（非 Windows 自然为 null，§15.10）。 */
export function findEdgeExecutable(config: { edgePath?: string }): string | null {
  for (const candidate of edgeCandidatePaths(config)) {
    try {
      if (existsSync(candidate)) return candidate
    } catch { /* 单个候选探测异常 → 试下一个 */ }
  }
  return null
}

/** 随机空闲端口（先绑定探测再释放；仅 127.0.0.1 语义，进程退出即释放，§15.9）。 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      server.close(() => resolve(typeof addr === 'object' && addr !== null ? addr.port : 0))
    })
  })
}

export type EdgeLaunchOptions = { userDataDir: string; port: number; width: number; height: number; url: string }

/**
 * 启动参数（§15.4，实测坑固化为规范）：`--headless=new`（旧版 --headless 不暴露 CDP 端口）+
 * 稳定性开关 + 临时 user-data-dir + 随机调试端口 + 任意来源放行 + 视口尺寸；URL 恒为最后一个参数。
 * userDataDir 统一转正斜杠。
 */
export function buildEdgeArgs(opts: EdgeLaunchOptions): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--disable-background-networking',
    '--hide-scrollbars',
    `--user-data-dir=${opts.userDataDir.replace(/\\/g, '/')}`,
    `--remote-debugging-port=${opts.port}`,
    '--remote-allow-origins=*',
    `--window-size=${opts.width},${opts.height}`,
    opts.url,
  ]
}

export type EdgeHandle = {
  child: ChildProcess
  port: number
  userDataDir: string
  exe: string
  /** spawn 异步失败（如 ENOENT）记录于此，由 cdpConnect 轮询时显式失败 */
  launchError?: string
}

/** 启动无头 Edge（临时 profile + 随机端口）；只返回句柄，不等待 CDP 就绪（那是 cdpConnect 的事）。 */
export async function launchEdge(url: string, config: Config, viewport: { width: number; height: number }): Promise<EdgeHandle> {
  const exe = findEdgeExecutable(config)
  if (exe === null) throw new RenderError('E_NO_EDGE', '未找到 Microsoft Edge（Config.edgePath 未配置且默认路径均不存在）')
  const userDataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dsh-dsf-edge-'))
  const port = await pickFreePort()
  let child: ChildProcess
  try {
    child = spawn(exe, buildEdgeArgs({ userDataDir, port, width: viewport.width, height: viewport.height, url }), { stdio: 'ignore' })
  } catch (e) {
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* 清理失败留待系统 */ }
    throw new RenderError('E_RENDER_FAILED', `Edge 启动失败：${e instanceof Error ? e.message : String(e)}`)
  }
  const handle: EdgeHandle = { child, port, userDataDir, exe }
  child.once('error', (err) => { handle.launchError = err instanceof Error ? err.message : String(err) })
  return handle
}

// ── ⑩-2 CDP 客户端（§15.4：内置 fetch 轮询 + 全局 WebSocket；单命令受总预算约束）────────────────

/** WebSocket 结构化最小接口（Node ≥22 全局实现；不依赖 DOM lib / undici 类型声明）。 */
type WsLike = {
  send(data: string): void
  close(): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'error' | 'close', listener: () => void): void
}

function getWebSocketCtor(): new (url: string) => WsLike {
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket
  if (typeof ctor !== 'function') throw new RenderError('E_RENDER_FAILED', '运行时无全局 WebSocket（需 Node ≥ 22）')
  return ctor as new (url: string) => WsLike
}

export type CdpResponse = { result?: Record<string, unknown> }

export type CdpSession = {
  /** 发 CDP 命令（单命令受总预算约束；断开/超预算/协议错误 → RenderError）。 */
  send(method: string, params?: Record<string, unknown>): Promise<CdpResponse>
  /** Runtime.evaluate（returnByValue + awaitPromise；页面脚本异常 → RenderError）。 */
  evalJs<T>(expression: string): Promise<T>
  close(): void
}

/**
 * CDP 会话（§15.4）：轮询 /json/version（受总预算约束；Edge 提前退出即失败）→ /json/list 取 page target →
 * WS 连接 → Runtime/Page.enable → Emulation.setDeviceMetricsOverride（1x 缩放、非移动）。
 */
export async function cdpConnect(handle: EdgeHandle, opts: { width: number; height: number; deadline: number; url?: string }): Promise<CdpSession> {
  const base = `http://127.0.0.1:${handle.port}`
  let ready = false
  while (Date.now() < opts.deadline) {
    if (handle.launchError !== undefined) throw new RenderError('E_RENDER_FAILED', `Edge 启动失败：${handle.launchError}`)
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      throw new RenderError('E_RENDER_FAILED', `Edge 进程提前退出（exitCode=${handle.child.exitCode}），CDP 未能就绪`)
    }
    try {
      const res = await fetch(`${base}/json/version`)
      if (res.ok) { ready = true; break }
    } catch { /* 未就绪，继续轮询 */ }
    await sleep(250)
  }
  if (!ready) throw new RenderError('E_RENDER_TIMEOUT', `CDP 未在 renderTimeoutMs 预算内就绪（127.0.0.1:${handle.port}）`)

  let wsUrl: string | undefined
  let targetUrl: string | undefined
  try {
    const targets = await (await fetch(`${base}/json/list`)).json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
    // 审查 P2-11：优先按**目标 URL 匹配** page target（Edge 可能额外开出 about:blank 排在前），
    // 匹配不到则退而取第一个 page target（后续显式 Page.navigate 兜底）。
    const wantHost = (() => { try { return new URL(opts.url ?? '').host } catch { return '' } })()
    const matched = targets.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string'
      && wantHost !== '' && typeof t.url === 'string' && t.url.includes(wantHost))
    const fallbackTarget = targets.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
      ?? targets.find((t) => typeof t.webSocketDebuggerUrl === 'string')
    const picked = matched ?? fallbackTarget
    wsUrl = picked?.webSocketDebuggerUrl
    targetUrl = picked?.url
  } catch (e) {
    throw new RenderError('E_RENDER_FAILED', `CDP /json/list 获取失败：${e instanceof Error ? e.message : String(e)}`)
  }
  if (wsUrl === undefined) throw new RenderError('E_RENDER_FAILED', 'CDP /json/list 中未找到 page target')

  const WebSocketCtor = getWebSocketCtor()
  const ws = new WebSocketCtor(wsUrl)
  const pending = new Map<number, { resolve: (v: CdpResponse) => void; reject: (e: RenderError) => void; timer: ReturnType<typeof setTimeout> }>()
  let nextId = 0
  let closed = false
  const failAll = (err: RenderError): void => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err) }
    pending.clear()
  }
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } }
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error !== undefined) p.reject(new RenderError('E_RENDER_FAILED', `CDP 命令出错：${msg.error.message ?? '(无 message)'}`))
        else p.resolve(msg.result !== undefined ? { result: msg.result } : {})
      }
    } catch { /* 非 JSON 帧忽略 */ }
  })
  ws.addEventListener('error', () => { closed = true; failAll(new RenderError('E_RENDER_FAILED', 'CDP WebSocket 出错')) })
  ws.addEventListener('close', () => { closed = true; failAll(new RenderError('E_RENDER_FAILED', 'CDP WebSocket 断开')) })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RenderError('E_RENDER_TIMEOUT', 'CDP WebSocket 连接超预算')), Math.max(1, opts.deadline - Date.now()))
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new RenderError('E_RENDER_FAILED', 'CDP WebSocket 连接失败')) })
  })

  const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> => new Promise((resolve, reject) => {
    if (closed) { reject(new RenderError('E_RENDER_FAILED', `CDP 已断开（${method}）`)); return }
    const remaining = opts.deadline - Date.now()
    if (remaining <= 0) { reject(new RenderError('E_RENDER_TIMEOUT', `CDP 命令超预算：${method}`)); return }
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new RenderError('E_RENDER_TIMEOUT', `CDP 命令超预算：${method}`)) }, remaining)
    pending.set(id, { resolve, reject, timer })
    try {
      ws.send(JSON.stringify({ id, method, params }))
    } catch (e) {
      pending.delete(id)
      clearTimeout(timer)
      reject(new RenderError('E_RENDER_FAILED', `CDP 发送失败（${method}）：${e instanceof Error ? e.message : String(e)}`))
    }
  })

  const evalJs = async <T,>(expression: string): Promise<T> => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    const result = res.result as { exceptionDetails?: { text?: string }; result?: { value?: unknown } } | undefined
    if (result !== undefined && result.exceptionDetails !== undefined) {
      throw new RenderError('E_RENDER_FAILED', `页面脚本执行失败：${result.exceptionDetails.text ?? ''}（${expression.slice(0, 48)}…）`)
    }
    return (result?.result?.value ?? null) as T
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false })

  return {
    send,
    evalJs,
    close: () => {
      closed = true
      try { ws.close() } catch { /* 已断开 */ }
      failAll(new RenderError('E_RENDER_FAILED', 'CDP 会话已关闭'))
    },
  }
}

/**
 * 资源回收（§15.9）：WS close → 只 kill 自己 spawn 的 child（绝不按进程名批量杀 Edge——会误杀用户浏览器）→
 * 删临时 profile（rmSync 重试；删不掉留待系统清理，不阻塞、不抛出——R-23）。
 */
export async function closeAll(handle: EdgeHandle | null, session?: CdpSession | null): Promise<void> {
  try { session?.close() } catch { /* 已断开 */ }
  if (handle === null) return
  try { handle.child.kill() } catch { /* 已退出 */ }
  await sleep(1000) // 等 Edge 释放 profile 文件锁（原型实测需 ~1s，配合下方 rmSync 重试）
  try {
    rmSync(handle.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch { /* 文件仍被占用 → 残留目录留待系统/人工清理（R-23） */ }
}

// ── ⑩-3 画面探测（canvas 占比 = 择源判据①）与渲染正文（§15.3/§15.4/§15.6）──────────────────

/** canvas 面积占比择源阈值（§15.3 判据①：WebOffice/图表类正文）。 */
export const CANVAS_RATIO_THRESHOLD = 0.3

/** 纯函数：所有 canvas 的（面积/视口面积）最大值（assert-render 以假元素集驱动本函数）。 */
export function measureCanvasRatio(
  canvases: Array<{ width: number; height: number }>,
  viewport: { width: number; height: number },
): number {
  const viewportArea = viewport.width * viewport.height
  if (viewportArea <= 0 || canvases.length === 0) return 0
  let maxArea = 0
  for (const c of canvases) {
    const area = Math.max(0, c.width) * Math.max(0, c.height)
    if (area > maxArea) maxArea = area
  }
  return maxArea / viewportArea
}

/** 页内 canvas 尺寸采集（evalJs 用；viewport 取页面实报值，异常时由 TS 侧回退配置视口）。 */
const JS_MEASURE_CANVAS = `(() => {
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const canvases = [];
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    canvases.push({ width: Math.round(r.width), height: Math.round(r.height) });
  }
  return { viewport: { width: vw, height: vh }, canvases };
})()`

/** 渲染 DOM 的 canvas 占比探测；失败返回 null（= 未知，不命中判据①，不因此失败）。 */
async function probeCanvasRatio(session: CdpSession, fallbackViewport: { width: number; height: number }): Promise<number | null> {
  try {
    const info = await session.evalJs<{ viewport?: { width?: unknown; height?: unknown }; canvases?: unknown }>(JS_MEASURE_CANVAS)
    const width = typeof info?.viewport?.width === 'number' ? info.viewport.width : fallbackViewport.width
    const height = typeof info?.viewport?.height === 'number' ? info.viewport.height : fallbackViewport.height
    const rects = Array.isArray(info?.canvases)
      ? (info.canvases as unknown[]).filter((c): c is { width?: unknown; height?: unknown } => c !== null && typeof c === 'object')
        .map((c) => ({ width: typeof c.width === 'number' ? c.width : 0, height: typeof c.height === 'number' ? c.height : 0 }))
      : []
    return measureCanvasRatio(rects, { width, height })
  } catch {
    return null
  }
}

/** 渲染正文（§15.4）：document.body.innerText。 */
export async function readInnerText(session: CdpSession): Promise<string> {
  const text = await session.evalJs<unknown>('(() => { try { return document.body ? (document.body.innerText || "") : "" } catch (e) { return "" } })()')
  return typeof text === 'string' ? text : ''
}

// ── ⑩-4 滚动定位与分屏截图（§15.5；原型 proto-shots.mjs 移植为可单测纯函数 + CDP 驱动循环）────

export type ScrollCandidate = { width: number; height: number; scrollHeight: number; clientHeight: number }

/**
 * 选滚动容器（纯函数）：`scrollHeight > clientHeight + 50 && clientHeight > 200` 的元素里取**面积最大**者，
 * 返回其下标；全不中 → null（调用方退化为 window.scrollBy）。WebOffice 正文容器不是 documentElement（实测）。
 */
export function pickScrollingElement(candidates: ScrollCandidate[]): number | null {
  let best: number | null = null
  let bestArea = 0
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (c.scrollHeight > c.clientHeight + 50 && c.clientHeight > 200) {
      const area = c.width * c.height
      if (area > bestArea) { bestArea = area; best = i }
    }
  }
  return best
}

/** 页内采集候选（evalJs 用）：按面积降序取前 64 个（防超大 DOM 把返回 payload 撑爆），引用挂 window 供滚动复用。 */
const JS_COLLECT_SCROLL_CANDIDATES = `(() => {
  const all = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
      const r = el.getBoundingClientRect();
      all.push({ el: el, w: Math.round(r.width), h: Math.round(r.height), sh: el.scrollHeight, ch: el.clientHeight });
    }
  }
  all.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
  const top = all.slice(0, 64);
  window.__dshScrollEls = top.map(function (x) { return x.el; });
  return top.map(function (x) { return { width: x.w, height: x.h, scrollHeight: x.sh, clientHeight: x.ch }; });
})()`

/** 窗口退化滚动（无合格容器时）：window.scrollBy + 文档级进度。 */
export function windowScrollExpr(dy: number): string {
  return `(() => {
  window.scrollBy(0, ${dy});
  const de = document.documentElement;
  return { mode: 'window', y: window.scrollY, sh: de.scrollHeight, ch: window.innerHeight };
})()`
}

/** 容器滚动：优先用采集阶段缓存的引用（下标），引用丢失时按同规则现找面积最大者兜底。 */
export function elementScrollExpr(index: number, dy: number): string {
  return `(() => {
  const els = window.__dshScrollEls || [];
  let el = els[${index}] || null;
  if (!el) {
    let best = null; let bestArea = 0;
    for (const e of document.querySelectorAll('*')) {
      if (e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 200) {
        const r = e.getBoundingClientRect(); const a = r.width * r.height;
        if (a > bestArea) { bestArea = a; best = e; }
      }
    }
    el = best;
  }
  if (!el) {
    window.scrollBy(0, ${dy});
    const de = document.documentElement;
    return { mode: 'window', y: window.scrollY, sh: de.scrollHeight, ch: window.innerHeight };
  }
  el.scrollTop = el.scrollTop + ${dy};
  return { mode: 'element', y: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight };
})()`
}

export type ScrollInfo = { mode: 'window' | 'element'; y: number; sh: number; ch: number }

/** 滚动步长 = 视口高 − overlap（§15.5：默认重叠 60 防漏行；下限 1 防零/负步长死循环）。 */
export function scrollStep(viewportHeight: number, overlap: number): number {
  return Math.max(1, viewportHeight - overlap)
}

/** 到底判定：scrollTop + clientHeight ≥ scrollHeight − 5（容器与窗口同式，§15.5）。 */
export function reachedBottom(y: number, clientHeight: number, scrollHeight: number): boolean {
  return y + clientHeight >= scrollHeight - 5
}

/** 截图文件名：两位序号（01.png…；超 99 时自然进位三位）。 */
export function shotFileName(seq: number): string {
  return `${String(seq).padStart(2, '0')}.png`
}

/** sha1 去重（纯函数）：与上一**保留**帧相同 → 丢弃（实测重复帧 4 张；连投三张相同只丢后两张）。 */
export function isDuplicateShot(prevSha1: string | null, sha1: string): boolean {
  return prevSha1 !== null && prevSha1 === sha1
}

// ── ⑩-4b 感知哈希去重（P3/FR-14：sha1 快路径 → dHash64 预筛 → 32×32 灰度 MAD 复核；Design §16.4）──
// 移植自已实测原型 workorders/proto-phash.mjs（45 张真实截图解码 1.4s；真近重复对 MAD=0.954、
// 相似幻灯片对 MAD≥2.791 → 阈值 1.5 有约 1.8 倍分离度；dHash 单独用会把"深蓝横幅"与"空白屏"并组
// → 必须叠加 MAD 复核）。仅用 Node 内置 zlib，零新依赖。

/** PNG 解码不支持项（隔行 / 非 8-bit / 未知 colorType / 签名不符 / 数据截断）——上层回退 sha1 精确去重。 */
export class PngUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PngUnsupportedError'
  }
}

/** 解码结果：8-bit 非隔行、colorType 0/2/4/6 的逐像素数据（行滤波已还原）。 */
export type DecodedPng = { width: number; height: number; channels: number; pixels: Buffer }

/**
 * PNG 解码（纯函数，原型 decodePng 移植）：解析 IHDR/IDAT → `zlib.inflateSync` → 逐行反滤波
 * （None/Sub/Up/Average/Paeth 五种）。**只支持 8-bit 非隔行、colorType 0/2/4/6**；隔行、位深≠8、
 * 未知 colorType、签名不符、数据截断 → 抛 `PngUnsupportedError`（绝不静默返回错数据——宁可在
 * 上层回退 sha1，也不让坏像素污染感知哈希）。
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new PngUnsupportedError('签名不符：非 PNG 字节流')
  }
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let sawIhdr = false
  const idat: Buffer[] = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    if (off + 12 + len > buf.length) throw new PngUnsupportedError(`PNG 数据截断（${type} 声明 ${len}B 超出缓冲）`)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      // 审查 P2-3：IHDR 声明长度 < 13 时下面的 readUInt32BE 会越界抛 RangeError（非 PngUnsupportedError）
      if (len < 13) throw new PngUnsupportedError(`IHDR 长度不足 13（${len}）`)
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
      sawIhdr = true
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (!sawIhdr) throw new PngUnsupportedError('缺少 IHDR 块')
  if (bitDepth !== 8) throw new PngUnsupportedError(`不支持位深 ${bitDepth}（仅 8-bit）`)
  if (interlace !== 0) throw new PngUnsupportedError('不支持隔行 PNG（interlace≠0）')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (channels === 0) throw new PngUnsupportedError(`不支持颜色类型 ${colorType}（仅 0/2/4/6）`)
  if (width <= 0 || height <= 0) throw new PngUnsupportedError(`尺寸非法（${width}×${height}）`)
  // 审查 P2-3：无 IDAT / 空 IDAT 时 inflateSync 抛的是普通 Error → 统一为 PngUnsupportedError
  if (idat.length === 0) throw new PngUnsupportedError('缺少 IDAT 像素数据块')
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const expected = (stride + 1) * height
  if (raw.length < expected) throw new PngUnsupportedError(`像素数据不足（inflate 得 ${raw.length}B < 需 ${expected}B）`)
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos]
    const line = raw.subarray(pos + 1, pos + 1 + stride)
    pos += 1 + stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev !== null ? prev[x] : 0
      const c = prev !== null && x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      } else if (filter !== 0) throw new PngUnsupportedError(`未知行滤波 ${filter}（第 ${y} 行）`)
      cur[x] = v & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

/** dHash（原型 dHash 移植）：9×8 灰度网格相邻差分 → 64bit BigInt。 */
export function dHash64(img: DecodedPng): bigint {
  const { width, height, channels, pixels } = img
  const gray = new Float64Array(9 * 8)
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 9; gx++) {
      const x = Math.min(width - 1, Math.floor((gx * width) / 9))
      const y = Math.min(height - 1, Math.floor((gy * height) / 8))
      const i = (y * width + x) * channels
      let r = pixels[i]
      let g = pixels[i]
      let b = pixels[i]
      if (channels >= 3) { r = pixels[i]; g = pixels[i + 1]; b = pixels[i + 2] }
      gray[gy * 9 + gx] = 0.299 * r + 0.587 * g + 0.114 * b
    }
  }
  let bits = ''
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) bits += gray[gy * 9 + gx] > gray[gy * 9 + gx + 1] ? '1' : '0'
  }
  return BigInt('0b' + bits)
}

/** 32×32 灰度降采样（原型 madHash32 移植；像素级 MAD 复核用——区分"同内容"与"版式相似"）。 */
export function gray32(img: DecodedPng): Float64Array {
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

/** 64bit 汉明距离（原型 hamming 移植：BigInt 逐位计数）。 */
export function hammingBig(a: bigint, b: bigint): number {
  let x = a ^ b
  let c = 0
  while (x) { c += Number(x & 1n); x >>= 1n }
  return c
}

/** 平均绝对差（原型 mad 移植；0–255 灰度尺度）。 */
export function meanAbsDiff(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

/** 逐格最大绝对差（审查 P1-1 修正）：均值 MAD 会被**小面积但高对比**的变化稀释
 * （实测 1440×900 仅 30×30px 变黑 → 均值 MAD=0.249，远低于阈值 1.5，会被误判为重复而**丢真内容**）。
 * 因此叠加"任一格差异过大即否决判重"，把安全侧从"平均相似"收紧为"没有任何一块明显不同"。 */
export function maxCellDiff(a: Float64Array, b: Float64Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > m) m = d
  }
  return m
}

/** 灰度标准差（识别"近纯色帧"：此类帧 dHash 无梯度、均值 MAD 也无分辨力）。 */
export function grayStdDev(g: Float64Array): number {
  if (g.length === 0) return 0
  let s = 0
  for (let i = 0; i < g.length; i++) s += g[i]
  const mean = s / g.length
  let v = 0
  for (let i = 0; i < g.length; i++) v += (g[i] - mean) ** 2
  return Math.sqrt(v / g.length)
}

/** 近重复判定阈值（Design §16.4 实测 + 审查 P1-1 加固；内部常量，不进 Config）。 */
export const PHASH_MAX_HAMMING = 2
export const PHASH_MAX_MAD = 1.5
/** 逐格否决阈值：32×32 网格中任一格灰度差 > 该值 → 一律不判重（宁多留帧）。 */
export const PHASH_MAX_CELL_DIFF = 24
/** 近纯色帧门槛：灰度标准差低于该值 → 感知判定不可靠，仅认 sha1 完全相同。 */
export const PHASH_UNIFORM_STDDEV = 3

/** 去重方法标签：正常 = 感知哈希两级；解码失败回退 = 仅 sha1 精确比较。 */
export type DedupMethod = 'sha1+phash' | 'sha1(fallback)' | 'none'

/** 单帧指纹：sha1 恒在；感知部分（dhash/gray）在 PNG 解码失败时为 null（回退 sha1 语义）。 */
export type FrameFingerprint = { sha1: string; dhash: bigint | null; gray: Float64Array | null }

/** 帧指纹（纯函数）：sha1 + dHash64 + gray32；任何解码异常 → dhash/gray 置 null，不抛。 */
export function fingerprintFrame(data: Buffer): FrameFingerprint {
  const sha1 = createHash('sha1').update(data).digest('hex')
  try {
    const img = decodePng(data)
    return { sha1, dhash: dHash64(img), gray: gray32(img) }
  } catch {
    return { sha1, dhash: null, gray: null }
  }
}

/**
 * 近重复判定（两级，命中即停；**安全优先——宁可漏删不可误删**，Design §16.4）：
 * ① prev=null → false（首帧必留）；② sha1 相同 → true（快路径，与 P2 行为一致）；
 * ③ 任一 dhash/gray 为 null → **false**（解码失败回退"仅 sha1 精确比较"语义，绝不凭空猜）；
 * ④ 汉明 ≤ PHASH_MAX_HAMMING 且 MAD ≤ PHASH_MAX_MAD → true。
 */
export function isNearDuplicate(prev: FrameFingerprint | null, cur: FrameFingerprint): boolean {
  if (prev === null) return false
  if (prev.sha1 === cur.sha1) return true // 快路径：字节完全相同
  if (prev.dhash === null || prev.gray === null || cur.dhash === null || cur.gray === null) return false
  // 审查 P1-1 加固 ①：近纯色帧（空白画布/纯色块）的 dHash 无梯度、均值 MAD 也无分辨力
  //   → 感知判定不可靠，只认 sha1 完全相同（已在上面处理），此处一律不判重。
  if (grayStdDev(prev.gray) < PHASH_UNIFORM_STDDEV || grayStdDev(cur.gray) < PHASH_UNIFORM_STDDEV) return false
  // 审查 P1-1 加固 ②：逐格否决 —— 任一块明显不同即视为内容变化（防"小面积高对比"被均值稀释）。
  if (maxCellDiff(prev.gray, cur.gray) > PHASH_MAX_CELL_DIFF) return false
  return hammingBig(prev.dhash, cur.dhash) <= PHASH_MAX_HAMMING && meanAbsDiff(prev.gray, cur.gray) <= PHASH_MAX_MAD
}

export type CapturedShot = { file: string; bytes: number; sha1: string; data: Buffer }
export type CaptureEndReason = 'bottom' | 'max_shots' | 'timeout' | 'stagnant' | 'failed'
export type CaptureOutcome = {
  shots: CapturedShot[]
  endReason: CaptureEndReason
  scrollMode: 'element' | 'window'
  /** 被判近重复（sha1 相同或感知命中）而丢弃的帧数（P3/FR-14） */
  deduped: number
  /** 任一保留帧 PNG 解码失败 → 去重退化为仅 sha1（返回/manifest 标注 sha1(fallback)） */
  dedupFallback: boolean
  /** 本次渲染累计剥离的覆盖型浮层元素数（P5/FR-15；stripOverlays 关闭时恒 0） */
  overlaysStripped: number
  /** endReason='failed' 时的原因 */
  error?: string
}
export type CaptureOptions = {
  maxShots: number
  settleMs: number
  overlap: number
  viewportH: number
  deadline: number
  /** 每屏截图前剥离覆盖型浮层（P5/FR-15）；缺省/false = 一次都不调用（由 executeRender 显式传 Config.renderStripOverlays） */
  stripOverlays?: boolean
}

/**
 * 分屏截图循环（§15.5）：截当前屏 → 帧指纹近重复去重（P3/FR-14：sha1 快路径 + 感知哈希两级，
 * 比较对象恒为**上一张保留帧**）→ 滚一步（步长 = 视口高 − overlap）→ 等 settleMs →
 * 每屏截图前按 opts.stripOverlays 剥离覆盖型浮层并累计 overlaysStripped（P5/FR-15，缺省 false 不调用）→
 * 到底 / 达 max_shots / 超预算 / 停滞（连续两次滚动位置不变）即止。不写盘（Buffer 留内存，由
 * writeMaterialBundle 统一落盘）——超预算/中途失败时已截帧得以保留（§15.8 partial）。
 * 解码失败（保留帧 dhash=null）时后续比较退化为仅 sha1，dedupFallback=true（上层标注 fallback）。
 */
/**
 * 判定"存在正文级可滚动容器"：某候选的 scrollHeight ≥ 3×clientHeight（可滚动比例 ≥3）。
 * 轮廓面板等侧栏通常只有 ~2×，文档正文实测 56×（kdocs：38591/687）→ 可据此把"正文容器"与"侧栏"分开。
 */
export function hasSubstantialScroll(candidates: ScrollCandidate[]): boolean {
  return candidates.some((c) => c.scrollHeight >= c.clientHeight * 3)
}

/** 采集一次可滚动候选（失败返回空数组）。 */
export async function collectScrollCandidates(session: CdpSession): Promise<ScrollCandidate[]> {
  try {
    const collected = await session.evalJs<unknown>(JS_COLLECT_SCROLL_CANDIDATES)
    if (Array.isArray(collected)) return collected as ScrollCandidate[]
  } catch { /* 页面尚未可求值 */ }
  return []
}

/**
 * 等待"正文级"可滚动容器出现。
 *
 * 审查 P1-1 修正：此前本函数**独占总预算**（轮询到 `deadline`），导致
 *  ① 普通页面（可滚内容 < 3 屏）空等满 `renderTimeoutMs`；② 截图阶段拿到的是**已耗尽的** deadline → **0 张截图**。
 * 现改为：
 *  - 找到 substantial 容器（`scrollHeight ≥ 3×clientHeight`）→ 立即返回（文档站场景，约 9s 建好）；
 *  - **一个候选都没有** → 立即返回（短页本就没有可滚容器，不必等）；
 *  - 页面**已就绪**（有实质内容）但无 substantial 容器 → 立即返回（内容不足 3 屏的普通页）；
 *  - 其余情况最多等 `subBudgetMs`（默认 15s，**不占用总预算**），到点用现状继续。
 */
export async function waitForScrollableContent(
  session: CdpSession,
  deadline: number,
  pollMs = 500,
  subBudgetMs = 15000,
): Promise<ScrollCandidate[]> {
  const subDeadline = Math.min(deadline, Date.now() + subBudgetMs)
  let last: ScrollCandidate[] = []
  for (;;) {
    last = await collectScrollCandidates(session)
    if (hasSubstantialScroll(last)) return last
    if (last.length === 0) return last
    if (await isRenderReady(session)) return last // 页面已就绪但内容不足 3 屏 → 短页，立即继续
    if (Date.now() + pollMs >= subDeadline) return last
    await sleep(Math.min(pollMs, Math.max(0, subDeadline - Date.now())))
  }
}

// ── ⑩-4c 覆盖型浮层剥离器（P5/FR-15 · Design §17.2；移植自已实测原型 workorders/probe-p4-strip.mjs）──
// 真因（evidence/p4-rootcause-probe.md）：页面自己的动态覆盖层（WPS「快捷登录并查看」登录浮层）每帧
// 像素都在变，把帧间差异分布整个抹平，使 P3 的安全去重阈值（maxCell≤24 且 MAD≤1.5）失去分辨力。
// 本批不改任何去重阈值，改为在渲染期剥离覆盖层；原型实测（真实 kdocs 页面）命中 4 个元素且页面不
// 重建浮层 → 剥一次长期有效（若重建则下一屏再剥，幂等）。

/** 剥离约束②门槛：getBoundingClientRect 面积 ≥ 视口面积 × 该比例才视为"覆盖型"（导出常量，防恒绿抽检点）。 */
export const STRIP_MIN_VIEWPORT_COVERAGE = 0.85

/** 剥离约束③门槛：元素自身文本量不超过该字数才视为"非正文"（导出常量，防恒绿抽检点）。 */
export const STRIP_MAX_TEXT_LENGTH = 300

/**
 * 覆盖型浮层剥离启发式（FR-15 / Design §17.2）：四重约束，缺一不剥——
 * ① class 含 popup|modal|mask|overlay|dialog|guide（忽略大小写）；
 * ② getBoundingClientRect 面积 ≥ 视口面积 × STRIP_MIN_VIEWPORT_COVERAGE；
 * ③ 元素自身文本量 > STRIP_MAX_TEXT_LENGTH 则不剥（正文容器保护）；
 * ④ 标签为 CANVAS / IFRAME 则不剥（正文渲染载体，不得移除）。
 * 两个阈值以**导出常量插值**进表达式（模板字符串，非内嵌魔法数字）：主侧防恒绿抽检把
 * STRIP_MIN_VIEWPORT_COVERAGE 改为 0.0 必须导致 assert-strip 失败（小面积浮层会被误剥）。
 */
export const STRIP_OVERLAYS_JS = `(() => {
  let removed = 0
  const vw = window.innerWidth, vh = window.innerHeight
  const area = vw * vh
  if (!(area > 0)) return 0
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cls = (typeof el.className === 'string' ? el.className : '')
    if (!/popup|modal|mask|overlay|dialog|guide/i.test(cls)) continue
    const t = (el.textContent || '').trim()
    if (t.length >= ${STRIP_MAX_TEXT_LENGTH}) continue
    if (el.tagName === 'CANVAS' || el.tagName === 'IFRAME') continue
    const pos = getComputedStyle(el).position
    if (pos !== 'fixed' && pos !== 'absolute' && pos !== 'sticky') continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height < area * ${STRIP_MIN_VIEWPORT_COVERAGE}) continue
    el.remove(); removed++
  }
  return removed
})()`

/** 剥离覆盖型浮层，返回本次剥离的元素数；求值异常与非数值结果一律吞掉并返回 0（Design §17.2：绝不中断渲染通道）。 */
export async function stripOverlays(session: CdpSession): Promise<number> {
  try {
    const n = await session.evalJs<number>(STRIP_OVERLAYS_JS)
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0
  } catch { return 0 }
}

export async function captureShots(session: CdpSession, opts: CaptureOptions): Promise<CaptureOutcome> {
  const step = scrollStep(opts.viewportH, opts.overlap)
  let candidates: ScrollCandidate[] = []
  try {
    // 等"正文容器"真的出现：文档站（WebOffice）要数秒才建好可滚动正文容器，
    // 早采会只拿到轮廓面板（scrollHeight≈2×clientHeight）→ 滚了轮廓、正文永远不出现。
    const ready = await waitForScrollableContent(session, opts.deadline)
    if (ready !== null) candidates = ready
  } catch { /* 候选采集失败 → 退化为窗口滚动 */ }
  let pick = pickScrollingElement(candidates)
  const shots: CapturedShot[] = []
  let prev: FrameFingerprint | null = null
  let deduped = 0
  let dedupFallback = false
  let overlaysStripped = 0
  let lastY: number | null = null
  let seq = 0
  let repickStalls = 0
  let endReason: CaptureEndReason = 'max_shots'
  let error: string | undefined

  for (let i = 0; i < opts.maxShots; i++) {
    // 审查 P1-1：预算已耗尽时也要保证**至少 1 屏**（此前直接 break → 普通页面"有 md 无 PNG"）
    if (i > 0 && Date.now() >= opts.deadline) { endReason = 'timeout'; break }
    // P5/FR-15（Design §17.2）：每屏截图前剥离一次覆盖型浮层（幂等：页面不重建浮层 → 剥一次长期有效，
    // 重建则下一屏再剥）。opts.stripOverlays 非 true 时一次都不调用（A7：关闭即 v0.4.0 行为）。
    if (opts.stripOverlays === true) {
      const stripped = await stripOverlays(session)
      if (stripped > 0) {
        overlaysStripped += stripped
        // 审查 P1-1：剥离改变了 DOM —— 先前选中的滚动容器可能**本身已被移除**（或它的祖先被移除）。
        //   脱挂节点的 scrollTop / scrollHeight / clientHeight 恒为 0 → reachedBottom 恒真 →
        //   静默只出 1 张截图，且 endReason='bottom' 不计 partial、无任何异常信号。
        //   故剥离成功后立即重新采集候选 + 重选容器 + 重置进度基准（lastY / repickStalls）。
        try {
          candidates = await collectScrollCandidates(session)
          pick = pickScrollingElement(candidates)
        } catch { /* 采集失败 → 退化为窗口滚动 */ }
        lastY = null
        repickStalls = 0
      }
    }
    let b64: string
    try {
      const res = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const data = (res.result as { data?: unknown } | undefined)?.data
      if (typeof data !== 'string' || data === '') throw new Error('无 base64 数据')
      b64 = data
    } catch (e) {
      endReason = 'failed'
      error = `截图失败（第 ${i + 1} 屏）：${e instanceof RenderError ? e.message : e instanceof Error ? e.message : String(e)}`
      break
    }
    const buf = Buffer.from(b64, 'base64')
    const cur = fingerprintFrame(buf)
    if (isNearDuplicate(prev, cur)) {
      deduped += 1 // sha1 相同或感知命中 → 丢弃（prev 不前移：仍与上一张保留帧比较）
    } else {
      seq += 1
      shots.push({ file: shotFileName(seq), bytes: buf.length, sha1: cur.sha1, data: buf })
      if (cur.dhash === null) dedupFallback = true // 该帧无法感知哈希 → 此后比较退化为仅 sha1
      prev = cur
    }
    if (i === opts.maxShots - 1) break // 最后一屏后不再滚动
    try {
      const info = await session.evalJs<ScrollInfo>(pick === null ? windowScrollExpr(step) : elementScrollExpr(pick, step))
      if (Date.now() + opts.settleMs >= opts.deadline) { endReason = 'timeout'; break }
      if (opts.settleMs > 0) await sleep(opts.settleMs)
      if (info === null || typeof info !== 'object') throw new Error('滚动表达式无返回')
      if (reachedBottom(info.y, info.ch, info.sh)) {
        // 触底：可能选错了容器（正文容器比轮廓面板晚出现）→ 重新采集一次。
        // 审查 P2-5：比较"当前容器 vs 新最优容器"的 **scrollHeight**（不按下标跨数组比较），
        // 且连续无进展即熔断（避免反复重截同帧烧光 max_shots）。
        const reCollected = await collectScrollCandidates(session)
        const rePick = pickScrollingElement(reCollected)
        const currentHeight = pick !== null ? candidates[pick]?.scrollHeight ?? 0 : 0
        const nextHeight = rePick !== null ? reCollected[rePick]!.scrollHeight : 0
        if (rePick !== null && nextHeight > currentHeight + 50) {
          candidates = reCollected
          pick = rePick
          lastY = null
          repickStalls = 0
          continue
        }
        if (repickStalls >= 2) { endReason = 'stagnant'; break } // 连续两次重选无进展 → 熔断
        repickStalls += 1
        endReason = 'bottom'
        break
      }
      if (lastY === info.y) { endReason = 'stagnant'; break } // 滚不动了（防同帧循环烧满 max_shots）
      lastY = info.y
    } catch (e) {
      endReason = 'failed'
      error = `滚动失败（第 ${i + 1} 屏后）：${e instanceof RenderError ? e.message : e instanceof Error ? e.message : String(e)}`
      break
    }
  }
  return {
    shots,
    endReason,
    scrollMode: pick === null ? 'window' : 'element',
    deduped,
    dedupFallback,
    overlaysStripped,
    ...(error !== undefined ? { error } : {}),
  }
}

// ── ⑩-5 择源器（§15.3：api / render / auto 三模式 + auto 三判据 + 降级而非失败）────────────────

export type TextSourceName = 'api' | 'render' | 'api(fallback)'

/** 编辑器 UI 噪声标记（§15.3 判据②；子串命中即算——API 正文混入这些浮层文案说明抓到的是编辑器壳）。 */
export const EDITOR_NOISE_MARKERS = [
  '表情与角色',
  '顶部工具栏已关闭',
  '快捷登录并查看',
  '仅查看',
  '立即登录',
  '点赞',
  '留言',
  '发送',
] as const

export function hitsEditorNoise(text: string): boolean {
  return EDITOR_NOISE_MARKERS.some((marker) => text.includes(marker))
}

export type SourceDecision = { source: TextSourceName; warning?: string } | { error: 'E_NO_EDGE' }

/**
 * 择源（纯函数，§15.3）：
 * - `api`：只用 API 文字（调用方不启动 Edge）；
 * - `render`：无 Edge → E_NO_EDGE（唯一显式失败路径）；
 * - `auto`：Edge 不可用 → 降级 `api(fallback)` + warning；否则命中任一判据即用渲染 innerText——
 *   ① canvasRatio ≥ 0.3；② API 文字命中编辑器 UI 噪声标记；③ API 文字为空或长度 < 200。
 */
export function decideTextSource(input: {
  text_source: string
  apiText: string
  canvasRatio: number | null
  edgeAvailable: boolean
}): SourceDecision {
  if (input.text_source === 'api') return { source: 'api' }
  if (input.text_source === 'render') {
    return input.edgeAvailable ? { source: 'render' } : { error: 'E_NO_EDGE' }
  }
  // auto
  if (!input.edgeAvailable) {
    return { source: 'api(fallback)', warning: '未找到 Microsoft Edge，渲染通道不可用：已降级为 API 文字（无页面截图）' }
  }
  if (input.canvasRatio !== null && input.canvasRatio >= CANVAS_RATIO_THRESHOLD) return { source: 'render' }
  if (hitsEditorNoise(input.apiText)) return { source: 'render' }
  if (input.apiText.trim().length < 200) return { source: 'render' }
  return { source: 'api' }
}

// ── ⑩-6 渲染文字清洗（§15.6；原型 kdocs-clean.mjs 移植：UI 行黑名单 + 重复页眉 + 连续重复块）──

/** 整行精确匹配的编辑器 UI / 浮层标签（与 EDITOR_NOISE_MARKERS 同源 + 原型实测的通用 UI 词）。 */
const RENDER_UI_LINES = new Set([
  '仅查看', '分享', '立即登录', '插入', '目录', '要点', '正文', '点赞', '留言', '发送',
  '100%', '快捷登录并查看', '已登录 WPS 客户端', '用 WPS 打开文档', '其他登录方式',
  '创建', '更新', 'AI 总结',
])

/**
 * 渲染 innerText 清洗（纯函数，**只删行不改字**）：整行 UI 标签剔除 → 重复页眉（同一非空长行出现 ≥3 次，
 * 各页顶部页眉，只留首次）→ 折叠相邻重复行与连续空行 → 去尾部空行；BOM/零宽字符剔除。
 * 短行（<6 字）不参与页眉判定，避免误伤正文短句。
 */
export function cleanRenderedText(text: string): string {
  const counts = new Map<string, number>()
  for (const raw of text.split('\n')) {
    const t = raw.replace(/\uFEFF/g, '').trim()
    if (t !== '' && t.length >= 6) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const kept = new Set<string>()
  const stage1: string[] = []
  for (const raw of text.split('\n')) {
    const t = raw.replace(/\uFEFF/g, '').trim()
    if (t === '') { stage1.push(''); continue }
    if (RENDER_UI_LINES.has(t)) continue // 编辑器 UI 行
    const count = counts.get(t) ?? 0
    if (count >= 3) {
      if (kept.has(t)) continue // 重复页眉：只留首次
      kept.add(t)
    }
    stage1.push(raw.trimEnd())
  }
  const stage2: string[] = [] // 折叠相邻重复行（推广段等成对出现）
  for (const line of stage1) {
    if (line === stage2[stage2.length - 1]) continue
    stage2.push(line)
  }
  const stage3: string[] = [] // 连续空行压一
  for (const line of stage2) {
    if (line === '' && stage3[stage3.length - 1] === '') continue
    stage3.push(line)
  }
  while (stage3.length > 0 && stage3[stage3.length - 1] === '') stage3.pop()
  return stage3.join('\n')
}

// ── ⑩-7 素材包（§15.6：md + shots/ + manifest.json；merge_hint 固定文案，形态 A）──────────────

/** 合并指引（固定文案，§15.6）：图文合并是 agent 侧行为，插件不调任何视觉 API。 */
export const MERGE_HINT = '读取 `shots_dir` 下的 PNG，用模型自带视觉能力把图内内容转成文字，按顺序插入 `text_path` 对应位置，形成图文合并终稿'

export type ManifestShot = { file: string; bytes: number }

export type MaterialManifest = {
  url: string
  title: string
  text_source: TextSourceName
  text_chars: number
  shots_total: number
  shots: ManifestShot[]
  captured_at: string
  merge_hint: string
  /** 实际生效的每屏等待 ms（args.render_settle_ms ?? Config.renderSettleMs；P3/FR-13 回显） */
  render_settle_ms?: number
  /** 实际生效的渲染总预算 ms（预算联动后；P3/FR-13 回显） */
  render_timeout_ms?: number
  /** 被近重复判定丢弃的截图帧数（P3/FR-14） */
  shots_deduped?: number
  /** 去重方法：sha1+phash（正常）/ sha1(fallback)（感知解码失败回退） */
  dedup_method?: DedupMethod
  /** 本次渲染累计剥离的覆盖型浮层元素数（P5/FR-15；仅截图通道跑过的路径出现，0 = 没剥到任何覆盖层） */
  overlays_stripped?: number
  /** 渲染提前终止（timeout/failed）时标注（§15.8） */
  partial?: boolean
  end_reason?: string
  warning?: string
}

/** manifest 构造（纯函数；assert-arbiter ⑤ 以此断言 merge_hint 与 shots 数组；P3 字段可选——不传则不出现键）。 */
export function buildManifest(input: {
  url: string
  title: string
  text_source: TextSourceName
  text_chars: number
  shots: ManifestShot[]
  capturedAt?: Date
  partial?: boolean
  endReason?: string
  warning?: string
  warnings?: string[]
  renderSettleMs?: number
  renderTimeoutMs?: number
  shotsDeduped?: number
  dedupMethod?: DedupMethod
  /** P5/FR-15：不传 = 该路径不出现 overlays_stripped 字段（与 dedup_method 同为条件展开） */
  overlaysStripped?: number
}): MaterialManifest {
  return {
    url: maskUrlQuery(input.url),
    title: input.title,
    text_source: input.text_source,
    text_chars: input.text_chars,
    shots_total: input.shots.length,
    shots: input.shots.map((s) => ({ file: s.file, bytes: s.bytes })),
    captured_at: (input.capturedAt ?? new Date()).toISOString(),
    merge_hint: MERGE_HINT,
    ...(input.renderSettleMs !== undefined ? { render_settle_ms: input.renderSettleMs } : {}),
    ...(input.renderTimeoutMs !== undefined ? { render_timeout_ms: input.renderTimeoutMs } : {}),
    ...(input.shotsDeduped !== undefined ? { shots_deduped: input.shotsDeduped } : {}),
    ...(input.dedupMethod !== undefined ? { dedup_method: input.dedupMethod } : {}),
    ...(input.overlaysStripped !== undefined ? { overlays_stripped: input.overlaysStripped } : {}),
    ...(input.partial === true ? { partial: true } : {}),
    ...(input.endReason !== undefined ? { end_reason: input.endReason } : {}),
    ...(input.warning !== undefined ? { warning: input.warning } : {}),
    ...(input.warnings !== undefined && input.warnings.length > 0 ? { warnings: input.warnings } : {}),
  }
}

/**
 * URL 脱敏（审查 P2-8）：manifest 首次把完整 URL 落盘，而带签名/临时 token 的分享链接
 * （如 ?access_token=…）会因此留盘。落盘时**只保留 origin + path**，query 一律剥离。
 */
export function maskUrlQuery(url: string): string {
  const q = url.indexOf('?')
  if (q < 0) return url
  const head = url.slice(0, q)
  const frag = url.indexOf('#', q)
  return frag < 0 ? head : `${head}${url.slice(frag)}`
}

export type MaterialBundle = {
  /** 正文 md 绝对路径（writeDoc 排他占名后的最终名，可能带 -2 序号） */
  textPath: string
  /** 截图目录（无截图时不建目录 → null） */
  shotsDir: string | null
  manifestPath: string
  shots: ManifestShot[]
  textBytes: number
}

/**
 * 素材包落盘（§15.6）：先走既有 writeDoc（排他占名 + 重名序号，绝不覆盖），再以**实际**基名建
 * `<基名>.shots/NN.png` 与 `<基名>.manifest.json`——三件套恒与 md 同名同目录。
 */
export async function writeMaterialBundle(opts: {
  dir: string
  baseName: string
  text: string
  shots: CapturedShot[]
  manifest: MaterialManifest
}): Promise<MaterialBundle> {
  const written = await writeDoc(opts.dir, opts.baseName, opts.text)
  const finalDir = path.dirname(written.path)
  const actualBase = path.basename(written.path).replace(/\.md$/, '')
  let shotsDir: string | null = null
  try {
    if (opts.shots.length > 0) {
      shotsDir = path.join(finalDir, `${actualBase}.shots`)
      await fsp.mkdir(shotsDir, { recursive: true })
      for (const shot of opts.shots) {
        await fsp.writeFile(path.join(shotsDir, shot.file), shot.data)
      }
    }
    const manifestPath = path.join(finalDir, `${actualBase}.manifest.json`)
    await fsp.writeFile(manifestPath, JSON.stringify(opts.manifest, null, 2) + '\n', 'utf8')
    return {
      textPath: written.path,
      shotsDir,
      manifestPath,
      shots: opts.shots.map((s) => ({ file: s.file, bytes: s.bytes })),
      textBytes: written.bytes,
    }
  } catch (e) {
    // 审查 P2-7：写盘中途失败时，正文 md 与半份 shots/ 已落盘 → 回报已写路径，
    // 避免 agent 只拿到一个 E_IO 却不 know 产物在哪。
    const detail = e instanceof Error ? e.message : String(e)
    const err = Object.assign(new Error(`素材包写盘失败（${detail}）；已落盘部分：正文 ${written.path}${shotsDir !== null ? `、截图目录 ${shotsDir}` : ''}`), { exitCode: 32 })
    throw err
  }
}

/** Config.renderViewport（'WxH'）解析；不合法 → null（schemastery 已在加载期拦截，此处为运行时兜底）。 */
export function parseViewport(spec: string): { width: number; height: number } | null {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(spec.trim())
  if (m === null) return null
  return { width: Number(m[1]), height: Number(m[2]) }
}

// ── ⑩-8b 渲染预算联动（P3/FR-13 · Design §16.3）──────────────────────────────

/** 预算联动入参（纯函数，assert-pipeline 以此断言联动式）。 */
export type RenderBudgetInput = { maxShots: number; settleMs: number; configTimeoutMs: number }

/**
 * 渲染总预算（纯函数，Design §16.3）：`needByShots = ⌈maxShots × settleMs × 1.6⌉ + 20000`
 * （1.6 = 截图+滚动开销系数，实测每屏 ≈ 0.9s + settle；20000 = Edge 启动与首屏就绪余量），
 * 与 `Config.renderTimeoutMs` 取大后夹到 [5000, 600000]（上限与 Config schema 一致）。
 * 调用方只在**传了 render_settle_ms** 时启用本函数；不传时预算直接用 Config.renderTimeoutMs
 * （P2 零回归——工单 A9 硬要求）。
 */
export function resolveRenderBudget(input: RenderBudgetInput): number {
  const needByShots = Math.ceil(input.maxShots * input.settleMs * 1.6) + 20000
  return Math.min(600000, Math.max(5000, Math.max(input.configTimeoutMs, needByShots)))
}

// ── ⑩-8 素材管线编排（executeRender；render=true 且 children≠true 时进入）────────────────────

/** render:true 的成功返回：在 ToolSuccess 之上加素材包增量字段（§15.2 + §16.2）。 */
export type RenderSuccess = ToolSuccess & {
  text_path: string
  shots_dir: string | null
  shots: ManifestShot[]
  manifest_path: string
  text_source: TextSourceName
  shots_total: number
  text_chars: number
  /** 实际生效的每屏等待 ms（P3/FR-13 回显） */
  render_settle_ms: number
  /** 实际生效的渲染总预算 ms（P3/FR-13 回显） */
  render_timeout_ms: number
  /** 被近重复判定丢弃的截图帧数（P3/FR-14） */
  shots_deduped: number
  dedup_method: DedupMethod
  /** 本次渲染累计剥离的覆盖型浮层元素数（P5/FR-15；截图通道跑过的路径恒在——关闭剥离时为 0；api 源/无 Edge 降级不出现该字段） */
  overlays_stripped?: number
  warning?: string
}

/** render:true 的失败返回：E_NO_EDGE / E_RENDER_* / E_IO 等；渲染中断但已有 partial 素材时携带路径（§15.8）。 */
export type RenderFailure = ToolFailure & {
  text_path?: string
  shots_dir?: string | null
  shots?: ManifestShot[]
  manifest_path?: string
  text_source?: TextSourceName
  shots_total?: number
  text_chars?: number
  /** partial 失败路径同样回显实际生效值，便于定位"调了 settle 仍超时"（§16.6） */
  render_settle_ms?: number
  render_timeout_ms?: number
  /** 审查 P2-4：§16.2 称四项齐 —— 失败路径同样回显去重结果 */
  shots_deduped?: number
  dedup_method?: DedupMethod
  /** partial 失败路径同样回显剥离计数（P5/FR-15，与去重计数同策略） */
  overlays_stripped?: number
}

export type RenderResult = RenderSuccess | RenderFailure

/** 素材管线内的凭据解析（与 P0 同文案；render 源全程不触 API，不需要 Key）。 */
async function needApiKey(config: Config): Promise<string | ToolFailure> {
  const key = await resolveApiKey(process.env, config, process.platform === 'win32')
  if (key === null) {
    return fail('E_NO_KEY', `三级凭据解析均未取到 API Key（${config.apiKeyEnv} 进程环境 / Windows 用户级环境 / Config.apiKey）`)
  }
  return key
}

/** 素材包写盘 + 成功返回组装（所有成功/降级路径共用的收口）。 */
async function finishRenderBundle(tail: {
  dir: string
  base: string
  url: string
  title: string
  text: string
  source: TextSourceName
  shots: CapturedShot[]
  partial: boolean
  endReason?: string
  warning?: string
  warnings?: string[]
  started: number
  /** 实际生效的每屏等待与总预算（P3/FR-13 回显，进返回与 manifest） */
  settleMs: number
  timeoutMs: number
  /** 感知去重记账（P3/FR-14：无 Edge/无截图路径为 0 / sha1+phash） */
  shotsDeduped: number
  dedupMethod: DedupMethod
  /** 浮层剥离记账（P5/FR-15）；不传 = 该路径不出现 overlays_stripped 字段（api 源 / 无 Edge 降级） */
  overlaysStripped?: number
}): Promise<RenderResult> {
  const manifestShots: ManifestShot[] = tail.shots.map((s) => ({ file: s.file, bytes: s.bytes }))
  try {
    const bundle = await writeMaterialBundle({
      dir: tail.dir,
      baseName: slugify(tail.title, tail.url),
      text: tail.text,
      shots: tail.shots,
      manifest: buildManifest({
        url: tail.url,
        title: tail.title,
        text_source: tail.source,
        text_chars: [...tail.text].length,
        shots: manifestShots,
        renderSettleMs: tail.settleMs,
        renderTimeoutMs: tail.timeoutMs,
        shotsDeduped: tail.shotsDeduped,
        dedupMethod: tail.dedupMethod,
        ...(tail.overlaysStripped !== undefined ? { overlaysStripped: tail.overlaysStripped } : {}),
        ...(tail.partial ? { partial: true } : {}),
        ...(tail.endReason !== undefined ? { endReason: tail.endReason } : {}),
        ...(tail.warning !== undefined ? { warning: tail.warning } : {}),
        ...(tail.warnings !== undefined ? { warnings: tail.warnings } : {}),
      }),
    })
    return {
      ok: true,
      title: tail.title,
      path: bundle.textPath,
      bytes: bundle.textBytes,
      chars: [...tail.text].length,
      request_id: null, // 素材路径文字不保证来自单次 API 调用（render/auto/fallback），如实为 null
      elapsed_ms: Date.now() - tail.started,
      base_dir: tail.base,
      text_path: bundle.textPath,
      shots_dir: bundle.shotsDir,
      shots: bundle.shots,
      manifest_path: bundle.manifestPath,
      text_source: tail.source,
      shots_total: bundle.shots.length,
      text_chars: [...tail.text].length,
      render_settle_ms: tail.settleMs,
      render_timeout_ms: tail.timeoutMs,
      shots_deduped: tail.shotsDeduped,
      dedup_method: tail.dedupMethod,
      ...(tail.overlaysStripped !== undefined ? { overlays_stripped: tail.overlaysStripped } : {}),
      ...(tail.warning !== undefined ? { warning: tail.warning } : {}),
      ...(tail.warnings !== undefined && tail.warnings.length > 0 ? { warnings: tail.warnings } : {}),
    }
  } catch (e) {
    return fail('E_IO', `素材包落盘失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * 渲染素材管线（FR-12 / §15.2/§15.3/§15.8）：
 * text_source=api → 只用 API 文字、不启动 Edge；render → 全程渲染（无 Edge 即 E_NO_EDGE）；
 * auto → 预取 API 文字 → 起 Edge 探 canvas → 三判据择源（命中 → 渲染 innerText，未命中 → API 文字，
 * Edge 不可用 → api(fallback)+warning）。截图随 Edge 会话产出（显式 api 源除外）；超预算/截图中断保留
 * 已产出素材并标注 partial；显式 render 模式的渲染失败按 E_NO_EDGE/E_RENDER_* 返回（有 partial 素材时附带路径）。
 */
/**
 * 渲染管线依赖注入点（审查 P1-2：此前 `executeRender` 零自动化断言覆盖，
 * 因为 Edge 探测 / CDP 会话 / API 抓取都是硬依赖，只能靠真实端到端验证）。
 * 生产路径全部走默认实现；**仅供管线级断言**（assert-pipeline.mjs）注入假实现。
 */
export type RenderDeps = {
  /** 覆盖 Edge 可执行文件探测（返回 null 模拟"无 Edge"） */
  findEdge?: (config: { edgePath?: string }) => string | null
  /** 覆盖 API 抓取（auto 模式的判据②③输入） */
  fetchOne?: typeof fetchOne
  /** 覆盖 CDP 会话工厂（假会话驱动管线分支） */
  openSession?: (handle: EdgeHandle, opts: { width: number; height: number; deadline: number; url?: string }) => Promise<CdpSession>
}

async function executeRender(args: FetchArgs, url: string, config: Config, exec: ExecLike | undefined, deps: RenderDeps = {}): Promise<RenderResult> {
  const started = Date.now()
  // 范围/枚举本地前置（schema DSL 不支持 → 运行时拒绝，与 P1 max_depth/max_pages 同策略）
  const textSource = args.text_source ?? 'auto'
  if (textSource !== 'auto' && textSource !== 'api' && textSource !== 'render') {
    // 审查 P2-2：参数类错误**不得**复用"修正 URL"提示（会误导 agent 改 URL 重试）
    return fail('E_INVALID_URL', `text_source 必须为 auto|api|render（当前 ${JSON.stringify(args.text_source)}）`, undefined, '参数不合法：text_source 只能取 auto / api / render，请修正该参数后重试（与 URL 无关）')
  }
  const maxShots = args.max_shots ?? 40
  if (typeof maxShots !== 'number' || !Number.isInteger(maxShots) || maxShots < 1 || maxShots > 100) {
    return fail('E_INVALID_URL', `max_shots 必须为 1–100 的整数（当前 ${JSON.stringify(args.max_shots ?? '缺省')}）`, undefined, '参数不合法：max_shots 只能取 1–100 的整数，请修正该参数后重试（与 URL 无关）')
  }
  // P3/FR-13（Design §16.2/§16.3）：每屏等待可按调用覆盖（0–5000 整数，缺省 Config.renderSettleMs）。
  // 预算联动**只在传参时启用**（⌈shots×settle×1.6⌉+20000 与 Config.renderTimeoutMs 取大，夹 [5000,600000]）；
  // 不传时预算直接用 Config.renderTimeoutMs —— 与 P2 完全一致（工单 A9 零回归硬要求）。
  if (args.render_settle_ms !== undefined
    && (typeof args.render_settle_ms !== 'number' || !Number.isInteger(args.render_settle_ms) || args.render_settle_ms < 0 || args.render_settle_ms > 5000)) {
    return fail('E_INVALID_URL', `render_settle_ms 必须为 0–5000 的整数（当前 ${JSON.stringify(args.render_settle_ms)}）`, undefined, '参数不合法：render_settle_ms 只能取 0–5000 的整数，请修正该参数后重试（与 URL 无关）')
  }
  const settleMs = args.render_settle_ms ?? config.renderSettleMs
  const renderBudgetMs = args.render_settle_ms === undefined
    ? config.renderTimeoutMs
    : resolveRenderBudget({ maxShots, settleMs, configTimeoutMs: config.renderTimeoutMs })
  const viewport = parseViewport(config.renderViewport)
  if (viewport === null) return fail('E_RENDER_FAILED', `Config.renderViewport 非法（${config.renderViewport}，应形如 1440x900）`)

  const clean = args.clean ?? config.defaultClean
  const target = resolveOutputDir(args.output_dir ?? config.defaultOutputDir, exec)

  /** 取 API 文字并按 clean 语义清洗（与 P0 同语义；失败原样返回结构化错误）。 */
  const fetchApiText = async (): Promise<{ text: string; title: string } | ToolFailure> => {
    const key = await needApiKey(config)
    if (typeof key !== 'string') return key
    const fetched = await (deps.fetchOne ?? fetchOne)(url, key, config, exec?.signal)
    if (!fetched.ok) return fetched
    if (fetched.content.trim() === '') return fail('E_EMPTY_CONTENT', '接口返回正文为空或纯空白（不落盘）', fetched.request_id ?? undefined)
    return { text: clean ? cleanMarkdown(fetched.content) : fetched.content, title: fetched.title }
  }

  // ── 显式 api（§15.3-2）：只用 API 文字，不启动 Edge（素材包 = md + manifest，shots_total=0）──
  if (textSource === 'api') {
    const api = await fetchApiText()
    if (!('text' in api)) return api
    return await finishRenderBundle({
      dir: target.dir, base: target.base, url, title: api.title, text: api.text, source: 'api', shots: [], partial: false,
      started, settleMs, timeoutMs: renderBudgetMs, shotsDeduped: 0, dedupMethod: 'none',
    })
  }

  // ── auto / render：需要渲染通道；无 Edge 时 render 报 E_NO_EDGE、auto 降级 API（§15.3-5）──
  const findEdge = deps.findEdge ?? findEdgeExecutable
  const openSession = deps.openSession ?? cdpConnect
  const fetchForProbe = deps.fetchOne ?? fetchOne
  if (findEdge(config) === null) {
    if (textSource === 'render') {
      return fail('E_NO_EDGE', '未找到 Microsoft Edge（Config.edgePath 未配置且默认路径均不存在），text_source=render 需要本机 Edge')
    }
    const api = await fetchApiText()
    if (!('text' in api)) return api
    const warning = '未找到 Microsoft Edge，渲染通道不可用：已降级为 API 文字（无页面截图）'
    return await finishRenderBundle({
      dir: target.dir, base: target.base, url, title: api.title, text: api.text, source: 'api(fallback)', shots: [], partial: false, warning,
      started, settleMs, timeoutMs: renderBudgetMs, shotsDeduped: 0, dedupMethod: 'none',
    })
  }

  // auto 预取 API 文字（判据②③输入；空/短正文本身即判据③，不算失败；未取到记为 null）
  let probeText: string | null = null
  let probeTitle = ''
  let probeFailure: ToolFailure | null = null
  if (textSource === 'auto') {
    const key = await resolveApiKey(process.env, config, process.platform === 'win32')
    if (key !== null) {
      const fetched = await fetchForProbe(url, key, config, exec?.signal)
      if (fetched.ok) { probeText = fetched.content; probeTitle = fetched.title }
      else probeFailure = fetched
    }
  }

  const deadline = Date.now() + renderBudgetMs // P3：传 settle 时为联动预算；不传时 = Config.renderTimeoutMs（零回归）
  let handle: EdgeHandle | null = null
  let session: CdpSession | null = null
  let renderText: string | null = null
  let renderTitle = ''
  let capture: CaptureOutcome | null = null
  let renderError: RenderError | null = null
  const renderWarnings: string[] = []
  // 审查 P2-1：Config.edgePath 非空但文件不存在时，实现是**静默回退**默认探测 → 明确告警
  //（设计表原写"非空时必须存在"，二者口径统一为"优先使用，不存在则回退并告警"）
  const configuredEdge = typeof config.edgePath === 'string' ? config.edgePath.trim() : ''
  if (configuredEdge !== '' && !existsSync(configuredEdge)) {
    renderWarnings.push(`Config.edgePath 指向的文件不存在（${configuredEdge}），已回退默认 Edge 探测`)
  }
  try {
    handle = await launchEdge(url, config, viewport)
    session = await openSession(handle, { width: viewport.width, height: viewport.height, deadline, url })
    // 就绪轮询：重型 SPA（WebOffice/文档站）渲染需数秒（实测 kdocs 约 9s），
    // 只等 renderSettleMs（默认 700ms）会取到空正文、无可滚容器 → 只剩 1 帧。
    // 在总预算内轮询到"页面有实质内容"再继续；超时则按现状继续（不额外失败）。
    const ready = await waitForRenderReady(session, deadline)
    if (settleMs > 0) await sleep(Math.min(settleMs, Math.max(0, deadline - Date.now()))) // 首屏渲染等待（P3：settle 可按调用覆盖）
    const canvasRatio = await probeCanvasRatio(session, viewport)
    const decision = decideTextSource({ text_source: textSource, apiText: probeText ?? '', canvasRatio, edgeAvailable: true })
    if ('error' in decision) throw new RenderError('E_NO_EDGE', 'Edge 探测与择源间出现不一致（防御路径，不应到达）')

    // ── 阶段 A：取文字用**高视口** ──
    // 实测（kdocs 文档站）：视口 900/1600 → innerText 只有轮廓面板（1391 字，无正文）；
    // 视口 2400 → 正文进 DOM（2670 字）。WebOffice 只有在视口容得下一整页时才把正文渲染为 DOM 文本。
    const textViewport = parseViewport(config.renderTextViewport) ?? viewport
    if (decision.source === 'render' && textViewport.height <= viewport.height) {
      // 审查 P2-10：视口配反会**静默**退化成单阶段（正文可能取不全）→ 明确告警
      renderWarnings.push(`Config.renderTextViewport（${config.renderTextViewport}）高度未大于截图视口（${config.renderViewport}），已退化为单阶段视口：部分 WebOffice 类文档的正文可能不完整`)
    }
    if (decision.source === 'render' && textViewport.height > viewport.height) {
      await session.send('Emulation.setDeviceMetricsOverride', { width: textViewport.width, height: textViewport.height, deviceScaleFactor: 1, mobile: false })
      await waitForRenderReady(session, deadline)
      // 阶段 A 取文字：窗口内取最长的一份（渲染中途有平台期，"首次稳定"会拿到残缺正文）
      renderText = cleanRenderedText(await waitForTextLongest(session, deadline))
      const t = await session.evalJs<unknown>('document.title')
      renderTitle = typeof t === 'string' ? t : ''
      // 切回截图视口，再做跨页滚动分屏（审查 P2-9：切回后补一次就绪校验，等布局重排稳定）
      await session.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false })
      await waitForRenderReady(session, deadline)
      await sleep(Math.min(settleMs, Math.max(0, deadline - Date.now())))
    } else if (decision.source === 'render') {
      renderText = cleanRenderedText(await waitForTextLongest(session, deadline))
      const t = await session.evalJs<unknown>('document.title')
      renderTitle = typeof t === 'string' ? t : ''
    }

    capture = await captureShots(session, {
      maxShots,
      settleMs,
      overlap: config.renderScrollOverlap,
      viewportH: viewport.height,
      deadline,
      stripOverlays: config.renderStripOverlays, // P5/FR-15：由 Config 显式传入（false → 一次都不调用，A7）
    })

    // 阶段 C：滚动会触发更多内容渲染 → 再回高视口取一次，取两者更长者（只会更全，不会更差）
    if (decision.source === 'render' && textViewport.height > viewport.height) {
      try {
        await session.send('Emulation.setDeviceMetricsOverride', { width: textViewport.width, height: textViewport.height, deviceScaleFactor: 1, mobile: false })
        const after = cleanRenderedText(await waitForTextLongest(session, deadline, 400, 3000, 1200))
        if (after.length > (renderText ?? '').length) renderText = after
      } catch { /* 复读失败不影响已有正文 */ }
    }
  } catch (e) {
    renderError = e instanceof RenderError ? e : new RenderError('E_RENDER_FAILED', e instanceof Error ? e.message : String(e))
  } finally {
    await closeAll(handle, session)
  }

  const partial = capture !== null && (capture.endReason === 'timeout' || capture.endReason === 'failed')

  // P3/FR-14 记账：解码失败 → dedup_method='sha1(fallback)'，warning 只追加一次（renderWarnings 为本次执行
  // 的私有数组，天然不刷屏）；正常为 'sha1+phash'。无 Edge / 无截图路径 capture=null → 0 / sha1+phash。
  const shotsDeduped = capture?.deduped ?? 0
  const dedupMethod: DedupMethod = capture?.dedupFallback === true ? 'sha1(fallback)' : 'sha1+phash'
  // P5/FR-15 记账：截图通道跑过（capture ≠ null）才有剥离计数；关闭剥离时为 0（字段仍在）。
  // api 源 / 无 Edge 降级路径不进入本行以下任何 finishRenderBundle 调用点 → 字段不出现（条件展开）。
  const overlaysStripped = capture?.overlaysStripped ?? 0
  if (capture?.dedupFallback === true) {
    renderWarnings.push('截图 PNG 感知解码失败（隔行/16-bit/损坏帧），去重已回退为 sha1 精确比较（dedup_method=sha1(fallback)）')
  }

  // ── 显式 render：失败语义不降级（§15.3-5）；已产出素材保留并附带路径（§15.8）──
  if (textSource === 'render') {
    if (renderError !== null) return fail(renderError.renderCode, renderError.message) // 启动/CDP/取文阶段失败：尚无素材
    const text = renderText ?? ''
    if (text.trim() === '' && (capture === null || capture.shots.length === 0)) {
      return fail('E_EMPTY_CONTENT', '渲染正文为空且无截图产出（页面可能是空壳）')
    }
    if (partial) {
      // 先保留素材（§15.8），再按码失败返回（E_RENDER_TIMEOUT / E_RENDER_FAILED）
      const saved = await finishRenderBundle({
        dir: target.dir, base: target.base, url, title: renderTitle, text, source: 'render',
        shots: capture!.shots, partial: true, endReason: capture!.endReason, warnings: renderWarnings, started,
        settleMs, timeoutMs: renderBudgetMs, shotsDeduped: capture!.deduped, dedupMethod, overlaysStripped,
      })
      if (saved.ok) {
        const code: ErrorCode = capture!.endReason === 'timeout' ? 'E_RENDER_TIMEOUT' : 'E_RENDER_FAILED'
        const detail = capture!.error !== undefined ? `：${capture!.error}` : ''
        return {
          ok: false as const,
          code,
          message: `渲染提前终止（${capture!.endReason}${detail}），已产出素材包（partial）`,
          hint: HINTS[code],
          text_path: saved.text_path,
          shots_dir: saved.shots_dir,
          shots: saved.shots,
          manifest_path: saved.manifest_path,
          text_source: saved.text_source,
          shots_total: saved.shots_total,
          text_chars: saved.text_chars,
          render_settle_ms: settleMs, // §16.6：失败路径也回显实际生效值，便于定位"调了 settle 仍超时"
          render_timeout_ms: renderBudgetMs,
          shots_deduped: saved.shots_deduped, // 审查 P2-4：§16.2 称四项齐，失败路径同样回显
          dedup_method: saved.dedup_method,
          overlays_stripped: overlaysStripped, // P5/FR-15：partial 失败路径同样回显剥离计数
        }
      }
      return saved // 落盘失败（E_IO）原样返回
    }
    return await finishRenderBundle({
      dir: target.dir, base: target.base, url, title: renderTitle, text, source: 'render',
      shots: capture?.shots ?? [], partial: false, warnings: renderWarnings, started,
      settleMs, timeoutMs: renderBudgetMs, shotsDeduped: capture?.deduped ?? 0, dedupMethod, overlaysStripped,
    })
  }

  // ── auto 汇合：降级而非失败（§15.3-5）──
  let source: TextSourceName
  let text: string
  let title: string
  let warning: string | undefined
  if (renderText !== null) {
    source = 'render'
    text = renderText
    title = probeTitle !== '' ? probeTitle : renderTitle
    if (renderError !== null) {
      warning = `渲染通道部分失败（${renderError.renderCode}：${renderError.message}），未产出页面截图`
    }
  } else {
    // 渲染文字未取得：要么择源本就是 api（探针未命中），要么渲染失败需降级
    if (probeText === null) {
      // API 预取未取得（无 Key 或抓取失败）且渲染未出文字 → 双通道皆不可用
      const renderNote = renderError !== null ? `（渲染通道同时失败：${renderError.renderCode} ${renderError.message}）` : ''
      if (probeFailure !== null) return probeFailure
      return fail('E_NO_KEY', `渲染通道未能产出正文${renderNote}，且三级凭据解析均未取到 API Key（${config.apiKeyEnv} 进程环境 / Windows 用户级环境 / Config.apiKey）`)
    }
    text = clean ? cleanMarkdown(probeText) : probeText
    title = probeTitle
    if (renderError !== null) {
      source = 'api(fallback)'
      warning = `渲染通道失败，已降级为 API 文字（${renderError.renderCode}：${renderError.message}）`
    } else {
      source = 'api'
    }
  }
  if (partial && warning === undefined) {
    warning = `截图提前终止（${capture!.endReason}${capture!.error !== undefined ? `：${capture!.error}` : ''}），素材包标注 partial`
  }
  const shots = capture?.shots ?? []
  if (text.trim() === '' && shots.length === 0) {
    return fail('E_EMPTY_CONTENT', 'API 与渲染通道均未取得正文，且无截图产出（不落盘）')
  }
  return await finishRenderBundle({
    dir: target.dir,
    base: target.base,
    url,
    title,
    text,
    source,
    shots,
    partial,
    endReason: partial ? capture?.endReason : undefined,
    warning,
    warnings: renderWarnings,
    started,
    settleMs,
    timeoutMs: renderBudgetMs,
    shotsDeduped,
    dedupMethod,
    overlaysStripped,
  })
}

// ── execute 管线组装（B2 §3 五层串联；任何失败不产生文件、不抛异常）──────────

/**
 * 失败返回。审查 P2-2：`hint` 允许按调用点**定制**——参数类错误不该复用
 * "修正 URL 后重试"（会误导 agent 去改 URL）。错误码集合不变（仍 11 个）。
 */
function fail(code: ErrorCode, message: string, requestId?: string, hintOverride?: string): ToolFailure {
  return {
    ok: false,
    code,
    message,
    ...(requestId !== undefined ? { request_id: requestId } : {}),
    hint: hintOverride ?? HINTS[code],
  }
}

/** 框架执行上下文的最小子集（P1-2/P1-3）：会话 cwd 与调用方取消信号。 */
type ExecLike = {
  readonly signal?: AbortSignal
  readonly agent?: { readonly session?: { readonly header?: { readonly cwd?: string } } }
}

/** 会话工作区：框架自身也这样取（`exec.agent.session.header.cwd`，见 dsh-tools 源码）。 */
function sessionCwd(exec: ExecLike | undefined): string | null {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : null
}

/** output_dir 解析（FR-8）：绝对直用；相对**基于会话工作区**；无会话 cwd 时回退进程 cwd 并如实回报基准。 */
function resolveOutputDir(dir: string, exec: ExecLike | undefined): { dir: string; base: string } {
  if (process.platform !== 'win32' && dir === WINDOWS_DEFAULT_OUTPUT_DIR) {
    return { dir: path.join(homedir(), 'deepseek网页抓取'), base: 'home' }
  }
  const cwd = sessionCwd(exec)
  if (cwd !== null) return { dir: path.resolve(cwd, dir), base: cwd }
  return { dir: path.resolve(dir), base: process.cwd() }
}

const ALLOWED_ARG_KEYS = new Set(Object.keys(TOOL_PARAMETERS))

/**
 * 合集路径（FR-11 / Design §14.2/§14.9）：范围本地前置 → BFS → 逐页清洗 → 合并 → mergedSlug → writeDoc。
 * 根页级失败（robots 拒 / 根页抓取失败）原样返回；取消后不落盘；任何 IO 失败 → E_IO 且无残留。
 */
async function executeCollection(
  args: FetchArgs,
  url: string,
  key: string,
  config: Config,
  exec: ExecLike | undefined,
): Promise<CollectionResult> {
  // 范围本地前置（schema DSL 不支持数值范围 → 运行时拒绝；children 非 true 时这两个参数已被忽略）
  const maxDepth = args.max_depth ?? 2
  const maxPages = args.max_pages ?? 30
  if (typeof maxDepth !== 'number' || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 5) {
    return fail('E_INVALID_URL', `max_depth 必须为 0–5 的整数（当前 ${JSON.stringify(args.max_depth ?? '缺省')}）`)
  }
  if (typeof maxPages !== 'number' || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) {
    return fail('E_INVALID_URL', `max_pages 必须为 1–200 的整数（当前 ${JSON.stringify(args.max_pages ?? '缺省')}）`)
  }

  const started = Date.now()
  const crawl = await crawlChildren(url, key, config, exec?.signal, { maxDepth, maxPages })
  if (crawl.rootFailure !== undefined) return crawl.rootFailure
  if (exec?.signal?.aborted === true) return fail('E_UPSTREAM', '调用方已取消本次执行，未落盘')

  if (crawl.pages.length === 0) return fail('E_UPSTREAM', '合集抓取未取得根页（未落盘）') // 防御：rootFailure 为空时不可达
  const root = crawl.pages[0]!

  // 逐页清洗（与 P0 同一 clean 语义：缺省 config.defaultClean，false 原样保真）
  const clean = args.clean ?? config.defaultClean
  const cleanPage = (page: PageResult): PageResult => ({
    ...page,
    content: clean ? cleanMarkdown(page.content) : page.content,
  })
  const merged = renderMerged(cleanPage(root), crawl.pages.slice(1).map(cleanPage), crawl.skipped, crawl.skippedTotal)

  try {
    const target = resolveOutputDir(args.output_dir ?? config.defaultOutputDir, exec)
    const written = await writeDoc(target.dir, mergedSlug(root.title, root.url), merged)
    return {
      ok: true,
      title: root.title,
      path: written.path,
      bytes: written.bytes,
      chars: [...merged].length, // P2-17：按 Unicode 码点计数
      request_id: null, // 合并自多页，无单一上游 request_id，如实为 null
      elapsed_ms: Date.now() - started,
      base_dir: target.base,
      pages_total: crawl.pages.length,
      pages_ok: crawl.pages.length,
      pages_failed: crawl.pagesFailed,
      skipped_total: crawl.skippedTotal,
      ...(crawl.skipped.length > 0 ? { skipped: crawl.skipped } : {}),
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return fail('E_IO', `落盘失败：${detail}`)
  }
}

/**
 * 管线级测试入口（审查 P1-2）：把 executeFetch 连同其 deps 注入点暴露给断言脚本。
 * **仅供断言使用**（`assert-pipeline.mjs`）；生产路径走 `apply` 注册的工具。
 */
export const __executeFetch = executeFetch

async function executeFetch(args: FetchArgs, config: Config, exec?: ExecLike, deps: RenderDeps = {}): Promise<ToolResult | CollectionResult | RenderResult> {
  // 未知参数显式拒绝（P2-21：框架 schema 无 additionalProperties:false，静默忽略会误导调用方）
  const unknown = Object.keys(args as unknown as Record<string, unknown>).filter((k) => !ALLOWED_ARG_KEYS.has(k))
  if (unknown.length > 0) return fail('E_INVALID_URL', `不支持的参数：${unknown.join(', ')}（本工具仅支持 url / output_dir / clean / children / max_depth / max_pages / render / text_source / max_shots / render_settle_ms）`)

  // ① 校验层：本地前置拒绝，不发请求
  const url = typeof args.url === 'string' ? args.url : ''
  const check = validateUrl(url)
  if (!check.ok) return fail('E_INVALID_URL', check.reason)

  // output_dir 空白串不得静默落到 cwd（P2-9）
  if (typeof args.output_dir === 'string' && args.output_dir.trim() === '') {
    return fail('E_IO', 'output_dir 不能为空字符串（缺省请省略该参数）')
  }

  // P2 渲染素材路径（FR-12 / Design §15.2）：render=true 时走素材管线；与 children 互斥（单页素材包
  // 与多页合集是两种产出形态）。分派先于凭据层——text_source=render 全程不触 API，不需要 Key。
  if (args.render === true) {
    if (args.children === true) {
      return fail('E_INVALID_URL', 'render 与 children 互斥：渲染素材路径仅支持单页（多页合集请用 children=true 的 API 路径）', undefined, '参数互斥：render 与 children 不能同时为 true；渲染素材通道只支持单页，请二选一后重试')
    }
    return await executeRender(args, url, config, exec, deps)
  }

  // ② 凭据层：三级解析（顺序按 Spec FR-7）
  const key = await resolveApiKey(process.env, config, process.platform === 'win32')
  if (key === null) {
    return fail('E_NO_KEY', `三级凭据解析均未取到 API Key（${config.apiKeyEnv} 进程环境 / Windows 用户级环境 / Config.apiKey）`)
  }

  // P1 合集路径（FR-11）：children=true → BFS 合集；缺省/false 走下方 P0 单页路径（A7：逐字节不变）
  if (args.children === true) {
    return await executeCollection(args, url, key, config, exec)
  }

  // ③ 调用层：API + 8 码分类（失败直接透传结构化对象，不抛异常）；转发调用方取消信号（P1-3）
  const fetched = await fetchOne(url, key, config, exec?.signal)
  if (!fetched.ok) return fetched

  // 空正文：不落盘
  if (fetched.content.trim() === '') {
    return fail('E_EMPTY_CONTENT', '接口返回正文为空或纯空白（不落盘）', fetched.request_id ?? undefined)
  }

  // ④ 清洗层：clean 缺省取 config.defaultClean；false 直通原文（逐字节保真）
  const clean = args.clean ?? config.defaultClean
  const content = clean ? cleanMarkdown(fetched.content) : fetched.content

  // 取消后不落盘（P1-3）：抓取已完成但调用方已取消 → 报取消，不写文件
  if (exec?.signal?.aborted === true) return fail('E_UPSTREAM', '调用方已取消本次执行，未落盘')

  // ⑤ 命名层 + ⑥ 落盘层（任何 IO 失败 → E_IO，无文件残留）
  const baseName = slugify(fetched.title, url)
  try {
    const target = resolveOutputDir(args.output_dir ?? config.defaultOutputDir, exec)
    const written = await writeDoc(target.dir, baseName, content)
    return {
      ok: true,
      title: fetched.title,
      path: written.path,
      bytes: written.bytes,
      chars: [...content].length, // P2-17：按 Unicode 码点计数（emoji 不再算 2）
      request_id: fetched.request_id ?? null,
      elapsed_ms: fetched.elapsed_ms,
      base_dir: target.base, // 相对路径所用基准（绝对路径时即其上级目录所在解析基准）
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return fail('E_IO', `落盘失败：${detail}`)
  }
}

// ── 插件主体（R1 范式：defineTool + ctx.effect 注册，卸载自动注销）────────────

export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args: unknown, value: unknown) => {
        const v = value as ToolResult | CollectionResult | RenderResult
        if (v.ok) {
          if ('shots_dir' in v) {
            return [{
              type: 'text',
              text: `抓取成功（素材包）：${v.title}\n正文：${v.text_path}（${v.text_chars} 字符，来源 ${v.text_source}）\n截图：${v.shots_dir ?? '无'}（${v.shots_total} 张，去重丢弃 ${v.shots_deduped} 张，${v.dedup_method}${v.overlays_stripped !== undefined && v.overlays_stripped > 0 ? `，剥离 ${v.overlays_stripped} 个覆盖层` : ''}）\n清单：${v.manifest_path}（${v.elapsed_ms}ms，settle ${v.render_settle_ms}ms / 预算 ${v.render_timeout_ms}ms）${v.warning !== undefined ? `\n注意：${v.warning}` : ''}`,
            }]
          }
          if ('pages_total' in v) {
            return [{
              type: 'text',
              text: `抓取成功（合集）：${v.title}\n路径：${v.path}（共 ${v.pages_total} 页：${v.pages_ok} 成功 / ${v.pages_failed} 失败，${v.chars} 字符，${v.elapsed_ms}ms）`,
            }]
          }
          return [{
            type: 'text',
            text: `抓取成功：${v.title}\n路径：${v.path}（${v.chars} 字符，${v.elapsed_ms}ms，request_id=${v.request_id ?? '无'}）`,
          }]
        }
        // render 失败但已保留 partial 素材时（§15.8）附带 manifest 路径，方便调用方取走素材
        const partialNote = 'manifest_path' in v && v.manifest_path !== undefined ? `（已保留部分素材：${v.manifest_path}）` : ''
        return [{ type: 'text', text: `抓取失败：${v.code} — ${v.message}${partialNote}` }]
      },
    },
    async execute(args, exec) {
      return await executeFetch(args, config, exec as unknown as ExecLike)
    },
  })), '@dsh-external/dsh-deepseek-fetch: deepseek_fetch')
}
