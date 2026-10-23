# P1 第二批自验证据（FR-11 同域子页合并）

- 时间：2026-10-21 09:20–09:55（Asia/Shanghai）
- 产物版本：`bundle` v0.1.0 → **v0.2.0**
- 执行：门禁/构建/注入链**主侧执行**；代码由 ZCode 起草（E7），主侧复核修正 1 处
- 环境：Node v24.18.1；checkout `D:/deepseek-harness`；bash = Git Bash

## 1. 门禁（命令原文 + 退出码）

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | **0** | `=== Build complete ===`（首轮 **2**：`TS2367` 收窄误判，已修，见 §4） |
| 2 | `tsc -p tsconfig.json --noEmit` | **0** | 无输出 |
| 3 | `node scripts/verify.mjs` | **0** | 13 项全 `-ok`：`module / tool-contract / error-codes / validateUrl / resolveApiKey / classifyError / cleanMarkdown / slugify / config-fields / preset / **discover / bfs / merge**` + `verify: PASS` |
| 4 | `node scripts/assert-config.mjs` | 0 | `config-fields-ok`（7 → **11** 字段） |
| 5 | `node scripts/assert-discover.mjs` | 0 | `discover-ok`（7 类锚点 + 4 类 robots 样例） |
| 6 | `node scripts/assert-bfs.mjs` | 0 | `bfs-ok`（本地 http 桩 9 用例：深度/页数/子页失败/预算/取消/robots 拒根/拒子树/空正文/发现 404 降级） |
| 7 | `node scripts/assert-merge.mjs` | 0 | `merge-ok`（整串严格相等比对 + 命名与 URL 形态回退） |
| 8 | `assert-validate-url / resolve-apikey / classify-error / clean / slugify / preset` | 全 0 | 原 6 个断言仍 PASS（**P0 断言未被破坏**） |
| 9 | `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle>` | **0** | `[PASS] bundle`；`1/1 PASS; 0 FAIL` |
| 10 | `package.json` version | — | `0.2.0` |

## 2. P0 回归（判据 A7：单页路径逐字节不变）

| 用例 | 结果 |
|---|---|
| 不传 `children` | `ok:true`；落盘**无** `> 来源:` 行、**无** `##` 页标题、**无** `---` 分隔、**无** front matter；首行即正文 |
| `children:false` | 与上同构（`sameShape=true`，无来源行） |
| `children:false` + `max_depth:5` + `max_pages:99` | `ok:true`（两参被忽略且**不报错**） |
| 未知参数 `filename` | `E_INVALID_URL`「不支持的参数：filename（本工具仅支持 url / output_dir / clean / children / max_depth …）」 |

## 3. 合集路径端到端

**3.1 lib 直连（隔离临时目录，验后已删）**

| 项 | 值 |
|---|---|
| 输入 | `https://api-docs.deepseek.com/zh-cn/guides/search`，`children:true, max_depth:1, max_pages:5` |
| 返回 | `ok:true`，`pages_total=5`、`pages_ok=5`、`pages_failed=0`，47083 字符 |
| 文件 | `网页搜索与抓取-合集.md`；来源行 5、`---` 5、无 front matter、无 BOM |
| `max_depth:0` | `pages_total=1`（仅根页）✓ |

**3.2 宿主真实调用（已装配 profile + `dev_reload_package`）**

```
deepseek_fetch({ url: "https://api-docs.deepseek.com/zh-cn/guides/search",
                 children: true, max_depth: 1, max_pages: 4 })
→ 抓取成功（合集）：网页搜索与抓取
  路径：C:\deepseek网页抓取\网页搜索与抓取-合集.md
  （共 4 页：4 成功 / 0 失败，25273 字符，696ms）
```

落盘核验（`C:\deepseek网页抓取\网页搜索与抓取-合集.md`，31828 B）：

- 来源行 **4**：`/zh-cn/guides/search`、`/zh-cn/`、`/guides/search`、`/zh-cn/guides/vision`
- 分隔线 `---` **4**；**无** front matter；**无** BOM
- 「## 未抓取清单」存在，如实列出 **15** 个因页数预算未抓的页面（`超出页数预算（max_pages=4）`）
- 结构抽样（行号 0–8）：

```
# 网页搜索与抓取

> 来源: https://api-docs.deepseek.com/zh-cn/guides/search

Search / Fetch API 已上线，使用自研搜索引擎，支持网页搜索与抓取，点此查看使用指南。
```

## 4. 施工期缺陷与修正

| # | 现象 | 处置 |
|---|---|---|
| 1 | 首轮构建 `TS2367`（index.ts:852）：823 行已判 `signal?.aborted === true`，TS 把它窄化为 `false \| undefined`，852 行重复比较被判「无交集」 | 改为真值判断 `if (signal?.aborted) return`（运行期语义不变，TS 不再报错）；复跑 build/tsc 全绿 |
| 2 | ZCode 侧 Bash 被拦，未跑工单机检、也未跑任何断言 | 主侧下发前已过 `validate-workorder.mts`（PASS，4169 字），接收方未复跑成功——**如实记录**；全部 A1~A5 门禁由主侧执行并留证 |
| 3 | ZCode 未建备份（备份路径不在工单 ② 白名单） | 如实记录；基线指纹 `index.ts sha256 c65bd40f9b99193a…`（28186 B）仍在变更日志中可追溯 |

## 5. 已知取舍（设计已声明，非缺陷）

| 项 | 说明 |
|---|---|
| 页内标题不重写 | 我方页标题用 `#`/`##`，页内原有 `#`/`##` 保持原样 → 根页出现两个同名 `# 网页搜索与抓取`（其一来自源页面本身）。设计 §14.6 明写「代价是页内 # 可能与页标题同级」 |
| 未抓取清单的粒度 | 页数/预算超限的剩余页**逐条列出**（本次 15 条），文件因此变长——可读性换完整性，用户可按 `max_pages` 调整 |

## 6. 委派记录（E7）

| 轮 | 目标 | 结果 | token |
|---|---|---|---|
| 1 | zcode_code 起草 T-11~T-14（纯写文件） | 成功：`src/index.ts` 1144 行 + 4 断言脚本，仅写 ② 清单内 7 路径 | in 4,335,398 / out 76,227（cacheRead 4,195,584） |
