# 阶段04 开发自验证据 — dsh-deepseek-fetch

- 时间：2026-10-21 03:00–03:20（Asia/Shanghai）
- 执行位置：DSH 主侧（门禁/构建/注入链均为主侧执行；ZCode 仅写文件，见文末委派记录）
- 环境：Node v24.18.1；DSH checkout `D:/deepseek-harness`；bash = `C:\Program Files\Git\bin\bash.exe`（WSL 不用）

## 1. 交付文件（16 个）

```
bundle/package.json | cordis.patch.yml | tsconfig.json | .gitignore
bundle/scripts/{build.sh, verify.mjs, assert-validate-url.mjs, assert-resolve-apikey.mjs,
                assert-classify-error.mjs, assert-clean.mjs, assert-slugify.mjs,
                assert-config.mjs, assert-preset.mjs}
bundle/src/index.ts（550 行）
preset/agent.cordis.yml | preset.yml
```

## 2. 构建与门禁（命令原文 + 退出码）

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | **0** | `=== Build complete ===`；产出 `lib/index.js`（22006B）、`lib/index.js.map`、`lib/types/index.d.ts` |
| 2 | `tsc -p tsconfig.json --noEmit` | **0** | 无输出（类型通过） |
| 3 | `node scripts/verify.mjs` | **0** | `module-ok / tool-contract-ok / error-codes-ok / validateUrl-ok / resolveApiKey-ok / classifyError-ok / cleanMarkdown-ok / slugify-ok / config-fields-ok / preset-ok` + `verify: PASS` |
| 4 | `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle>` | **0** | `[PASS] bundle`；`1/1 PASS; 0 FAIL` |
| 5 | 防恒绿抽检：把 `assert-slugify` 的 `'_CON'` 改成 `'_CON-WRONG'` 后 `node scripts/verify.mjs` | **1** | `verify: FAIL（1 项失败：slugify）`；还原后复跑 exit 0 |

## 3. 端到端功能自测（直连 lib，隔离临时目录）

脚本：`.selftest-tmp/run.mjs`（验毕已删）；输出目录 `.selftest-tmp/out`（验毕已删）。

| 用例 | 输入 | 结果 |
|---|---|---|
| U1 成功·默认 | `https://example.com` | `ok:true`，`Example-Domain.md`，`chars=916`，`bytes=1300`，首行即正文 |
| U1 落盘核验 | 同上 | `exists=true`；前 3 字节 `e8afa5`（UTF-8 中文，**非 BOM**）；`hasYamlHead=false`；`charsMatch=true` |
| U3 `clean:false` 保真 | 同 URL，`clean:false` | `chars=931`，正文保留 **15 处**反斜杠转义（清洗版 916） |
| U4 重名序号 | 同 URL 再抓 | `Example-Domain-2.md`（不覆盖） |
| U5 非法 URL | `not-a-url` | `E_INVALID_URL`，无文件 |
| U6 站点拒绝 | `https://zh.wikipedia.org/zh-cn/Markdown` | `E_FETCH_FAILED` + `request_id=5b9fc179-…`，无文件 |
| U6b 带凭证 | `https://user:pass@example.com` | `E_INVALID_URL`（本地前置拒绝），无文件 |
| U8 落盘失败 | `output_dir` 指向已存在文件 | `E_IO`（`EEXIST: mkdir`），无文件 |
| 残留检查 | — | `after=[Example-Domain.md, Example-Domain-2.md, Example-Domain-3.md]`；`.tmp-*` 残留 = 0 |

**未覆盖（如实）**：`E_RATE_LIMIT` 无法稳定触发（上游阈值未公开，仅有 429 兜底实现与 `classifyError` 断言）；`E_NO_KEY` 未端到端跑（本机 Key 已配置，不想改动机器环境；由 `resolveApiKey` 断言 + 代码分支覆盖）；`E_AUTH`（需无效 Key）留阶段05 独立 profile 补测。

## 4. 宿主注入链（真实注册 → 真实调用 → 卸载即净）

| 步 | 命令/动作 | 结果 |
|---|---|---|
| 1 | `dev_inject_plugin { dir: .../bundle }` | `OK: @dsh-external/dsh-deepseek-fetch 已注入`；host ✓；client 跳过（无 client 声明，符合预期） |
| 2 | `dev_plugin_status` | `[active] e3d6903e (@dsh-external/dsh-deepseek-fetch) [injected]` |
| 3 | 工具真实调用 `deepseek_fetch({url:"https://api-docs.deepseek.com/zh-cn/api/fetch"})` | `ok:true`；`C:\deepseek网页抓取\https-api.deepseek.com-v1-tools-fetch.md`；922 字符；3175ms |
| 4 | 落盘核验 | 1204 B；前 3 字节 `53 65 61`（`Sea`，无 BOM）；`startsWithYaml=false`；70 行；首行 = 正文 |
| 5 | `dev_self_test` | **FAIL（PASS 0/1）**：`checkout 探测 — 无 DSH_CHECKOUT`。属**注入器自身前置**（宿主进程 env 无该变量，会话侧不可设），不是本插件缺陷；等价链路证据 = 步 1/2/3 + 步 6 |
| 6 | `dev_uninject_plugin dsh-deepseek-fetch` | `卸载完成`：entry 卸载 / patch 写 disabled / registry 清理 / junction 删除 / client 模块表清理 |
| 7 | 残留复核 | junction 不存在；registry 不含本插件名 |

## 5. 施工中发现并修复的缺陷（3 处实现 + 2 处规格合规）

| # | 缺陷 | 性质 | 修复 |
|---|---|---|---|
| 1 | `build.sh` 克隆时漏了 `mkdirSync('node_modules/@standard-schema')`，先删父目录再建子 junction → `ENOENT`，构建必挂 | **阻断构建** | 就地补回 `mkdirSync`（1 行） |
| 2 | `slugify` 把文件系统非法字符**删除**，与 Spec FR-3「替换为 `-`」不符 | 规格合规 | 改为替换 `-`，并补 `-{2,}`→`-` 折叠（否则 `API: 文档` 出双横线） |
| 3 | `resolveApiKey` 顺序为 env→config→注册表，与 Spec FR-7「进程环境→用户环境→插件配置项」不符 | 规格合规 | 调整为 env → Windows 用户级环境 → config；同步断言注释 |
| 4 | 对应断言 `assert-slugify` 期望值 `abcde` 随 #2 改为 `a-b-c-d-e` | 测试同步 | 已更新 |
| 5 | `assert-resolve-apikey` 注释仍写旧顺序 | 文档同步 | 已更新（断言逻辑对 isWin=false 分支仍成立） |

## 6. 委派记录（E7）

| 轮 | 目标 | 结果 | token |
|---|---|---|---|
| 1 | 施工 T-01~T-09（含自验） | **未动工**：ZCode 会话权限客户端失效，Bash 全线被拦（连 `node --version`），按工单「缺料即停」上报 | in 1,091,860 / out 12,303 |
| 2 | 环境探针（plan 模式） | 被 plan 模式禁 Bash（预期行为，不计故障） | in 34,286 / out 1,175 |
| 3 | 环境探针（edit 模式） | `echo` 可用、`node` 被拦（`No permission client configured for Bash`）→ 判定 ZCode 侧无法执行命令 | in 48,832 / out 526 |
| 4 | **纯写文件模式**（工单 v1.1：只写不跑命令，门禁归主侧） | **成功**：16 个文件，零越权（只写 ② 清单） | in 2,240,170 / out 85,516 |

## 7. 已知观察（未修，留待用户裁决）

DeepSeek fetch 对部分站点（如 api-docs 文档页）返回的 `title` 本身就是接口 URL（实测 `https://api.deepseek.com/v1/tools/fetch`），按「标题 → slug」规则落成 `https-api.deepseek.com-v1-tools-fetch.md`——文件名可读性差。**未擅自加启发式**（超出已确认规格 FR-3）；如需优化，建议阶段05 后加「title 形如 URL 时回退 host-path」规则。
