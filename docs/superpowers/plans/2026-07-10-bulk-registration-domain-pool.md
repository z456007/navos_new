# Bulk Registration Domain Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NavOS bulk registration clear, domain-aware, and production-safe by separating fill/create semantics, selecting healthy YYDS domains, recording domain health, and replacing the global concurrency cap with stage-aware limits.

**Architecture:** Keep the existing BullMQ registration job API and `RegistrationService` pipeline, then add a focused YYDS domain-pool layer and a bounded registration scheduler. The implementation proceeds in small, testable commits: contract first, YYDS protocol second, domain pool third, registration integration fourth, UI last.

**Tech Stack:** TypeScript, Fastify, BullMQ, MySQL/in-memory stores, React, Ant Design, Vitest.

---

## File Map

- `src/services/registration-job-types.ts`: add `create` mode, `count`, optional `skipped`.
- `src/services/registration-job-service.ts`: validate `create` payload and configurable max concurrency.
- `src/services/bullmq-registration-queue.ts`: expose `count` in job snapshots.
- `src/services/registration-worker.ts`: calculate fill/create planned attempts explicitly.
- `src/services/registration-scheduler.ts`: run attempts with bounded max in-flight.
- `src/protocols/mail/yyds-mail.ts`: send explicit `domain` and classify YYDS failures.
- `src/services/yyds-domain-pool.ts`: filter, pick, score, cooldown domains.
- `src/store/yyds-domain-pool-store.ts`: in-memory and MySQL config/health stores.
- `src/services/registration-service.ts`: ask domain pool for a domain and record success/failure.
- `src/server/app.ts`: domain-pool admin routes and test injection.
- `src/index.ts`: MySQL store and runtime wiring.
- `src/config/env.ts`, `.env.example`: scheduler/domain-pool defaults.
- `web/src/types.ts`, `web/src/lib/registration-job.ts`: frontend type normalization.
- `web/src/panels/AccountsPanel.tsx`: fill vs create controls.
- `web/src/panels/YydsDomainPoolPanel.tsx`: domain-pool UI.
- Tests: `tests/registration-job-service.test.ts`, `tests/registration-worker.test.ts`, `tests/registration-scheduler.test.ts`, `tests/yyds-mail.test.ts`, `tests/yyds-domain-pool.test.ts`, `tests/registration-service.test.ts`, `tests/server.test.ts`, `tests/admin-app.test.tsx`, `tests/config.test.ts`.

---

### Task 1: Add explicit `create` job mode

**Files:**
- Modify: `src/services/registration-job-types.ts`
- Modify: `src/services/registration-job-service.ts`
- Modify: `src/services/bullmq-registration-queue.ts`
- Test: `tests/registration-job-service.test.ts`
- Test: `tests/bullmq-registration-queue.test.ts`

- [ ] **Step 1: Write failing job-service tests**

Add to `tests/registration-job-service.test.ts`:

```ts
it("creates explicit create-count jobs without using fill defaults", async () => {
  const queue = new FakeRegistrationQueue();
  const service = new RegistrationJobService(queue, {
    defaultTarget: 8,
    defaultConcurrency: 2,
    maxConcurrency: 20
  });

  const created = await service.createJob({ mode: "create", count: 12, concurrency: 6 });

  expect(created).toEqual({ jobId: "job-1" });
  expect(await service.getJob("job-1")).toMatchObject({
    id: "job-1",
    mode: "create",
    count: 12,
    concurrency: 6,
    progress: { started: 0, completed: 0, failed: 0, total: 12 }
  });
});

it.each([
  ["missing count", { mode: "create", concurrency: 2 } as never, /count/],
  ["zero count", { mode: "create", count: 0, concurrency: 2 } as never, /count/],
  ["too-high count", { mode: "create", count: 501, concurrency: 2 } as never, /count/],
  ["fractional count", { mode: "create", count: 1.5, concurrency: 2 } as never, /count/],
  ["string count", { mode: "create", count: "12", concurrency: 2 } as never, /count/]
])("rejects malformed create job input: %s", async (_caseName, input, message) => {
  const queue = new FakeRegistrationQueue();
  const service = new RegistrationJobService(queue, {
    defaultTarget: 8,
    defaultConcurrency: 2,
    maxConcurrency: 20
  });

  await expect(service.createJob(input)).rejects.toThrow(message);
  expect(queue.jobs).toHaveLength(0);
});
```

Update the fake queue `add()` signature so it accepts:

```ts
{ mode: "single" } | { mode: "fill"; target: number; concurrency: number } | { mode: "create"; count: number; concurrency: number }
```

and sets `count` plus `progress.total = data.count` for `create`.

- [ ] **Step 2: Verify the new tests fail**

Run:

```powershell
npx vitest run tests/registration-job-service.test.ts --testNamePattern "create"
```

Expected: FAIL because `create` is not a supported job mode yet.

- [ ] **Step 3: Extend job types**

In `src/services/registration-job-types.ts`, change the exported types to:

```ts
export type RegistrationJobMode = "single" | "fill" | "create";

export type RegistrationJobCreateInput =
  | { mode: "single" }
  | { mode: "fill"; target?: number; concurrency?: number }
  | { mode: "create"; count: number; concurrency?: number };

export type RegistrationJobPayload =
  | { mode: "single"; cancelRequested?: boolean }
  | { mode: "fill"; target: number; concurrency: number; cancelRequested?: boolean }
  | { mode: "create"; count: number; concurrency: number; cancelRequested?: boolean };

export interface RegistrationJobProgress {
  started: number;
  completed: number;
  failed: number;
  total: number;
  skipped?: number;
}
```

Add `count?: number` to `RegistrationJobSnapshot`.

- [ ] **Step 4: Extend job service validation**

In `src/services/registration-job-service.ts`, add `maxConcurrency?: number` to `RegistrationJobServiceOptions`.

Replace mode validation with:

```ts
if (mode !== "single" && mode !== "fill" && mode !== "create") {
  throw new RegistrationJobValidationError('mode must be "single", "fill", or "create"');
}
```

For bulk modes validate concurrency once:

```ts
const concurrency = rawInput.concurrency === undefined ? this.options.defaultConcurrency : rawInput.concurrency;
const maxConcurrency = this.options.maxConcurrency ?? 20;
if (typeof concurrency !== "number" || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > maxConcurrency) {
  throw new RegistrationJobValidationError(`concurrency must be an integer from 1 to ${maxConcurrency}`);
}
```

For `fill`, keep existing target validation. For `create`, add:

```ts
const count = rawInput.count;
if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 500) {
  throw new RegistrationJobValidationError("count must be an integer from 1 to 500");
}
return { mode: "create", count, concurrency };
```

- [ ] **Step 5: Expose create fields in BullMQ snapshots**

In `src/services/bullmq-registration-queue.ts`, add:

```ts
if (job.data.mode === "create") {
  snapshot.count = job.data.count;
  snapshot.concurrency = job.data.concurrency;
}
```

- [ ] **Step 6: Run tests**

```powershell
npx vitest run tests/registration-job-service.test.ts tests/bullmq-registration-queue.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/services/registration-job-types.ts src/services/registration-job-service.ts src/services/bullmq-registration-queue.ts tests/registration-job-service.test.ts tests/bullmq-registration-queue.test.ts
git commit -m "feat(registration): add explicit create job mode"
```

---

### Task 2: Make fill/create planned attempts explicit in the worker

**Files:**
- Modify: `src/services/registration-worker.ts`
- Test: `tests/registration-worker.test.ts`

- [ ] **Step 1: Write failing worker tests**

Add to `tests/registration-worker.test.ts`:

```ts
it("reports fill planned attempts as target minus active count", async () => {
  const registrationService = makeRegistrationService({
    getStats: vi.fn(async () => stats({ activeCount: 97 })),
    registerOne: vi.fn(async () => success(1))
  });
  const job = makeJob({ mode: "fill", target: 100, concurrency: 6 });

  const result = await processRegistrationJob(job, registrationService);

  expect(result).toMatchObject({
    mode: "fill",
    target: 100,
    activeBefore: 97,
    planned: 3,
    started: 3,
    completed: 3,
    failed: 0
  });
  expect(registrationService.registerOne).toHaveBeenCalledTimes(3);
});

it("create mode registers requested count regardless of active count", async () => {
  const registrationService = makeRegistrationService({
    getStats: vi.fn(async () => stats({ activeCount: 100 })),
    registerOne: vi.fn(async () => success(1))
  });
  const job = makeJob({ mode: "create", count: 4, concurrency: 6 });

  const result = await processRegistrationJob(job, registrationService);

  expect(result).toMatchObject({
    mode: "create",
    count: 4,
    activeBefore: 100,
    planned: 4,
    started: 4,
    completed: 4,
    failed: 0
  });
  expect(registrationService.registerOne).toHaveBeenCalledTimes(4);
});

it("fill mode skips work when active count already satisfies target", async () => {
  const registrationService = makeRegistrationService({
    getStats: vi.fn(async () => stats({ activeCount: 101 })),
    registerOne: vi.fn(async () => success(1))
  });
  const job = makeJob({ mode: "fill", target: 100, concurrency: 6 });

  const result = await processRegistrationJob(job, registrationService);

  expect(result).toMatchObject({
    mode: "fill",
    target: 100,
    activeBefore: 101,
    planned: 0,
    skipped: 1
  });
  expect(registrationService.registerOne).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run tests/registration-worker.test.ts --testNamePattern "planned attempts|create mode|skips work"
```

Expected: FAIL because the worker has no `create` mode and returns the older fill shape.

- [ ] **Step 3: Add common bulk result shape**

In `src/services/registration-worker.ts`, add:

```ts
interface BulkRegistrationJobResult {
  mode: "fill" | "create";
  target?: number;
  count?: number;
  concurrency: number;
  activeBefore: number;
  planned: number;
  started: number;
  completed: number;
  failed: number;
  skipped: number;
  results: RegistrationResult[];
}
```

Replace the fill-only branch with:

```ts
return await processBulkRegistration(jobId, data, progress, registrationService, options);
```

where `data` is `Extract<RegistrationJobPayload, { mode: "fill" | "create" }>`.

- [ ] **Step 4: Implement bulk calculation**

Create `processBulkRegistration()` with:

```ts
const stats = await registrationService.getStats();
const planned = data.mode === "fill" ? Math.max(0, data.target - stats.activeCount) : data.count;
let started = 0;
let completed = 0;
let failed = 0;
const skipped = planned === 0 ? 1 : 0;
const results: RegistrationResult[] = [];
```

If `planned === 0`, update progress with `{ started: 0, completed: 0, failed: 0, total: 0, skipped: 1 }` and return the `BulkRegistrationJobResult`.

For now, process batches with:

```ts
const batchSize = Math.min(data.concurrency, planned - started);
```

Do not keep the old `SAFE_FILL_BATCH_CONCURRENCY = 2` cap in this task.

- [ ] **Step 5: Run worker tests**

```powershell
npx vitest run tests/registration-worker.test.ts
```

Expected: PASS after updating older test names/expectations that asserted a hard cap of 2.

- [ ] **Step 6: Commit**

```powershell
git add src/services/registration-worker.ts tests/registration-worker.test.ts
git commit -m "feat(registration): clarify bulk job attempt semantics"
```

---

### Task 3: Support explicit YYDS mailbox domains and classify YYDS failures

**Files:**
- Modify: `src/protocols/mail/yyds-mail.ts`
- Test: `tests/yyds-mail.test.ts`

- [ ] **Step 1: Write failing YYDS tests**

Add to `tests/yyds-mail.test.ts`:

```ts
it("creates a mailbox with an explicit domain when provided", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new YydsMailClient({
    baseUrl: "https://mail.test/v1",
    apiKey: "ac-test",
    localPartFactory: () => "navos-test",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({
        success: true,
        data: { address: "navos-test@healthy.test", id: "m1", token: "mail-token", domain: "healthy.test", subdomain: "" }
      });
    }
  });

  const mailbox = await client.createMailbox({ domain: "healthy.test" });

  expect(mailbox).toMatchObject({ address: "navos-test@healthy.test", domain: "healthy.test" });
  expect(calls[0]?.init.body).toBe(JSON.stringify({ localPart: "navos-test", domain: "healthy.test" }));
});

it("classifies quota exhausted responses separately from normal rate limits", async () => {
  const quotaClient = new YydsMailClient({
    baseUrl: "https://mail.test/v1",
    apiKey: "ac-test",
    fetchImpl: async () => Response.json(
      { success: false, error: "quota exhausted", errorCode: "quota_exhausted" },
      { status: 429, headers: { "Retry-After": "28800" } }
    )
  });
  await expect(quotaClient.createMailbox()).rejects.toMatchObject({
    status: 429,
    failureKind: "quota_exhausted",
    retryAfterSeconds: 28800
  });
});
```

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run tests/yyds-mail.test.ts --testNamePattern "explicit domain|quota exhausted"
```

Expected: FAIL because `createMailbox()` takes no input and `YydsMailError` has no classification fields.

- [ ] **Step 3: Add YYDS failure and mailbox input types**

In `src/protocols/mail/yyds-mail.ts`, add:

```ts
export type YydsFailureKind =
  | "rate_limited"
  | "quota_exhausted"
  | "domain_rejected"
  | "mailbox_create_failed"
  | "message_poll_failed"
  | "verification_timeout"
  | "unknown";

export interface CreateMailboxInput {
  localPart?: string;
  domain?: string;
  subdomain?: string;
}
```

Extend `YydsMailbox` with optional `domain` and `subdomain`.

Extend `YydsMailError` constructor with `failureKind: YydsFailureKind = "unknown"` and `retryAfterSeconds?: number`.

- [ ] **Step 4: Send domain in `/accounts` body**

Change `createMailbox(input: CreateMailboxInput = {})` to build:

```ts
const body: Record<string, string> = { localPart: input.localPart ?? this.localPartFactory() };
if (input.domain) body.domain = input.domain;
if (input.subdomain) body.subdomain = input.subdomain;
```

Return:

```ts
domain: typeof data.domain === "string" ? data.domain : input.domain,
subdomain: typeof data.subdomain === "string" ? data.subdomain : input.subdomain
```

- [ ] **Step 5: Classify YYDS errors**

In `request()`, before throwing:

```ts
const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
const kind = classifyYydsFailure(response.status, parsed, raw);
throw new YydsMailError(errorMessage(parsed, raw), response.status, parsed ?? raw, kind, retryAfterSeconds);
```

Add:

```ts
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function classifyYydsFailure(status: number, parsed: unknown, raw: string): YydsFailureKind {
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const errorCode = typeof record.errorCode === "string" ? record.errorCode : "";
  const message = [record.error, record.message, raw].filter((item): item is string => typeof item === "string").join(" ");
  if (status === 429 && errorCode === "quota_exhausted") return "quota_exhausted";
  if (status === 429 || /too many account creation requests|rate.?limit/i.test(message)) return "rate_limited";
  if (/domain/i.test(message)) return "domain_rejected";
  return "unknown";
}
```

- [ ] **Step 6: Run YYDS tests**

```powershell
npx vitest run tests/yyds-mail.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/protocols/mail/yyds-mail.ts tests/yyds-mail.test.ts
git commit -m "feat(yyds): support explicit mailbox domains"
```

---

### Task 4: Add domain pool service and store

**Files:**
- Create: `src/services/yyds-domain-pool.ts`
- Create: `src/store/yyds-domain-pool-store.ts`
- Test: `tests/yyds-domain-pool.test.ts`

- [ ] **Step 1: Write failing domain-pool tests**

Create `tests/yyds-domain-pool.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { YydsDomainPool } from "../src/services/yyds-domain-pool.js";
import { InMemoryYydsDomainPoolStore } from "../src/store/yyds-domain-pool-store.js";

function domain(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    isPublic: true,
    isVerified: true,
    isMxValid: true,
    dnsRecords: { status: "healthy", receivingReady: true },
    ...overrides
  };
}

describe("YydsDomainPool", () => {
  it("filters public YYDS domains to healthy receiving domains", async () => {
    const pool = new YydsDomainPool({
      store: new InMemoryYydsDomainPoolStore(),
      fetchDomains: vi.fn(async () => [
        domain("healthy.test"),
        domain("degraded.test", { dnsRecords: { status: "degraded", receivingReady: true } }),
        domain("private.test", { isPublic: false })
      ]),
      now: () => 1000
    });

    const refreshed = await pool.refresh();
    const picked = await pool.pickDomain();

    expect(refreshed.eligible.map((item) => item.domain)).toEqual(["healthy.test"]);
    expect(picked?.domain).toBe("healthy.test");
  });

  it("honors whitelist, blacklist, and cooldown", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    await store.saveConfig({
      enabled: true,
      mode: "auto-plus-whitelist",
      whitelist: ["boost.test"],
      blacklist: ["blocked.test"],
      refreshIntervalMinutes: 30
    });
    const pool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("boost.test"), domain("blocked.test"), domain("normal.test")]),
      now: () => 1000
    });

    await pool.refresh();
    await pool.recordFailure("boost.test", "verification_timeout", "verification code not received");
    await pool.recordFailure("boost.test", "verification_timeout", "verification code not received");

    const candidates = await pool.listCandidates();
    expect(candidates.find((item) => item.domain === "blocked.test")).toBeUndefined();
    expect(candidates.find((item) => item.domain === "boost.test")?.status).toBe("cooldown");
    expect((await pool.pickDomain())?.domain).toBe("normal.test");
  });
});
```

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run tests/yyds-domain-pool.test.ts
```

Expected: FAIL because the service/store do not exist.

- [ ] **Step 3: Create store interfaces and in-memory store**

Create `src/store/yyds-domain-pool-store.ts` with exported:

```ts
export type YydsDomainPoolMode = "auto" | "whitelist" | "auto-plus-whitelist";
export type YydsDomainHealthStatus = "active" | "cooldown" | "disabled";

export interface YydsDomainPoolConfig {
  enabled: boolean;
  mode: YydsDomainPoolMode;
  whitelist: string[];
  blacklist: string[];
  refreshIntervalMinutes: number;
}

export interface YydsDomainHealthRecord {
  domain: string;
  status: YydsDomainHealthStatus;
  successCount: number;
  failureCount: number;
  verificationTimeoutCount: number;
  mailboxRateLimitCount: number;
  quotaExhaustedCount: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  cooldownUntil: number;
  weight: number;
  lastCheckedAt: number;
  lastError?: string;
}
```

Implement `InMemoryYydsDomainPoolStore` with `getConfig()`, `saveConfig()`, `listHealth()`, `getHealth()`, `saveHealth()`.

- [ ] **Step 4: Create pool service**

Create `src/services/yyds-domain-pool.ts` with methods:

```ts
refresh(): Promise<{ eligible: Array<{ domain: string }> }>
listCandidates(): Promise<YydsDomainCandidate[]>
pickDomain(): Promise<YydsDomainCandidate | undefined>
recordSuccess(domain: string): Promise<void>
recordFailure(domain: string, kind: YydsFailureKind, error: string): Promise<void>
```

Filtering rule:

```ts
isPublic === true &&
isVerified === true &&
isMxValid === true &&
dnsRecords.receivingReady === true &&
dnsRecords.status === "healthy"
```

Cooldown rule for this task:

```ts
kind === "verification_timeout" && verificationTimeoutCount >= 2
```

sets `cooldownUntil = now + 10 * 60 * 1000` and `status = "cooldown"`.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run tests/yyds-domain-pool.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/services/yyds-domain-pool.ts src/store/yyds-domain-pool-store.ts tests/yyds-domain-pool.test.ts
git commit -m "feat(yyds): add domain pool selection"
```

---

### Task 5: Add config parsing and MySQL domain-pool store

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `src/store/yyds-domain-pool-store.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add to `tests/config.test.ts`:

```ts
it("loads registration scheduler and YYDS domain pool defaults", () => {
  const config = loadConfig({
    MASTER_API_KEY: "sk-test",
    PROVIDER_BASE_URL: "https://upstream.test",
    VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
  });

  expect(config.registrationMaxInFlight).toBe(6);
  expect(config.registrationMailboxCreateConcurrency).toBe(2);
  expect(config.registrationMailboxCreatePerSecond).toBe(2);
  expect(config.registrationPollConcurrency).toBe(30);
  expect(config.yydsDomainPool).toMatchObject({
    enabled: true,
    mode: "auto-plus-whitelist",
    whitelist: [],
    blacklist: [],
    refreshIntervalMinutes: 30
  });
});
```

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run tests/config.test.ts --testNamePattern "scheduler and YYDS domain pool"
```

Expected: FAIL because the fields are not in `AppConfig`.

- [ ] **Step 3: Extend `AppConfig`**

Add fields:

```ts
registrationMaxInFlight: number;
registrationMailboxCreateConcurrency: number;
registrationMailboxCreatePerSecond: number;
registrationVipSendConcurrency: number;
registrationPollConcurrency: number;
registrationLoginConcurrency: number;
registrationCertConcurrency: number;
registrationVerificationTimeoutMs: number;
yydsDomainPool: YydsDomainPoolConfig;
```

Add parser helpers:

```ts
function parseCappedPositiveInt(value: string | undefined, fallback: number, max: number): number {
  return Math.min(parsePositiveInt(value, fallback), max);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return value.trim().toLowerCase() !== "false";
}
```

Add return fields with defaults:

```ts
registrationMaxInFlight: parseCappedPositiveInt(env.REGISTRATION_MAX_IN_FLIGHT, 6, 20),
registrationMailboxCreateConcurrency: parseCappedPositiveInt(env.REGISTRATION_MAILBOX_CREATE_CONCURRENCY, 2, 5),
registrationMailboxCreatePerSecond: parseCappedPositiveInt(env.REGISTRATION_MAILBOX_CREATE_PER_SECOND, 2, 10),
registrationVipSendConcurrency: parseCappedPositiveInt(env.REGISTRATION_VIP_SEND_CONCURRENCY, 6, 20),
registrationPollConcurrency: parseCappedPositiveInt(env.REGISTRATION_POLL_CONCURRENCY, 30, 100),
registrationLoginConcurrency: parseCappedPositiveInt(env.REGISTRATION_LOGIN_CONCURRENCY, 6, 20),
registrationCertConcurrency: parseCappedPositiveInt(env.REGISTRATION_CERT_CONCURRENCY, 4, 20),
registrationVerificationTimeoutMs: parsePositiveInt(env.REGISTRATION_VERIFICATION_TIMEOUT_MS, 90_000),
yydsDomainPool: {
  enabled: parseBool(env.YYDS_DOMAIN_POOL_ENABLED, true),
  mode: parseDomainPoolMode(env.YYDS_DOMAIN_POOL_MODE),
  whitelist: parseCsv(env.YYDS_DOMAIN_WHITELIST).map((item) => item.toLowerCase()),
  blacklist: parseCsv(env.YYDS_DOMAIN_BLACKLIST).map((item) => item.toLowerCase()),
  refreshIntervalMinutes: parsePositiveInt(env.YYDS_DOMAIN_REFRESH_MINUTES, 30)
}
```

- [ ] **Step 4: Add MySQL store**

In `src/store/yyds-domain-pool-store.ts`, add `MysqlYydsDomainPoolStore` mirroring `MysqlYydsMailConfigStore` style. It must create:

```sql
CREATE TABLE IF NOT EXISTS yyds_domain_pool_config (
  id TINYINT PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  mode VARCHAR(32) NOT NULL DEFAULT 'auto-plus-whitelist',
  whitelist_json JSON NOT NULL,
  blacklist_json JSON NOT NULL,
  refresh_interval_minutes INT NOT NULL DEFAULT 30,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
)
```

and:

```sql
CREATE TABLE IF NOT EXISTS yyds_domain_health (
  domain VARCHAR(255) PRIMARY KEY,
  status ENUM('active', 'cooldown', 'disabled') NOT NULL DEFAULT 'active',
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  verification_timeout_count INT NOT NULL DEFAULT 0,
  mailbox_rate_limit_count INT NOT NULL DEFAULT 0,
  quota_exhausted_count INT NOT NULL DEFAULT 0,
  last_success_at BIGINT NOT NULL DEFAULT 0,
  last_failure_at BIGINT NOT NULL DEFAULT 0,
  cooldown_until BIGINT NOT NULL DEFAULT 0,
  weight INT NOT NULL DEFAULT 10,
  last_checked_at BIGINT NOT NULL DEFAULT 0,
  last_error TEXT NULL
)
```

Implement `getConfig()`, `saveConfig()`, `listHealth()`, `getHealth()`, `saveHealth()` with MySQL named parameters.

- [ ] **Step 5: Update `.env.example`**

Append:

```env
REGISTRATION_MAX_IN_FLIGHT=6
REGISTRATION_MAILBOX_CREATE_CONCURRENCY=2
REGISTRATION_MAILBOX_CREATE_PER_SECOND=2
REGISTRATION_VIP_SEND_CONCURRENCY=6
REGISTRATION_POLL_CONCURRENCY=30
REGISTRATION_LOGIN_CONCURRENCY=6
REGISTRATION_CERT_CONCURRENCY=4
REGISTRATION_VERIFICATION_TIMEOUT_MS=90000
YYDS_DOMAIN_POOL_ENABLED=true
YYDS_DOMAIN_POOL_MODE=auto-plus-whitelist
YYDS_DOMAIN_REFRESH_MINUTES=30
YYDS_DOMAIN_WHITELIST=
YYDS_DOMAIN_BLACKLIST=
```

- [ ] **Step 6: Run tests**

```powershell
npx vitest run tests/config.test.ts tests/yyds-domain-pool.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/config/env.ts .env.example src/store/yyds-domain-pool-store.ts tests/config.test.ts
git commit -m "feat(config): add registration domain pool settings"
```

---

### Task 6: Expose domain pool admin routes

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/index.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write failing route tests**

Add to `tests/server.test.ts`:

```ts
it("protects and returns YYDS domain pool state", async () => {
  const domainStore = new InMemoryYydsDomainPoolStore();
  const app = createApp({
    masterApiKey: "sk-test",
    providerBaseUrl: "https://upstream.test",
    providerAuthMode: "uid-token",
    accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
    yydsDomainPoolStore: domainStore,
    yydsDomainFetchImpl: async () => [
      { domain: "healthy.test", isPublic: true, isVerified: true, isMxValid: true, dnsRecords: { status: "healthy", receivingReady: true } }
    ],
    fetchImpl: async () => Response.json({ ok: true })
  });

  expect((await app.inject({ method: "GET", url: "/api/mail/yyds/domains" })).statusCode).toBe(401);

  const refresh = await app.inject({ method: "POST", url: "/api/mail/yyds/domains/refresh", headers: { authorization: "Bearer sk-test" } });
  expect(refresh.statusCode).toBe(200);
  expect(refresh.json().eligible).toEqual([{ domain: "healthy.test" }]);

  const listed = await app.inject({ method: "GET", url: "/api/mail/yyds/domains", headers: { authorization: "Bearer sk-test" } });
  expect(listed.statusCode).toBe(200);
  expect(listed.json().domains[0]).toMatchObject({ domain: "healthy.test", status: "active" });
});
```

- [ ] **Step 2: Verify route tests fail**

```powershell
npx vitest run tests/server.test.ts --testNamePattern "domain pool"
```

Expected: FAIL because routes and app options do not exist.

- [ ] **Step 3: Create domain pool in `createApp()`**

In `src/server/app.ts`, add app options:

```ts
yydsDomainPoolStore?: YydsDomainPoolStore;
yydsDomainFetchImpl?: () => Promise<unknown[]>;
```

Create:

```ts
const yydsDomainPoolStore = options.yydsDomainPoolStore ?? new InMemoryYydsDomainPoolStore();
const yydsDomainPool = new YydsDomainPool({
  store: yydsDomainPoolStore,
  fetchDomains: options.yydsDomainFetchImpl ?? fetchPublicYydsDomains
});
```

Implement `fetchPublicYydsDomains()` using `options.fetchImpl ?? fetch` against `https://maliapi.215.im/v1/domains`.

- [ ] **Step 4: Add routes**

Add protected routes:

```ts
GET /api/mail/yyds/domains
POST /api/mail/yyds/domains/refresh
PUT /api/mail/yyds/domain-pool/config
```

The `GET` response shape:

```ts
{
  config: await yydsDomainPoolStore.getConfig(),
  domains: await yydsDomainPool.listCandidates()
}
```

The `PUT` body normalizes `whitelist` and `blacklist` string arrays to lowercase domain names.

- [ ] **Step 5: Wire MySQL store in `src/index.ts`**

Instantiate:

```ts
const yydsDomainPoolStore = new MysqlYydsDomainPoolStore(config.mysql);
await yydsDomainPoolStore.ensureSchema();
```

Pass `yydsDomainPoolStore` to `createApp()`.

- [ ] **Step 6: Run tests**

```powershell
npx vitest run tests/server.test.ts --testNamePattern "domain pool"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/server/app.ts src/index.ts tests/server.test.ts
git commit -m "feat(yyds): expose domain pool admin routes"
```

---

### Task 7: Use domain pool in registration attempts

**Files:**
- Modify: `src/services/registration-service.ts`
- Modify: `src/index.ts`
- Modify: `src/server/app.ts`
- Test: `tests/registration-service.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/registration-service.test.ts`:

```ts
it("uses a picked YYDS domain for mailbox creation and records the domain in results", async () => {
  const vipFetch = vipFetchForPipeline({});
  const mailFetch = mailFetchForCode("domain@mail.good.test", "mail-token", "445566");
  const pickedDomains: string[] = [];
  const recorder = { recordSuccess: vi.fn(async () => undefined), recordFailure: vi.fn(async () => undefined) };
  const vipClient = new VipClient({ baseUrl: "https://vip.test", hmacSecret: "test-secret-32!!", fetchImpl: vipFetch });
  const yydsClient = new YydsMailClient({
    baseUrl: "https://mail.test/v1",
    apiKey: "ac-test",
    fetchImpl: async (url, init) => {
      if (String(url).includes("/accounts") && init?.body) {
        pickedDomains.push(JSON.parse(init.body as string).domain);
      }
      return mailFetch(url, init);
    }
  });

  const service = new RegistrationService({
    yydsClient,
    vipClient,
    accountService,
    domainPicker: async () => ({ domain: "mail.good.test" }),
    domainRecorder: recorder,
    maxPollAttempts: 2,
    pollIntervalMs: 1,
    mailboxMinIntervalMs: 0
  });

  const result = await service.registerOne();

  expect(result.success).toBe(true);
  expect(result.domain).toBe("mail.good.test");
  expect(pickedDomains).toEqual(["mail.good.test"]);
  expect(recorder.recordSuccess).toHaveBeenCalledWith("mail.good.test");
});
```

- [ ] **Step 2: Verify test fails**

```powershell
npx vitest run tests/registration-service.test.ts --testNamePattern "picked YYDS domain"
```

Expected: FAIL because `RegistrationServiceOptions` lacks domain picker/recorder.

- [ ] **Step 3: Extend registration service types**

In `src/services/registration-service.ts`, add:

```ts
export interface RegistrationDomainPick { domain: string; }
export interface RegistrationDomainRecorder {
  recordSuccess(domain: string): Promise<void>;
  recordFailure(domain: string, kind: YydsFailureKind, error: string): Promise<void>;
}
```

Extend `RegistrationServiceOptions` with `domainPicker` and `domainRecorder`. Extend `RegistrationResult` with `domain?: string`, `failureKind?: YydsFailureKind`, `elapsedMs?: number`, `retryCount?: number`.

- [ ] **Step 4: Pass selected domain to YYDS mailbox creation**

In `registerOne()`:

```ts
const startedAt = Date.now();
const picked = this.domainPicker ? await this.domainPicker() : undefined;
const pickedDomain = picked?.domain;
const mailbox = await this.createMailboxWithRetry(pickedDomain);
const domain = mailbox.domain ?? pickedDomain ?? email.split("@").at(-1);
```

Change mailbox methods to accept `domain?: string` and call:

```ts
return await (await this.resolveYydsClient()).createMailbox(domain ? { domain } : undefined);
```

- [ ] **Step 5: Record domain success/failure**

On success:

```ts
if (domain && this.domainRecorder) await this.domainRecorder.recordSuccess(domain);
```

On verification timeout:

```ts
if (domain && this.domainRecorder) await this.domainRecorder.recordFailure(domain, "verification_timeout", "verification code not received");
return { success: false, email, domain, error: "verification code not received", failureKind: "verification_timeout", elapsedMs: Date.now() - startedAt };
```

On caught `YydsMailError`, record `error.failureKind`.

- [ ] **Step 6: Wire runtime**

In `src/index.ts`, create `YydsDomainPool` and pass:

```ts
domainPicker: async () => config.yydsDomainPool.enabled ? await yydsDomainPool.pickDomain() : undefined,
domainRecorder: yydsDomainPool
```

In `src/server/app.ts`, keep these optional for tests.

- [ ] **Step 7: Run tests**

```powershell
npx vitest run tests/registration-service.test.ts tests/yyds-domain-pool.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/services/registration-service.ts src/index.ts src/server/app.ts tests/registration-service.test.ts
git commit -m "feat(registration): pick and record YYDS domains"
```

---

### Task 8: Add bounded registration scheduler

**Files:**
- Create: `src/services/registration-scheduler.ts`
- Modify: `src/services/registration-worker.ts`
- Test: `tests/registration-scheduler.test.ts`
- Test: `tests/registration-worker.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Create `tests/registration-scheduler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { RegistrationScheduler } from "../src/services/registration-scheduler.js";

describe("RegistrationScheduler", () => {
  it("runs attempts up to maxInFlight without the old global cap of 2", async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = new RegistrationScheduler({ maxInFlightAttempts: 4 });

    const result = await scheduler.run({
      planned: 4,
      runAttempt: vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { success: true };
      }),
      onProgress: async () => undefined
    });

    expect(maxActive).toBe(4);
    expect(result).toMatchObject({ started: 4, completed: 4, failed: 0 });
  });

  it("stops scheduling new attempts on quota exhausted failures", async () => {
    const scheduler = new RegistrationScheduler({ maxInFlightAttempts: 2 });

    const result = await scheduler.run({
      planned: 5,
      runAttempt: vi.fn(async () => ({ success: false, error: "quota exhausted", failureKind: "quota_exhausted" })),
      onProgress: async () => undefined
    });

    expect(result).toMatchObject({ started: 1, completed: 0, failed: 1, stoppedEarly: true, stopReason: "quota_exhausted" });
  });
});
```

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run tests/registration-scheduler.test.ts
```

Expected: FAIL because scheduler file does not exist.

- [ ] **Step 3: Create scheduler**

Create `src/services/registration-scheduler.ts` with `RegistrationScheduler.run()` accepting:

```ts
{
  planned: number;
  runAttempt: (index: number) => Promise<RegistrationResult>;
  onProgress: (progress: { started: number; completed: number; failed: number; total: number; results: RegistrationResult[] }) => Promise<void>;
}
```

The scheduler starts at most `maxInFlightAttempts` promises, records results, and stops early when a result has `failureKind === "quota_exhausted"`.

- [ ] **Step 4: Use scheduler from worker**

In `registration-worker.ts`, import `RegistrationScheduler` and replace the manual bulk loop with:

```ts
const scheduler = new RegistrationScheduler({ maxInFlightAttempts: data.concurrency });
const scheduled = await scheduler.run({
  planned,
  runAttempt: async () => registerOneSafely(registrationService),
  onProgress: async (next) => {
    started = next.started;
    completed = next.completed;
    failed = next.failed;
    results.splice(0, results.length, ...next.results);
    await progress.update(started, completed, failed, planned, skipped, "info", `${data.mode} registration progress updated`);
  }
});
```

Return `stoppedEarly` and `stopReason`.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run tests/registration-scheduler.test.ts tests/registration-worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/services/registration-scheduler.ts src/services/registration-worker.ts tests/registration-scheduler.test.ts tests/registration-worker.test.ts
git commit -m "feat(registration): add bounded attempt scheduler"
```

---

### Task 9: Update admin UI for create/fill and domain pool

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/registration-job.ts`
- Modify: `web/src/panels/AccountsPanel.tsx`
- Create: `web/src/panels/YydsDomainPoolPanel.tsx`
- Modify: `web/src/panels/YydsMailConfigPanel.tsx`
- Test: `tests/admin-app.test.tsx`

- [ ] **Step 1: Write failing UI test**

Add to `tests/admin-app.test.tsx`:

```ts
it("distinguishes fill target from create count in account registration controls", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/accounts") return Response.json([]);
    if (path === "/api/registration/jobs" && init?.method === "GET") return Response.json([]);
    if (path === "/api/registration/jobs" && init?.method === "POST") return Response.json({ jobId: "job-create" });
    if (path === "/api/registration/jobs/job-create") {
      return Response.json({ id: "job-create", mode: "create", state: "succeeded", count: 5, concurrency: 4, progress: { started: 5, completed: 5, failed: 0, total: 5 }, logs: [] });
    }
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<ConsoleShell />);
  fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
  fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));
  await screen.findByRole("button", { name: "账号池" });

  fireEvent.change(await screen.findByLabelText("新增数量"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("任务并发"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "新增注册" }));

  const postCall = fetchMock.mock.calls.find(([path, init]) => path === "/api/registration/jobs" && init?.method === "POST");
  expect(JSON.parse(postCall?.[1]?.body as string)).toEqual({ mode: "create", count: 5, concurrency: 4 });
});
```

- [ ] **Step 2: Verify test fails**

```powershell
npx vitest run tests/admin-app.test.tsx --testNamePattern "fill target from create count"
```

Expected: FAIL because UI has no create controls.

- [ ] **Step 3: Update frontend types and normalizer**

Set:

```ts
export type RegistrationJobMode = "single" | "fill" | "create";
```

Add `count?: number` to `RegistrationJobView`.

In `normalizeRegistrationJob()`, map:

```ts
const modeValue = readString(record.mode);
mode: modeValue === "single" || modeValue === "create" ? modeValue : "fill",
count: readNumber(record.count),
```

- [ ] **Step 4: Replace account registration controls**

In `AccountsPanel.tsx`, add state:

```ts
const [fillTarget, setFillTarget] = useState(100);
const [createCount, setCreateCount] = useState(10);
const [jobConcurrency, setJobConcurrency] = useState(6);
```

Change `startRegistrationJob(mode)` to accept `"single" | "fill" | "create"` and send:

```ts
mode === "fill"
  ? { mode: "fill", target: fillTarget, concurrency: jobConcurrency }
  : mode === "create"
    ? { mode: "create", count: createCount, concurrency: jobConcurrency }
    : { mode: "single" }
```

Render labels:

```tsx
补齐到 active 数量
新增数量
任务并发
```

Render buttons:

```tsx
补齐账号池
新增注册
```

- [ ] **Step 5: Add domain pool panel**

Create `web/src/panels/YydsDomainPoolPanel.tsx` with:

- `GET /api/mail/yyds/domains`
- `PUT /api/mail/yyds/domain-pool/config`
- `POST /api/mail/yyds/domains/refresh`
- whitelist textarea
- blacklist textarea
- table columns: domain, status, weight, successCount, failureCount

Use `apiRequest`, `StatusLine`, `Input.TextArea`, `AntButton`, and `Table` like existing panels.

- [ ] **Step 6: Render domain pool under YYDS config**

In `YydsMailConfigPanel.tsx`, import and render:

```tsx
<YydsDomainPoolPanel apiKey={apiKey} />
```

- [ ] **Step 7: Run UI tests**

```powershell
npx vitest run tests/admin-app.test.tsx --testNamePattern "fill target from create count|YYDS"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add web/src/types.ts web/src/lib/registration-job.ts web/src/panels/AccountsPanel.tsx web/src/panels/YydsDomainPoolPanel.tsx web/src/panels/YydsMailConfigPanel.tsx tests/admin-app.test.tsx
git commit -m "feat(admin): clarify bulk registration controls"
```

---

### Task 10: Final verification and live smoke checks

**Files:**
- No planned production edits.

- [ ] **Step 1: Run targeted backend tests**

```powershell
npx vitest run tests/registration-job-service.test.ts tests/registration-worker.test.ts tests/registration-scheduler.test.ts tests/registration-service.test.ts tests/yyds-mail.test.ts tests/yyds-domain-pool.test.ts tests/server.test.ts --testNamePattern "create|fill|domain|quota|scheduler|YYDS"
```

Expected: PASS.

- [ ] **Step 2: Run targeted frontend tests**

```powershell
npx vitest run tests/admin-app.test.tsx --testNamePattern "registration|YYDS|domain"
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

```powershell
npm run typecheck
npm test
npm run build:server
npm run build:web
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Live smoke check domain refresh**

```powershell
$headers=@{'x-api-key'='zgm2003';'authorization'='Bearer zgm2003'}
Invoke-RestMethod -Uri 'http://127.0.0.1:18888/api/mail/yyds/domains/refresh' -Method POST -Headers $headers | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:18888/api/mail/yyds/domains' -Headers $headers | ConvertTo-Json -Depth 5
```

Expected: healthy domains are returned and no YYDS API key is present.

- [ ] **Step 5: Live smoke check create mode**

```powershell
$headers=@{'x-api-key'='zgm2003';'authorization'='Bearer zgm2003'}
$job=Invoke-RestMethod -Uri 'http://127.0.0.1:18888/api/registration/jobs' -Method POST -Headers $headers -ContentType 'application/json' -Body '{"mode":"create","count":3,"concurrency":3}'
Invoke-RestMethod -Uri "http://127.0.0.1:18888/api/registration/jobs/$($job.jobId)" -Headers $headers | ConvertTo-Json -Depth 10
```

Expected: `progress.total` is `3`, and result rows include domain metadata.

- [ ] **Step 6: Live smoke check fill mode**

```powershell
$stats=Invoke-RestMethod -Uri 'http://127.0.0.1:18888/api/registration/stats' -Headers $headers
$target=$stats.activeCount + 2
$body=@{mode='fill';target=$target;concurrency=3} | ConvertTo-Json
$job=Invoke-RestMethod -Uri 'http://127.0.0.1:18888/api/registration/jobs' -Method POST -Headers $headers -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri "http://127.0.0.1:18888/api/registration/jobs/$($job.jobId)" -Headers $headers | ConvertTo-Json -Depth 10
```

Expected: returned job result `planned` equals `2`.

---

## Self-Review

Spec coverage:

- Fill vs create semantics: Tasks 1, 2, 9, 10.
- Domain discovery, whitelist, blacklist, cooldown: Tasks 4, 5, 6, 9.
- YYDS `domain` support and 429/quota classification: Task 3.
- Domain-aware registration results and health recording: Task 7.
- Global cap replacement with bounded scheduling: Task 8.
- Admin UI: Task 9.
- Verification and live smoke: Task 10.

Type consistency:

- `create` uses `count`.
- `fill` uses `target`.
- both bulk modes use `concurrency`.
- YYDS classification uses `YydsFailureKind`.
- domain-pool persistence uses `YydsDomainPoolStore`, `YydsDomainPoolConfig`, and `YydsDomainHealthRecord`.

No unresolved markers are intentionally present in this plan.
