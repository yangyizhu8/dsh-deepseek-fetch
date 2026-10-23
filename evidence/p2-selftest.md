# P2 阶段04 自验证据（FR-12 渲染素材通道）

- 时间：2026-10-22 01:45 – 02:40
- 产物版本：`bundle` v0.2.0 → **v0.3.0**
- 执行：门禁/构建/端到端**主侧执行**；代码由 ZCode 起草（E7，工单 wo-03，机检 PASS 5109 字），主侧复核并修 5 处

## 1. 交付文件（工单 ② 白名单内，零越权）

| 文件 | 变更 |
|---|---|
| `bundle/src/index.ts` | 1279 → **2404 行**（T-16~T-19 主体） |
| `bundle/scripts/assert-render.mjs` | 新建（101 行） |
| `bundle/scripts/assert-shots.mjs` | 新建（152 行） |
| `bundle/scripts/assert-arbiter.mjs` | 新建（152 行） |
| `bundle/scripts/assert-config.mjs` | 期望字段 11 → 16（后 17） |
| `bundle/scripts/assert-classify-error.mjs` | 注释更新 |
| `bundle/scripts/verify.mjs` | 16 → **19 项**（+render/shots/arbiter） |
| `bundle/package.json` | version → `0.3.0` |

**diff 范围核对**：ZCode 仅改动上述 8 个路径（主侧按 40 分钟窗口核对文件 mtime），基线四件未动。

## 2. 门禁（命令原文 + 退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | **0** | `=== Build complete ===`（首轮 2 → TS 修复后 0） |
| `tsc -p tsconfig.json --noEmit` | **0** | 无输出 |
| `node scripts/verify.mjs` | **0** | 19 项全 `-ok` + `verify: PASS` |
| `node scripts/assert-config.mjs` | 0 | `config-fields-ok` |
| `node scripts/assert-render.mjs` | 0 | `render-ok` |
| `node scripts/assert-shots.mjs` | 0（首轮 52） | `shots-ok`（首轮失败为**断言样例数据错**，见 §4-①） |
| `node scripts/assert-arbiter.mjs` | 0 | `arbiter-ok` |
| `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle>` | **0** | `[PASS] bundle` 1/1 |

**防恒绿抽检**（改真正的断言条件）：`pickScrollingElement(candidates) !== 1` → `!== 0` ⇒ **exit 52**；还原 ⇒ `verify: PASS`（exit 0）。

## 3. 端到端（宿主真实调用，已装配 profile + `dev_reload_package` 前后 `[active]`）

### 3.1 素材包抓取

```
deepseek_fetch({ url: "https://www.kdocs.cn/l/cgJRsrQzOc1S",
                 render: true, text_source: "auto", max_shots: 10 })
→ 抓取成功（素材包）：交易回战 · AI自进化&可解释量化交易
  正文：C:\deepseek网页抓取\交易回战-·-AI自进化&可解释量化交易-6.md（2387 字符，来源 render）
  截图：C:\deepseek网页抓取\交易回战-·-AI自进化&可解释量化交易-6.shots（10 张）
  清单：C:\deepseek网页抓取\交易回战-·-AI自进化&可解释量化交易-6.manifest.json（18450ms）
```

素材包三件核验：

| 项 | 值 |
|---|---|
| `<基名>.md` | 5532 B；首行 = `交易回战 · AI自进化&可解释量化交易`；**含正文段落**（"量化策略每天都在运行" ✓）；**无** UI 噪声（"表情与角色" ✗）；**无** front matter |
| `<基名>.shots/` | **10 张** PNG（1440×900） |
| `<基名>.manifest.json` | `text_source=render`、`text_chars=2387`、`shots_total=10`、`merge_hint`（72 字）；键 = `url,title,text_source,text_chars,shots_total,shots,captured_at,merge_hint` |

### 3.2 P0 / P1 回归

| 用例 | 结果 |
|---|---|
| P0 单页（不传 children） | `ok:true`；落盘**无** `> 来源:` 行、**无** front matter、916 字符 → **纯正文未变** |
| P1 合集（`children:true, max_depth:1, max_pages:3`） | `ok:true`；`pages_total=3`；3 条 `> 来源:` 行；含「## 未抓取清单」→ **合集结构未变** |

### 3.3 资源

| 项 | 值 |
|---|---|
| Edge 进程 | 抓取前后**无新增残留**（插件只 kill 自己 spawn 的 child；实测残留 0） |
| 临时 profile | 插件自建的临时目录**已清理**（`workorders/` 下残留 0 个 `.edge*`——残留的两处是我自己的**探针脚本**留下，已手动清除） |
| 端口 | 随机空闲端口，仅 127.0.0.1 |

## 4. 主侧实测发现并修复的 5 处（关键证据）

| # | 现象 | 判定 | 修复 |
|---|---|---|---|
| ① | `assert-shots` ① 失败："scrollHeight ≤ clientHeight+50 应不合格" | **断言错，实现对**：样例 `sh=700/ch=600` 实为可滚（700 > 650） | 样例改 `sh=640/ch=600` |
| ② | 首轮真实抓取：正文 **0 字符**、仅 1 张截图 | 实现缺陷：只等 `renderSettleMs`（700ms），页面未成型 | 补 `waitForRenderReady`：总预算内每 500ms 轮询"有实质内容"（文本≥200 字 / 有 canvas / readyState=complete 且有子节点）→ 正文 0 → 655 字、截图 1 → 8 张 |
| ③ | 正文 655 字（只有轮廓面板） | 实现缺陷：候选容器**采集过早**（WebOffice 正文容器约 9s 后才建好） | 补 `waitForScrollableContent`（要求某候选 `scrollHeight ≥ 3×clientHeight`，排除轮廓面板）+ 触底后**重选容器** |
| ④ | 正文稳定在 **662 字**，永远取不到第 1 战正文 | **静默丢失型缺陷**（不报错，最难发现）：900/1600 视口下 WebOffice 正文**不在 DOM**（`innerText` 恒 1391 字＝轮廓面板），2400 视口下才 2670 字 | 改**两阶段视口**：高视口 `renderTextViewport`（1440×2400）取文字 → 切回 `renderViewport`（1440×900）取截图；新增 Config 字段（16 → 17）→ 正文 **662 → 2387 字** |
| ⑤ | `tsc` 报 `TS18047: 'textViewport' is possibly 'null'`（`parseViewport` 可返回 null） | 类型缺陷 | `?? viewport` 兜底 |

**④ 的实测对照（同一页面、仅改视口高度）**：

| 视口 | innerText 长度 | 含正文段落 |
|---|---|---|
| 900 | 1391 | ❌ 仅轮廓面板 |
| 1600 | 1391 | ❌ |
| **2400** | **2670** | ✅ |

## 5. 已知限制（实测确认，写入报告）

| ID | 内容 | 影响 |
|---|---|---|
| O-11 | **404 页面不触发降级**：站点 404 页仍含导航链接 → 被当可抓页，素材里会含 "Page Not Found" 正文 | 与 P0 同源（接口对 404 返回 200，无状态码可判） |
| O-13 | robots 通配符仅支持 `*` 与 `$`，不支持字符类等复杂写法 | 常见写法已覆盖 |
| O-14 | 正文取自**渲染后 DOM 文本**；canvas 绘制且不进 DOM 的内容（如纯图片页）取不到文字 | 这类页面只能靠截图 → agent 视觉文字化 |
| O-15 | 页面 JS 会在渲染中执行，页面自身可能发起内网请求 | **页面行为**，非插件主动；插件不拦截 |