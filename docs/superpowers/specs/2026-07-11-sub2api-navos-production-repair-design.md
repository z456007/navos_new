# Sub2Api + NavOS 生产级修复 Spec

日期：2026-07-11
范围：本地 `E:\navos-new` + 本地 `E:\github-work\sub2api`
约束：先本地修复和压测，确认后再考虑上线；不要直接改生产。

---

## 0. 总目标

把 `navos-new` 改造成一个可被 `sub2api` 无缝接入的生产级上游：

- Sub2Api 继续负责外层用户、API Key、分组、计费、通道、外层 failover。
- NavOS 负责内部账号池、余额检测、账号租赁、耗尽禁用/恢复、注册补号、图片/视频任务轮询。
- 任意单个 NavOS 内部账号额度耗尽，都不能把整条 Sub2Api 链路打死。
- 所有公共 `/v1/*` 接口必须保持 OpenAI/Claude/Seedance 兼容，方便 Codex、Claude Code、cc-switch 等客户端直接使用。
- 先在本地通过 Sub2Api 入口做并发测试，再迁移生产。

---

## 1. 用户提出的六个大问题

### 问题 1：轮询机制错误，额度耗尽账号没有被正确跳过

现象：用户请求经 Sub2Api 打到 NavOS 后，NavOS 内部轮询到一个看起来可用、实际已经没额度的账号，导致返回类似“当前账号积分没了/余额不足/insufficient balance”的错误。更糟的是，如果这个账号不被标记耗尽或停用，后续请求还会继续撞它，用户会感觉“老是同一个错误”。

根因方向：

1. NavOS 内部账号健康状态没有做到“按错误类型精确处置”。
2. 账号额度可能不是每天自动刷新，不能假设第二天自动恢复。
3. 某些接口可能只看本地 `balance_remaining`，但没有及时向 VIP 余额接口核验。
4. 对图片/视频这种异步任务，如果创建成功后轮询失败，要区分：
   - 任务真的失败
   - 账号没额度
   - 上游临时错误
   - 内容策略/参数错误
   - 任务其实已有图片/视频输出但状态字段误导
5. Sub2Api 只能看到 NavOS 这个上游账号，看不到 NavOS 内部账号，所以内部账号轮换必须在 NavOS 里解决。

### 问题 2：前端需要可配置、批量的余额检查

当前已有单账号 `刷新余额` 和后台 depleted 余额 reconcile，但管理前端还不够直观：

- 应能一键批量检查账号余额。
- 应能配置检查范围：只查 depleted、查 active、查全部非 disabled。
- 应能配置并发、批量大小、间隔。
- 应显示检查结果：检查数、恢复数、仍耗尽数、失败数、失败账号。
- 如果账号余额恢复为正数，自动从 `depleted` 改回 `active`。
- `disabled` 账号不能被自动恢复，因为 disabled 代表人工停用或凭证失效。

### 问题 3：图片不能存服务器本机，也不要 COS 备份

用户明确不要 COS 概念，也不希望图片落服务器本机。NavOS 应只做协议转发和必要的临时上传：

- 上游返回 OSS/CDN URL：直接透传 URL。
- 上游返回 `b64_json`：公共 OpenAI 兼容接口按 `b64_json` 返回。
- 管理后台展示时可以把 `b64_json` 转成 `data:image/...`，但不能在公共 `/v1/images/generations` 里乱改结构。
- 参考图如果是公网 HTTPS URL，尽量直接传给上游，不要下载到本机。
- 只有当上游接口要求 multipart 文件时，才在内存里转换为 `Blob/FormData` 发送，不落盘。
- 视频/图片本地 data URL 上传上游时，使用上游 `/api/uploads/file` 获得云端 URL，仍然不保存到本机。
- 保持现有“无 COS 字段”测试：响应中不能出现 `cosUrl`、`cosKey`、`archiveStatus`、`archiveError`。

### 问题 4：1K 用户并发，连接池和整体并发能力要生产级

用户体量目标是约 1K 并发。需要区分：

- Sub2Api 外层并发：用户请求、API Key、通道调度、外层 failover。
- NavOS 内部并发：账号租赁、任务创建、任务轮询、余额查询、注册任务。
- MySQL/Redis 并发：不能把 DB 连接池开太小，也不能无限开。
- 上游并发：真正的 AI 生成压力应由上游承担，NavOS 不应该把请求变成串行瓶颈。

现状风险：

- NavOS 多个 MySQL store 各自 `connectionLimit: 10`，总量叠加可能不明确，但单 store 也可能在高并发下排队。
- Sub2Api 默认数据库连接池较大，但如果本地 NavOS 只有 10 连接，NavOS 会成为瓶颈。
- 图片/视频任务长轮询占用 HTTP 请求时间，如果没有 async task/poll 合同，容易造成超时。
- 流式模型请求 SSE 开始后不能无感切换账号，必须真实流式转发，并在 SSE error 时标记账号健康。

生产目标：

- 1K 并发进入 Sub2Api 时，NavOS 不应崩溃、不应 double-book 同一内部账号。
- 模型请求用 MySQL `SELECT ... FOR UPDATE` lease，不允许并发抢同一账号。
- 图片/视频优先走 202 async + task poll，避免单请求无限等待。
- 连接池、超时、keepalive、任务等待时间全部可配置。
- 压测必须从 Sub2Api baseURL + API key 发起，而不是绕过 Sub2Api 直打 NavOS。

### 问题 5：部分 SQL 慢，并发注册慢

需要做 SQL/索引/注册链路专项检查：

账号池相关：

- `accounts` 需要覆盖 lease 选择的组合索引。
- `image_tasks`、`video_tasks` 需要 task id 主键和状态更新时间索引。
- `yyds_domain_health` 需要 domain 主键、状态/冷却/权重相关查询索引。
- 管理端列表不能在账号 1W+ 时一次性全量返回所有敏感字段。

注册相关：

- 批量注册不是每个 public 请求同步触发，而是后台任务维护容量。
- YYDS mailbox create 要全局限速，不能只有单进程限速。
- 邮箱创建、VIP 发码、邮件轮询、登录认证、企业认证应拆成阶段并发：
  - mailbox create：低并发，例如 2，并带 QPS 限制。
  - VIP send-code：中等并发，例如 4-6。
  - 邮件轮询：高并发，例如 30+。
  - login/cert：中等并发，例如 4-6。
- YYDS quota exhausted 要全局熔断一段时间，不要继续撞接口。
- 域名池要记录成功率/失败率/冷却，不要每次随机踩坏域名。

### 问题 6：去掉“补齐到 N 个”作为主流程，只保留“增量新增 N 个”

用户明确说“补齐多少数量完全没用，只需要挂一个增量的”。因此前端和默认操作要调整：

- 主按钮只保留 `新增注册 N 个`。
- `fill to active target` 可以保留为后端兼容能力，但前端不要作为主流程展示。
- 如果保留 fill，放到高级/折叠区，明确写“补齐到 active 总数”，避免再把“注册 100 个”理解成实际只注册 47 个。
- 默认 job payload 使用：

```json
{ "mode": "create", "count": 100, "concurrency": 6 }
```

而不是：

```json
{ "mode": "fill", "target": 100, "concurrency": 6 }
```

### ?? 7??????????????? `.env` ??

??????????????????????? env ??????????????????????????????YYDS ???????????????? `.env` ???????????

?????

- `.env` ???????????????? DB ??????`PORT`?`MYSQL_*` ?????`REDIS_URL`?`QUEUE_PREFIX`?`MASTER_API_KEY`??????? HMAC ????
- ???????
- DB-backed ?????????????????????? MySQL `runtime_config`???????? `/api/runtime-config` ??????
- `.env` ???????????????????/?????????? DB ?????
- ???????
- DB-backed ???????????????????????????????????????????????????????????
- ???????
- DB-backed ???????????????????????????????????????? NavOS ??????? MySQL ??????
- ???????
- DB-backed ?????????????????????????/????????????? SSH??? `.env` ?????

---

## 2. Sub2Api 与 NavOS 边界合同

### 2.1 Sub2Api 负责

- 外部 API Key 和用户余额。
- 分组管理、模型可见性、通道选择。
- 外层账号并发槽和 failover。
- 对外 OpenAI/Anthropic/Seedance 兼容路由。
- 多个独立上游之间的调度。

### 2.2 NavOS 负责

- 内部 NavOS 账号注册和导入。
- 内部账号 lease、release、consume。
- 内部账号余额刷新、耗尽恢复、冷却、停用。
- 图片/视频任务创建、持久化、轮询。
- 上游错误分类，并转换成 Sub2Api 能理解的 HTTP 状态。
- 内部容量报告。

### 2.3 重要原则

如果 Sub2Api 只有一个上游账号指向 NavOS，那么 Sub2Api 无法知道 NavOS 里面哪个内部账号没额度。它只能看到“NavOS 这个上游可用/不可用”。所以：

- 单个内部账号没额度：NavOS 内部 deplete 并换下一个账号。
- 所有内部账号都不可用：NavOS 才返回 `503 account_unavailable` 或 `429 capacity_limited`。
- 不要把内部账号没额度直接返回成 Sub2Api 上游级 `401/402`，否则外层可能把整个 NavOS 通道当坏。

---

## 3. 错误分类与账号状态机

### 3.1 账号状态

保留现有状态：

```ts
type AccountStatus = "active" | "depleted" | "disabled";
```

`cooldown` 继续用 `rate_limited_until > now` 表示，但前端展示时应显示为“冷却中”。

### 3.2 错误分类

| 上游信号 | 分类 | 账号动作 | 对 Sub2Api 返回 |
|---|---|---|---|
| 明确余额不足、积分不足、insufficient_balance | quota_exhausted | 当前内部账号 `depleted`，余额置 0，换号重试 | 内部重试；全部失败后 `503` |
| token invalid、unauthorized、banned、credential invalid | invalid_account | 当前内部账号 `disabled`，换号重试 | 内部重试；全部失败后 `503` |
| 429/rate limit | rate_limited | 当前内部账号 cooldown | 内部重试；全部冷却后 `429` 带 Retry-After |
| 5xx/网络超时/连接断开 | temporary | 当前内部账号短 cooldown | 内部重试；最终 `502/503` |
| prompt 参数错误/参考图无效/内容策略 | user_error | release lease，不惩罚账号 | `400/422`，不外层 failover |
| 任务成功且有图片/视频 URL | success | 扣费/释放 lease | `200` |
| 任务标 failed 但同时有可用图片 URL/base64 | success 优先 | 扣费/释放 lease | `200` |

### 3.3 禁止宽泛误判

不能在成功响应全文里用正则扫 `insufficient_balance` 就 deplete。只能在明确错误上下文里分类：

- HTTP status >= 400 的 body。
- 结构化 `error` 对象。
- SSE `event:error`。
- task terminal failed 的 `error/message`。

如果 assistant 正常回复里出现字符串 `insufficient_balance`，不能把账号标成耗尽。

---

## 4. 余额检查与恢复设计

### 4.1 后端接口

保留：

```http
POST /api/accounts/:uid/balance/refresh
```

新增/强化：

```http
POST /api/accounts/balances/reconcile
```

请求体：

```json
{
  "scope": "depleted",
  "limit": 1000,
  "concurrency": 10,
  "reactivatePositive": true
}
```

`scope` 可选：

- `depleted`：只查 depleted，默认。
- `active`：只查 active，用于校验本地余额是否过期。
- `non_disabled`：查 active + depleted。
- `all`：查全部，但 disabled 只更新余额，不自动启用。

响应：

```json
{
  "checked": 100,
  "restored": 20,
  "stillDepleted": 70,
  "updatedActive": 8,
  "failed": 2,
  "failures": [
    { "uid": "u_xxx", "message": "queryBalance failed" }
  ]
}
```

规则：

- `depleted + balance > 0` => `active`。
- `active + balance == 0` => `depleted`。
- `disabled + balance > 0` => 只更新余额，不自动 active。
- balance 查询失败不改变账号状态。

### 4.2 定时任务

配置：

```env
ACCOUNT_BALANCE_RECONCILE_ENABLED=true
ACCOUNT_BALANCE_RECONCILE_INTERVAL_MINUTES=30
ACCOUNT_BALANCE_RECONCILE_BATCH_SIZE=1000
ACCOUNT_BALANCE_RECONCILE_CONCURRENCY=10
ACCOUNT_BALANCE_RECONCILE_SCOPE=depleted
```

说明：

- 不能假设额度每天刷新。
- 定时任务只是“发现恢复”的手段，不是“到点强制启用”。
- 如果上游永不恢复额度，账号会一直 depleted。

### 4.3 前端

账号池页面增加：

- `批量检查余额` 按钮。
- 范围下拉：只查耗尽 / 查 active / 查非停用 / 查全部。
- 并发输入，默认 10，上限 50。
- limit 输入，默认 1000。
- 显示最近一次 reconcile 摘要。

---

## 5. 图片与参考图处理合同

### 5.1 公共 OpenAI 兼容响应

`POST /v1/images/generations` 必须严格按请求返回：

- `response_format: "b64_json"` => `data[].b64_json`
- `response_format: "url"` => `data[].url`

如果用户没传，默认可以按 OpenAI 兼容默认 `url` 或当前系统默认，但必须一致。

当前代码风险点：`imageResponseToResults()` 把 `b64_json` 转成 `data:image/png;base64,...` 的 `url`，这适合后台展示，不适合公共 OpenAI 兼容接口。

修复方向：

- 增加 `normalizeOpenAIImageResponse(body, responseFormat)`。
- 后台 UI 使用 `imageResponseToDisplayResults()`。
- 公共 `/v1/images/generations` 使用 OpenAI strict normalizer。

### 5.2 图片输出成功优先

`normalizePolledImageTask()` 应先收集图片输出，再判断 failed：

1. 如果能提取到 URL/base64，则返回 `200`。
2. 没有图片且状态 succeeded，返回 `502 image_output_missing`，可内部换号重试。
3. 状态 failed 且无图片，再按错误分类处理。

### 5.3 不落本机、不 COS

- 不写图片文件到服务器磁盘。
- 不做 COS 归档。
- 不新增本机静态文件服务。
- 对公网 OSS/CDN URL 直接透传。
- 对 data URL 只在内存中转成 multipart 传给上游。

---

## 6. 并发与超时设计

### 6.1 目标

本地压测目标分层：

| 层级 | 目标 |
|---|---|
| 单元测试 | 证明 lease 不 double-book，错误分类正确 |
| 本地 fake 上游集成 | 100、300、1000 并发不崩，延迟可控 |
| Sub2Api 入口压测 | 必须走 `http://127.0.0.1:18080/v1` + Sub2Api API key |
| 真实上游小流量 smoke | 低并发验证真实图片/视频/模型，不烧光额度 |

### 6.2 NavOS 配置建议

```env
MYSQL_CONNECTION_LIMIT=100
MYSQL_QUEUE_LIMIT=0
MODEL_ACCOUNT_WAIT_MS=30000
IMAGE_ACCOUNT_WAIT_MS=120000
IMAGE_MAX_POLL_ATTEMPTS=30
IMAGE_POLL_INTERVAL_MS=4000
IMAGE_SYNC_WAIT_BUDGET_MS=120000
VIDEO_CREATE_TIMEOUT_MS=30000
VIDEO_POLL_TIMEOUT_MS=30000
ACCOUNT_LEASE_TTL_MS=600000
```

说明：

- `IMAGE_ACCOUNT_WAIT_MS=120000` 表示最多等可用账号 2 分钟，不是无限生成。
- 图片生成超时后如果返回 `202 running`，客户端/Sub2Api 应 poll task，而不是让一个 HTTP 请求卡死 10 分钟。
- Sub2Api 如果自身超时 2 分钟，NavOS 同步等待就不能超过它太多，否则外层断开后内层还在跑。

### 6.3 连接池

NavOS 当前多个 MySQL store 各自固定 `connectionLimit: 10`。生产需要统一可配置：

```ts
interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  queueLimit: number;
}
```

所有 MySQL store 使用同一配置。初始建议：

- 小机器：`MYSQL_CONNECTION_LIMIT=50`
- 中等机器：`MYSQL_CONNECTION_LIMIT=100`
- 高并发机器：`MYSQL_CONNECTION_LIMIT=200`，同时确认 MySQL `max_connections`

但不能盲目开大，压测时看：

- MySQL Threads_connected
- 平均查询耗时
- lease SQL p95
- Redis 延迟
- Node event loop lag

---

## 7. SQL 与索引

### 7.1 accounts

建议索引：

```sql
CREATE INDEX idx_accounts_lease_pick
ON accounts(status, rate_limited_until, lease_until, balance_remaining, last_used_at, created_at);

CREATE INDEX idx_accounts_health
ON accounts(status, last_balance_at, rate_limited_until);
```

`leaseActive()` 必须继续使用事务 + `FOR UPDATE`，并发下不能换成普通 SELECT。

### 7.2 image_tasks / video_tasks

```sql
CREATE INDEX idx_image_tasks_status_updated ON image_tasks(status, updated_at);
CREATE INDEX idx_image_tasks_account_updated ON image_tasks(account_uid, updated_at);

CREATE INDEX idx_video_tasks_status_updated ON video_tasks(status, updated_at);
CREATE INDEX idx_video_tasks_account_updated ON video_tasks(account_uid, updated_at);
```

### 7.3 yyds_domain_health

```sql
CREATE INDEX idx_yyds_domain_health_pick
ON yyds_domain_health(status, cooldown_until, weight, last_success_at, last_failure_at);
```

### 7.4 慢 SQL 验证

本地/测试库启用慢查询或对关键 SQL 做 explain：

- account lease pick
- account list page
- task get by id
- task list by status
- domain candidate pick
- registration job list

---

## 8. 注册系统改造

### 8.1 前端主流程只保留增量注册

账号池页面主区域：

- 输入：`新增数量`
- 输入：`任务并发`
- 按钮：`新增注册`

发送：

```json
{ "mode": "create", "count": 100, "concurrency": 6 }
```

`fill` 仅保留后端兼容，前端放到高级折叠，或先隐藏。

### 8.2 注册全局限速

新增 Redis 全局限速 key：

```text
navos:registration:mailbox:create:slots
navos:registration:mailbox:create:qps
navos:registration:yyds:quota_exhausted_until
```

规则：

- 每次 YYDS mailbox create 必须拿 Redis slot。
- 如果 YYDS 返回 quota exhausted，写 `quota_exhausted_until`，所有 worker 暂停新 attempt。
- Retry-After 优先。
- 多 NavOS 实例共享 Redis 时也不会突破 YYDS 限制。

### 8.3 阶段并发

```env
REGISTRATION_JOB_CONCURRENCY=1
REGISTRATION_MAX_IN_FLIGHT=20
REGISTRATION_MAILBOX_CREATE_CONCURRENCY=2
REGISTRATION_MAILBOX_CREATE_PER_SECOND=2
REGISTRATION_VIP_SEND_CONCURRENCY=6
REGISTRATION_POLL_CONCURRENCY=50
REGISTRATION_LOGIN_CONCURRENCY=6
REGISTRATION_CERT_CONCURRENCY=6
```

注意：`REGISTRATION_MAX_IN_FLIGHT` 是一个任务内最多多少 attempt 在跑，不等于 YYDS mailbox create 并发。邮箱创建必须单独限速。

---

## 9. Sub2Api 本地压测要求

### 9.1 必须从 Sub2Api 入口打

不能只测 NavOS：

```text
client -> http://127.0.0.1:18080/v1 -> Sub2Api -> http://127.0.0.1:18888 -> NavOS -> fake/real upstream
```

原因：用户真实链路就是 Sub2Api，外层并发槽、failover、超时、响应兼容都在 Sub2Api。

### 9.2 本地 fake upstream

为了不烧真实额度，先做 fake upstream：

- fake chat：支持 `/v1/responses`、`/v1/chat/completions`、`/v1/messages`，可配置延迟、SSE chunks、错误比例。
- fake image：支持 task create + poll，模拟 running/succeeded/failed/quota。
- fake video：支持 seedance create + poll，模拟 202、成功、余额不足。
- fake VIP balance：支持 queryBalance，模拟恢复/不恢复。
- fake YYDS：支持 mailbox create，模拟 429、quota exhausted、域名失败。

### 9.3 压测矩阵

| 分支 | 并发 | 成功条件 |
|---|---:|---|
| Chat non-stream `/v1/chat/completions` | 100/300/1000 | 无 double-book，无 5xx 雪崩 |
| Responses stream `/v1/responses` | 100/300/1000 | 首 chunk 实时返回，SSE 不被缓存到最后 |
| Claude `/v1/messages` | 100/300/1000 | 图片消息不丢，错误可读 |
| 图片文生图 | 50/100/300 | 200 或 202 合同正确，不无限挂 |
| 图片参考图生成 | 20/50/100 | 参考图 multipart/URL 正确，无本机落盘 |
| 视频 seedance create | 20/50/100 | 时长限制、余额保护正确 |
| 视频 poll | 100/300/1000 | task id 查询稳定 |
| 注册 create | 20/50/100 attempts | YYDS create 不超全局限速 |
| 余额 reconcile | 1000 账号 | 并发可控，disabled 不自动启用 |

### 9.4 指标

压测输出必须包含：

- total requests
- success / 4xx / 5xx / timeout
- p50 / p95 / p99 latency
- RPS
- NavOS 内部账号 lease 次数和冲突数
- 每个内部账号使用次数
- depleted/cooldown/disabled 变化
- MySQL query p95
- Redis error count
- Node process RSS / event loop lag

---

## 10. 实施计划

### Phase 1：修复 spec 与测试基建

1. 重写本 spec 为 UTF-8 中文。
2. 增加本地 fake upstream/压测脚本目录：`scripts/load/`。
3. 压测脚本支持 Sub2Api baseURL + API key。
4. 增加压测报告输出到 `docs/diagnostics/`。

### Phase 2：账号健康与余额检查

1. 扩展 balance reconcile scope。
2. 前端增加批量余额检查按钮和结果展示。
3. 错误分类只在结构化错误上下文生效。
4. 增加 quota/invalid/temp/user_error 单元测试。

### Phase 3：图片兼容与不落盘

1. 拆分 public OpenAI image normalizer 与 admin display normalizer。
2. 图片输出成功优先于 failed 状态。
3. 修复 `/v1/images/generations` `response_format`。
4. 增加参考图 URL/data URL/multipart 测试。

### Phase 4：连接池与 SQL

1. MySQL connectionLimit/queueLimit env 化。
2. 补账号/task/domain 索引。
3. 增加 lease 并发测试。
4. 对关键 SQL 做 explain 记录。

### Phase 5：注册主流程改成增量 create

1. 前端隐藏/降级 fill。
2. 主流程只展示 create count。
3. Redis 全局 mailbox create limiter。
4. quota exhausted 全局熔断。

### Phase 6：Sub2Api 全链路压测

1. 启动 fake upstream + NavOS + Sub2Api。
2. 用 Sub2Api API key 跑全分支压测。
3. 根据失败点针对性修复。
4. 全部通过后再准备上线同步。

---

## 11. Definition of Done

完成标准：

- 单个内部账号额度耗尽不会让整条 Sub2Api 链路死掉。
- 批量余额检查能从前端触发，并能恢复 depleted 中余额为正的账号。
- disabled 不会被自动恢复。
- 图片/视频响应不包含 COS/归档字段，不落本机。
- `/v1/images/generations` 严格兼容 OpenAI response_format。
- 参考图生成走通：URL 和 data URL 都可用。
- 1K 并发压测经过 Sub2Api 入口，报告可复现。
- MySQL lease 不 double-book。
- 慢 SQL 有 explain 和索引修复记录。
- 注册默认走增量 create，不再让用户误会 fill target。
- 所有修改先本地完成、测试、压测，再上线。
