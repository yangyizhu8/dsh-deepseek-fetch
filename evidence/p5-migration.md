# 迁移收口证据（T-34~T-37 · 方案 A）

- 时间：2026-10-24 00:59 – 01:25
- 用户裁决：迁移方案 **A**（独立 GitHub 仓 + 克隆落位 + 宿主 link 改指）
- 结论：**成功**。GitHub 仓 `yangyizhu8/dsh-deepseek-fetch`（公开）已建立并推送；克隆目录 `D:\dsh-sync\packages\dsh-deepseek-fetch` 自足可构建可验证；宿主已从克隆目录加载插件（**反向探针证明**）；旧工作副本保留为回退点。

## 1. 生态侦察结论（迁移前）

| 事实 | 结论 |
|---|---|
| `@dsh-external` 性质 | **本机约定的 scope**（包名 + `link:` 安装）；GitHub 上**无同名单体仓**（搜索无果） |
| 本机 32 个该 scope 包的落位 | `D:\dsh-sync\packages` 19 个 · `D:\deepseek-harness\plugins` 13 个 · 零散 3 处 |
| `D:\deepseek-harness\plugins` 合并仓 | git 仅跟踪 8 个顶层目录（白名单 5 插件 + archive + jev-decision-adapter + workorders）；README 明确"白名单五插件，其余目录不在本仓范围"；现存 **12 处他人在途改动** → **本方案不碰它** |
| `yangyizhu8` 的 GitHub 模式 | **一插件一仓**（dsh-unread-mark / dsh-session-handoff / dsh-expert-market / dsh-powercontext / dsh）→ 方案 A 沿用该模式 |
| `gh` 凭据 | 已登录 `yangyizhu8`，scopes 含 `repo`（R-33 前置通过） |

## 2. T-34 建仓

```
gh repo create yangyizhu8/dsh-deepseek-fetch --public --description "..."
→ https://github.com/yangyizhu8/dsh-deepseek-fetch   (CREATE_EXIT=0)
gh repo view → {"visibility":"PUBLIC","defaultBranchRef":{"name":"main"}}
```

## 3. T-35 克隆落位与同步

| 项 | 结果 |
|---|---|
| 克隆 | `git clone … D:\dsh-sync\packages\dsh-deepseek-fetch` → exit 0 |
| 同步方式 | **robocopy**（排除 `node_modules` / `.git` / `.zcode` / `_bak*` / `*.bak-*` / `*.tmp-*`）→ exit 3（成功） |
| 首次尝试失败留痕 | 用 `Copy-Item -Recurse` 时踩到 `bundle/node_modules` 里的 **junction 循环**（数百条 `DirectoryNotFoundException`）→ 改用 robocopy 排除后干净 |
| 入库文件 | **187** 个（不含 `.git`）；`node_modules` 残留 **0** |
| 顶层 | `bundle/ preset/ evidence/ diagrams/ workorders/ README LICENSE .gitignore` + 5 份流水线文档 |
| 提交 | `ec14502`（首笔）+ `05d1340`（README 安装步骤补构建环节） |
| 远端一致 | 本地 HEAD == `origin/main` ✓；远端目录 API 抽查：13 顶层项、`bundle/{src,scripts,...}`、**19 个断言脚本** ✓ |

## 4. 克隆自足性验证

```
cd D:\dsh-sync\packages\dsh-deepseek-fetch\bundle
DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh   → exit 0（链接 peer 依赖 + tsc）
node scripts/verify.mjs                                   → verify: PASS（23 项）
check-plugin-ready.mjs <clone/bundle>                     → [PASS] bundle 1/1
git status --porcelain                                    → 0（node_modules 已被 .gitignore 排除）
```

> **发现并修正**：`bundle/.gitignore` 内含 `lib/` → `lib` 是构建产物、**不入库**。因此克隆后**必须先跑 `build.sh`**；已在 README 安装步骤里补上该环节与警告。

## 5. T-36 宿主 link 改指

| 步骤 | 结果 |
|---|---|
| 备份 | `~/.dsh/profiles/web/package.json.bak-link-repoint`（原样字节） |
| 依赖改写 | `link:C:\project-study\dsh-deepseek-fetch\bundle` → `link:D:/dsh-sync/packages/dsh-deepseek-fetch/bundle` |
| **BOM 纪律** | 读入时 BOM=false → JSON 解析 → 写回 **无 BOM**（625 字节校验、`JSON.parse` 通过） ✓ |
| `dsh.profile.bundles` | 含 `@dsh-external/dsh-deepseek-fetch` ✓ |
| junction 重建 | 先删旧 junction，再 `New-Item -ItemType Junction → D:\...\bundle`；`lib/index.js` 可达 ✓ |
| 重载 | `dev_reload_package` → `before: [active]` / `after: [active]` ✓ |

### 决定性验证（反向探针）

| 探针 | 结果 | 结论 |
|---|---|---|
| 移走**克隆**的 `bundle/lib` → `dev_reload_package` | **失败**（`The "type" argument must be of type string…`），**尽管旧路径 lib 完好** | **加载源 = 克隆目录** ✓ |
| 恢复克隆 `lib` → 重载 | `[active]` 恢复 | 探针可逆、无残留（`git status` 0） |
| 顺带记录 | 同型探针（移走旧 lib）也报同样错误，说明该错误信息是"入口模块缺失"的表现而非路径问题 | — |

**迁移后真实调用**（两条通道都验）：

```
deepseek_fetch({url: example.com, render: true})
→ 抓取成功（素材包）… 1 张，去重丢弃 0 张，sha1+phash；settle 700ms / 预算 90000ms

deepseek_fetch({url: example.com})
→ 抓取成功 … 916 字符
```

## 6. T-37 迁移后全量回归

| 检查 | 结果 |
|---|---|
| 克隆目录 `verify.mjs` | **23 项 PASS** |
| 旧工作副本 `verify.mjs` | **23 项 PASS**（回退点仍可用） |
| 宿主重载 ×3 | 均 `[active]`，无重复 entry |
| 插件工具实际可用 | 单页 + 渲染素材包两形态均成功 |
| profile JSON | 无 BOM、可解析、bundles 含本插件 |
| 远端与本地 | HEAD 一致（`05d1340`） |
| 回滚点 | ① `package.json.bak-link-repoint` ② 旧工作副本 `C:\project-study\dsh-deepseek-fetch`（lib 完整、verify PASS） |

### 卸载即净：**未在生产宿主执行 uninject（有意偏离，理由如下）**

`dev_uninject_plugin` 会向 profile patch 写入 `disabled` 条目并删 junction；在生产宿主上执行会让插件消失、且需改 profile 才能恢复 —— **风险高于收益**。改为等价证据：

1. 插件 `apply` **只做一件事**：`ctx.effect(() => ctx.tools.register(...), id)` → dispose 即撤工具，无路由/定时器/slot/监听器；
2. `dev_plugin_status` 全量清单中 `deepseek-fetch` **恰 1 条** entry；
3. 重载 ×3 后仍恰 1 条，无 `duplicate` / `already registered`；
4. 无插件路由（`dev_clear_routes` 无前缀可清）。

## 7. 迁移后目录约定（写入 README）

- **单向同步**：本地工作副本（`C:\project-study\dsh-deepseek-fetch`）→ 提交 → 克隆（`git pull`）；**克隆目录不再手工编辑**。
- `bundle/lib` / `bundle/node_modules` 为构建产物，`bundle/.gitignore` 排除；克隆后必跑 `build.sh`。
- 旧工作副本**不删**：既是唯一编辑源，也是回退点。
