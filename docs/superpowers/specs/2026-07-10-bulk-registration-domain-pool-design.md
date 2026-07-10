# Bulk Registration Domain Pool Design

Date: 2026-07-10

## Goal

Make NavOS account registration reliable enough for production use as a Sub2Api-compatible upstream account registrar.

The current registration path can register accounts, but bulk operations are easy to misread and too coarse:

- entering `100` means "fill active pool to 100", not "create 100 new accounts"
- UI and worker hard-cap fill concurrency to 2 because earlier high concurrency caused YYDS account creation rate limits
- YYDS mailbox creation does not choose a domain, so the provider selects random public domains
- registration failures such as "verification code not received" do not preserve enough domain-level evidence
- rate-limit handling treats all YYDS failures similarly instead of using `Retry-After`, `quota_exhausted`, and per-domain health

This design keeps the safe low-concurrency path, adds an explicit high-throughput mode, and introduces domain selection, scoring, and cooldown so the system can improve registration success rate without blindly increasing pressure on YYDS Mail or the NavOS VIP backend.

## Evidence From Current Runtime

Observed local runtime on 2026-07-10:

- current account pool reached `100` active accounts after a small fill job
- fill job `4` used `target=100`, started `47`, completed `44`, failed `3`; this is consistent with "fill to active target" semantics when the pool already had about `53` active accounts
- fill job `3` used `target=100`, `concurrency=10`, started `98`, completed `56`, failed `42`; `40` failures were YYDS mailbox creation rate-limit responses
- current `POST /v1/accounts` call sends only `localPart`, not `domain`
- YYDS Mail public docs state that `/v1/accounts` supports `localPart` plus an explicit `domain`, and that `/v1/domains` is publicly queryable
- YYDS Mail public docs distinguish normal `429` rate limits from `quota_exhausted`; normal rate limits should follow `Retry-After`, while `quota_exhausted` should stop retries until reset or upgrade

These facts imply that the main bug is not only one broken line. The bulk-registration system needs clearer semantics, stage-aware concurrency, and domain-aware feedback.

## Non-Goals

- Do not bypass authentication or add any public registration endpoint.
- Do not move registration into Sub2Api; NavOS remains the upstream registrar and Sub2Api remains a compatible consumer.
- Do not remove the existing safe single-registration path.
- Do not make live YYDS or VIP calls in automated tests.
- Do not store plaintext YYDS API keys, account tokens, mailbox tokens, or provider secrets in logs.
- Do not rely on a fixed hardcoded public domain list as the only source of truth.

## Product Semantics

### Registration Modes

Expose two distinct bulk operations.

1. **Fill active pool**
   - UI label: `补齐到 N 个 active 账号`
   - API payload:
     ```json
     { "mode": "fill", "target": 100, "concurrency": 2 }
     ```
   - Meaning:
     ```ts
     attempts = max(0, target - currentActiveCount)
     ```
   - Existing behavior stays compatible, but the UI label and result summary must make the semantics explicit.

2. **Create N new accounts**
   - UI label: `新增注册 N 个账号`
   - API payload:
     ```json
     { "mode": "create", "count": 100, "concurrency": 6 }
     ```
   - Meaning:
     ```ts
     attempts = count
     ```
   - This mode is for expanding inventory regardless of current active count.

### Result Summary

Every job should show:

- requested mode and requested number
- actual attempts planned
- started, completed, failed, skipped
- active count before and after
- top failure reasons
- domain success/failure summary

This removes the "why did 100 become 47" ambiguity.

## Architecture

```text
AccountsPanel
  -> RegistrationJobService
    -> BullMQ registration queue
      -> RegistrationWorker
        -> RegistrationScheduler
          -> YydsDomainPool
          -> YydsMailClient
          -> VipClient
          -> AccountService
```

### RegistrationJobService

Owns API payload validation and job creation.

Supported payloads:

```ts
type RegistrationJobPayload =
  | { mode: "single" }
  | { mode: "fill"; target: number; concurrency: number }
  | { mode: "create"; count: number; concurrency: number };
```

Validation:

- `target`: integer 1 to 500
- `count`: integer 1 to 500
- `concurrency`: integer 1 to configured maximum
- unknown fields are ignored only when they are harmless; invalid mode/count/target/concurrency returns 400

### RegistrationWorker

Converts job payloads into a number of registration attempts.

For `fill`:

```ts
plannedAttempts = Math.max(0, payload.target - stats.activeCount)
```

For `create`:

```ts
plannedAttempts = payload.count
```

The worker no longer uses one global `SAFE_FILL_BATCH_CONCURRENCY = 2` for the full pipeline. It delegates concurrency to `RegistrationScheduler`, which applies separate limits to mailbox creation and downstream registration stages.

### RegistrationScheduler

Controls stage-aware concurrency.

Stages:

1. YYDS mailbox creation
2. VIP email-code send
3. YYDS message polling
4. VIP login/register
5. enterprise certification
6. account import

Recommended initial limits:

```ts
{
  maxInFlightAttempts: 6,
  maxMailboxCreatesPerSecond: 2,
  maxMailboxCreateConcurrency: 2,
  maxVipSendConcurrency: 6,
  maxPollConcurrency: 30,
  maxVipLoginConcurrency: 6,
  maxCertConcurrency: 4
}
```

Interpretation:

- mailbox creation remains conservative because it produced most previous high-concurrency failures
- polling can be much higher because it mostly waits on message availability
- VIP send/login/certification can be tuned separately from YYDS mailbox creation

The UI "并发数" controls `maxInFlightAttempts`, not raw mailbox-creation QPS. Advanced stage limits are environment-configurable.

## YYDS Domain Pool

### Domain Discovery

Add `YydsDomainPool` that can load public domains from:

```http
GET https://maliapi.215.im/v1/domains
```

Eligible automatic domains must satisfy:

- `isPublic === true`
- `isVerified === true`
- `isMxValid === true`
- `dnsRecords.receivingReady === true`
- `dnsRecords.status === "healthy"`

The domain list is cached for a configurable TTL, default 30 minutes.

If the fetch fails and a cached list exists, use the cached list. If no cached list exists, fallback to provider default domain selection and log `domain_pool_unavailable`.

### Manual Whitelist

Add admin-configurable whitelist:

```ts
interface YydsDomainPoolConfig {
  enabled: boolean;
  mode: "auto" | "whitelist" | "auto-plus-whitelist";
  whitelist: string[];
  blacklist: string[];
  refreshIntervalMinutes: number;
}
```

Behavior:

- `auto`: use eligible domains from `/v1/domains`
- `whitelist`: only use manually approved domains
- `auto-plus-whitelist`: start with eligible public domains and boost manual whitelist domains
- `blacklist`: always excluded

Whitelist entries should be normalized to lowercase domain names.

### Domain Scoring

Track short-window and lifetime domain performance:

```ts
interface DomainHealth {
  domain: string;
  status: "active" | "cooldown" | "disabled";
  successCount: number;
  failureCount: number;
  verificationTimeoutCount: number;
  mailboxRateLimitCount: number;
  quotaExhaustedCount: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  cooldownUntil: number;
  weight: number;
}
```

Selection rule:

1. exclude disabled and cooldown domains
2. prefer whitelist domains
3. prefer domains with recent successful verification
4. penalize domains with verification timeouts
5. use weighted random selection among the remaining candidates

This avoids permanently hammering one "good" domain while still learning from recent outcomes.

### Domain Cooldown

Failure-specific cooldown:

- `verification code not received`: cooldown that domain for 10 minutes after 2 failures in a rolling 30-minute window
- YYDS mailbox create 429 normal limit: global mailbox create backoff using `Retry-After`, and domain cooldown for 1 to 5 minutes
- `quota_exhausted`: stop creating new YYDS mailboxes until `resetAt` or manual intervention
- DNS unhealthy on refresh: disable until next successful domain refresh

Cooldown state must be visible in the admin UI.

## YYDS Mail Client Changes

Extend mailbox creation input:

```ts
interface CreateMailboxInput {
  localPart?: string;
  domain?: string;
  subdomain?: string;
}
```

Request body:

```json
{
  "localPart": "navos-6140d64e",
  "domain": "portfolink.vps.cd"
}
```

Response should preserve:

- final `address`
- `domain`
- `subdomain`
- mailbox `token`
- raw response metadata only in debug-safe form

If no domain is provided, existing provider default behavior remains supported.

## Error Classification

Add a classifier for YYDS errors:

```ts
type YydsFailureKind =
  | "rate_limited"
  | "quota_exhausted"
  | "domain_rejected"
  | "mailbox_create_failed"
  | "message_poll_failed"
  | "verification_timeout"
  | "unknown";
```

Classification rules:

- HTTP 429 with `errorCode === "quota_exhausted"`: `quota_exhausted`
- HTTP 429 without quota exhaustion: `rate_limited`
- provider response containing "Too many account creation requests": `rate_limited`
- no verification code before deadline: `verification_timeout`
- mailbox response missing address: `mailbox_create_failed`

Retry rules:

- `rate_limited`: retry after `Retry-After` when present, otherwise exponential backoff with jitter
- `quota_exhausted`: stop job early with a clear terminal error
- `verification_timeout`: do not retry the same mailbox; mark domain health and start a new attempt if the job still has retry budget
- `domain_rejected`: disable or cooldown domain

## Registration Attempt Model

Each planned attempt may consume more than one mailbox if a domain fails before VIP registration. Track retries separately from completed accounts.

```ts
interface RegistrationAttemptResult {
  success: boolean;
  uid?: string;
  email?: string;
  domain?: string;
  mailboxToken?: string;
  balance?: number;
  certCredits?: number;
  error?: string;
  failureKind?: string;
  elapsedMs: number;
  retryCount: number;
}
```

Job counters:

- `planned`: requested attempts
- `started`: attempts started
- `completed`: successful accounts
- `failed`: attempts that ended without an account
- `mailboxesCreated`: total YYDS mailboxes created
- `domainCooldowns`: number of domain cooldown events

## Configuration

Add environment defaults:

```env
REGISTRATION_MAX_IN_FLIGHT=6
REGISTRATION_MAILBOX_CREATE_CONCURRENCY=2
REGISTRATION_MAILBOX_CREATE_PER_SECOND=2
REGISTRATION_VIP_SEND_CONCURRENCY=6
REGISTRATION_POLL_CONCURRENCY=30
REGISTRATION_LOGIN_CONCURRENCY=6
REGISTRATION_CERT_CONCURRENCY=4
REGISTRATION_VERIFICATION_TIMEOUT_MS=90000
REGISTRATION_POLL_INTERVAL_MS=3000
YYDS_DOMAIN_POOL_ENABLED=true
YYDS_DOMAIN_POOL_MODE=auto-plus-whitelist
YYDS_DOMAIN_REFRESH_MINUTES=30
YYDS_DOMAIN_WHITELIST=
YYDS_DOMAIN_BLACKLIST=
```

Caps:

- `REGISTRATION_MAX_IN_FLIGHT`: 1 to 20
- mailbox create concurrency: 1 to 5
- mailbox creates per second: 1 to 10
- poll concurrency: 1 to 100

The admin UI can expose simple safe controls first:

- `补齐目标`
- `新增数量`
- `任务并发`
- `域名池模式`
- `白名单`
- `黑名单`

Advanced stage limits can stay in `.env` initially.

## Storage

Use MySQL for domain pool configuration and health.

### `yyds_domain_pool_config`

Single-row config:

- `id`
- `enabled`
- `mode`
- `whitelist_json`
- `blacklist_json`
- `refresh_interval_minutes`
- `created_at`
- `updated_at`

### `yyds_domain_health`

One row per domain:

- `domain` primary key
- `status`
- `success_count`
- `failure_count`
- `verification_timeout_count`
- `mailbox_rate_limit_count`
- `quota_exhausted_count`
- `last_success_at`
- `last_failure_at`
- `cooldown_until`
- `weight`
- `last_checked_at`
- `last_error`

This data is operational metadata, not secrets.

## Backend Routes

All routes require local admin authorization.

### Registration jobs

Keep:

- `POST /api/registration/jobs`
- `GET /api/registration/jobs`
- `GET /api/registration/jobs/:jobId`
- `POST /api/registration/jobs/:jobId/cancel`

Extend create payload to support `create` mode.

### Domain pool

Add:

- `GET /api/mail/yyds/domains`
  - returns current eligible domains, health, cooldown, and config
- `POST /api/mail/yyds/domains/refresh`
  - refreshes `/v1/domains` cache and health eligibility
- `PUT /api/mail/yyds/domain-pool/config`
  - saves whitelist, blacklist, mode, and refresh interval
- `POST /api/mail/yyds/domains/:domain/disable`
- `POST /api/mail/yyds/domains/:domain/enable`
- `POST /api/mail/yyds/domains/:domain/cooldown`

Do not expose YYDS API key through these routes.

## Frontend Design

### Accounts Panel Registration Controls

Replace the ambiguous controls with two clear actions:

- `补齐账号池`
  - input: `补齐到 active 数量`
  - helper text: `当前 active = X，本次预计注册 max(0, 目标 - X) 个`
- `新增账号`
  - input: `新增数量`
  - helper text: `不看当前账号池，直接尝试新增 N 个`

Show concurrency as:

- `任务并发`
- helper text: `控制同时进行的注册尝试；邮箱创建会单独限速`

Raise UI max from 2 to the configured safe cap, default 6.

### Job Progress

Show:

- requested mode
- planned attempts
- active before/after
- completed/failed
- current stage counts
- top domain success rates
- top failure reasons

If the job is fill mode and planned attempts are less than the target number, show:

```text
目标是补齐到 100 个 active；任务开始时已有 97 个 active，所以本次只需尝试 3 个。
```

### Domain Pool Panel

Add a YYDS domain pool section under configuration:

- current mode
- whitelist text area
- blacklist text area
- refresh button
- healthy/active/cooldown/disabled counts
- domain table:
  - domain
  - status
  - weight
  - success/failure
  - verification timeout count
  - cooldown until
  - last success/failure
  - actions: enable, disable, cooldown

## Data Flow

### Create Account With Domain Selection

1. Scheduler asks `YydsDomainPool.pickDomain()`.
2. `YydsDomainPool` returns a domain or `undefined` fallback.
3. `YydsMailClient.createMailbox({ domain })` creates mailbox.
4. VIP sends code to final returned address.
5. Registration polls the mailbox token/address.
6. On code received, domain success is recorded.
7. On timeout or provider error, failure kind is recorded and domain health is updated.

### Bulk Job

1. Admin starts fill or create job.
2. Worker calculates planned attempts.
3. Scheduler starts up to `maxInFlightAttempts`.
4. Mailbox creation stage obeys mailbox QPS/concurrency limit.
5. Attempts proceed independently after mailbox creation.
6. Progress is updated after every attempt and domain cooldown event.
7. Job finishes when all planned attempts are success/failed/skipped, or when a terminal provider quota error stops new attempts.

## Error Handling

### Normal Registration Failures

Failures are recorded per attempt and do not fail the entire bulk job unless every attempt fails before any useful progress and the cause is terminal.

Examples:

- verification timeout
- VIP send-code failure
- cert failure after registration
- mailbox create transient failure after retry budget

### Terminal Bulk Job Failures

The bulk job should stop early when:

- YYDS API key cannot be decrypted
- YYDS API key is missing
- YYDS quota is exhausted
- no eligible domains are available and provider default mailbox creation also fails
- Redis/worker infrastructure fails

### Partial Success

A bulk job with some completed accounts and some failed attempts should end in `succeeded` with failure counters, not `failed`, because it produced usable inventory.

The UI must not hide failures just because the job state is `succeeded`.

## Security And Privacy

- Domain health is safe to persist.
- YYDS API key remains encrypted through existing config service.
- Account tokens and mailbox tokens stay protected behind local admin auth.
- Server logs must never include full tokens, YYDS API keys, or raw job results.
- Job snapshots may contain credentials only for authenticated local admin routes.

## Testing Plan

### Unit Tests

Registration semantics:

- fill mode calculates planned attempts as `target - active`
- create mode calculates planned attempts as `count`
- fill mode with active >= target starts zero attempts and returns a clear skipped summary

Domain pool:

- filters `/v1/domains` to healthy receiving domains
- applies whitelist and blacklist
- excludes cooldown and disabled domains
- records success and failure health
- cools down repeated verification-timeout domains
- falls back to provider default only when allowed

YYDS client:

- sends `domain` in `/v1/accounts` request when provided
- preserves existing localPart-only behavior
- classifies 429 `quota_exhausted`
- respects `Retry-After` for normal rate limits

Scheduler:

- high task concurrency does not exceed mailbox create concurrency
- polling concurrency can exceed mailbox create concurrency
- terminal quota failure stops new attempts
- partial success returns succeeded with counters

### API Tests

- `POST /api/registration/jobs` accepts `create` mode
- invalid `count`, `target`, or `concurrency` returns 400
- job snapshot exposes planned attempts and active before/after
- domain config routes require auth
- domain config save/load round-trips whitelist and blacklist
- domain refresh handles upstream failure with cached data

### Frontend Tests

- account panel labels distinguish fill from create
- fill helper text shows current active and planned attempts
- create mode posts `{ mode: "create", count, concurrency }`
- domain pool panel saves whitelist and blacklist
- job result renders domain summary and top failure reasons

### Manual Verification

Use small batches first:

1. refresh domain pool
2. run single registration with explicit domain
3. run create count `3`, concurrency `3`
4. run create count `10`, concurrency `6`
5. inspect domain health and failure summaries
6. run fill to active target and confirm planned attempts match `target - active`

Increase concurrency only after domain health and YYDS rate-limit behavior are visible.

## Rollout Plan

1. Rename and clarify UI semantics for existing fill mode.
2. Add create mode to job payload, worker, API normalization, and UI.
3. Extend `YydsMailClient.createMailbox()` to accept `domain`.
4. Add domain discovery and in-memory domain pool selection.
5. Add MySQL domain pool config and health stores.
6. Add domain pool admin routes and UI.
7. Replace global fill batch cap with stage-aware scheduler limits.
8. Add YYDS 429/quota/error classification and retry policy.
9. Add richer job progress and result summaries.
10. Run small live batches, tune defaults, then raise production concurrency.

## Default Production Stance

Initial production defaults should favor stability:

- `REGISTRATION_MAX_IN_FLIGHT=6`
- mailbox create concurrency `2`
- mailbox create rate `2/s`
- domain pool mode `auto-plus-whitelist`
- verification timeout `90s`
- domain cooldown enabled

This should improve throughput versus the current global concurrency cap of 2 while avoiding the previous failure pattern where mailbox creation was hammered at concurrency 10.
