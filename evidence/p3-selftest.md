# P3 阶段04 自验证据（FR-13 参数化等待 · FR-14 感知哈希去重）

- 时间：2026-10-23 01:05 – 02:05
- 产物版本：`bundle` v0.3.0 → **v0.4.0**
- 执行：门禁/构建/端到端**主侧执行**；代码由 ZCode 起草（E7，工单 `wo-04-p3-settle-phash.md`，机检 PASS 4576 字），主侧复核并修 1 处测试桩缺陷

## 1. 交付文件（工单 ② 白名单内，零越权）

| 文件 | 变更 |
|---|---|
| `bundle/src/index.ts` | 2543 → **2845 行**（阶段04 交付时；阶段05 加固后为 **2900 行**）：`render_settle_ms` 参数 + `resolveRenderBudget` + ⑩-4b 感知哈希节 + `captureShots` 帧指纹去重 + 4 个回显字段贯通 |
| `bundle/scripts/assert-png.mjs` | 新建（150 行） |
| `bundle/scripts/assert-phash.mjs` | 新建（114 行） |
| `bundle/scripts/assert-shots.mjs` | 增 ③f/③g/③h 去重用例（252 行） |
| `bundle/scripts/assert-pipeline.mjs` | 增 ⑧a~⑧d 参数/预算/去重贯通（420 行） |
| `bundle/scripts/verify.mjs` | 20 → **22 项** |
| `bundle/package.json` | version → `0.4.0` |

**diff 范围核对**：ZCode 仅改动上述 7 个路径（主侧按 50 分钟窗口核对 mtime），基线四件未动。

## 2. 门禁（命令原文 + 退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | **0** | `=== Build complete ===` |
| `tsc -p tsconfig.json --noEmit` | **0** | 无输出 |
| `node scripts/verify.mjs` | **0** | **22 项全 `-ok` + `verify: PASS（22 项）`**（原 20 + `png` + `phash`） |
| `node scripts/assert-png.mjs` | 0 | `png-ok` |
| `node scripts/assert-phash.mjs` | 0 | `phash-ok` |
| `node D:/deepseek-harness/scripts/check-plugin-ready.mjs <bundle>` | **0** | `[PASS] bundle` 1/1 |

### 防恒绿抽检（两次，均证明断言非恒真）

| 突变 | 结果 |
|---|---|
| ① `PHASH_MAX_MAD` 1.5 → 99 | `assert-phash` **exit 55**，报 `PHASH_MAX_MAD 应为 1.5，实际 99`（常量守卫命中） |
| ② **去掉 MAD 复核**（模拟"dHash 单用"的错误实现） | `assert-phash` **exit 55**，报 `② 相似对 38.png vs 42.png 不得判重（原型实测 MAD≥2.791），实际 true（hamming=2、MAD=2.791）` ← **行为断言确实可证伪** |

两次还原后 `verify: PASS（22 项）`。

## 3. 主侧修复的 1 处缺陷（ZCode 交付后实测发现）

| ID | 现象 | 判定 | 修复 |
|---|---|---|---|
| D-29 | ⑧d 管线用例报 `E_RENDER_TIMEOUT`，实测耗时 **31.1 秒**（预算 30s 全部耗尽） | **测试桩缺陷**（非实现缺陷）：假会话用 `if (s.includes('canvas')) return 0` 把 `JS_RENDER_READY`（其内部含 `querySelectorAll('canvas')`）也判成 **0=未就绪** → `waitForRenderReady` 空等到 deadline。P2 的同类用例之所以通过，是因为它们对未知表达式返回 `1`，恰好让就绪判据成立 | 假会话**先判就绪判据特征**（`readyState`/`children.length`）→ 返回 1，再判 canvas |

**定位方法**：给假会话每个 `evalJs` 表达式打类型标签并记时间戳 → 时间线显示 `canvas@28ms … canvas@30010ms`（每 500ms 一次、持续到 deadline），据此锁定是就绪轮询而非 silver bullet。

## 4. 端到端（宿主真实调用，已装配 profile + `dev_reload_package` 前后 `[active]`）

### 4.1 不传 `render_settle_ms`（P2 零回归验证）

```
deepseek_fetch({ url: "https://example.com", render: true })
→ 抓取成功（素材包）：Example Domain
  正文：…\Example-Domain.md（916 字符，来源 api）
  截图：…\Example-Domain.shots（1 张，去重丢弃 0 张，sha1+phash）
  清单：…（6255ms，settle 700ms / 预算 90000ms）
```

**关键**：`settle 700ms / 预算 90000ms` = Config 默认值，**未触发联动** → 与 P2 行为逐语义一致；耗时 6.2s（P2 实测 6.5s）。

### 4.2 传 `render_settle_ms: 2500`（预算联动 + 去重）

```
deepseek_fetch({ url: kdocs, render: true, render_settle_ms: 2500, max_shots: 50 })
→ 抓取成功（素材包）：交易回战 · AI自进化&可解释量化交易
  正文：…-2.md（2404 字符，来源 render）
  截图：…-2.shots（41 张，去重丢弃 4 张，sha1+phash）
  清单：…（161456ms，settle 2500ms / 预算 220000ms）
```

| 核验项 | 结果 |
|---|---|
| 预算联动算式 | `⌈50 × 2500 × 1.6⌉ + 20000` = **220000** ✓ 与回显一致（Config 只有 90000） |
| 是否超时 | 实际 161.5s < 220s → **未出现 `E_RENDER_TIMEOUT`** ✓ |
| 去重是否生效 | 45 帧 → **41 张**，`shots_deduped=4`，`dedup_method='sha1+phash'` ✓ |
| 正文完整度 | 2404 字符（与 P2 最优档一致）✓ |

### 4.3 去重结果的「安全侧」核验（R-26 最严重风险）

对**新素材包 41 张**逐帧复核（脚本 `workorders/verify-dedup-result.mjs`）：

| 检查 | 结果 |
|---|---|
| 相邻帧残留近重复（`isNearDuplicate` 逐对） | **0 对** ✓ |
| 近空白帧（32×32 灰度标准差 < 2） | **0 张** ← 此前 sha1 版本有 2 张空白近重复帧 |
| 41 张的灰度标准差 | 全部 ≥ **32**（40 张在 32–40 区间）→ **无真内容被误删** ✓ |

### 4.4 边界拒绝（两层防护）

| 输入 | 结果 |
|---|---|
| `render_settle_ms: 6000` | 插件拒绝：`E_INVALID_URL` + hint 含「参数」✓ |
| `render_settle_ms: -1` | 插件拒绝：`E_INVALID_URL` + hint 含「参数」✓ |
| `render_settle_ms: 1.5` | **框架 schema 先拒**：`ToolArgsError: "render_settle_ms" must be an integer` ✓（双保险） |

### 4.5 P0 / P1 回归

| 用例 | 结果 |
|---|---|
| P0 单页 | `ok:true`；落盘无 `> 来源:`、无 front matter、916 字符 → **纯正文未变** |
| P1 合集（`children:true, max_depth:1, max_pages:3`） | `ok:true`；`pages_total=3`；3 条 `> 来源:`；含「## 未抓取清单」 |

## 5. 资源与交付卫生

| 项 | 结果 |
|---|---|
| Edge 进程 | 无新增残留（只 kill 自己 spawn 的 child） |
| 临时 profile | `workorders/` 下 `.edge*` 残留 **0** |
| `lib/_bak*` 编译产物 | **0**（P2 曾出现，本轮每次突变后即删） |
| `.zcode/`（含明文 Key） | 存在过（483 B `config.json`）→ **已删除**；全仓 `sk-*` 扫描 **0 命中** |
| `package.json` version | **0.4.0** |

## 6. 已知代价与限制

| 项 | 说明 |
|---|---|
| 解码开销 | 每帧 ~31ms（仅 sha1 不同时才解码）；45 帧 ≈ +1.4s，已含在 161.5s 总耗时内 |
| 预算联动只增不减 | 传 `render_settle_ms` 时预算只会 ≥ `Config.renderTimeoutMs`，不会缩小 |
| `render_settle_ms` 仅在 `render:true` 时生效 | 与 `max_shots`/`text_source` 同策略（非 render 路径静默忽略，不报错） |
| 非 8-bit/隔行 PNG | 解码显式抛 `PngUnsupportedError` → 回退 sha1 并标 `dedup_method='sha1(fallback)'` |
| 阈值固定 | `PHASH_MAX_HAMMING=2` / `PHASH_MAX_MAD=1.5` 为内部常量，不进 Config（避免配置面膨胀） |
