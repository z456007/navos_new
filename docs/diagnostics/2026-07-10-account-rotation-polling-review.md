# 账号轮换 / 轮询机制诊断报告

- 日期：2026-07-10
- 范围：navos-new 的模型代理账号轮换、账号池选择、注册验证码轮询、图片/视频任务轮询
- 结论：**model-proxy 的账号轮换在流式请求下整体失效**（严重）；另有一处基于响应体正则的误判风险，一处并发竞态。图片/视频链路的轮询与重试判断经核对是**正确**的。
- 性质：本报告仅为诊断，不含代码改动。

---

## 0. 拓扑背景（为什么这些问题重要）

navos-new 不是独立对外服务，而是 **Sub2Api 网关的一个上游渠道后端**：

```
终端用户 → Sub2Api 网关(计费/鉴权/负载均衡/粘性会话/支付)
              │  作为一个上游渠道指向 http://navos-new:18888
              ▼
        navos-new(协议适配 + NavOS 账号池自动注册)
              │  用池中的 NavOS 账号转发
              ▼
        上游 NavOS 服务 (tec-do.com)
```

依据：`docker-compose.yml` 把 navos 挂进 `sub2api-deploy_sub2api-network`（external），别名 `navos-new`；`.env` 的 `PUBLIC_PROXY_API_KEYS` 即供 Sub2Api 侧调用。

含义：navos-new 面对的是 **Sub2Api 打来的真实付费流量**，其中绝大多数是 `stream: true` 的对话请求，且带并发。下面的问题在这个拓扑下被放大。

---

## 1. 问题一（严重）：流式响应下 model-proxy 账号轮换完全失效

### 位置
- `src/server/app.ts` `forwardModelRequestWithAccountRotation`（约 412–460 行）
- `src/protocols/http.ts` `toResult`（56–73 行）
- 判定函数：`providerResultBodyText` / `providerResultIndicatesQuotaExhausted` / `providerResultIndicatesTemporaryFailure` / `providerResultIndicatesInvalidAccount`（app.ts 155–191 行）

### 机理
1. 上游对 `/v1/chat/completions`、`/v1/messages`、`/v1/responses` 返回 `text/event-stream` 时，`http.ts:60-61` 把 `body` 设为一个 Node `Readable` 流，且此时 HTTP 状态通常已是 `200`。
2. 轮换循环依赖对 `result.status` 和 `result.body` **文本内容**的判断。对流对象：
   ```js
   function providerResultBodyText(result) {
     return typeof result.body === "string" ? result.body : JSON.stringify(result.body) ?? "";
   }
   ```
   `JSON.stringify(readableStream)` 得到 `"{}"`，`insufficient_balance|余额不足|rate_limit|banned|...` 等正则**永远不命中**。

### 后果
- 上游在 **SSE 流内部**返回的 `429 / 余额不足 / 账号失效` 错误被当作成功，原样透传给调用方（Sub2Api → 终端用户）。
- `depleteAccount` / `cooldownAccount` / `disableAccount` 在流式路径下**一次都不触发**：坏账号永久留在池中，被 `pickActive` 反复选中。
- 只有当上游在**握手阶段**就返回非 200 的 JSON（401/402/403 等）时轮换才生效；一旦进入流式即失效。

### 影响面
- 命中 model-proxy 三个端点的所有 `stream: true` 请求（生产主路径）。
- 图片链路（`pollCreatedImageTask`）与视频链路是**服务端任务轮询 + 非流式 JSON**，**不受此问题影响**（已核对 `src/protocols/image.ts`、`src/protocols/video.ts`）。

### 根因备注
HTTP 语义上，一旦响应头已发、流已开始转发，就无法“换个账号重来”。因此真正的修法只能是：**在拿到流之前**（握手响应阶段）用状态码决定是否换号；进入流转发后不可重试。或对首个 SSE chunk 做错误嗅探后中断换号（复杂，谨慎）。

---

## 2. 问题二（真 bug / 数据正确性）：基于改写后响应体的正则误判

### 位置
- `providerResultIndicatesQuotaExhausted`（app.ts 161–169 行）中的
  `/insufficient_balance|积分不足|余额不足/.test(bodyText)`
- 触发点：`forwardModelRequestWithAccountRotation`（app.ts 437）在**非流式**分支对 `result.body` 跑该正则。

### 机理
非流式路径下，`model-proxy` 会把上游成功响应**改写**成 OpenAI Chat / Responses 结构（如 `anthropicMessageToOpenAiChat`）。若模型正文里恰好出现“余额不足”“insufficient_balance”等字样（用户提问或模型输出复述），`JSON.stringify(改写后 body)` 会命中正则，于是一个**实际成功**的账号被 `depleteAccount` 清零。反向的漏判同理存在。

### 后果
- 误伤：正常账号被判定耗尽、余额清零、状态置 depleted。
- 用状态码 + 全文正则去推断上游**业务语义**本身脆弱，随上游文案/多语言变化而失准。

### 影响面
- 非流式 model-proxy 请求（占比小于流式，但一旦命中就是账号数据被破坏，不可自愈）。

---

## 3. 问题三（并发竞态）：model-proxy 未用租借机制，导致并发挤同一账号

### 位置
- model-proxy 选号：`providerAuthOrRegister` → `accountService.pickAccount()` → `store.pickActive()`（无锁 `SELECT ... LIMIT 1`）+ `markUsed`（app.ts 394–410；account-service.ts 61–67；mysql-account-store.ts 139–148, 204–209）
- 对照正确实现：视频/图片走 `leaseVideoAccount` / `leaseImageAccount` → `store.leaseActive()`（`FOR UPDATE` 行锁 + lease_id + lease_until 事务，mysql-account-store.ts 150–191）

### 机理
`pickActive` 只做无锁查询，`markUsed` 只更新 `last_used_at`。两个并发的 chat 请求会同时选到 `last_used_at` 最小的**同一个账号**并同时使用。model-proxy 是唯一没有采用 `leaseActive` 租借路径的请求类型。

### 后果
- Sub2Api 的负载均衡打出的并发下，“轮换”退化为“并发请求争抢同一账号”，均衡与隔离失效，也放大单账号限流概率。

### 影响面
- 所有并发的 model-proxy 请求。

---

## 4. 相关但**无问题**的部分（已核对，供对照）

- **注册验证码轮询** `registration-service.ts:293 pollVerificationCode`：最多 20 次、间隔 4s、首次不等待、transient 错误吞掉续轮，逻辑正确。唯一可选优化：失败时不区分“超时”与“持续报错”，仅返回 `undefined`（非 bug）。
- **图片任务轮询** `image.ts:128 pollCreatedImageTask`：最多 30 次、间隔 4s，基于非流式 JSON 的 `status` 字段判定 succeeded/failed，账号重试判断有效。
- **图片账号选择**：走 `leaseImageAccount`（租借），并发安全。

---

## 5. 附带观察（非本次轮询主题，但建议留意）

- **粘性会话被 navos-new 内部换号破坏**：Sub2Api 的 sticky session 只能固定到“navos-new 这个渠道”，无法固定到 navos-new 内部实际使用的 NavOS 账号。model-proxy 每次重新 `pickAccount` 且可能中途换号，会破坏依赖同一后端账号的多轮上下文 / prompt 缓存。
- **凭证明文**：`e:\navos-new\.env` 与 `e:\Sub2Api\deploy\config.yaml`、`deploy\.env` 含真实密码 / JWT secret / HMAC secret；`MASTER_API_KEY=zgm2003` 同时被用作 `PUBLIC_PROXY_API_KEYS`，等于公开代理密钥 == 管理员全权限密钥。均为部署配置问题，勿入库。

---

## 6. 严重度与建议优先级（仅排序，不含实现）

| 序 | 问题 | 严重度 | 是否自愈 | 建议优先级 |
|---|---|---|---|---|
| 1 | 流式下 model-proxy 轮换/降级完全失效 | 高 | 否（坏账号常驻） | P0 |
| 2 | 改写后响应体正则误判、误扣账号 | 中高 | 否（账号数据被破坏） | P1 |
| 3 | model-proxy 并发挤同一账号（未租借） | 中 | 部分 | P1 |
| 附 | 粘性会话被内部换号破坏 | 视依赖而定 | — | P2 |

---

## 7. 修复方向（概念，未落地）

- 问题一：轮换判断收敛到**握手响应阶段**（未取流前按 status 决策）；确认取到 `text/event-stream` 即视为进入转发、不再重试。可选进阶：嗅探首个 SSE 事件中的错误再中断换号。
- 问题二：只在**上游原始错误 body + HTTP status** 上做配额/失效判断，且在 model-proxy 格式转换**之前**判断；不要对已转成成功结构的 body 跑业务语义正则。
- 问题三：让 model-proxy 复用 `leaseActive` 租借路径（与图片/视频一致），成功后 `markUsed`/释放，失败后 `cooldown`/`disable`。
