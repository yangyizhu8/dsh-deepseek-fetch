零越权：只写 ② 清单内路径，其余一律只读；禁脑补需求，缺料即停。
禁脑补：P0 只做 FR-1~FR-8；不引入 spec 未定义参数与功能；不做 P1 子页。

## ① 目标与可核验验收判据

目标：按 `DEV-PLAN.md` v0.2 施工 T-01~T-09，在产物根下产出 `bundle/`（插件包）与 `preset/`（预设），实现单页抓取工具 `deepseek_fetch`：URL → DeepSeek Fetch API → 清洗 → 命名 → 原子落盘（文件内容仅正文）→ 结构化回报。

**分工（v1.1 更正）**：执行方**只写文件，不执行任何命令**；下表 A1~A8 由**主侧（DSH）**在写完后执行并回贴结果，执行方据此迭代修复。理由：门禁执行与构建注入链属审计禁区，严禁委派外部执行体（O3-C4）。

| ID | 可核验判据（由主侧执行；你只需保证实现满足） |
|---|---|
| A1 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` exit 0，输出含 `=== Build complete ===`，`lib/index.js` 存在 |
| A2 | `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle 绝对路径>` exit 0，全 PASS |
| A3 | `/d/deepseek-harness/node_modules/.bin/tsc -p tsconfig.json --noEmit` exit 0 |
| A4 | `node scripts/verify.mjs` exit 0，打印各项 `<item>-ok` 与 `verify: PASS`；人为改错一个期望值须 exit≠0（验毕还原） |
| A5 | 工具参数键集合**恰为** `{url, output_dir, clean}`；`filename`/`children`/`max_depth`/`max_pages` 不得出现 |
| A6 | `preset/` 两文件可被 js-yaml 解析；`agent.cordis.yml` 首行 name 为 `@dsh-external/dsh-deepseek-fetch`；`preset.yml` 的 name/description 非空 |
| A7 | 落盘内容 = 清洗后正文：首行即正文，无 `---`/YAML/来源行/时间头；UTF-8 无 BOM（前 3 字节非 EF BB BF） |
| A8 | 任何失败路径（8 错误码）均不产生文件，也不留 `.tmp-*` 残留 |

## ② 允许写入清单

- `bundle/package.json`
- `bundle/cordis.patch.yml`
- `bundle/tsconfig.json`
- `bundle/.gitignore`
- `bundle/scripts/build.sh`
- `bundle/scripts/verify.mjs`
- `bundle/scripts/assert-*.mjs`
- `bundle/src/index.ts`
- `preset/agent.cordis.yml`
- `preset/preset.yml`

只读（禁写）：`Plugin-Spec.md`、`Plugin-Design.md`、`DEV-PLAN.md`、`PIPELINE-STATE.md`、`diagrams/`、`evidence/`、`.zcode/`（内含密钥，禁读禁写）。

## ③ 冻结基线

基线标识（sha256 前 16 位 + 字节数，只读不改）：
- `Plugin-Spec.md` v0.3 → sha256 `10e194a5d5e99762…`，15086 B
- `Plugin-Design.md` v0.1 → sha256 `57dc011712df7e46…`，15205 B
- `DEV-PLAN.md` v0.2 → sha256 `bab3dd1de853830c…`，49124 B

环境：Node v24.18.1；DSH checkout = `D:/deepseek-harness`；构建**必须**显式 `DSH_CHECKOUT=D:/deepseek-harness`（自动探测不含该路径）。
参考范式（只读）：`D:\deepseek-harness\plugins\dsh-site-crawl\`（src/index.ts 的 defineTool+ctx.effect 注册、Config、scripts/build.sh、cordis.patch.yml、package.json）。
preset 模板（只读）：`C:\Users\Administrator\.dsh\.agent-presets\client-key-agent\`（含 agent.cordis.yml + preset.yml；**不要**用 `apps\cli\config\agent-presets\`，那里只剩 .bak）。

## ④ 关联阶段与台账引用

阶段：流水线阶段04 开发（T-01~T-09）。
台账：`C:\project-study\dsh-deepseek-fetch\PIPELINE-STATE.md`（只读，由主维护；你只上报结果，不写台账）。
任务细节：`DEV-PLAN.md` §3（每任务的产出/验收/依赖）与 §6（风险缓解）。

## ⑤ 契约摘录

- 插件导出：`export const name`、`export const inject = ['tools']`、`export const Config = z.object({...})`、`export function apply(ctx, config)`；注册用 `ctx.effect(() => ctx.tools.register(defineTool({...})), '@dsh-external/dsh-deepseek-fetch: deepseek_fetch')`。
- `defineTool({ name: 'deepseek_fetch', description, parameters: { url: {type:'string',required:true}, output_dir: {type:'string'}, clean: {type:'boolean'} }, output: { schema, render }, async execute(args) })`。
- 成功返回 `{ok:true,title,path,bytes,chars,request_id,elapsed_ms}`；失败返回 `{ok:false,code,message,request_id?,hint?}`——**不抛异常**（框架级参数校验除外）。
- 8 错误码：`E_INVALID_URL` / `E_NO_KEY` / `E_AUTH`(401/403) / `E_FETCH_FAILED`(404 且含 failed to fetch URL) / `E_RATE_LIMIT`(429) / `E_UPSTREAM`(5xx/网络/超时，重试 1 次) / `E_EMPTY_CONTENT`（空正文不落盘） / `E_IO`。
- 凭据三级：`process.env[apiKeyEnv]` → `config.apiKey` → Windows `reg query HKCU\Environment /v <name>`（非 Windows 跳过）→ null。Key 不得进日志/返回值/文件。
- 清洗：围栏代码块（```）内**原样保留**；块外剥离 `\` + Markdown 标点；`clean:false` 原样保真。
- 落盘：`path.resolve` + `fs.mkdir(recursive)` → 临时文件 `.<name>.tmp-<pid>-<rand>` → `rename`；重名 `-2`…`-99` → `-YYYYMMDD-HHmmss`；UTF-8 无 BOM；不追加换行/页脚。
- Config 7 字段与默认值按 `Plugin-Design.md` §7；额外导出 `CONFIG_FIELDS` 常量供断言。

## ⑥ 失败约束与头部禁令

- **缺料即停**：任何不确定（依赖如何 link、loader 方言细节、API 行为）→ 停下如实报告，禁止臆造或猜 API。
- **禁止执行任何命令**（`build.sh` / `tsc` / `node` / `npm` / `check-plugin-ready` 全部由主侧执行）。若你的环境本身无命令执行权限，**不要因此停工**——只写文件即可，并在回报里如实说明"未执行命令"。
- 禁止修改基线文件；禁止写 `.zcode/`；禁止读取/打印任何 API Key 值。
- 禁止为了让门禁通过而改判据：不得改 `check-plugin-ready` 调用、不得注释 verify 断言、不得放宽 schema 或错误码。
- 断言一律写成 `scripts/assert-*.mjs`（`cat > f <<'EOF'` 写入），**不要**用 `node -e`（bash 双引号会吞反斜杠）。
- 测试失败必须原样输出完整报错，禁止筛选/美化。

## ⑦ 缺陷清单

（首轮为空）
