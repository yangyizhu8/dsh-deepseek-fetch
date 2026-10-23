# DEV-PLAN — dsh-deepseek-fetch（阶段03 开发计划）

- 版本：v0.1
- 日期：2026-10-21
- 阶段：03 计划（本文是本阶段唯一产物；`bundle/`、`preset/` 为阶段04 产物，本文只做拆解与立规）
- 输入基线：`Plugin-Spec.md` v0.3（已审核通过，2026-10-21 01:45）+ `Plugin-Design.md` v0.1（已审核通过）
- 规模预估：P0 全量约 **500~900 行 TypeScript**（单文件 `bundle/src/index.ts` + 工具实现 + 自验脚本），任务粒度按「单任务 <150 行等价改动」切分

---

## 1. 计划输入与基线清单

### 1.1 文档基线（全部只读，施工期间不得修改）

| # | 文件 | 版本/状态 | 用途 |
|---|---|---|---|
| B1 | `C:\project-study\dsh-deepseek-fetch\Plugin-Spec.md` | v0.3，已审核通过 | 需求唯一来源：P0 只交付 FR-1~FR-8；FR-11（子页 BFS/合并）为 P1 第二批，**不得排进本计划**；FR-9/FR-10 仅登记不计划 |
| B2 | `C:\project-study\dsh-deepseek-fetch\Plugin-Design.md` | v0.1，已审核通过 | 设计唯一来源：工具契约（§4）、Config 7 字段（§7）、8 错误码（§4.1）、五层管线（§2.1/§3）、原子写与重名策略（§8）、三级凭据解析（§7）、复用对照（§11） |
| B3 | `C:\project-study\dsh-deepseek-fetch\PIPELINE-STATE.md` | 由流水线主持有，**本计划与阶段04 施工方均只读** | 阶段状态与台账；施工完成由主刷新，不由施工方写 |
| B4 | `diagrams\dsh-deepseek-fetch-structure.html`（+ `structure.candidate.json`、`finalize.json` receipt） | 四门 PASS，随设计一并过审 | 挂载点/边界对照（HOST 组合面 bundle entry、凭据只进内存、五层管线顺序）。**图与 B2 冲突以 B2 为准**（B2 §2.1 R2 条款） |
| B5 | `evidence\api-probe.md` | 2026-10-21，12 例实测 | 接口行为事实：`{title,content}`、content 含反斜杠转义、错误体带 request_id、无限流头、部分站点 404、时延 0.1~3.3s |

### 1.2 参考实现范式（只读，克隆/借鉴来源）

| # | 路径 | 借用点 |
|---|---|---|
| R1 | `D:\deepseek-harness\plugins\dsh-site-crawl\src\index.ts`（497 行） | `export const name / inject = ['tools']`、`Config = z.object({...})`、`defineTool({name, description, parameters, output:{schema,render}, execute})` + `ctx.effect(() => ctx.tools.register(...), '<id>: <name>')` 范式 |
| R2 | 同上 `package.json` | `peerDependencies` 范围声明、`type: module`、`main: ./lib/index.js`、`dsh.bundle.patch: ./cordis.patch.yml` 声明、`scripts.build / scripts.typecheck` |
| R3 | 同上 `scripts\build.sh` | `DSH_CHECKOUT` 探测（环境变量 → `~/dsh-harness` 等候选）→ `link_pkg` junction 依赖 → checkout 自带 tsc 编译 |
| R4 | 同上 `cordis.patch.yml` | `- insert: [{ id, name }]` loader entry 形态 |
| R5 | 同上 `tsconfig.json`、`.gitignore` | ES2023/NodeNext/strict/outDir=lib/rootDir=src；忽略 node_modules 与 lib |
| R6 | `C:\Users\Administrator\.dsh\.agent-presets\<preset>\`（活模板，如 `client-key-agent`、`dsh-plugin-pipeline`，各含 `agent.cordis.yml` + `preset.yml`）。**主侧复核更正**：`D:\deepseek-harness\apps\cli\config\agent-presets\` 下仅存 `agent.cordis.yml.bak-*` 备份，已不是活模板 | `preset/agent.cordis.yml` 组合行写法（工具行 + config；无 service 行则无需 isolate realm group）+ `preset.yml` 的 `name`/`description` 双字段 |

### 1.3 流水线契约引用（只读）

| # | 路径 | 关键条款 |
|---|---|---|
| P1 | `D:\dsh-sync\packages\dsh-plugin-pipeline-skills\skills\plugin-builder\SKILL.md` | 阶段04 产物 = `preset/`（`agent.cordis.yml` + `preset.yml`）+ `bundle/`（标准结构）；DSH 准入三件套；实验隔离与四处清理纪律 |
| P2 | `D:\dsh-sync\packages\dsh-plugin-pipeline-skills\skills\plugin-checker\SKILL.md` | 阶段05 检查项（结构合规/装配启动/功能生效/边界失败路径/生命周期残留）与 `SHIPPABLE.md` 报告结构 |
| P3 | `C:\Users\Administrator\.dsh\.agent-presets\dsh-plugin-pipeline\PIPELINE-FLOW.md` | O5 验收五步（diff 范围→构建→注入自测→基线一致→门禁证据）；进共享 bundles 三件套门禁（`check-plugin-ready.mjs` 全 PASS → `dsh plugin --profile web add` 试装 → 启动达 `dsh web: http://127.0.0.1:3080` 无插件树错误） |

### 1.4 本机环境前提（阶段04 开工前逐条复核）

| 项 | 值 | 核验命令 |
|---|---|---|
| Node | v24.18.1（2026-10-21 实测） | `node --version` |
| DSH checkout | `D:\deepseek-harness`（`packages/`、`vendor/{cordis,cosmokit,schemastery}`、`node_modules\.bin\tsc` 均已验证在位） | `test -x /d/deepseek-harness/node_modules/.bin/tsc && echo TSC-OK` |
| DSH_CHECKOUT | **必须显式传且用 Windows 风格**：`DSH_CHECKOUT=D:/deepseek-harness`（wo00 先例 `DSH_CHECKOUT=D:\...` 同理）。两个原因：① 自动探测候选（`~/dsh-harness` 等）不含 `D:\deepseek-harness`，不传则构建报 `cannot locate the dsh checkout`；② build.sh 的 `link_pkg` 用 node `path.resolve()` 解析该值，**环境变量值不经 MSYS 参数路径转换**——传 `/d/...` POSIX 风格会被 Windows node 解析成当前盘符相对路径，junction 链错位 | 见 T-01 验收命令 |
| super-injector registry | `C:\Users\Administrator\.dsh\super-injector\registry.json` 现有 7 件在册，**无 `deepseek-fetch` / `@dsh-external/dsh-deepseek-fetch` 冲突** | `Get-Content C:\Users\Administrator\.dsh\super-injector\registry.json` |
| 凭据 | `DEEPSEEK_API_KEY` 用户级已配置（长度 35、`sk-` 前缀，B5 实测），进程级为空 → 三级解析必要 | `reg query HKCU\Environment /v DEEPSEEK_API_KEY`（只看存在性，**输出不得入证据**） |

### 1.5 dev_* 注入器调用方式（实证汇总）

`dev_*` 是 **DSH 会话内 host 侧工具（super-injector 注入器环境），不是 shell 命令**——在 DSH 会话里按名调用；shell 侧等价物只有 `bash scripts/build.sh` / `tsc` / `node` 系列。实证形态（来源：`dsh-site-crawl\README.md`、`huaihua-gjj-panel\README.md:19`、`workorders\upg020-p2-wo00-four-plugins-adaptation.md:42-55`、`quantstudio-max\docs\ARCHITECTURE.md` §6/§7）：

```text
# 以下均在 DSH 会话（注入器环境）内调用：
dev_plugin_status                     # 查挂载状态，期望本插件 [active]
dev_inject_plugin { "dir": "C:/project-study/dsh-deepseek-fetch/bundle" }   # 运行时注入（隔离通道）
dev_build_plugin                      # 包装 build.sh（junction+tsc）；shell 等价 = DSH_CHECKOUT=... bash scripts/build.sh
dev_reload_package                    # registry 在册插件热重载（host 半改动迭代；包内多模块需传 lib 子串清缓存）
dev_self_test                         # 注入器链自测（注意：测的是注入器链而非本插件功能，见 workorders\pipeline-wo04 裁定2）
dev_uninject_plugin @dsh-external/dsh-deepseek-fetch   # 卸载（wo00 先例用目录短名 dsh-job-progress；以注入器实际接受的形式为准）
dev_injected_list                     # 在册清单
```

- `dev_self_test` 的参数形态本机文档未留证：调用时以注入器内联提示为准；其通过**不能替代**插件功能验证（功能以会话内实际调用 `deepseek_fetch` 并核对返回值为准）。
- 注入通道使用插件 schema 内置默认配置（R4 注释先例：「config 全部使用插件 schema 内置默认值」）；需要覆盖 config 的边界用例（E_NO_KEY / E_AUTH / E_UPSTREAM 死端点）走**纯函数断言（T-09）或独立 profile 装配（阶段05）**，不得为测试改源码默认值。

### 1.6 P0 范围白名单（越界即违约）

- **FR 白名单**：FR-1 ~ FR-8。FR-11 / FR-9 / FR-10 出现在任何任务产出中即违约。
- **工具参数白名单**：`url` / `output_dir` / `clean`。`filename`、`children`、`max_depth`、`max_pages` **禁止出现在参数 schema**（P1 登记，P0 不预留假参数——B2 §3 明文）。
- **产物白名单**：`<产物根>\preset\`、`<产物根>\bundle\`、`<产物根>\evidence\dev-selftest.md`（阶段04 自验证据，先例 = 阶段01 `evidence\api-probe.md`）。基线文件（B1~B5）一律只读。

---

## 2. 交付物总览

```text
C:\project-study\dsh-deepseek-fetch\          # 产物根
├── DEV-PLAN.md                               # 本文件（阶段03）
├── Plugin-Spec.md / Plugin-Design.md / PIPELINE-STATE.md / diagrams\ / evidence\api-probe.md   # 既有基线（只读）
├── preset\                                   # 阶段04 交付：预设配置（P1 结构定义）
│   ├── agent.cordis.yml                      # 工具行（仅承载默认配置；无 service 行 → 无需 isolate realm）
│   └── preset.yml                            # name / description 展示元数据（必写，否则选择器只显示目录名）
├── bundle\                                   # 阶段04 交付：插件包
│   ├── package.json                          # name=@dsh-external/dsh-deepseek-fetch, version=0.1.0, type=module,
│   │                                         #   main=./lib/index.js, peerDependencies, dsh.bundle.patch=./cordis.patch.yml
│   ├── cordis.patch.yml                      # - insert: [{ id: deepseek-fetch, name: '@dsh-external/dsh-deepseek-fetch' }]
│   ├── tsconfig.json                         # 克隆 R5（ES2023/NodeNext/strict/outDir=lib/rootDir=src）
│   ├── scripts\
│   │   ├── build.sh                          # 克隆 R3（DSH_CHECKOUT 探测 + junction + tsc），link 集裁剪见 T-01
│   │   └── verify.mjs                        # 最小自验门禁（纯函数断言；wo00 先例「无则补最小 verify.mjs」）
│   ├── src\
│   │   └── index.ts                          # 唯一源文件：name/inject/Config/apply + 五层管线（约 500~800 行）
│   ├── lib\                                  # 构建产物（build.sh 产出：index.js + types + sourcemap；不入基线）
│   ├── node_modules\                         # build.sh junction（构建期产物；不入基线）
│   └── .gitignore                            # 忽略 node_modules/ 与 lib/（R5 先例）
└── evidence\
    └── dev-selftest.md                       # 阶段04 自验证据（T-10 产出：命令原文 + 关键输出摘录）
```

行数预算：`src/index.ts` 约 500~800 行（T-02~T-07 分摊，单任务 ≤150 行等价改动）+ `scripts/verify.mjs` 约 90 行 + preset 两文件约 25 行 + 构建配置四文件——合计落在 500~900 行预估带内。

---

## 3. WBS 任务表

> 预估图例：S ≤60 行；M 61~150 行；L >150 行（本计划无 L 任务）。
> 所有 shell 命令在 Git Bash 下执行（`bash`/`powershell` 已标注）；`<产物根>` = `C:\project-study\dsh-deepseek-fetch`。
> 「注入器环境」= DSH 会话内 host 侧调用（见 §1.5）。
> **断言执行形式（主侧复核补正，必须遵守）**：下文各任务的 `node -e "…"` 片段是**断言逻辑示意**——其中的反斜杠与引号经 bash 双引号会失真（T-05 尤其严重）。施工时一律改写为 `bundle/scripts/assert-<item>.mjs` 文件（以 `cat > file <<'EOF'` 引号形式写入，禁止插值），再以 `node scripts/assert-<item>.mjs` 执行；这些文件即 T-09 `verify.mjs` 的分项来源，T-09 汇总后 `node scripts/verify.mjs` 为唯一门禁入口。

### T-01 搭建 bundle 骨架与构建链

| 字段 | 内容 |
|---|---|
| ID | T-01 |
| 任务名 | 搭建 `bundle/` 骨架并打通构建链 |
| 归属 | `bundle/package.json`、`bundle/tsconfig.json`、`bundle/scripts/build.sh`、`bundle/cordis.patch.yml`、`bundle/.gitignore`、`bundle/src/index.ts`（最小骨架） |
| 依据 | FR-1~FR-8 的承载骨架；B2 §2.2（HOST 组合 bundle entry）、§11（R2/R3/R4 克隆）；B1 §1（loader id / 工具名 / 包名） |
| 输入 | R2、R3、R4、R5（只读克隆源）；§1.4 环境前提 |
| 产出 | `bundle/package.json`（含 `dsh.bundle.patch` 声明、peerDependencies：`cordis >=4.0.0-rc <5`、`schemastery ^3.18.0`、`@deepseek-ai/dsh-tools >=0.0.1-rc <2`；devDependencies：`typescript ^5.9.0`、`@types/node ^24`；不声明未 import 的 `@deepseek-ai/dsh-llm`）；`bundle/cordis.patch.yml`（insert 条目 `id: deepseek-fetch`，**首行注释须含「bundle」字样**——`check-plugin-ready.mjs` ③ 按目录名 `bundle` 匹配，见 R-01）；`bundle/scripts/build.sh`（克隆 R3 并**删除** `dsh-llm`、`dsh-system-prompt` 两个 `link_pkg` 行——本插件 src 零 import，若 tsc 报缺类型再回加，见 R-03）；`bundle/tsconfig.json`、`bundle/.gitignore`；`bundle/src/index.ts` 最小骨架（`export const name` / `inject = ['tools']` / `Config` 空壳 / `apply` 空实现，约 40 行） |
| 验收判据 | 见下方命令块（构建 exit 0 + 产物在位 + 准入三件套 ①②③ 过） |
| 依赖 | 无 |
| 预估 | S |
| 风险 | R-01、R-03、R-04 |

```bash
# 1) 构建（必须显式 DSH_CHECKOUT，见 §1.4）
cd /c/project-study/dsh-deepseek-fetch/bundle
DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh
# 期望：exit 0；输出含 "=== Build complete ==="；产出 lib/index.js、lib/types/index.d.ts

# 2) 产物在位
ls lib/index.js lib/types/index.d.ts

# 3) 准入三件套（此时未注入，④ 迁移门不触发）
node /d/deepseek-harness/scripts/check-plugin-ready.mjs /c/project-study/dsh-deepseek-fetch/bundle
# 期望：exit 0；输出 [PASS] bundle
```

### T-02 实现工具契约注册（schema + render + 返回形态）

| 字段 | 内容 |
|---|---|
| ID | T-02 |
| 任务名 | 注册 `deepseek_fetch` 工具契约行 |
| 归属 | `bundle/src/index.ts` |
| 依据 | FR-1；B2 §4.1（参数 schema / 返回结构 / 渲染函数）、§5（`inject=['tools']` 唯一硬依赖） |
| 输入 | T-01 骨架；R1 范式（`defineTool` + `ctx.effect` 注册 + effect 标签 `'@dsh-external/dsh-deepseek-fetch: deepseek_fetch'`） |
| 产出 | `src/index.ts` 内：`defineTool({...})` 完整契约——参数 schema **仅** `url`（string，required，描述含 ≤8192/http(s)/禁凭证约束）、`output_dir`（string）、`clean`（boolean）；`output.schema = { type:'object', additionalProperties:true }`；`output.render` 按 B2 §4.1 渲染函数（成功 `抓取成功：<title>\n路径：<path>…`；失败 `抓取失败：<code> — <message>`）；execute 暂返回占位结构（后续任务填充管线） |
| 验收判据 | ① `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` exit 0；② typecheck 见命令；③ **schema 禁 type 数组**（⑥ 门禁）：check-plugin-ready 全 PASS；④ 注入后工具出现在会话工具集 |
| 依赖 | T-01 |
| 预估 | M（约 130 行） |
| 风险 | R-01、R-02 |

```bash
cd /c/project-study/dsh-deepseek-fetch/bundle
/d/deepseek-harness/node_modules/.bin/tsc -p tsconfig.json --noEmit
# 期望：exit 0（typecheck；junction 已由 T-01 build 建立）
node /d/deepseek-harness/scripts/check-plugin-ready.mjs /c/project-study/dsh-deepseek-fetch/bundle
# 期望：exit 0，无 ⑤/⑥ 报错（defineTool 裸属性表是官方 API，不在 ⑤ 管辖）
```

```text
# 注入器环境（DSH 会话内）：
dev_inject_plugin { "dir": "C:/project-study/dsh-deepseek-fetch/bundle" }
dev_plugin_status        # 期望本插件 [active]
# 然后在本会话内向模型请求调用 deepseek_fetch（任意 url），期望：
#   工具出现在工具集中且可被调用（此时 execute 为占位返回，只验注册，不验业务）
```

### T-03 实现校验层与三级凭据解析

| 字段 | 内容 |
|---|---|
| ID | T-03 |
| 任务名 | 实现前置校验层与三级凭据解析 |
| 归属 | `bundle/src/index.ts` |
| 依据 | FR-5（本地前置校验部分）、FR-7；B2 §4.1 参数校验行、§7（凭据解析顺序与理由）、§10（无 Key / URL 非法两行） |
| 输入 | T-02 契约；B5 用例 D/E/F（非法 URL 三形态） |
| 产出 | ① `validateUrl(url): {ok:true} \| {ok:false, reason}` 纯函数（导出）：空 / >8192 / 非 http(s) / 无 host / 含用户名密码（`URL.username`/`URL.password` 非空）→ 拒绝；② `resolveApiKey(env, config, isWin): Promise<string \| null>`（导出）：① `process.env[config.apiKeyEnv]` → ② `config.apiKey` 非空 → ③ 仅 Windows：`reg query HKCU\Environment /v <name>` 解析（非 Windows 跳过）→ null；③ execute 前置接线：校验失败 → `E_INVALID_URL` 返回（不发请求）；无 Key → `E_NO_KEY` 返回（含配置指引 hint） |
| 验收判据 | node 动态 import 断言（不消耗外网调用），见命令块 |
| 依赖 | T-02 |
| 预估 | M（约 110 行） |
| 风险 | R-04（reg query 输出编码）、R-07 |

```bash
cd /c/project-study/dsh-deepseek-fetch/bundle
DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh
node -e "import('file:///C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').then(m => {
  const bad = ['not-a-url', 'ftp://a.com', 'https://user:pass@example.com'];
  for (const u of bad) if (m.validateUrl(u).ok) { console.error('FAIL ' + u); process.exit(1); }
  if (!m.validateUrl('https://example.com').ok) process.exit(1);
  console.log('validateUrl-ok');
})"
# 期望输出：validateUrl-ok

node -e "import('file:///C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').then(async m => {
  const r1 = await m.resolveApiKey({ DSF_X: 'k1' }, { apiKeyEnv: 'DSF_X', apiKey: '' }, false);
  const r2 = await m.resolveApiKey({}, { apiKeyEnv: 'DSF_X', apiKey: 'k2' }, false);
  const r3 = await m.resolveApiKey({}, { apiKeyEnv: 'DSF_NO_SUCH_VAR', apiKey: '' }, false);
  if (r1 !== 'k1' || r2 !== 'k2' || r3 !== null) process.exit(1);
  console.log('resolveApiKey-ok');   // 三级顺序：env → config → (win) registry；全 miss = null
})"
# 期望输出：resolveApiKey-ok（注意：断言不打印任何真实 Key 值）
```

### T-04 实现调用层与 8 错误码分类

| 字段 | 内容 |
|---|---|
| ID | T-04 |
| 任务名 | 实现 DeepSeek API 调用层与错误码映射 |
| 归属 | `bundle/src/index.ts` |
| 依据 | FR-1、FR-5；B2 §4.1 错误码表（8 码）、§7（endpoint/timeoutMs/retries 配置）、§10（重试与分类行）；B5（错误体结构、request_id 在 message 尾部） |
| 输入 | T-03；B5 错误响应结构 `{"error":{message,type,param,code}}` |
| 产出 | ① `classifyError(status, message): string` 纯函数（导出）：401/403→`E_AUTH`；404 且 message 含 `failed to fetch URL`→`E_FETCH_FAILED`；429→`E_RATE_LIMIT`；5xx→`E_UPSTREAM`；其余 4xx→`E_FETCH_FAILED` 兜底；② `fetchOne(url, key, config): Promise<{ok,title,content,request_id,elapsed_ms} \| {ok:false,code,message,request_id?}>`：`AbortController` 超时（`clearTimeout` 于 finally）、`Authorization: Bearer`（仅内存）、5xx/网络异常重试 `config.retries` 次（429 不重试）、从 message 尾部提取 `request_id=<id>`；③ execute 接线：失败返回结构化对象（不抛异常），**任何失败路径不产生文件** |
| 验收判据 | ① 纯函数 8 码断言（node -e，见命令块）；② 构建绿；端到端分类验证在 T-10（注入后实测） |
| 依赖 | T-03 |
| 预估 | M（约 120 行） |
| 风险 | R-07 |

```bash
cd /c/project-study/dsh-deepseek-fetch/bundle
DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh
node -e "import('file:///C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').then(m => {
  const cases = [
    [401, '', 'E_AUTH'], [403, '', 'E_AUTH'],
    [404, 'failed to fetch URL, request_id=x', 'E_FETCH_FAILED'],
    [429, '', 'E_RATE_LIMIT'],
    [500, '', 'E_UPSTREAM'], [503, '', 'E_UPSTREAM'],
  ];
  for (const [s, msg, want] of cases) if (m.classifyError(s, msg) !== want) process.exit(1);
  console.log('classifyError-ok');
})"
# 期望输出：classifyError-ok
# 注：E_INVALID_URL（T-03 前置）、E_NO_KEY（T-03 前置）、E_EMPTY_CONTENT（T-06 前落盘检查）、E_IO（T-06 落盘）不在 classifyError 管辖——四码分支由 T-09 verify.mjs 各自断言，合成 8 码全覆盖。
```

### T-05 实现清洗层（代码块内不剥离、代码块外剥离转义）

| 字段 | 内容 |
|---|---|
| ID | T-05 |
| 任务名 | 实现 Markdown 反斜杠转义清洗 |
| 归属 | `bundle/src/index.ts` |
| 依据 | FR-2；B2 §8（文件内容 = content 经清洗）、§4.1 `clean` 参数；B5 事实 2（实测 `\/ \# \: \. \, \; \( \) \< \> \'` 等 11 处/页） |
| 输入 | T-04；B5 转义清单 |
| 产出 | `cleanMarkdown(content): string` 纯函数（导出）：**逐段扫描，围栏代码块（``` 围栏）内原样保留、块外剥离 Markdown 反斜杠转义**（`\` + 标点 → 标点；`\` + 非标点保留原样——避免误伤 Windows 路径类文本）；`clean:false` 时 execute 直通原文（保真路径零变换） |
| 验收判据 | node -e 断言含「代码块内保留」用例，见命令块 |
| 依赖 | T-04（管线顺序；函数本身无数据依赖） |
| 预估 | S（约 60 行） |
| 风险 | R-08 |

```bash
cd /c/project-study/dsh-deepseek-fetch/bundle
DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh
node -e "import('file:///C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').then(m => {
  const input = '\\\\# 标题\n\n\`\`\`bash\nls C:\\\\dir \\\\\\\\ x\n\`\`\`\n\n\\\\[链接\\\\]';
  const out = m.cleanMarkdown(input);
  if (!out.startsWith('# 标题')) process.exit(11);            // 块外剥离
  if (!out.includes('ls C:\\\\dir \\\\\\\\ x')) process.exit(12); // 围栏内保留
  if (!out.endsWith('[链接]')) process.exit(13);               // 块外剥离
  console.log('cleanMarkdown-ok');
})"
# 期望输出：cleanMarkdown-ok
```

### T-06 实现命名层与原子落盘

| 字段 | 内容 |
|---|---|
| ID | T-06 |
| 任务名 | 实现 slug 命名、重名序号与原子写落盘 |
| 归属 | `bundle/src/index.ts` |
| 依据 | FR-3、FR-4、FR-6；B2 §8 全表（文件名规则 / 原子写 / 并发重名 / 目录）、§10（空正文 / IO 失败 / 并发同名三行） |
| 输入 | T-05；B2 §8 规则原文 |
| 产出 | ① `slugify(title, fallbackHostPath): string` 纯函数（导出）：去 `<>:"/\|?*` 与控制字符 → 空白折叠 `-` → 去首尾 `-`/`.` → 截断 80 字符 → Windows 保留名（`CON/PRN/AUX/NUL/COM1-9/LPT1-9`）前缀 `_` → 空回退 `host-pathname` → 保险回退 `untitled`；② `writeDoc(dir, name, content): Promise<{path,bytes}>`（导出）：`path.resolve` 归一 + `fs.mkdir(recursive)`（FR-6，支持中文空格路径）→ 同目录临时文件 `.<name>.tmp-<pid>-<rand>` → `rename` 原子落位（UTF-8 **无 BOM**，不追加换行/页脚）→ 目标名被占（EEXIST/EPERM）→ 序号 `-2`…`-99` → 仍冲突 `-YYYYMMDD-HHmmss` → 再失败 `E_IO`；临时文件 try/finally `unlink`；③ execute 接线：`content` 空或纯空白 → **不落盘**，返回 `E_EMPTY_CONTENT`（附 request_id） |
| 验收判据 | ① slug 纯函数断言（node -e）；② 构建绿后真实落盘三查（见命令块 PowerShell） |
| 依赖 | T-05 |
| 预估 | M（约 150 行） |
| 风险 | R-04（中文路径/无 BOM/保留名） |

```bash
cd /c/project-study/dsh-deepseek-fetch/bundle
DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh
node -e "import('file:///C:/project-study/dsh-deepseek-fetch/bundle/lib/index.js').then(m => {
  if (m.slugify('  深度求索 API: 文档 ', 'example.com/x') !== '深度求索-API-文档') process.exit(21);
  if (m.slugify('a/b\\\\c?d*e', 'h/p') !== 'abcde') process.exit(22);
  if (m.slugify('CON', 'h/p') !== '_CON') process.exit(23);
  if (m.slugify('', 'example.com/docs/x') !== 'example.com-docs-x') process.exit(24);
  if (m.slugify('x'.repeat(200), 'h/p').length !== 80) process.exit(25);
  console.log('slugify-ok');
})"
# 期望输出：slugify-ok
```

```powershell
# 落盘三查（依赖 T-10 注入后的真实抓取；此处为判据模板，<file> 以实际回报 path 代入）
Test-Path 'C:\deepseek网页抓取\<file>.md'          # 期望 True
Get-Content -TotalCount 1 'C:\deepseek网页抓取\<file>.md'   # 期望首行即正文（无 --- / 无 YAML / 无来源行 / 无时间戳）
$b=[IO.File]::ReadAllBytes('<file>')[0..2]; ($b | ForEach-Object { $_.ToString('X2') }) -join ' '   # 期望输出非 EF BB BF（本机 Windows PowerShell 5.1 无 Format-Hex -Count）
```

### T-07 实现 Config 7 字段与 execute 管线组装

| 字段 | 内容 |
|---|---|
| ID | T-07 |
| 任务名 | 组装 Config 全量字段与五层管线串联 |
| 归属 | `bundle/src/index.ts` |
| 依据 | FR-1（返回字段）、FR-8（output_dir 覆盖）；B2 §7（Config 7 字段与默认值、配置错误大声失败）、§3（五层管线）、§4.1 返回结构 |
| 输入 | T-02~T-06 全部函数 |
| 产出 | ① `Config = z.object({...})` 7 字段全量：`defaultOutputDir`（默认 `C:\deepseek网页抓取`；POSIX 退化 `~/deepseek网页抓取` 由实现处理）、`endpoint`（默认官方 URL，校验 http(s)）、`timeoutMs`（默认 60000，范围 1000–300000）、`retries`（默认 1，范围 0–3）、`defaultClean`（默认 true）、`apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）、`apiKey`（默认 `''`）；② execute 完整串联：校验 → 凭据 → 调用 → 清洗（`clean ?? config.defaultClean`）→ 命名 → 落盘 → 返回 `{ok:true, title, path, bytes, chars, request_id, elapsed_ms}`；`output_dir ?? config.defaultOutputDir`（绝对直用；相对基于会话工作区 `resolve`）；③ 保留 T-02 render 契约（title/path/chars/elapsed_ms/request_id 进返回值，**不进文件**）；④ **额外导出 `export const CONFIG_FIELDS = ['defaultOutputDir','endpoint','timeoutMs','retries','defaultClean','apiKeyEnv','apiKey'] as const`**——断言与 T-09 只依赖该常量，**不依赖 schemastery 对象内部结构**（主侧复核补正）。 |
| 验收判据 | ① 构建绿；② Config schema 常量断言（T-09 收口，此处 node -e 快查）；③ typecheck |
| 依赖 | T-06 |
| 预估 | M（约 90 行） |
| 风险 | R-02、R-07 |

```bash
cd /c/project-study/dsh-deepseek-fetch/bundle
DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh
/d/deepseek-harness/node_modules/.bin/tsc -p tsconfig.json --noEmit
# 断言（按 §3 前言写成 scripts/assert-config.mjs）：
#   从 ../lib/index.js 读 CONFIG_FIELDS，断言长度 = 7 且与设计 §7 字段名逐一相同；
#   任一不符 exit 31。（不依赖 schemastery 对象内部结构）
node scripts/assert-config.mjs
# 期望输出：config-fields-ok
```

### T-08 编写 preset/ 预设配置

| 字段 | 内容 |
|---|---|
| ID | T-08 |
| 任务名 | 编写 `preset/` 工具型 bundle 预设 |
| 归属 | `preset/agent.cordis.yml`、`preset/preset.yml` |
| 依据 | B1 §1（预设 id `preset-dsh-deepseek-fetch`）；B2 §2.2 结论（「仅承载默认配置（bundle 预设），不含 service」→ 无 service 行 → **无需 isolate realm group**）；P1 §B 线（结构 + 复制纪律） |
| 输入 | R6（agent-presets 组合行范式）；T-02 定稿的插件名 |
| 产出 | `preset/agent.cordis.yml`：单行工具行 `- id: deepseek-fetch` / `name: '@dsh-external/dsh-deepseek-fetch'`（不写 config——默认值即 schema 内置，与 R4 同策略；文件头注释说明「工具型 bundle 预设，仅承载默认配置」）；`preset/preset.yml`：`name: DeepSeek 网页抓取（deepseek_fetch）` + `description:`（B1 §1 一句话定位原文）。**不编辑** R6 安装目录本体，只复制改 |
| 验收判据 | ① 两文件存在且 preset.yml 双字段在位；② YAML 可被 loader 方言解析（与准入② 同一解析器），见命令块 |
| 依赖 | T-02（插件名/工具行定稿） |
| 预估 | S（约 25 行） |
| 风险 | R-02（preset 行与 bundle patch 并存的双挂载语义 → T-10 试装验证） |

```bash
# 断言（按 §3 前言写成 scripts/assert-preset.mjs；heredoc 写入，避免引号/反斜杠失真）
#   js-yaml 取自 check-plugin-ready.mjs 同源依赖：
#     D:/deepseek-harness/node_modules/.pnpm/js-yaml@4.2.0/node_modules/js-yaml/index.js
#   断言：agent.cordis.yml 解析为数组且 rows[0].name === '@dsh-external/dsh-deepseek-fetch'；
#         preset.yml 的 name / description 均非空。任一不符 exit 41 / 42。
node scripts/assert-preset.mjs
# 期望输出：preset-ok
```

### T-09 建立最小自验门禁 verify.mjs

| 字段 | 内容 |
|---|---|
| ID | T-09 |
| 任务名 | 建立 `scripts/verify.mjs` 汇总断言门禁 |
| 归属 | `bundle/scripts/verify.mjs` |
| 依据 | P3 O5 ②（构建绿）；wo00 先例验收判据第 3 条原文「插件自有 verify/test 门禁 exit 0（无则补最小 verify.mjs——工具 schema 常量断言）」；T-03~T-07 各任务的 node -e 断言收口 |
| 输入 | T-02~T-07 产出的全部导出纯函数与常量 |
| 产出 | `verify.mjs`（约 90 行）：动态 `import('../lib/index.js')` 后断言——① 模块可加载（name/inject/Config 在位）；② 工具契约常量（工具名 `deepseek_fetch`、参数键集合 = `{url, output_dir, clean}` **无 P1 参数**）；③ `validateUrl` 三形态拒/一形态过；④ `resolveApiKey` 三级顺序与全 miss；⑤ `classifyError` 8 码映射全集（含 4 码非管辖说明性断言：E_INVALID_URL/E_NO_KEY/E_EMPTY_CONTENT/E_IO 在 execute 分支——以常量存在性断言错误码表完整性）；⑥ `cleanMarkdown` 块内保留/块外剥离；⑦ `slugify` 五边界；⑧ Config 7 字段键。**输出不含任何 Key 值**；失败非零退出并打印失败项 |
| 验收判据 | `node scripts/verify.mjs` exit 0（命令见下）；人为注入一个错误断言能使之 exit≠0（防恒绿，P3 O6「能失败」纪律） |
| 依赖 | T-07 |
| 预估 | S（约 90 行） |
| 风险 | R-08 |

```bash
cd /c/project-study/dsh-deepseek-fetch/bundle
node scripts/verify.mjs
# 期望：exit 0；输出逐项 <item>-ok 汇总 + "verify: PASS"
# 防恒绿抽检（施工时任选一断言临时改错期望值复跑，期望 exit≠0，验毕还原）
```

### T-10 注入通道全环自测与证据落盘

| 字段 | 内容 |
|---|---|
| ID | T-10 |
| 任务名 | 执行注入全环功能自测并落证据 |
| 归属 | `evidence/dev-selftest.md`（新文件；命令与输出摘录的唯一记录处） |
| 依据 | B2 §10（失败模式全表）、§9（生命周期与回收）；P3 O5 ③⑤；B1 §2 成功判据 1~5 |
| 输入 | T-01~T-09 全部产物；注入器环境（§1.5） |
| 产出 | `evidence/dev-selftest.md`：含 ① 注入/状态/卸载全环命令与输出；② 端到端用例记录（下表 7 项可真实触发码 + 成功路径全部返回字段）；③ 落盘核验（T-06 PowerShell 三查 + 重名 `-2` + `clean:false` 保真对比）；④ 无 Key/无效 Key/死端点类用例以 T-09 纯函数断言 + 阶段05 独立 profile 补测的说明。**证据中不得出现 Key 明文** |
| 验收判据 | 全环命令序列 + 端到端用例表全部通过（见下） |
| 依赖 | T-08、T-09 |
| 预估 | S（0 行代码；验证与记录工作） |
| 风险 | R-01、R-02、R-07 |

```text
# 注入器环境（DSH 会话内）——全环序列：
dev_plugin_status                                   # 注入前：确认无本插件残留记录
node D:/deepseek-harness/scripts/check-plugin-ready.mjs C:/project-study/dsh-deepseek-fetch/bundle   # 未注入时点再取一次全 PASS 证据
dev_inject_plugin { "dir": "C:/project-study/dsh-deepseek-fetch/bundle" }
dev_plugin_status                                   # 期望 [active]
dev_self_test                                       # 注入器链自测（其通过不替代下列表格的功能实测）
# ……执行下表端到端用例……
dev_uninject_plugin @dsh-external/dsh-deepseek-fetch
dev_plugin_status                                   # 期望无本插件记录（卸载即净）
```

端到端用例表（T-10 实测，结果记入 `evidence/dev-selftest.md`）：

| # | 用例 | 调用 | 期望 |
|---|---|---|---|
| U1 | 成功·默认目录 | `deepseek_fetch({url:'https://example.com'})` | `ok:true` + 真实存在的绝对路径 + `bytes/chars/request_id/elapsed_ms` 齐全；`Test-Path` True；首行即正文；无 BOM |
| U2 | 成功·自定义目录 | `deepseek_fetch({url:'https://example.com', output_dir:'C:\dsf-自验-临时'})` | 落盘在自定义目录（中文路径可用）；验毕手删该临时目录 |
| U3 | 成功·clean:false 保真 | 同 URL 再抓 `clean:false` | 文件与接口原文逐字节一致（与 U1 文件 diff 仅应差在 U1 已清洗） |
| U4 | 重名序号 | 同一标题页连续抓 2 次 | 第二个文件名带 `-2` 后缀，两文件并存不覆盖 |
| U5 | E_INVALID_URL | `deepseek_fetch({url:'not-a-url'})` | `ok:false, code:'E_INVALID_URL'`；目标目录无新文件 |
| U6 | E_FETCH_FAILED | `deepseek_fetch({url:'https://zh.wikipedia.org/zh-cn/Markdown'})` | `ok:false, code:'E_FETCH_FAILED'` + 上游 message/request_id + hint 建议换 site_crawl；无文件（B5 用例 H 复现基线） |
| U7 | E_UPSTREAM | 阶段04 以 T-09 纯函数断言；阶段05 独立 profile 下把 patch config `endpoint` 覆盖为死端口（如 `http://127.0.0.1:1/v1/tools/fetch`）实测 | `ok:false, code:'E_UPSTREAM'`（重试 1 次后）；无文件 |
| U8 | E_NO_KEY / E_AUTH / E_RATE_LIMIT / E_EMPTY_CONTENT / E_IO | T-09 纯函数断言全覆盖；E_NO_KEY/E_AUTH 阶段05 独立 profile 以 `apiKeyEnv` 指向不存在变量 / `apiKey` 置无效值补测；E_IO 以 `output_dir` 指向一个**已存在文件**路径实测（mkdir EEXIST/ENOTDIR → E_IO）；E_RATE_LIMIT 端到端遇 429 顺带记录（不人为制造） | 各自 `ok:false` + 对应 code；均无文件产生 |

> U1~U6 为阶段04 注入通道实测；U7/U8 标注了两层覆盖方式（阶段04 纯函数断言 + 阶段05 独立 profile 实测），**不宣称注入通道做不到的覆盖**。

---

## 4. 执行序列与并行度

**默认串行**。核心原因：T-02~T-07 全部写入**同一文件** `bundle/src/index.ts`（单文件设计，B2 §3 + 行数预估决定），共享写入面 → 并行必冲突。

| 批次 | 任务 | 串行/并行 | 理由 |
|---|---|---|---|
| 批1 | T-01 | 串行 | 构建链先通，后续一切验收依赖 `lib/` 产物 |
| 批2 | T-02 → T-03 → T-04 → T-05 → T-06 → T-07 | 串行 | 同文件 `src/index.ts` 顺序写入；且管线层次有数据依赖（execute 串联） |
| 批3 | T-08 | **可与批2 的 T-05~T-07 并行**（不同文件、零共享写入；保守起见也允许串行收尾） | `preset/` 独立目录，仅依赖 T-02 定稿的插件名 |
| 批4 | T-09 | 串行（在 T-07 后） | 汇总断言需要全部导出函数定型 |
| 批5 | T-10 | 串行（最后） | 全环验证依赖全部产物 + verify 绿 |

每批完成即按对应任务验收判据取证（命令 + 关键输出摘录，落入施工记录；T-10 统一汇总进 `evidence/dev-selftest.md`）。**批内任何验收不过不进入下一批**；批5 结束即到达里程碑 M1（见 §8）。

---

## 5. UI 说明（B 分支 · 本插件无 UI）

**分支判定**：B 分支（无前端 UI）。依据为 `Plugin-Design.md` §12 原文：

> 【本插件无前端 UI 模块，跳过 style-design 页面设计环节】

及其引用的阶段01 定稿（`Plugin-Spec.md` §7：「纯后台逻辑 / 纯工具插件，无任何前端 UI 视图」；承载形态不适用，**后续阶段不得改写本结论**）。

因此本计划：

- **无 verify 门禁**：不执行 `verify <项目>` / `--host-theme` / `--max-exempt` 任何模式；阶段05 亦无 UI 门禁复核项（plugin-checker §6 整节不适用）。
- **无 design/ 基线**：不创建 `design/` 目录、无 DESIGN.md、无 theme kit、无页面脚手架、无 `design.lock.json`、无已登记例外清单。
- **无 client 半**：`bundle/` 不含 `src/client/`、无 `exports['./client']`、无 `dsh.client.platform` 声明；不占任何 slot。
- 交付物里不存在任何 `.html`/`.css`/前端 bundle 产物；WBS 无 UI 任务。

**纪律（保留一条）**：若施工中发现确需 UI（例如用户要求「加一个面板手动填 URL」），**不得就地写任何前端代码**——立即停止施工，回退阶段02 重新触发 UI 识别与 `style-design` 设计审核闭环（修订 B1 §7 需先回退阶段01），重新走完 02→03 之后才允许继续开发。任何「先改了再说」都属违规。

---

## 6. 风险登记与回退

| 编号 | 风险描述 | 触发条件 | 影响面 | 缓解 | 回退 |
|---|---|---|---|---|---|
| R-01 | **DSH 三件套准入失败**：`dsh.bundle.patch` 声明缺失/指向不存在文件；`cordis.patch.yml` 不被 loader 方言解析；试装出现 `plugin tree failed / duplicate / already registered / declares no` | T-01 声明写错；patch 含损坏 YAML；loader entry 冲突 | 插件无法装配，后续全部验收阻塞 | T-01 即跑 `check-plugin-ready.mjs`（六项门禁：①声明②解析③insert④迁移门⑤裸注册 schema⑥type 数组禁用）并保持 exit 0；patch 为纯 insert + 注释的标准 YAML，不用 `!!js`；**注意**：③ 按目录名 `bundle` 匹配，patch 注释须含「bundle」字样（check-plugin-ready.mjs:95-104 实测逻辑）；④ 迁移门要求**在 inject 之后跑必 FAIL**——证据采集时点固定为 build 后、inject 前（quantstudio §8-④ 先例） | 修正声明/patch 后重跑三件套；若 loader 冲突无法消解 → 从 registry 与 bundles 双侧确认单挂载后重试 |
| R-02 | **唯一性冲突**：loader id / 工具名 `deepseek_fetch` 与既有装配冲突；或 `preset/` 工具行与 bundle patch insert 行**双挂载**语义未实证 | 已有同名工具或 entry；同一插件同时经注入通道与 bundles 装配 | 启动崩溃（duplicate loader entry id）或工具重复注册 | 开工前已核 registry 7 件无冲突（§1.4）；B1 §8 唯一性核对三行（loader id ✅ / 工具名 ✅ / slot 不适用）；开发期只在注入通道（隔离）挂载，不进共享 bundles；preset 行与 bundle patch 并存场景在 T-10 试装以「无 duplicate 报错」显式验证 | `dev_uninject_plugin` 即净；若双面并存实测冲突 → 裁定单挂载面（preset 行仅用于未走 bundle patch 装配的部署），在阶段04 报告中登记并回改本计划（§9 变更） |
| R-03 | **依赖解析失败**：peerDependencies 范围与宿主不匹配；build.sh junction 缺包导致 tsc 类型错误；`@standard-schema` .pnpm 探测落空 | 删减 link 集后 dsh-tools 类型传递依赖缺失；checkout 结构变化 | 构建红，T-01 起全部验收阻塞 | link 集裁剪仅删 `dsh-llm`/`dsh-system-prompt`（src 零 import 实证），保留 cordis/cosmokit/schemastery/dsh-tools/@types/node + @standard-schema 探测块；tsc 报缺类型即回加对应 `link_pkg` 行重跑（R3 自带探测） | 恢复与 R3 完全一致的 link 集整只克隆（多 link 两个包无害）；peerDeps 范围按 R2 原样回退 |
| R-04 | **平台风险（Windows）**：中文/空格路径处理、UTF-8 无 BOM 写入、Windows 保留名、`reg query` 输出编码、Git Bash 与 WSL 的 bash 差异 | 默认目录 `C:\deepseek网页抓取` 含中文；PowerShell 5.1 读 UTF-8；quantstudio 曾遇「本机 bash=WSL 不可用」 | 落盘乱码/BOM 污染；slug 生成保留名冲突；三级凭据第三级解析失败；build.sh 不可执行 | 路径全走 `node:path`（B1 §5 跨平台行）；写入显式 `utf8` 无 BOM（T-06 判据：`[IO.File]::ReadAllBytes` 前 3 字节非 `EF BB BF`）；slug 保留名前缀 `_`（T-06 断言）；reg query 解析对值做 trim/编码容错，非 Windows 跳过；build.sh 一律在 **Git Bash** 下跑（本计划全部 bash 命令的执行环境） | 编码类失败：改用 node 侧 `fs.writeFile` 显式编码重写落盘实现；bash 环境不可用：按 quantstudio 先例以 pwsh 等价执行 junction+tsc 两步，或走注入器 `dev_build_plugin` 包装路径 |
| R-05 | **UI 漂移**（本项目不适用，说明理由） | —— | —— | B 分支无 UI：无 design/ 基线、无 verify 门禁、无 client 半（§5），不存在「实现偏离锁定设计」的对象 | 纪律保留：施工中一旦发现确需 UI → 停止施工，回退阶段02 重走 style-design 闭环（§5）；不就地写前端代码 |
| R-06 | **形态误判风险**：把 toolkit 误按 ui-panel/hybrid 施工（加 client 半、加 slot、加 `dsh.client.platform`）；或把「无 UI」误读到 host 工具实现上（漏实现 render） | 施工时惯性复制 hybrid 模板（如 quantstudio 骨架） | 形态漂移 → 准入面膨胀、无谓 client 声明、验收范围失真 | 开工前复核 B1 §6（形态判定：toolkit）与 §7（UI 结论）；模板只用 R1（site-crawl，同为纯工具 toolkit）；`output.render` 属于**工具契约**而非 UI，必须实现（B2 §4.1）——「无 UI」不豁免 render | 若发现已按错误形态产出 → 删除 client 半相关产物回到 R1 范式重做；若确系需求变化（真要 UI）→ 回退阶段01/02 重判（同 §5 纪律） |
| R-07 | **上游接口行为漂移**：实测基线（B5，2026-10-21）过期——错误 message 格式变化、429 阈值/行为变化、成功响应结构变化 | DeepSeek 调整 fetch API；限流策略收紧 | 错误码误分类；端到端用例失败 | 错误分类同时依据 status 与 message 双信号（classifyError）；request_id 提取对 message 尾部格式容错；B5 复现命令保留可重跑（`evidence/api-probe.md` §复现方式）；429 只兜底不做阈值假设（B1 §9） | 端到端失败时先重跑 B5 探针定位漂移点：仅 message 措辞变化 → 修 classifyError 匹配并过 T-09；结构性变化 → 停工上报用户，回退阶段02 修订设计（属基线变更） |
| R-08 | **清洗层正确性风险**：围栏代码块边界误判（嵌套/未闭合围栏、行内反引号）、转义剥离过度（误伤非 Markdown 转义的反斜杠，如 Windows 路径 `C:\dir`） | content 含不规则围栏或路径类文本 | 正文被污染（FR-2 违约）；`clean:false` 不受影响（直通） | 规则收敛为「围栏内不剥离、围栏外仅剥离 `\`+Markdown 标点」；T-05/T-09 断言含保留用例；若遇真实页面清洗误判，以 `clean:false` 为用户可用兜底 | 收紧/放宽正则后重跑 T-05+T-09+U3 三查；两轮修复仍有 P0 级误判 → 上报用户裁定规则修订（属设计 §8 变更，走 §9 变更流程） |

---

## 7. 验收标准

### 7.1 阶段04 自验（每任务一条命令 + 关键输出摘录要求）

| 任务 | 命令（Git Bash，`cd bundle/` 后） | 必须出现的关键输出 |
|---|---|---|
| T-01 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh`；`node /d/deepseek-harness/scripts/check-plugin-ready.mjs /c/project-study/dsh-deepseek-fetch/bundle` | `=== Build complete ===`；`[PASS] bundle`；exit 0 |
| T-02 | `/d/deepseek-harness/node_modules/.bin/tsc -p tsconfig.json --noEmit` + 注入器环境 `dev_plugin_status` | tsc exit 0；本插件 `[active]`；会话工具集出现 `deepseek_fetch` |
| T-03 | T-03 的两条 `node -e`（validateUrl / resolveApiKey） | `validateUrl-ok`；`resolveApiKey-ok` |
| T-04 | T-04 的 `node -e`（classifyError 六组） | `classifyError-ok` |
| T-05 | T-05 的 `node -e`（cleanMarkdown 三断言） | `cleanMarkdown-ok` |
| T-06 | T-06 的 `node -e`（slugify 五断言）+ U1 后 PowerShell 三查 | `slugify-ok`；`Test-Path` True；首行即正文；首 3 字节非 `EF BB BF` |
| T-07 | `bash scripts/build.sh` + `tsc --noEmit` + T-07 的 `node -e` | `config-fields-ok` |
| T-08 | T-08 的 `node -e`（YAML 解析） | `preset-ok` |
| T-09 | `node scripts/verify.mjs` | 逐项 `-ok` + `verify: PASS`；exit 0；防恒绿抽检记录 |
| T-10 | §3 T-10 的注入器全环序列 + U1~U6 实测 | 全环输出 + 用例表结果落 `evidence/dev-selftest.md` |

**摘录纪律**：每条证据 = 命令原文 + 退出码 + 关键输出摘录（失败必须完整原样输出报错，禁止筛选/简化/美化——P1 §构建与自验第 5 条）；`evidence/dev-selftest.md` 为阶段04 证据唯一汇总处；任何输出中不得出现 API Key 明文。

### 7.2 阶段05 终验（plugin-checker 口径）

1. **构建通过**：`DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` exit 0；`tsc -p tsconfig.json --noEmit` exit 0；`node scripts/verify.mjs` exit 0。
2. **试装/注入生效**（三件套 + 功能）：
   - 未注入时点 `check-plugin-ready.mjs` 全 PASS（六项，exit 0）；
   - 注入通道全环：`dev_inject_plugin` → `dev_plugin_status [active]` → `dev_self_test` → 功能实测（U1~U6）→ `dev_uninject_plugin`；
   - **独立 profile 真实试装**：启动日志到达宿主就绪行，**无** `plugin tree failed / duplicate / already registered / declares no` 类报错；正式进共享 bundles 按 P3 §八三件套：`check-plugin-ready.mjs` 全 PASS → `dsh plugin --profile web add` 试装 → 启动达 `dsh web: http://127.0.0.1:3080` 无插件树错误；
   - 独立 profile 下以 patch config 覆盖补测 U7/U8（死端点→`E_UPSTREAM`；`apiKeyEnv` 指向不存在变量→`E_NO_KEY`；无效 `apiKey`→`E_AUTH`；`output_dir` 指向已存在文件→`E_IO`）。
3. **边界用例 8 错误码覆盖**：U5/U6 端到端 + U7 端到端（独立 profile）+ U8（E_NO_KEY/E_AUTH/E_IO 端到端，E_RATE_LIMIT/E_EMPTY_CONTENT 以 T-09 纯函数断言覆盖并在报告注明覆盖方式）；**所有失败路径核验零文件产生**（目标目录前后清单对比）。
4. **卸载即净**：`dev_uninject_plugin` 后 `dev_plugin_status` 无本插件记录；无残留路由/定时器/slot/监听器/**junction**（四处清理：依赖声明、node_modules link、持久化锁文件、注入台账——P1 §A 纪律）；重载前后 `dev_reload_package` 无重复注册。
5. **SHIPPABLE 判据**：按 P2 出具 `SHIPPABLE.md`（检查范围/逐项结果表/缺陷清单/残留结论/交付说明），全部检查项通过且有证据 → 输出 `SHIPPABLE`；存在未闭合缺陷 → `NOT SHIPPABLE` + 阻塞项清单。UI 门禁复核整节不适用（B 分支，§5）。
6. **凭据红线终核**：全部证据材料（含 `evidence/dev-selftest.md`、`SHIPPABLE.md`）中无 Key 明文；`clean:false` 产物文件亦不含 Key（正文与 Key 无接触面）。

---

## 8. 里程碑

| 里程碑 | 名称 | 到达判据（全部满足才算到达） |
|---|---|---|
| **M1** | 阶段04 完成点（开发收口） | ① T-01~T-10 全部验收判据取证通过（§7.1 表逐行）；② 准入三件套过（`check-plugin-ready` 全 PASS + 注入全环 `[active]` + 启动无插件树错误）；③ 8 码覆盖按 §7.2-3 的方式全部闭合；④ 卸载即净验证通过；⑤ `evidence/dev-selftest.md` 落盘且无 Key 泄漏；⑥ 向用户呈报并获【阶段4审核通过】（一阶段一交付一暂停，P1 完成判定） |
| **M2** | 阶段05 完成点（可发布收口） | ① 独立 profile 试装 + 正式三件套（含 `dsh plugin --profile web add` + 就绪行）通过；② `SHIPPABLE.md` 出具且标记 `SHIPPABLE`（或 `NOT SHIPPABLE` + 阻塞项，此时 M2 未达）；③ 卸载即净与凭据红线终核通过；④ 用户最终验收通过（P2 强制暂停分支：用户确认后才宣布闭环） |

---

## 9. 计划变更日志

| 日期 | 版本 | 变更内容 | 影响范围 | 触发方 |
|---|---|---|---|---|
| 2026-10-21 | v0.1 | 初版：依 B1 v0.3 + B2 v0.1 拆解 10 条任务（T-01~T-10）、8 项风险（R-01~R-08，含用户点名六类）、两层验收、双里程碑 | 全部 | 阶段03 计划（本文件） |
| 2026-10-21 | v0.2 | **主侧复核修正 5 处施工阻断点**：① R6 活模板路径更正为 `C:\Users\Administrator\.dsh\.agent-presets\`（`apps\cli\config\agent-presets` 只剩 `.bak`）；② 新增「断言执行形式」约定——`node -e` 片段仅作逻辑示意，施工改 `scripts/assert-<item>.mjs` + heredoc 写入（T-05 反斜杠经 bash 双引号失真会必错）；③ T-08 断言块原有悬空 `)` 造成 SyntaxError，改为 assert-preset.mjs；④ T-07 增导出 `CONFIG_FIELDS` 常量，断言不再依赖 schemastery 内部结构；⑤ T-06 BOM 检查改 `[IO.File]::ReadAllBytes`（本机 PS 5.1 无 `Format-Hex -Count`），§1.4 tsc 核验改 POSIX 路径 | §1.2/§1.4、§3 前言、T-06/T-07/T-08 | 主侧复核（阶段03 交付前） |

| 2026-10-21 | v0.3 | **P1 第二批增量计划**（见 §10）：依 `Plugin-Design.md` v0.3 §14 拆解 T-11~T-15（参数/Config、发现层+robots、BFS 预算、合并器+命名、端到端+回归），新增 R-09~R-15 风险，里程碑 M3/M4 | 新增 §10 | 待审核（P1 阶段03） |
| 2026-10-22 | v0.4 | **P2 第三批增量计划**（见 §11）：依 `Plugin-Design.md` v0.4 §15 拆解 T-16~T-21（参数/Config/错误码、Edge 探测+CDP 渲染器、滚动定位+分屏截图、择源器+素材包、自验门禁、端到端+回归），新增 R-16~R-23 风险，里程碑 M5/M6；**不引入新 npm 依赖**（Node 内置 fetch/WebSocket） | 新增 §11 | 待审核（P2 阶段03） |
| 2026-10-22 | v0.5 | **P2 阶段04 主侧修复记录**（ZCode 交付后主侧实测发现并修，5 处）：① `assert-shots` 样例与阈值不自洽（`sh=700/ch=600` 实为可滚）→ 改 640/600（**断言错，实现对**）；② 渲染通道**缺就绪等待**（只等 700ms，页面未成型）→ 补 `waitForRenderReady` 轮询；③ 候选容器**采集过早**（正文容器尚未建好）→ 补 `waitForScrollableContent`（要求 scrollHeight ≥ 3×clientHeight）+ 触底后重选容器；④ **取文字视口不足**（900/1600 视口下 WebOffice 正文不进 DOM，**静默只剩轮廓面板 1391 字**）→ 改**两阶段视口**（高视口 1440×2400 取文字 → 切回 1440×900 取截图），正文 662 → **2387 字**；⑤ Config 增 `renderTextViewport`（16 → 17 字段）并同步 `assert-config` | `src/index.ts`、`assert-config.mjs`、`assert-shots.mjs` | 主侧修复（阶段04 内） |
| 2026-10-23 | v0.9 | **P3 阶段05（独立审查 → 修复 → 复验）**：审查报 0×P0 / **3×P1** / 8×P2。P1-1 **真实误删路径**（小面积高对比被均值稀释 → 判重丢内容）→ 加 **uniform 守卫 + 逐格否决**（阈值 3 / 24），并新增 ③j/③k/①/①b/①c 五组断言；P1-2 fallback 端到端缺断言 → ⑧g；P1-3 比较基准无判别性断言 → ③i（三段帧）；P2-1/2/3/4/5/7 全修（预算精确断言 ⑧e、settle 真作用于等待 ⑧f、PNG 畸形统一抛错、partial 返回补字段、无截图路径报 none、文档三处偏差）。**两次突变抽检**均按预期失败。**代价如实登记**：加固后真实序列丢弃数降为 0（安全优先，恢复收益需 P4 的 UI 掩蔽方案） | `src/index.ts`、4 个断言文件 | 主侧修复（阶段05 内） |
| 2026-10-23 | v0.8 | **P3 阶段04 记录**：ZCode 交付 7 文件（+303 行，零越权）；主侧修 1 处**测试桩缺陷** D-29（假会话把 `JS_RENDER_READY` 误判成 0 → 就绪轮询空等 30s → ⑧d 超时；改为先判就绪特征再判 canvas）；门禁 **22 项 PASS**；两次防恒绿抽检（常量守卫 + **去掉 MAD 复核的行为突变**）均按预期失败；真实端到端：不传 settle = `settle 700/预算 90000` 零回归、传 2500 = `settle 2500/预算 220000` 不超时且**去重丢 4 张**；去重安全侧核验：新包 41 张相邻无残留近重复、**近空白帧 0 张**、全帧 sd≥32（无真内容误删） | `src/index.ts`、`assert-pipeline.mjs` | 主侧修复（阶段04 内） |
| 2026-10-23 | v0.7 | **P3 第四批增量计划**（见 §12）：依 `Plugin-Design.md` v0.5 §16 拆解 T-22~T-27（参数+预算联动 / PNG 解码器 / dHash+MAD 判定 / 去重接线 / 门禁 20→22 项 / 真实两轮+回归），新增 R-24~R-28 风险，里程碑 M7/M8；**零新 npm 依赖**（PNG 用 Node 内置 zlib） | 新增 §12 | 待审核（P3 阶段03） |
| 2026-10-22 | v0.6 | **P2 阶段04 追加修复（用户复跑 max_shots=20 触发）**：取文字的"连续两次相同即稳定"判据被渲染**平台期**骗过 → 同一文档两次得到 1693 / 2404 字。改为 `waitForTextLongest`（切视口后等 2.5s 重排 + 6s 窗口内取**最长**的一份）+ **阶段 C 复读**（滚动后再回高视口取一次，取更长者）；新增断言 ⑦（"必须取最长而非首个平台期"，含管线级用例）并做防恒绿抽检（突变 → exit 53、还原 → PASS）。修复后连跑两次为 **2527 / 2404** 字符（均为完整档） | `src/index.ts`、`assert-pipeline.mjs` | 主侧修复（阶段04 内） |

> 变更纪律：施工中任何偏离（如 R-02 双挂载裁定、R-07 上游漂移处置）须先在本日志登记变更行（日期/版本/内容/影响/触发方），经用户确认后才按新基线执行；禁止先改后补记。

---

## 10. P1 第二批增量计划（FR-11 · v0.3）

- 输入基线：`Plugin-Design.md` **v0.3 §14**（已过审）、`Plugin-Spec.md` v0.3 FR-11
- 施工产物仍是同一 `bundle/`（版本号 `0.1.0 → 0.2.0`），**不新增 preset 行、不新增 loader entry**
- 规模预估：新增/改动约 **330~420 行** TypeScript（`src/index.ts` 由 ~640 行增至 ~1000 行）

### 10.1 WBS

| ID | 任务名 | 归属 | 依据 | 产出 | 验收判据（可执行） | 依赖 | 预估 | 风险 |
|---|---|---|---|---|---|---|---|---|
| T-11 | 扩展工具参数与 Config | `bundle/src/index.ts`、`bundle/scripts/assert-config.mjs`、`bundle/scripts/verify.mjs` | FR-11；Design §14.2 / §14.8 | `TOOL_PARAMETERS` 增 `children/max_depth/max_pages`（含 required/范围）；`Config` 增 4 字段；`CONFIG_FIELDS` 更新为 11 项；`FetchArgs` 扩展；`ALLOWED_ARG_KEYS` 自动跟随 | `bash scripts/build.sh` exit 0；`tsc --noEmit` exit 0；`node scripts/verify.mjs` → `config-fields-ok`（11 项）+ `tool-contract-ok`（6 参数、且无 filename/children 之外的 P1 参数）；`node scripts/assert-config.mjs` exit 0 | T-10 | S | R-13 |
| T-12 | 实现发现层与 robots 解析 | `bundle/src/index.ts`、`bundle/scripts/assert-discover.mjs`（新） | FR-11；Design §14.3 / §14.4 | `extractAnchors(html)`、`normalizeLink(href, baseUrl)`（去 fragment、仅 http/https）、`sameHost(url, rootHost)`（严格同 host）、`BLOCKED_EXT` 过滤、`parseRobots(text)` + `robotsAllows(rules, pathname)`（最长前缀）；`fetchHtml(url, timeoutMs, signal)` | `node scripts/assert-discover.mjs` exit 0：覆盖 7 类样例（相对链接 / 绝对链接 / `#anchor` / `mailto:` / 跨 host / `.png` 黑名单 / 重复路径去重）+ robots 4 类样例（`Disallow: /` 拒、`Allow` 覆盖 `Disallow`、`User-agent: *`、空 rules 放行） | T-11 | M | R-09、R-10 |
| T-13 | 实现 BFS 与预算控制 | `bundle/src/index.ts`、`bundle/scripts/assert-bfs.mjs`（新） | FR-11；Design §14.5 | `crawlChildren(rootUrl, key, config, signal)` → `{ pages[], skipped[], budgetExhausted }`；FIFO、深度限制、页数上限、并发 ≤ `childrenConcurrency`、总预算 `childrenTimeoutMs`、单页失败跳过 | `node scripts/assert-bfs.mjs` exit 0（依赖本地桩服务）：① 深度 1 只抓根+直链；② `max_pages=3` 截断；③ 子页 500 → 记入 skipped 且整体继续；④ 预算 300ms → `budgetExhausted=true` 且已抓页保留；⑤ 取消信号 → 提前返回且无落盘 | T-12 | M | R-12、R-14 |
| T-14 | 实现合并器与合集命名 | `bundle/src/index.ts`、`bundle/scripts/assert-merge.mjs`（新） | FR-11；Design §14.6 / §14.7 | `renderMerged(root, pages, skipped)`（根 `#`、子 `##`、`---` 分隔、`> 来源: <url>`、文末「未抓取清单」）、`mergedSlug(title, url)`（`-合集` 后缀 + URL 形态标题回退） | `node scripts/assert-merge.mjs` exit 0：字符串含 `# <根标题>`、`## <子标题>`、`> 来源:`、`---`；有 skipped 时含「## 未抓取清单」；`mergedSlug('深度求索 API','https://x') === '深度求索-API-合集'`；URL 形态标题 → `host-path-合集` | T-13 | S | R-09 |
| T-15 | 合集路径端到端与 P0 回归 | `bundle/scripts/verify.mjs`、`evidence/p1-selftest.md`（新） | FR-11；Design §14.9；DEV-PLAN §7.1 | verify 增 3 项（discover/bfs/merge）；证据文件记录命令+输出 | ① `node scripts/verify.mjs` exit 0（新增 3 项 + 原 10 项）；② **P0 回归**：`children:false` 与不传参数行为一致（落盘纯正文、无来源行、重名 -2）；③ 真实站点 `children:true`（`https://api-docs.deepseek.com/zh-cn/guides/search`）→ `pages_total>=2`、文件含 `> 来源:`；④ 落盘核验：首行 = `# <根标题>`、无 BOM、无 front matter | T-14 | S | R-10、R-13 |

### 10.2 执行序列与并行度

**全串行**（T-11 → T-12 → T-13 → T-14 → T-15）。原因：T-11~T-14 全部写入同一文件 `bundle/src/index.ts`，且 T-13 依赖 T-12 的发现函数、T-14 依赖 T-13 的返回值结构。

### 10.3 无 UI 说明

沿用阶段02 B 分支结论（本插件无前端 UI）：`design/` 不存在、无 verify 门禁、无例外清单；P1 不新增任何 UI。若施工中发现确需 UI → 停止，回退阶段02。

### 10.4 风险登记（增量）

| 编号 | 风险 | 触发 | 影响 | 缓解 | 回退 |
|---|---|---|---|---|---|
| R-09 | robots / 锚点解析误判 | 规则写法非标准（通配符、CRLF、大小写） | 误拒（少抓）或误放（越界） | 最长前缀匹配 + 4 类 robots 样例 + 7 类锚点样例；不确定时**偏保守**（拒） | `respectRobots=false` 参数关闭；解析器回滚到「仅 `Disallow: /` 全站拒」的保守版 |
| R-10 | 发现通道被反爬/JS 渲染站点 | 站点返回 403 或 HTML 无 `<a>`（SPA） | 子页发现为空 | 降级单页 + 清单记原因；正文仍由 DeepSeek 侧渲染抓取 | 提示用户改用 `site_crawl` 或直接单页多次抓取 |
| R-11 | 合并文件过大 | 30 页 × 大页 | 单文件数十 MB | `max_pages` 上限 200；默认 30；返回值含 `bytes` 供判断 | 用户下调 `max_pages` |
| R-12 | 并发预算竞态 | 3 并发与 deadline 同时推进 | 超预算仍发请求 | 调度循环在**发请求前**查 deadline；已发请求计入 | 并发降为 1（`childrenConcurrency=1`） |
| R-13 | P0 路径回归破坏 | 参数扩展误改单页分支 | 已验收功能回退 | `children` 缺省 false；T-15 强制 P0 回归用例 + verify 原 10 项必须仍 PASS | 回退 T-11 改动（git 无仓 → 先备份 `src/index.ts`） |
| R-14 | 站点规模/唯一性 | 无新增 entry/工具名 | 无 | 不新增 loader entry 与工具；仅参数与 Config 扩展 | — |
| R-15 | 编码/平台 | 非 UTF-8 站点（GBK） | 发现阶段 href 乱码 | 发现通道按 UTF-8 解码；乱码导致链接失效时按 R-10 降级 | 记录为已知限制 |

### 10.5 验收标准（增量两层）

**阶段04 自验**（每任务一条命令，全部为可执行命令）：
- T-11：`bash scripts/build.sh` / `tsc --noEmit` / `node scripts/verify.mjs` / `node scripts/assert-config.mjs`
- T-12：`node scripts/assert-discover.mjs`
- T-13：`node scripts/assert-bfs.mjs`
- T-14：`node scripts/assert-merge.mjs`
- T-15：`node scripts/verify.mjs` + 真实站点合集抓取 + 落盘四查（首行/无 BOM/无 front matter/含来源行）

**阶段05 终验**：构建三绿；`check-plugin-ready` 全 PASS；**profile 已安装态**下 `dev_reload_package` 后 `[active]`；真实合集抓取一次；P0 单页回归一次；卸载/重装不产生重复 entry；SHIPPABLE 报告更新至 v0.3。

### 10.6 回滚与备份

- 施工前备份：`bundle/src/index.ts` → `bundle/src/index.ts.bak-p1-<ts>`；`bundle/scripts/*.mjs` 同批备份。
- 失败判定：任一验收命令非零退出，或 P0 回归用例失败。
- 回退手段：还原备份文件 → `bash scripts/build.sh` → `dev_reload_package dsh-deepseek-fetch` → 复跑 verify。

### 10.7 里程碑

| 里程碑 | 判据 |
|---|---|
| **M3**：P1 开发收口 | T-11~T-15 验收全过；P0 回归全过；合集真实抓取成功；`evidence/p1-selftest.md` 落盘 → 提交用户【阶段4审核通过】 |
| **M4**：P1 可发布收口 | 构建/门禁全绿；profile 安装态 reload 后 `[active]`；SHIPPABLE v0.3 出具且用户最终验收通过 |

---

## 11. P2 第三批增量计划（FR-12 渲染素材通道 · v0.4）

- 输入基线：`Plugin-Spec.md` **v0.4 FR-12**、`Plugin-Design.md` **v0.4 §15**（均已过审）、结构图 v3（四门 PASS + 人眼复核）
- 施工产物仍是同一 `bundle/`（版本 `0.2.0 → 0.3.0`）+ 断言脚本；**不新增 preset 行 / loader entry / npm 依赖**
- 规模预估：新增约 **420~560 行** TypeScript（`src/index.ts` 约 1279 → 1750 行）；CDP 客户端用 **Node 内置 `fetch` + 全局 `WebSocket`**（Node 24 实测可用），**不引入 puppeteer/playwright**

### 11.1 WBS

| ID | 任务名 | 归属 | 依据 | 产出 | 验收判据（可执行） | 依赖 | 预估 | 风险 |
|---|---|---|---|---|---|---|---|---|
| T-16 | 扩展参数、Config 与错误码 | `bundle/src/index.ts`、`bundle/scripts/assert-config.mjs`、`bundle/scripts/assert-classify-error.mjs`、`bundle/scripts/verify.mjs` | FR-12；Design §15.2/§15.7 | `TOOL_PARAMETERS` 增 `render`/`text_source`/`max_shots`；`Config` 增 5 字段；`ERROR_CODES` 8→11（`E_NO_EDGE`/`E_RENDER_TIMEOUT`/`E_RENDER_FAILED`）；`CONFIG_FIELDS` 同步；未知参数仍被拒 | `bash scripts/build.sh` exit 0；`tsc --noEmit` exit 0；`node scripts/verify.mjs` → `config-fields-ok`(17 项) + `tool-contract-ok`(9 键) + `error-codes-ok`(11 码)；`node scripts/assert-config.mjs` exit 0 | T-15 | S | R-22 |
| T-17 | 实现 Edge 探测器与 CDP 渲染器 | `bundle/src/index.ts`、`bundle/scripts/assert-render.mjs`（新） | Design §15.4/§15.10 | `findEdgeExecutable(config)`（3 处探测 + `edgePath` 覆盖）；`launchEdge()`（`--headless=new` + 随机端口 + 临时 profile）；`cdpConnect()`（轮询 `/json/version` → `/json/list` → WS → `Runtime/Page.enable` → `Emulation.setDeviceMetricsOverride`）；`readInnerText()`；`measureCanvasRatio()`；`closeAll()`（WS close + 进程 kill + 临时目录清理） | `node scripts/assert-render.mjs` exit 0：① Edge 探测：命中本机路径或返回 null；② **纯函数** `measureCanvasRatio`（构造假元素集，验证面积占比计算）；③ 随机端口：两次取值不同；④ 启动参数包含 `--headless=new` 与 `--remote-debugging-port`（纯函数组装参数后断言字符串） | T-16 | M | R-16、R-20 |
| T-18 | 实现滚动定位与分屏截图器 | `bundle/src/index.ts`、`bundle/scripts/assert-shots.mjs`（新） | Design §15.5 | `pickScrollingElement()`（面积最大可滚元素：阈值 `scrollHeight>clientHeight+50 && clientHeight>200`；缺省退 `window.scrollBy`）；`captureShots()`（步长=视口高−overlap、每屏等 settleMs、`sha1` 去重、到底/达上限终止）；PNG 落 `<基名>.shots/NN.png` | `node scripts/assert-shots.mjs` exit 0：① `pickScrollingElement` 在假元素集上选面积最大者；② 去重：同字节丢弃 / 异字节保留（纯函数）；③ 步长 `H - overlap`；④ 终止判定（到底 / 达上限） | T-17 | M | R-18 |
| T-19 | 实现择源器与素材包写入 | `bundle/src/index.ts`、`bundle/scripts/assert-arbiter.mjs`（新） | Design §15.3/§15.6/§15.8 | `decideTextSource()`（api/render/auto + 三判据 + 降级 `api(fallback)`）；`writeMaterialBundle()`（`<基名>.md` + `<基名>.shots/NN.png` + `<基名>.manifest.json`，含 `merge_hint`）；execute 接线：`render:true` 返回 `text_path`/`shots_dir`/`shots[]`/`manifest_path`/`text_source`/`shots_total`/`text_chars` | `node scripts/assert-arbiter.mjs` exit 0：① auto + 命中 canvas 判据 → `render`；② auto + 未命中 → `api`；③ auto + Edge 不可用 → `api(fallback)` + warning；④ 显式 `text_source='render'` + 无 Edge → `E_NO_EDGE`；⑤ manifest 必含 `merge_hint` 与 `shots` 数组 | T-18 | M | R-19、R-21 |
| T-20 | 扩展自验门禁 | `bundle/scripts/verify.mjs` + 3 个新 assert | DEV-PLAN §7.1 | verify 增 `render`/`shots`/`arbiter` 三项 | `node scripts/verify.mjs` exit 0（项数 = 16 + 3）；**防恒绿抽检**：改任一新断言期望值 → exit≠0 → 还原 → exit 0 | T-19 | S | R-22 |
| T-21 | 端到端素材包抓取与全量回归 | `evidence/p2-selftest.md`（新） | FR-12 验收；Design §15.2 | 记录：真实站点 `render:true` 的命令原文+退出码+输出摘录；素材包三件落盘核验（md 首行 / PNG 可读 / manifest 字段）；**P0 单页回归**、**P1 合集回归**（`children:true` 仍走 API 通道）；Edge 进程零残留核验 | ① `deepseek_fetch({url, render:true})` → `ok:true` 且 `shots_total ≥ 1`、`text_path` 存在、manifest 可解析；② 回归：P0 落盘仍为纯正文、P1 合集结构不变；③ `Get-Process msedge` 计数与调用前一致（零残留） | T-20 | S | R-20、R-22 |

### 11.2 执行序列与并行度

**全串行**（T-16 → T-17 → T-18 → T-19 → T-20 → T-21）：T-17~T-19 全部写入同一 `bundle/src/index.ts`，且 T-18 依赖 T-17 的 CDP 会话、T-19 依赖 T-18 的截图产物结构。

### 11.3 无 UI 说明

沿用 B 分支结论：无 `design/`、无 verify 门禁、无例外清单；P2 不新增 UI。「图像文字化 + 合并终稿」由 **agent 侧**用模型自带视觉能力完成（形态 A），**不是插件能力**。

### 11.4 风险登记（增量）

| 编号 | 风险 | 触发 | 影响 | 缓解 | 回退 |
|---|---|---|---|---|---|
| R-16 | Edge 启动失败 / CDP 端口被占 / 受限环境禁子进程 | 本机 Edge 异常、策略限制 | `render` 不可用 | `auto` **降级为 API 文字**（`api(fallback)` + warning）；仅 `text_source='render'` 才报 `E_NO_EDGE`；端口随机探测 | `render:false`，插件其余能力不受影响 |
| R-17 | 页面 JS 在渲染中自行访问内网 | 目标页自身行为 | 本机被访问（**页面行为，非插件主动**） | 明示为已知限制并登记进 SHIPPABLE；插件不主动请求非用户给定 URL | 无（属页面行为） |
| R-18 | 截图数量/体积爆炸 | 链接密集/超长页面 | 磁盘占用与视觉模型成本 | `max_shots`（默认 40）硬上限 + 固定视口 + sha1 去重；返回值含 `shots_total`/`text_chars` 供判断 | 调小 `max_shots` |
| R-19 | 形态 A 责任边界被误解（以为插件出终稿） | 用户/agent 误用 | 终稿缺失 | `manifest.merge_hint` 写明合并步骤；工具 description 与返回值显式说明"只出素材" | 下版做插件内视觉通道（需 VLM 凭据，另议） |
| R-20 | Edge 进程 / 临时 profile 残留 | 异常路径未走 finally | 进程与磁盘垃圾 | `finally` 必杀（只杀自己 spawn 的 child）+ 随机端口 + WS `close()` + 临时目录 `rmSync(maxRetries)` | 人工清理（路径随 warning 回报） |
| R-21 | 择源误判（canvas 面积阈值 30% 偏主观） | 图表类正文 / 阈值边界 | 选错文字通道 | 阈值可配 + 显式 `text_source` 覆盖 + 返回值回显 `text_source` | 显式指定 `text_source` |
| R-22 | 复用污染 P0/P1 行为 | 在既有 execute 管线上插分支 | 已验收功能回退 | `children` 与 `render` 互斥（render 路径不启动 BFS）；P0/P1 回归进 T-21 必测 | 还原 `src/index.ts` 备份重跑 verify |
| R-23 | 临时 profile 删除失败（文件锁） | Edge 未完全退出 | 残留目录 | `maxRetries` + 不阻塞 + 记 warning | 人工删除 |

### 11.5 验收标准（增量两层）

**阶段04 自验**：T-16 `build.sh` / `tsc` / `verify` / `assert-config`；T-17 `assert-render`；T-18 `assert-shots`；T-19 `assert-arbiter`；T-20 `verify`（含防恒绿抽检）；T-21 真实 `render:true` 抓取 + 素材包三件核验 + P0/P1 回归 + Edge 零残留。

**阶段05 终验**：构建三绿；`check-plugin-ready` 全 PASS；verify 全项 PASS（16+3）；**真实站点 `render:true` 产出可核验素材包**；P0/P1 回归全过；卸载即净；SHIPPABLE 更新至 v0.5（新增 §9 P2 段 + 独立审查结论）。

### 11.6 回滚与备份

施工前备份 `bundle/src/index.ts` 与 `bundle/scripts/*.mjs`（`*.bak-p2-<ts>`）；任一验收命令非零即还原备份 → rebuild → `dev_reload_package` → 复跑 verify。

### 11.7 里程碑

| 里程碑 | 判据 |
|---|---|
| **M5**：P2 开发收口 | T-16~T-21 全过；P0/P1 回归全过；真实素材包抓取成功；`evidence/p2-selftest.md` 落盘；Edge 零残留 → 提交用户【阶段4审核通过】 |
| **M6**：P2 可发布收口 | 构建/门禁全绿；profile 安装态 reload 后 `[active]`；SHIPPABLE v0.5 出具且用户最终验收通过 |

---

## 12. P3 第四批增量计划（FR-13 参数化等待 · FR-14 感知哈希去重 · v0.6）

- 输入基线：`Plugin-Spec.md` **v0.5 FR-13/FR-14**、`Plugin-Design.md` **v0.5 §16**（均已过审）、结构图 v4（四门 PASS + 人眼复核）
- 施工产物仍是同一 `bundle/`（版本 `0.3.0 → 0.4.0`）+ 断言脚本；**不新增 preset 行 / loader entry / npm 依赖**（PNG 解码用 Node 内置 `zlib`）
- 规模预估：新增约 **260~340 行**（`src/index.ts` 约 2537 → 2850 行）；其中 PNG 解码器 ~85 行、dHash/MAD ~55 行、去重器接线 ~35 行、预算联动与参数校验 ~45 行、断言 ~90 行

### 12.1 WBS

| ID | 任务名 | 归属 | 依据 | 产出 | 验收判据（可执行） | 依赖 | 预估 | 风险 |
|---|---|---|---|---|---|---|---|---|
| T-22 | 扩展参数 `render_settle_ms` 与预算联动 | `bundle/src/index.ts`、`bundle/scripts/assert-config.mjs`、`bundle/scripts/verify.mjs` | FR-13；Design §16.2/§16.3 | `TOOL_PARAMETERS` 增 `render_settle_ms`（10 键）；`resolveRenderBudget()` 实现 `clamp(max(cfgTimeout, ⌈shots×settle×1.6⌉+20000),5000,600000)`；越界 → `E_INVALID_URL` + 专属 hint；返回值回显 `render_settle_ms`/`render_timeout_ms` | `bash scripts/build.sh` 0；`tsc --noEmit` 0；`verify.mjs` 中 `tool-contract-ok` 变 **10 键**；`assert-pipeline` 新增用例：①不传参数→回显=Config 700；②传 2500→回显 2500 且 `render_timeout_ms ≥ 2500×shots×1.6+20000`；③传 6000→`E_INVALID_URL` 且 hint 含"参数"不含"URL" | T-21 | M | R-24 |
| T-23 | PNG 解码器 | `bundle/src/index.ts`、`bundle/scripts/assert-png.mjs`（新） | Design §16.4；已验证原型 `workorders/proto-phash.mjs` | `decodePng(buf)`：IHDR/IDAT 解析 → `zlib.inflateSync` → 5 种行反滤波 → `{width,height,channels,pixels}`；隔行/16-bit/损坏 → 抛 `PngUnsupportedError` | `node scripts/assert-png.mjs` exit 0：① 用**真实素材包 45 张**全解码成功且尺寸=1440×900/channels=4；② 手工构造 Sub/Up/Average/Paeth 四种滤波的单行 PNG 解码后像素值正确；③ 隔行/16-bit 桩 → 抛错（不静默返回错数据） | T-22 | M | R-25 |
| T-24 | dHash + MAD 近重复判定 | `bundle/src/index.ts`、`bundle/scripts/assert-phash.mjs`（新） | Design §16.4 | `dHash64()`、`gray32()`、`hamming()`、`mad()`、`isNearDuplicate(prev,cur)`（sha1 相同→true；否则 dHash≤2 且 MAD≤1.5→true；解码失败→仅 sha1） | `node scripts/assert-phash.mjs` exit 0：① **真近重复对**（`...-3.shots/27.png` vs `37.png`）MAD 实测 ≤1.5 → 判重 **true**；② **相似但内容不同**的幻灯片对（`38` vs `42`、`41` vs `43`、`28` vs `44`）MAD >1.5 → **false**（不得误删）；③ 两张不同内容帧（`01` vs `02`）→ false；④ 解码失败桩 → 回退 sha1 语义（相同 true / 不同 false）；⑤ `hamming` 边界（同值=0，全反=64） | T-23 | M | R-26 |
| T-25 | 去重器接入截图循环与返回字段 | `bundle/src/index.ts`、`bundle/scripts/assert-shots.mjs` | Design §16.4/§16.2 | `captureShots` 内去重由"sha1 比较"改为 `isNearDuplicate`；统计 `shots_deduped`；`finishRenderBundle`/manifest 增 `dedup_method`、`shots_deduped`；解码失败时 `dedup_method='sha1(fallback)'` + warning 一次 | `node scripts/assert-shots.mjs` exit 0（新增用例）：① 假会话交替返回"近重复帧"→ 只留 1 张且 `shots_deduped≥1`；② 交替返回"不同帧"→ 全留且 `shots_deduped=0`；③ 解码失败桩 → 走 sha1 且 `dedup_method='sha1(fallback)'` | T-24 | M | R-27 |
| T-26 | 门禁接入与防恒绿 | `bundle/scripts/verify.mjs` | DEV-PLAN §7.1 | verify 增 `png`/`phash` 两项（20 → **22 项**） | `node scripts/verify.mjs` exit 0（22 项）；**防恒绿抽检**：把 `MAD≤1.5` 改为 `MAD≤99` → `assert-phash` 必须失败（相似对被误判）→ 还原 → PASS | T-25 | S | R-27 |
| T-27 | 真实端到端复验与回归 | `evidence/p3-selftest.md`（新） | FR-13/FR-14 验收 | 记录：① `render_settle_ms:2500, max_shots:50` 一次真实抓取（命令原文 + 退出码 + 返回摘录 + 落盘核验 + `shots_deduped`）；② 同参数但**不传** settle 的对照；③ P0 单页 / P1 合集回归；④ Edge 零残留 | ① 不传 settle 时普通页 ≤10s 完成且有截图（P1-1 不回归）；② 传 2500 时**不出现** `E_RENDER_TIMEOUT` 且 `render_timeout_ms` 回显正确；③ 空白近似帧被去重（`shots_deduped ≥ 1`）；④ P0/P1 回归通过 | T-26 | M | R-24/R-27 |

### 12.2 执行序列与并行度

**全串行**（T-22 → T-23 → T-24 → T-25 → T-26 → T-27）：T-23/T-24/T-25 全部写入同一 `src/index.ts` 且后者依赖前者的导出；T-26 依赖三项断言；T-27 依赖全部。

### 12.3 无 UI 说明

沿用 B 分支：无 `design/`、无 verify 外观门禁、无例外清单。P3 不新增 UI。

### 12.4 风险登记（增量）

| 编号 | 风险 | 触发 | 影响 | 缓解 | 回退 |
|---|---|---|---|---|---|
| R-24 | 预算联动算大了 / 算小了 | 系数 1.6 偏保守或偏激进 | 偏大=空等；偏小=超时 | 系数由实测推导（0.9s+settle）；**不传参时完全等于现值**；回显实际值便于核验 | 调整系数常量 |
| R-25 | PNG 解码器在非 8-bit/隔行图上解错或崩溃 | 其他站点/浏览器输出格式不同 | 去重失效或抛异常 | 只支持 8-bit 非隔行，其余**显式抛错**；上层回退 sha1；断言覆盖 4 种行滤波 | 回退 sha1（`dedup_method='sha1(fallback)'`） |
| R-26 | **MAD 阈值把不同内容误判为重复** | 阈值过松 / 版式高度雷同的页面 | **真内容被删（最严重）** | 阈值 1.5 由实测分离度 1.8 倍得出；断言**专测**"相似对不得判重"（38vs42 / 41vs43 / 28vs44）；宁可漏删不可误删 | 调低阈值或退回 sha1 |
| R-27 | 去重接入破坏既有 sha1 行为 | 改 `captureShots` 时改坏 | P2 回归 | 保留 sha1 快路径为先；`assert-shots` 既有用例必须仍 PASS | 还原 `captureShots` |
| R-28 | 解码开销拖慢整体 | 每帧 ~31ms × 50 帧 | +1.5s | 已实测（45 张 1.4s）；仅在 sha1 不同时才解码 | 关闭感知去重（回退 sha1） |

### 12.5 验收标准（增量两层）

**阶段04 自验**：T-22 `build.sh`/`tsc`/`verify`（10 键）/`assert-pipeline`；T-23 `assert-png`；T-24 `assert-phash`；T-25 `assert-shots`；T-26 `verify`（22 项 + 防恒绿抽检）；T-27 真实两轮抓取 + 回归。

**阶段05 终验**：构建三绿；`check-plugin-ready` 全 PASS；verify **22 项**全 PASS；真实抓取含 `render_settle_ms` 覆盖并核验去重数与回显；P0/P1 回归；Edge 零残留；SHIPPABLE 更新至 **v0.6**（新增 §10 P3 段 + 独立审查结论）。

### 12.6 回滚与备份

施工前备份 `bundle/src/index.ts` 与 `bundle/scripts/*.mjs`（`*.bak-p3-<ts>`）；任一验收命令非零即还原 → rebuild → `dev_reload_package` → 复跑 verify。**注意**：`lib/` 下不得残留 `_bak*` 编译产物（P2 曾出现，属交付污染）。

### 12.7 里程碑

| 里程碑 | 判据 |
|---|---|
| **M7**：P3 开发收口 | T-22~T-27 全过；P0/P1 回归全过；真实两轮抓取成功（含 settle 覆盖与去重核验）；`evidence/p3-selftest.md` 落盘；Edge 零残留 → 提交用户【阶段4审核通过】 |
| **M8**：P3 可发布收口 | 构建/门禁全绿；profile 安装态 reload 后 `[active]`；SHIPPABLE v0.6 出具且用户最终验收通过 |


---

## 13. 第五批增量计划（FR-15 渲染期剥离覆盖型浮层 · v1.0）

### 13.1 计划输入与基线清单

| 类别 | 路径 | 状态 |
|---|---|---|
| 需求 | `Plugin-Spec.md` **v0.6** §4.2 FR-15 | 用户已确认（阶段01） |
| 设计 | `Plugin-Design.md` **v0.6** §17 | 用户已确认（阶段02） |
| 结构图 | `diagrams/dsh-deepseek-fetch-structure-v5.html` | 四门 PASS + 人眼复核（阶段02） |
| 根因证据 | `evidence/p4-rootcause-probe.md` + 6 个探针脚本（`workorders/probe-p4-*.mjs`、`probe-popup.mjs`、`probe-strip-compare.mjs`） | 阶段01 产出，可复现 |
| 现有产物 | `bundle/` v0.4.0（`src/index.ts` 2886 行 / 参数 10 / 错误码 11 / Config 17 / verify 22 项 / 18 个断言脚本） | 前四轮已验收 |

**基线冻结**：`bundle/src/index.ts` sha256 前缀 `232983a4`（阶段04 起点以实际值为准）；`Plugin-Spec.md` v0.6、`Plugin-Design.md` v0.6 定稿不改。

**B 分支（无 UI）**：本插件无前端页面（纯工具插件），沿用 P0~P3 结论；**无 `design/`、无 style-design 门禁、无例外清单**；P5 不新增 UI。

### 13.2 交付物总览（第五批 + 迁移）

```text
bundle/                        # 插件包（原地升级 v0.4.0 → v0.5.0）
  src/index.ts                 # +剥离器 +Config 字段 +返回字段（+~90 行）
  scripts/assert-strip.mjs     # 新增（剥离器断言）
  scripts/verify.mjs           # 22 → 23 项
  scripts/assert-config.mjs    # Config 字段 17 → 18
  package.json                 # version 0.4.0 → 0.5.0
D:\dsh-sync\packages\dsh-deepseek-fetch\   # 迁移落位（方案 A）
  bundle/                      # 插件包副本（与工作副本一致）
  Plugin-Spec.md / Plugin-Design.md / DEV-PLAN.md / SHIPPABLE.md / PIPELINE-STATE.md
  evidence/  diagrams/  workorders/
  README.md / LICENSE / .gitignore
GitHub: yangyizhu8/dsh-deepseek-fetch（新建，公开仓，一插件一仓模式）
```

### 13.3 WBS 任务表

| ID | 任务名 | 归属 | 依据 | 输入 | 产出 | 验收判据（可复核） | 依赖 | 预估 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| T-28 | 实现浮层剥离器 | `bundle/src/index.ts` | FR-15；Design §17.2 | 现有 `captureShots` / CDP 会话 | `STRIP_OVERLAYS_JS` 常量 + `export async function stripOverlays(session): Promise<number>` | `node scripts/assert-strip.mjs` exit 0：① 假浮层→剥离数=1；② 大文本正文容器→剥离数=**0**；③ CANVAS 容器→剥离数=**0**；④ 面积 <85% 的小浮层→剥离数=**0**；⑤ 求值抛错→返回 0 且不抛 | T-22 | M | R-29/R-30 |
| T-29 | 接入截图循环 | `bundle/src/index.ts` | Design §17.2/§17.3 | T-28 | 每屏截图前调用 `stripOverlays`；累计 `overlaysStripped` | `assert-strip` 增⑥：假会话连续 3 屏→剥离调用次数=3、累计数正确；`renderStripOverlays=false` 时**调用次数=0** | T-28 | S | R-29 |
| T-30 | Config 增 `renderStripOverlays` | `bundle/src/index.ts`（Config schema） | Design §17.3 | 现有 17 字段 | 18 字段（默认 `true`） | `assert-config` 更新：字段数=**18** 且 `renderStripOverlays` 默认 `true`；`verify` 的 `config-fields-ok` PASS | T-29 | S | — |
| T-31 | 返回与 manifest 增 `overlays_stripped` | `bundle/src/index.ts` | Design §17.3 | T-29 | 返回 + manifest 各增 1 字段 | 管线断言：返回 `overlays_stripped` 与 manifest 同值；非 render 路径该字段**不出现**（与 `dedup_method` 同策略） | T-29 | S | — |
| T-32 | 门禁接入与防恒绿 | `bundle/scripts/verify.mjs`、`assert-strip.mjs` | Design §17.5 | T-28~T-31 | verify 22 → **23 项**（+`strip`） | `node scripts/verify.mjs` exit 0（23 项）；**防恒绿**：把剥离面积阈值 0.85 改成 0.0 → `assert-strip` 必须失败（会剥掉正文容器）→ 还原 → PASS | T-31 | S | R-29 |
| T-33 | 真实端到端与回归 | `evidence/p5-selftest.md`（新） | FR-15 验收判据 A3~A5 | T-32 | 真实 kdocs 抓取证据 + P0/P1 回归 | ① 真实抓取 `overlays_stripped ≥ 1`；② 剥离后**正文长度不下降**（≥ v0.4.0 的 2404 字符）；③ 去重仍不误删（相邻帧无残留近重复、近空白帧 0 张）；④ P0 单页 / P1 合集回归通过；⑤ Edge 与临时 profile 零残留 | T-32 | M | R-29/R-30 |
| T-34 | 建 GitHub 仓并首推 | `yangyizhu8/dsh-deepseek-fetch` | 用户指令「迁到 dsh-external 仓库纳入正式生态」（方案 A） | 第五批定稿产物 | 公开仓 + README（用法/参数/限制/安装）+ LICENSE + .gitignore | `gh repo view yangyizhu8/dsh-deepseek-fetch` 可见；`gh api repos/.../contents` 列出 `bundle/src/index.ts`；README 含参数表与限制清单 | T-33 | M | R-32 |
| T-35 | 克隆落位并同步产物 | `D:\dsh-sync\packages\dsh-deepseek-fetch` | 方案 A | T-33 产物 | 克隆目录 = 仓库内容 + 第五批定稿全部产物 | 克隆目录内 `bundle/scripts/verify.mjs` 存在且 `node` 跑出 **23 项 PASS**；`git status` 干净 | T-34 | S | R-32 |
| T-36 | 宿主 link 改指 + 验装 | `C:\Users\Administrator\.dsh\profiles\web\package.json` + `node_modules` junction | 方案 A | T-35 | profile `dependencies` 的 `@dsh-external/dsh-deepseek-fetch` 指向克隆目录；junction 重建 | `dev_plugin_status` 显示插件 `[active]`；`dev_reload_package` 前后 `[active]`；宿主内调用 `deepseek_fetch` 成功（渲染通道 `overlays_stripped ≥ 1`） | T-35 | M | R-31 |
| T-37 | 迁移后全量回归与收口 | `evidence/p5-migration.md`（新）+ `SHIPPABLE.md` §11 | 迁移收口 | T-36 | 迁移后 verify/准入/真实抓取/卸载即净证据 | 克隆目录跑 `verify.mjs` 23 项 PASS + `check-plugin-ready` 1/1 + 真实抓取成功；`dev_uninject_plugin` 后无残留（junction 清理、profile 无悬空 link） | T-36 | M | R-31/R-33 |

### 13.4 执行序列与并行度

**串行主线**：T-28 → T-29 → T-30 → T-31 → T-32 → T-33 → T-34 → T-35 → T-36 → T-37。

理由：T-28~T-33 全部写入同一 `bundle/src/index.ts`（共享文件，必须串行，且每步都要能编译验证）；T-34 依赖 T-33 的定稿产物（**不得在未定稿时推送**）；T-35 依赖 T-34 的远端仓；T-36 依赖 T-35 的本地克隆；T-37 是最终收口。

**可并行**：无（T-34 的 `README.md` 文案可与 T-33 并行起草，但提交必须在 T-33 之后）。

### 13.5 无 UI 说明（B 分支）

本插件为**纯工具插件**（无前端页面 / 看板 / 配置面板）。沿用 P0~P3 的 B 分支结论：**无 `design/` 目录、无 style-design verify 门禁、无例外清单、无逐页形态归属表**。第五批与迁移均不引入任何 UI。

### 13.6 风险登记表

| 编号 | 风险 | 触发条件 | 影响面 | 缓解 | 回退 |
|---|---|---|---|---|---|
| **R-29** | **误剥正文容器**（四重约束被绕过） | 页面存在"覆盖 ≥85% + 文本 <300 字 + class 含 popup/modal"的**正文**容器 | 内容丢失（不可逆） | 四重约束（尤其③文本量、④非 CANVAS/IFRAME）；断言 A2/A3/A4；**防恒绿抽检**（阈值改 0.0 必须失败） | `Config.renderStripOverlays=false` → 行为回退 v0.4.0 |
| **R-30** | 剥离导致页面渲染异常（正文不再出现） | 覆盖层是渲染的**前置条件**（如"必须先登录才渲染"） | 正文为空 | T-33 断言"剥离后正文长度 **不下降**"（≥2404 字符）；真实抓取核验 | 同上（关闭开关）；或缩小关键词表 |
| **R-31** | 迁移后宿主 link 断裂 / 插件失效 | profile `package.json` 改指路径写错、junction 未重建、profile 未刷新 | 宿主内插件不可用 | 迁移前后各跑一次 verify + 真实抓取；保留 `C:\project-study` 原路径可一键改回；`dev_plugin_status` 核验 `[active]` | 把 link 改回 `link:C:\project-study\dsh-deepseek-fetch\bundle` 并 `dev_heal_links` |
| **R-32** | 克隆目录与工作副本分叉 | 两处都可编辑 → 改了一处忘了另一处 | 版本混乱 | **单向同步**：工作副本为唯一编辑源；克隆目录只由 `git pull` 更新；README 写明该规则 | 删克隆目录重建 + 重新 `link:` |
| **R-33** | GitHub 推送凭据缺失 / 未认证 | `gh` 未登录或无建仓权限 | T-34 卡住 | 动手前先 `gh auth status` 检查；已认证则 `gh repo create`；未认证则退化为"本地 git init + 提供推送指引"，**不阻塞** P4 代码交付 | 降级为本地仓 + 推送指引（交付物仍齐） |
| R-34 | 剥离计数口径漂移 | 页面重建浮层 → 计数累加与"层数"不等 | 语义误解 | 字段名 `overlays_stripped` 明确为"**累计剥离元素数**"（非"层数"），文档与 manifest 一致 | — |
| R-35 | 迁移踩到他人成果 | 改动 `D:\deepseek-harness\plugins`（合并仓，有 12 处他人在途改动） | 污染他人工作 | **方案 A 不碰合并仓**：落位 `D:\dsh-sync\packages\`（无 git 托管区） | — |

### 13.7 验收标准

**阶段04 自验**：

| 任务 | 可复核证据 |
|---|---|
| T-28~T-29 | `node scripts/assert-strip.mjs` exit 0（用例①~⑥，含"不误剥"与"开关关闭"） |
| T-30 | `node scripts/assert-config.mjs` exit 0（18 字段）；`verify` 的 `config-fields-ok` PASS |
| T-31 | 管线断言：返回/manifest 的 `overlays_stripped` 一致；非 render 路径不出现该字段 |
| T-32 | `node scripts/verify.mjs` exit 0（**23 项**）+ **防恒绿抽检**（阈值 0.85→0.0 必须失败，还原 PASS） |
| T-33 | `bash scripts/build.sh` 0、`tsc --noEmit` 0、真实 kdocs 抓取 `overlays_stripped ≥ 1` 且正文 ≥2404 字符、P0/P1 回归通过、Edge 零残留 |
| 全程 | 参数键仍 **10**、错误码仍 **11**、Config **18**、无新 npm 依赖、`lib/_bak*` 0、`.zcode` 不存在、全仓 `sk-*` 0 命中 |

**阶段05 终验**：构建三绿；`check-plugin-ready` 1/1；verify **23 项** PASS；真实抓取含 `overlays_stripped` 与"正文不下降"；P0/P1 回归；**迁移后**宿主 `[active]`、克隆目录 verify PASS、卸载即净（junction 清理 + profile 无悬空 link）；GitHub 仓可访问且内容与定稿一致；SHIPPABLE **v0.7**（新增 §11 第五批 + §12 迁移）。

### 13.8 回滚与备份方案

| 批次 | 还原点 | 失败判定 | 回退手段 |
|---|---|---|---|
| T-28~T-33（代码） | 实施前 `bundle/src/` 与 `bundle/scripts/` 全量备份到 `workorders/backup-p5-<ts>/`；`package.json` version 记为 `0.4.0` | 任何验收命令非零 | 还原备份 → rebuild → `dev_reload_package` → 复跑 verify（期望 22 项 PASS） |
| T-34~T-35（发布） | GitHub 仓可删；克隆目录可删（**不影响**工作副本与宿主） | 推送失败 / 克隆内容不符 | 删克隆目录 + 保留工作副本；宿主 link 不动 |
| T-36（宿主改指） | **先记录原值**：`link:C:\project-study\dsh-deepseek-fetch\bundle` | 插件不可用 / `[active]` 丢失 | 把 profile `package.json` 改回原 `link:` → `dev_heal_links` → `dev_reload_package` → 核验 `[active]` |
| T-37（收口） | — | 卸载后有残留 | 手工清 junction + profile 依赖项，`dev_clear_routes` 清路由 |

**迁移期铁律**：**不触碰 `D:\deepseek-harness\plugins` 合并仓**（有 12 处他人在途改动）；**不删** `C:\project-study\dsh-deepseek-fetch`（唯一编辑源 + 回退点）。

### 13.9 里程碑

| 里程碑 | 判据 |
|---|---|
| **M9**：第五批开发收口 | T-28~T-33 全过；verify **23 项** PASS + 防恒绿抽检通过；真实抓取 `overlays_stripped ≥ 1` 且正文不下降；P0/P1 回归；Edge 零残留；`evidence/p5-selftest.md` 落盘 → 提交用户【阶段4审核通过】 |
| **M10**：迁移收口 | T-34~T-37 全过；GitHub 仓可访问；克隆目录 verify 23 项 PASS；宿主 `[active]` 且真实调用成功；卸载即净；SHIPPABLE **v0.7** 出具且用户最终验收通过 |

### 13.10 计划变更日志

| 版本 | 日期 | 内容 | 影响文件 | 状态 |
|---|---|---|---|---|
| v1.0 | 2026-10-23 | **第五批计划**：依 `Plugin-Design.md` v0.6 §17 拆 T-28~T-33（剥离器 / 接入 / Config / 返回字段 / 门禁 23 项 / 真实端到端），并按用户选定的**迁移方案 A** 追加 T-34~T-37（建 GitHub 仓 → 克隆落位 `D:\dsh-sync\packages` → 宿主 link 改指 → 迁移后回归）；新增 R-29~R-35；里程碑 M9/M10；**B 分支（无 UI）** | 新增 §13 | 待审核（第五批阶段03） |
| v1.1 | 2026-10-23 | **第五批阶段04 记录**：ZCode 首轮以 `[zcode-fallback:other]` 失败但已写入大部分代码（桥接健康，重试一次补齐）；主侧**未回滚**改为逐条实测：构建 0 / tsc 0 / **verify 23 项 PASS**（+`strip-ok`）/ 准入 1/1；三次防恒绿抽检逐级加强（常量守卫 → 插值守卫 → **行为断言**：反转文本守卫使"假浮层应剥离 1 个，实际 0"）；真实端到端 **`overlays_stripped=4`** + 正文 **2404 字符未削弱** + 人眼确认浮层消失；无浮层页面 `overlays_stripped=0` 不误剥；P0/P1 回归通过；卫生（`.zcode` 已删、`_bak` 0、临时 profile 0）| `src/index.ts`（2977 行）、`assert-strip.mjs`、`verify.mjs`、`assert-config.mjs`、`package.json`（0.5.0） | 阶段04 完成 |
| v1.2 | 2026-10-24 | **第五批阶段05（独立审查 → 修复 → 复验）**：审查报 **0×P0 / 1×P1 / 12×P2**。**P1-1**（剥离后滚动容器脱挂 → 静默只出 1 张且不计 partial）→ 剥离数 >0 时重采候选 + 重选容器 + 重置进度；P2-4 零视口守卫、**P2-5 新增第五重约束（position ∈ fixed/absolute/sticky）**、P2-2 边界 `>=`、P2-6 整数校验、P2-12 成功文本回显；P2-1/P2-3/P2-9 文档改述；P2-11 **我方描述不实已按实测清单更正**。新增断言 ④b/④c/④d/④e/非整数/**⑥b（剥在截之前的事件序列）**，并给出 ⑥b 的突变证明（交换两块 → exit 54）。真实站点复验仍 `overlays_stripped=4`、正文 2404 未削弱 | `src/index.ts`（2995 行）、`assert-strip.mjs`、Design §17.2、Spec §4.2、evidence §7.5、SHIPPABLE §11 | 阶段05 完成 |
