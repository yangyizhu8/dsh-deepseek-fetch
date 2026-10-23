# 阶段05 独立审查与修复证据（第二轮）

- 时间：2026-10-21 03:45–04:10
- 触发：独立只读审查子代理（`3a316a32…`）报回 **P1×4 / P2×17**，推翻首版 SHIPPABLE 结论
- 处置：**首版 SHIPPABLE 作废**，按审查清单修复后重新执行全部门禁与功能自测

## 1. 已修（P1 全部 + 关键 P2）

| 编号 | 问题 | 修复落点 | 复验证据 |
|---|---|---|---|
| P1-1 | `rename` 会静默覆盖（Windows/POSIX 皆然），"绝不覆盖"只是 `existsSync` 预检（TOCTOU） | `writeDoc` 改为**排他占名**：写满 tmp → `fs.link(tmp,target)`（EEXIST→下一候选）→ 不支持硬链接时 `copyFile(...,COPYFILE_EXCL)`；**不再用 rename** | 3 并发同名 → `Stub-Title.md` / `-2` / `-3` 三文件并存；`tmpLeftover=[]` |
| P1-2 | 相对 `output_dir` 按**宿主进程 cwd** 解析（会写进别的项目目录） | `executeFetch` 接收 `exec`；`sessionCwd()` 取 `exec.agent.session.header.cwd`（框架 `dsh-tools` 同款取法）；返回值新增 `base_dir` 如实标注基准 | `exec.agent.session.header.cwd=<session-ws>` + `output_dir:'notes'` → 文件落 `session-ws/notes/`，`base_dir` 回显该路径 |
| P1-3 | `exec.signal` 完全未接；取消后仍落盘 | `execute(args, exec)`；`AbortSignal.any([controller.signal, exec.signal])`；落盘前再查 `exec.signal.aborted`；取消类失败不重试 | 已取消信号 → `E_UPSTREAM`「调用方已取消本次执行」，**文件数不变** |
| P1-4 | Spec FR-7（env→用户级→config）与 Design §7（env→config→reg）互相矛盾 | 代码保持**合 Spec**；Design 已按 Spec 修正（见 Design 变更日志 v0.2）；E_NO_KEY 文案顺序同步 | `assert-resolve-apikey` PASS |
| P2-5 | 最坏耗时 2×60s，超 §5「含重试 60s」 | `fetchOne` 用**总预算 deadline**，每次尝试用剩余时间；预算耗尽不再重试 | 桩 500 + `timeoutMs=4000` → 17ms 返回 `E_UPSTREAM` |
| P2-9 | `output_dir:""` 会落到 cwd | execute 内显式拒绝空白串 → `E_IO` | `output_dir:'   '` → `E_IO` |
| P2-10 | env 分支未 trim，reg 分支已 trim | 统一 `fromEnv.trim()` | tsc/verify 绿 + 代码核对 |
| P2-11 | `execFile('reg')` 无超时，可无界挂起 | `{ timeout: 3000, maxBuffer: 64KB }` | 代码核对 |
| P2-13 | 围栏状态机过宽（```/~~~ 混用、四反引号内含 ``` 会错位） | 记录**开围栏字符+长度**，仅同字符且长度≥开头且无 info string 才闭合；支持 `>` 引用内围栏 | 四反引号围栏内含 ``` 的用例：内层保留、其后正文正确剥离 |
| P2-14 | 行内代码无豁免（`C:\*.txt` 被剥） | 剥离时跳过成对反引号内的 code span | `` `C:\*.txt` `` 保留、同行的 `C:\*.txt` 剥离 |
| P2-15 | 保留名只看整串（`con.backup` 会被判合法 → rename 失败 → E_IO） | 按首个 `.` 前段判定 | `con.backup`→`_con.backup`、`aux.v2`→`_aux.v2` |
| P2-16 | 二阶兜底只有秒级时间戳，同秒多次即 E_IO | 时间戳后缀加**毫秒 + 4 位随机** | 代码核对 |
| P2-17 | `chars` 按 UTF-16 code unit（emoji 算 2） | 改 `[...content].length`（码点） | 实抓 `chars=916` 与首版一致（无 emoji 场景） |
| P2-20 | E_NO_KEY 文案顺序与实际相反 | 改为「进程环境 / Windows 用户级环境 / Config.apiKey」 | 代码核对 |
| P2-21 | 未知参数被框架静默忽略（schema 无 `additionalProperties:false`） | execute 内白名单校验，未知键显式拒绝 | `{children:true}` → `E_INVALID_URL`「不支持的参数：children」 |

## 2. 未修（已评估，作为已知限制写入 SHIPPABLE §3.2）

| 编号 | 问题 | 决定与理由 |
|---|---|---|
| P2-6 | "200 但非 JSON" 也计入 `E_UPSTREAM` 重试；重试无退避 | 保守不改：上游契约变化时重试一次可提高成功率；退避对单次人工调用收益小。已在报告登记 |
| P2-7 | 400/413/422 归 `E_FETCH_FAILED`，hint 误导为站点问题 | 归因需上游 error.type 细分，当前接口未保证；留待上游契约明确 |
| P2-12 | 临时文件清理是 best-effort（AV 占用会残留隐藏 tmp） | 已改为 `finally` 必执行 + 失败静默；残留为隐藏文件、不影响交付文件；彻底解决需重试清理 |
| P2-18 | 无响应体大小上限（超大页面整块入内存） | 未加：DeepSeek 侧返回的 Markdown 实际有截断，且加阈值会改变「完整落盘」语义；建议下版加 `maxBytes` Config |
| P2-19 | `Config.apiKey` 直配会让 Key 明文进 profile patch | 设计原意是本地兜底；已在报告与 SHIPPABLE 中明示「推荐仅用环境变量」 |
| 4 空格缩进代码块 | 不被识别为代码块 → 其内反斜杠会被剥离 | 与嵌套列表无法可靠区分；写入 SHIPPABLE 已知限制，建议 `clean:false` 兜底 |
| `E_EMPTY_CONTENT` 无 request_id | 200 响应体本就不含 request_id | 上游事实；已让失败对象与成功形状对齐（`request_id: null`），不臆造 |

## 3. 修复后门禁复跑

| 门 | 命令 | 结果 |
|---|---|---|
| 构建 | `DSH_CHECKOUT=D:/deepseek-harness bash scripts/build.sh` | exit 0，`=== Build complete ===` |
| 类型 | `tsc -p tsconfig.json --noEmit` | exit 0 |
| 自验 | `node scripts/verify.mjs` | 10 项全 `-ok` + `verify: PASS`，exit 0 |
| 准入 | `check-plugin-ready.mjs <bundle>` | `[PASS] bundle`，1/1 PASS |
| 真实抓取 | `deepseek_fetch({url:'https://example.com'})`（lib 直连） | `ok:true`，`Example-Domain.md`，916 字符，无 BOM，首行即正文 |

## 4. 修复过程返工记录（如实）

| 次数 | 现象 | 处置 |
|---|---|---|
| 1 | 首次构建失败 `TS1005 ',' expected` | 我上一处编辑误删换行（`$/iconst` 粘连）→ 补回 |
| 2 | 无其它返工 | — |
