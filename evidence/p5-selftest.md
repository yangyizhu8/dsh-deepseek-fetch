# 第五批（FR-15）阶段04 自验证据：渲染期剥离覆盖型浮层

- 时间：2026-10-23 17:49 – 23:59
- 产物版本：`bundle` v0.4.0 → **v0.5.0**（`src/index.ts` 2977 行）
- 执行：**门禁/构建/端到端全部主侧执行**；代码由 ZCode 起草（E7，工单 `wo-05-p5-strip.md`，机检 **PASS 3348 字**）

## 0. ZCode 执行实况（如实记录）

首轮 `zcode_code` 以 `[zcode-fallback:other]`「Turn execution failed」失败，**但失败前已写入大部分文件**（`index.ts` 2886→2977、`assert-strip.mjs` 已存在）；查 `zcode_bridge_status` 确认桥接健康（工具可用/密钥已读到）后重试一次，第二轮补齐 `verify.mjs`/`assert-config.mjs`/`package.json` 并**明确声明"所有命令未执行、基线 pin 不符（判为续作）"**。主侧据此**未回滚重写**，改为逐条实测验收。

## 1. 交付文件（工单 ② 白名单内，零越权）

| 文件 | 变更 |
|---|---|
| `bundle/src/index.ts` | 2886 → **2977 行**：`STRIP_MIN_VIEWPORT_COVERAGE=0.85` / `STRIP_MAX_TEXT_LENGTH=300`（导出常量并**插值进** `STRIP_OVERLAYS_JS`）+ `stripOverlays()` + `captureShots` 每屏一剥 + Config 第 18 字段 + `overlays_stripped` 贯通 |
| `bundle/scripts/assert-strip.mjs` | 新建（284 行，exit 54） |
| `bundle/scripts/verify.mjs` | 22 → **23 项**（+`strip`） |
| `bundle/scripts/assert-config.mjs` | Config 17 → **18** 字段 + 默认值断言 |
| `bundle/package.json` | version → **0.5.0** |

**diff 范围核对**：12 小时窗口内仅上述 5 个白名单文件被改；只读文件（`assert-shots/assert-pipeline/assert-png/assert-phash/cordis.patch.yml/build.sh/tsconfig.json`）mtime 全在 03:18 之前，**零触碰**。

## 2. 门禁（命令原文 + 退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | **0** | `=== Build complete ===` |
| `tsc -p tsconfig.json --noEmit` | **0** | 无输出 |
| `node scripts/verify.mjs` | **0** | **23 项全 `-ok` + `verify: PASS（23 项）`**（含 `strip-ok`） |
| `node scripts/assert-strip.mjs` | **0** | `strip-ok` |
| `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle>` | **0** | `[PASS] bundle` 1/1 |

### 数量红线

| 项 | 期望 | 实测 |
|---|---|---|
| 工具参数键 | 10 | **10** ✓ |
| 错误码 | 11 | **11** ✓ |
| `CONFIG_FIELDS` | **18**（+`renderStripOverlays`） | **18** ✓ |
| verify 项 | 23 | **23** ✓ |
| 新 npm 依赖 | 0 | **0** ✓ |

## 3. 防恒绿抽检（三次，逐次证明断言可证伪）

| 突变 | 结果 |
|---|---|
| ① `STRIP_MIN_VIEWPORT_COVERAGE` 0.85 → **0.0** | `assert-strip` **exit 54**：`⓪ STRIP_MIN_VIEWPORT_COVERAGE 应为 0.85，实际 0`（**常量守卫**命中） |
| ② 去掉文本量插值（`${STRIP_MAX_TEXT_LENGTH}` → `999999`） | **exit 54**：`⓪ STRIP_MAX_TEXT_LENGTH 未插值进 STRIP_OVERLAYS_JS`（**插值守卫**命中） |
| ③ **保留插值、反转比较方向**（`t.length > 300` → `t.length < 300`） | **exit 54**：`① 命中四重约束的假浮层应剥离 1 个，实际 0` ← **行为断言命中**，证明 `assert-strip` 真的在**执行** `STRIP_OVERLAYS_JS`（而非模式匹配文本） |

三次还原后 `verify: PASS（23 项）`。

## 4. 真实端到端（T-33 核心）

宿主内调用（`dev_reload_package` 前后 `[active]`）：

```
deepseek_fetch({ url: kdocs, render: true, render_settle_ms: 2500, max_shots: 12 })
→ 抓取成功（素材包）：交易回战 · AI自进化&可解释量化交易
  正文：…-6.md（2404 字符，来源 render）
  截图：…-6.shots（12 张，去重丢弃 0 张，sha1+phash）
  清单：…（59585ms，settle 2500ms / 预算 90000ms）
```

| 核验项 | 结果 |
|---|---|
| **`overlays_stripped`** | manifest 实测 = **4**（与原型 `probe-p4-strip.mjs` 命中的 4 个元素一致）✓ |
| **正文未被削弱** | **2404 字符**（与剥离前最优档一致 → 剥离没有破坏渲染，R-30 排除）✓ |
| **浮层是否真消失** | **人眼读图确认**：`03.png` 正文表格直接可见，中央无「快捷登录并查看」面板，仅余页面自身顶部工具栏（正常 chrome）✓ |
| **被剥元素逐条审计** | `workorders/probe-strip-audit.mjs`（只列举不删除）实测命中元素 = **4**：①`.editor-play-white-mask` 100%/fixed/文本0 ②`.overlay-reading-container` 95.6%/fixed/文本0 ③`.custom-overlay-container` 95.6%/fixed/文本236 ④`.component-popup.component-login-modal-pop` 100%/absolute/文本70（登录浮层）。**修正**：早期"容器+面板+标题+遮罩"的描述不实（面板≈5.6%、标题≈0.2%，按约束②不可能被剥） |
| 预算联动 | `settle 2500 / 预算 90000`（⌈12×2500×1.6⌉+20000 = 68000 < 90000 → 取 Config 90000，**只增不减**）✓ |
| 去重 | `shots_deduped=0`、`sha1+phash`（12 帧内容各异 → 正确不判重）✓ |

### 4.1 无浮层页面的行为（避免"无条件剥"）

```
deepseek_fetch({ url: "https://example.com", render: true })
→ ok=true  overlays_stripped=0  shots=1  dedup=sha1+phash
```

`overlays_stripped=0` → 普通页面**不误剥、不报错、正常出 1 张截图** ✓

## 5. P0 / P1 回归

| 用例 | 结果 |
|---|---|
| P0 单页 | `ok:true`；落盘**无** `> 来源:`、**无** front matter、916 字符 → 纯正文未变 |
| P1 合集（`children:true, max_depth:1, max_pages:3`） | `ok:true`；`pages_total=3`；3 条 `> 来源:`；含「## 未抓取清单」 |
| 越界参数（`render_settle_ms: 6000`） | `ok:false`、`E_INVALID_URL` |

## 6. 资源与交付卫生

| 项 | 结果 |
|---|---|
| 临时 profile 残留（`%TEMP%\dsh-dsf-edge-*`） | **0** |
| `lib/_bak*` / `src/_bak*` | **0 / 0** |
| `.zcode/`（483 B 明文 Key） | 存在过 → **已删除**；全仓 `sk-*` 扫描 **0 命中** |
| Edge 进程 | **未按进程名杀**（吸取 P2 教训）；插件只回收自己 spawn 的 child，临时目录已清零 |
| `package.json` version | **0.5.0** |

## 7. 已知限制（沿用 + 新增）

| 项 | 说明 |
|---|---|
| 剥离是**启发式** | 四重约束（class 关键词 / 覆盖 ≥85% / 文本 <300 / 非 CANVAS-IFRAME）；不匹配的浮层不会被剥（保守） |
| 依赖 class 命名 | 若站点用无语义 class（如 `div-1a2b`）承载浮层 → 剥不到；此时行为退回 v0.4.0（`overlays_stripped=0`） |
| 剥的是"覆盖型" | 局部浮层（工具提示、气泡）按设计**不剥** |
| iframe 内浮层 | 不处理（跨源不可达） |
| 去重阈值 | **一个都没改**（`hamming 2 / MAD 1.5 / cell 24 / uniform 3`）——剥离后双阈值自然恢复分辨力 |

## 7.5 阶段05 独立审查后的修复（5 项 + 断言补齐）

| ID | 问题 | 修复 |
|---|---|---|
| **P1-1** | 剥离后不刷新滚动容器引用 → 容器（或其祖先）被移除时脱挂节点 `scrollHeight` 恒 0 → 误判触底 → **静默只出 1 张、不计 partial、无告警** | 剥离数 > 0 时**重新采集候选 + 重选容器 + 重置 `lastY`/`repickStalls`** |
| P2-4 | 视口面积为 0 时面积约束恒真（探针：5×5 元素被剥） | 表达式开头 `if (!(area > 0)) return 0` |
| P2-5 | 只判面积不判定位 → **文档流内**短区块（`.guide-content` 8 字）被误剥 | 新增**第五重约束**：computed `position` ∈ `fixed`/`absolute`/`sticky`；**实测真实站点仍剥到 4 个，效果未削弱** |
| P2-2 / P2-6 | 文本边界口径（实现 `>300` 跳 vs 文档"<300 才剥"）与计数允许非整数 | 改为 `>= STRIP_MAX_TEXT_LENGTH` 跳过（对齐"<300"）；计数收紧为 `Number.isInteger` |
| P2-12 | 工具成功文本未回显剥离数 | 成功文本追加 `剥离 N 个覆盖层`（N>0 时） |
| P2-1 / P2-9 | Design 写"自身文本量"（实为子树 `textContent`）；"非 render 路径不出现字段"表述不准 | Design §17.2 改述为"元素**子树** `textContent` 字符数"并注明"祖先效应 = 安全方向漏剥"；Spec/Design 补"未跑截图通道的路径不出现" |

**新增断言**（`bundle/scripts/assert-strip.mjs`）：

| 用例 | 覆盖 |
|---|---|
| ④b | 流内 `static` 同名区块**不剥**；同区块改 `fixed` 后剥 1 |
| ④c | 零视口 → 返回 0（面积约束不得被架空） |
| ④d | 文本恰 300 字**不剥**、299 字剥 1（边界口径） |
| ④e | 大写关键词 `POPUP-ROOT` 命中（`/i` 不敏感） |
| ⑤ 扩展 | 非整数 `2.5` 折叠为 0 |
| **⑥b** | **事件序列断言"每屏截图前必先剥离"**（`strip` 与 `capture` 共享交错序列） |

**⑥b 可证伪证明**：把生产代码的 `[剥离块][截图块]` 交换为 `[截图][剥离]`（语法仍合法，构建仍 0）→ `assert-strip` **exit 54**：`⑥b 第 1 屏的截图前必须是剥离，实际序列 capture,strip,capture,strip,capture,strip`；还原 → `verify: PASS（23 项）`。

**登记不修（留 P6）**：P2-7(b) 假 DOM 未模拟"删除后脱挂"（真实 DOM 靠 document order + 脱挂 rect=0 成立）、P2-7(c)(d) 其余断言覆盖缺口与兜底 `return 1`、P2-8 每屏全量扫描成本、P2-10 真实"同内容帧"样本不可得（已降级为不作验收项）。

## 8. 复现路径

```powershell
cd C:\project-study\dsh-deepseek-fetch\bundle
$env:DSH_CHECKOUT='D:/deepseek-harness'
& 'C:\Program Files\Git\bin\bash.exe' scripts/build.sh
node scripts/verify.mjs          # 期望 23 项 PASS
node scripts/assert-strip.mjs    # 期望 strip-ok
```
