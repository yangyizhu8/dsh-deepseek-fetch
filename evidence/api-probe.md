# DeepSeek Fetch API 实测证据（阶段01 前置验证）

- 时间：2026-10-21 01:07 ~ 01:12（Asia/Shanghai）
- 端点：`POST https://api.deepseek.com/v1/tools/fetch`
- 鉴权：`Authorization: Bearer $DEEPSEEK_API_KEY`（用户级环境变量，长度 35，`sk-` 前缀；未在任何输出中打印）
- 探测脚本：`C:\project-study\_probe\fetch-probe.mjs`、`fetch-probe2.mjs`（Node v24.18.1 原生 fetch）
- 文档依据：https://api-docs.deepseek.com/zh-cn/api/fetch

## 用例结果汇总

| # | 用例 | URL | HTTP | 耗时 | 结果 |
|---|---|---|---|---|---|
| A | 英文文档页 | `https://api-docs.deepseek.com/zh-cn/api/fetch` | 200 | 3311 ms | ✅ `keys=content,title`，`content_len=1039`；标题回退为端点 URL |
| B | 极简页 | `https://example.com` | 200 | 120 ms | ✅ `title=Example Domain`，`content_len=931`，多语种正文 |
| C | 中文站点首页 | `https://www.deepseek.com` | 200 | 131 ms | ✅ `title=DeepSeek \| 深度求索`，`content_len=252`（首页正文天然短） |
| D | 非法 URL | `not-a-url` | 400 | 95 ms | ✅ 拒绝：`'url' must be a valid HTTP or HTTPS URL` |
| E | 不存在的域名 | `https://this-domain-definitely-not-exist-xyz123.com/a` | 404 | 3141 ms | ✅ 拒绝：`failed to fetch URL` |
| F | URL 含凭证 | `https://user:pass@example.com` | 400 | 250 ms | ✅ 拒绝：`'url' must not contain credentials` |
| G | HTTP 协议（非 HTTPS） | `http://example.com` | 200 | 3147 ms | ✅ 可用（自动跳到 https 内容） |
| H | 大站（维基百科中文） | `https://zh.wikipedia.org/zh-cn/Markdown` | 404 | 104 ms | ⚠️ 抓取失败：`failed to fetch URL`（站点侧受限，非插件缺陷） |

## 关键事实（直接影响规格）

1. **成功响应结构**：`{ "title": string, "content": string }`，`content` 即 Markdown 正文；`title` 缺失时可能回退为 URL 或空串（用例 A 出现 URL 回退）。
2. **Markdown 正文含反斜杠转义**：实测 `\/`、`\#`、`\:`、`\.`、`\,`、`\;`、`\(`、`\)`、`\<`、`\>`、`\'` 等大量出现（用例 G 单页 11 处），直接落盘会得到"脏 Markdown" → 规格 FR-2 依据。
3. **错误响应统一结构**：`{"error":{"message":...,"type":...,"param":null,"code":...}}`，`message` 尾部带 `request_id`（可用于工单追溯）。
4. **未返回限流头**：所有响应的 `x-ratelimit-remaining` / `x-ratelimit-reset` 均为 `null` → 限流阈值未公开，只能以 429 兜底（FR-5）。
5. **并非全站可抓**：维基百科 404 已复现 → 插件必须把"目标站不可抓"作为一等错误路径，并给出替代通道提示。
6. **时延分布**：0.1s ~ 3.3s，个别站点触顶 3s 级 → 超时设 60s、重试 1 次足够。

## 链接剥离复核（第二轮 · 回答「是否支持抓子页面」）

探测脚本：`C:\project-study\_probe\link-probe.mjs`、`link-probe2.mjs`（统计 Markdown 链接语法 `](` 与裸 URL `https?://`）

| 站点 | title | 正文长度 | Markdown 链接 | 裸 URL |
|---|---|---|---|---|
| `api-docs.deepseek.com/zh-cn/api/fetch` | 端点 URL 回退 | 1039 | **0** | **0** |
| `nodejs.org/en/learn/...` | Introduction to Node.js | 4281 | **0** | **0** |
| `blog.cloudflare.com/` | Cloudflare Blog | 5441 | **0** | **0** |
| `developer.mozilla.org/zh-CN/docs/Web/JavaScript` | JavaScript | 2154 | **0** | **0** |

**结论**：接口返回的是「纯阅读正文」，**链接被整体剥离**——连正文里「点此查看使用指南」这类锚文本也只剩文字、URL 丢失；且接口无 depth / children 参数。

**对规格的影响**：子页发现**不能**依赖抓取结果，必须另开通道（GET 原始 HTML 解析 `<a href>`）；两条通道的可用站点集合不同（本地直连可能被反爬拦截，DeepSeek 侧可抓，反之亦然）。→ 已落地为 FR-11（P1）。

## 复现方式

```powershell
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
node C:\project-study\_probe\fetch-probe.mjs
node C:\project-study\_probe\fetch-probe2.mjs
```
