# Sub2Api NavOS Production Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `E:\navos-new` as a production-grade NavOS upstream for local `E:\github-work\sub2api`, so one depleted internal account never kills the whole Sub2Api chain and all public `/v1/*` paths remain client-compatible.

**Architecture:** Keep Sub2Api as the outer API-key/group/failover layer and make NavOS responsible for internal account health, lease, balance reconciliation, registration, image/video polling, upstream error classification, and DB-backed runtime configuration. Implement from the inside out with TDD: runtime config surface and classifier first, then balance correctness, public image contract, DB/concurrency controls, registration limiter, and finally a local Sub2Api-chain load harness that never touches production.

**Tech Stack:** TypeScript, Fastify, React, Ant Design, MySQL/mysql2, Redis/ioredis, BullMQ, Vitest, PowerShell, local Sub2Api binary.

---

## Hard constraints

- Do not SSH or connect to production while executing this plan.
- Run and fix locally first in `E:\navos-new`; only later copy to production after user approval.
- Integration and load tests must enter through Sub2Api: `http://127.0.0.1:18080/v1` plus a Sub2Api API key.
- Production-readiness load tests must use real NavOS accounts and the real upstream. Fake upstream is only a protocol/harness smoke stage and cannot be used as final proof.
- Do not reintroduce COS, local image storage, or image archive metadata.
- Do not claim high-concurrency success until a report exists under `docs/diagnostics/`.
- Business/runtime knobs must be admin-visible and DB-backed where possible. `.env` is only bootstrap/default seed: ports, MySQL/Redis credentials, root secrets, and safe first-run defaults.

## File map

Create:

- `src/services/provider-failure-classifier.ts` — one place to classify upstream failures into account actions and external HTTP semantics.
- `src/services/registration-mailbox-limiter.ts` — Redis-backed YYDS mailbox create concurrency/QPS/quota fuse.
- `scripts/load/fake-navos-provider.ts` — local fake upstream for model/image/video/balance branches.
- `scripts/load/sub2api-chain-load-test.ts` — Sub2Api-entry load runner and report writer.
- `scripts/load/run-local-sub2api-chain.ps1` — Windows orchestration wrapper for fake upstream, NavOS, Sub2Api, and load runner.
- `tests/provider-failure-classifier.test.ts`
- `tests/registration-mailbox-limiter.test.ts`

Modify:

- `src/server/app.ts` — replace scattered failure heuristics, wire balance scope, pass image response format, preserve streaming.
- `src/protocols/image.ts` — split public OpenAI image normalizer from admin display normalizer and prefer output success over failed status.
- `src/services/account-balance-reconciler.ts` — support `depleted | active | non_disabled | all`, active demotion, disabled safety.
- `src/services/registration-service.ts` — use global mailbox limiter and quota fuse.
- `src/config/env.ts` — add MySQL pool, reconcile scope, model wait, registration limiter envs.
- `src/index.ts` — pass new config into stores, reconciler, and registration limiter.
- `src/store/mysql-account-store.ts`
- `src/store/image-task-store.ts`
- `src/store/video-task-store.ts`
- `src/store/runtime-config-store.ts`
- `src/store/yyds-domain-pool-store.ts`
- `src/store/yyds-mail-config-store.ts`
- `web/src/types.ts`
- `web/src/panels/RuntimeConfigPanel.tsx`
- `web/src/app/ConsoleShell.tsx`
- `web/src/panels/AccountsPanel.tsx`
- `.env.example`
- `.env`
- `package.json`
- Existing tests: `tests/account-balance-reconciler.test.ts`, `tests/server.test.ts`, `tests/image.test.ts`, `tests/config.test.ts`, `tests/admin-app.test.tsx`, `tests/registration-service.test.ts`

---

### Task 0: Local-only baseline and branch guard

**Files:**
- Read: `docs/superpowers/specs/2026-07-11-sub2api-navos-production-repair-design.md`
- Read: `package.json`
- No code changes in this task.

- [ ] **Step 1: Confirm local workspace**

Run:

```powershell
Get-Location
git status --short
```

Expected:

```text
Path
----
E:\navos-new
```

`git status --short` may show the new spec and plan, but must not show production-server edits.

- [ ] **Step 2: Run current focused baseline**

Run:

```powershell
npm test -- tests/account-balance-reconciler.test.ts tests/image.test.ts tests/config.test.ts
```

Expected: current baseline result is recorded before edits. If it fails, copy the exact failing test names into the task notes and still continue with Task 1 because this plan changes those files.

- [ ] **Step 3: Commit the UTF-8 spec and this plan only if the user wants commits**

Run only when committing is desired:

```powershell
git add docs/superpowers/specs/2026-07-11-sub2api-navos-production-repair-design.md docs/superpowers/plans/2026-07-11-sub2api-navos-production-repair.md
git commit -m "docs: plan sub2api navos production repair"
```

Expected: one docs-only commit.

---


### Task 1: DB-backed visual runtime configuration foundation

**Files:**
- Create: `src/services/runtime-config-schema.ts`
- Modify: `src/services/runtime-config-service.ts`
- Modify: `src/store/runtime-config-store.ts`
- Modify: `src/config/env.ts`
- Modify: `src/index.ts`
- Modify: `src/server/app.ts`
- Modify: `web/src/types.ts`
- Modify: `web/src/panels/RuntimeConfigPanel.tsx`
- Modify: `web/src/app/ConsoleShell.tsx`
- Modify: `tests/config.test.ts`
- Modify: `tests/admin-app.test.tsx`

- [ ] **Step 1: Write failing runtime config schema tests**

Append to `tests/config.test.ts`:

```ts
import {
  normalizeRuntimeConfigInput,
  runtimeConfigDefaultsFromAppConfig
} from "../src/services/runtime-config-schema.js";

it("normalizes visual runtime config input with safe caps", () => {
  const normalized = normalizeRuntimeConfigInput({
    imageAllowVideoReserveFallback: true,
    imageAccountWaitMs: 999999999,
    imageMaxPollAttempts: 0,
    imagePollIntervalMs: 250,
    accountBalanceReconcileEnabled: true,
    accountBalanceReconcileScope: "non_disabled",
    accountBalanceReconcileConcurrency: 999,
    registrationMailboxCreateConcurrency: 8,
    registrationMailboxCreatePerSecond: 20,
    registrationYydsQuotaBlockSeconds: 600,
    mysqlConnectionLimit: 200,
    mysqlQueueLimit: 1000
  });

  expect(normalized.imageAllowVideoReserveFallback).toBe(true);
  expect(normalized.imageAccountWaitMs).toBe(300000);
  expect(normalized.imageMaxPollAttempts).toBe(1);
  expect(normalized.imagePollIntervalMs).toBe(1000);
  expect(normalized.accountBalanceReconcileScope).toBe("non_disabled");
  expect(normalized.accountBalanceReconcileConcurrency).toBe(50);
  expect(normalized.registrationMailboxCreateConcurrency).toBe(8);
  expect(normalized.registrationMailboxCreatePerSecond).toBe(20);
  expect(normalized.registrationYydsQuotaBlockSeconds).toBe(600);
  expect(normalized.mysqlConnectionLimit).toBe(200);
  expect(normalized.mysqlQueueLimit).toBe(1000);
});

it("builds runtime config defaults from bootstrap env config", () => {
  const config = loadConfig({
    MASTER_API_KEY: "master",
    PUBLIC_PROXY_API_KEYS: "public",
    PROVIDER_BASE_URL: "https://provider.test",
    VIP_HMAC_SECRET: "secret",
    IMAGE_ACCOUNT_WAIT_MS: "90000",
    IMAGE_MAX_POLL_ATTEMPTS: "12",
    IMAGE_POLL_INTERVAL_MS: "3000",
    ACCOUNT_BALANCE_RECONCILE_SCOPE: "active",
    REGISTRATION_MAILBOX_CREATE_CONCURRENCY: "3",
    REGISTRATION_MAILBOX_CREATE_PER_SECOND: "4",
    REGISTRATION_YYDS_QUOTA_BLOCK_SECONDS: "120",
    MYSQL_CONNECTION_LIMIT: "150",
    MYSQL_QUEUE_LIMIT: "0"
  });

  const defaults = runtimeConfigDefaultsFromAppConfig(config);
  expect(defaults.imageAccountWaitMs).toBe(90000);
  expect(defaults.imageMaxPollAttempts).toBe(12);
  expect(defaults.imagePollIntervalMs).toBe(3000);
  expect(defaults.accountBalanceReconcileScope).toBe("active");
  expect(defaults.registrationMailboxCreateConcurrency).toBe(3);
  expect(defaults.registrationMailboxCreatePerSecond).toBe(4);
  expect(defaults.registrationYydsQuotaBlockSeconds).toBe(120);
  expect(defaults.mysqlConnectionLimit).toBe(150);
  expect(defaults.restartRequiredKeys).toContain("mysqlConnectionLimit");
});
```

- [ ] **Step 2: Verify runtime config tests fail**

Run:

```powershell
npm test -- tests/config.test.ts
```

Expected: fail with module not found for `runtime-config-schema.js` or missing fields.

- [ ] **Step 3: Create runtime config schema**

Create `src/services/runtime-config-schema.ts`:

```ts
import type { AppConfig } from "../config/env.js";
export type AccountBalanceReconcileScope = "depleted" | "active" | "non_disabled" | "all";

export interface RuntimeConfigView {
  imageAllowVideoReserveFallback: boolean;
  imageAccountWaitMs: number;
  imageMaxPollAttempts: number;
  imagePollIntervalMs: number;
  imageSyncWaitBudgetMs: number;
  videoCreateTimeoutMs: number;
  videoPollTimeoutMs: number;
  modelAccountWaitMs: number;
  accountLeaseTtlMs: number;
  accountBalanceReconcileEnabled: boolean;
  accountBalanceReconcileIntervalMinutes: number;
  accountBalanceReconcileBatchSize: number;
  accountBalanceReconcileConcurrency: number;
  accountBalanceReconcileScope: AccountBalanceReconcileScope;
  registrationConcurrency: number;
  registrationMaxInFlight: number;
  registrationMailboxCreateConcurrency: number;
  registrationMailboxCreatePerSecond: number;
  registrationVipSendConcurrency: number;
  registrationPollConcurrency: number;
  registrationLoginConcurrency: number;
  registrationCertConcurrency: number;
  registrationYydsQuotaBlockSeconds: number;
  mysqlConnectionLimit: number;
  mysqlQueueLimit: number;
  restartRequiredKeys: string[];
  updatedAt: number;
}

export type RuntimeConfigUpdateInput = Partial<Record<keyof RuntimeConfigView, unknown>>;

export const RUNTIME_CONFIG_RESTART_REQUIRED_KEYS = [
  "mysqlConnectionLimit",
  "mysqlQueueLimit"
] as const;

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfigView = {
  imageAllowVideoReserveFallback: false,
  imageAccountWaitMs: 120000,
  imageMaxPollAttempts: 30,
  imagePollIntervalMs: 4000,
  imageSyncWaitBudgetMs: 120000,
  videoCreateTimeoutMs: 30000,
  videoPollTimeoutMs: 30000,
  modelAccountWaitMs: 30000,
  accountLeaseTtlMs: 600000,
  accountBalanceReconcileEnabled: true,
  accountBalanceReconcileIntervalMinutes: 30,
  accountBalanceReconcileBatchSize: 1000,
  accountBalanceReconcileConcurrency: 10,
  accountBalanceReconcileScope: "depleted",
  registrationConcurrency: 2,
  registrationMaxInFlight: 20,
  registrationMailboxCreateConcurrency: 2,
  registrationMailboxCreatePerSecond: 2,
  registrationVipSendConcurrency: 6,
  registrationPollConcurrency: 50,
  registrationLoginConcurrency: 6,
  registrationCertConcurrency: 6,
  registrationYydsQuotaBlockSeconds: 300,
  mysqlConnectionLimit: 100,
  mysqlQueueLimit: 0,
  restartRequiredKeys: [...RUNTIME_CONFIG_RESTART_REQUIRED_KEYS],
  updatedAt: 0
};

export function runtimeConfigDefaultsFromAppConfig(config: AppConfig): RuntimeConfigView {
  return normalizeRuntimeConfigInput({
    ...DEFAULT_RUNTIME_CONFIG,
    imageAllowVideoReserveFallback: config.imageAllowVideoReserveFallback,
    imageAccountWaitMs: config.imageAccountWaitMs,
    imageMaxPollAttempts: config.imageMaxPollAttempts,
    imagePollIntervalMs: config.imagePollIntervalMs,
    accountBalanceReconcileEnabled: config.accountBalanceReconcileEnabled,
    accountBalanceReconcileIntervalMinutes: config.accountBalanceReconcileIntervalMinutes,
    accountBalanceReconcileBatchSize: config.accountBalanceReconcileBatchSize,
    accountBalanceReconcileConcurrency: config.accountBalanceReconcileConcurrency,
    accountBalanceReconcileScope: config.accountBalanceReconcileScope,
    registrationConcurrency: config.registrationConcurrency,
    registrationMaxInFlight: config.registrationMaxInFlight,
    registrationMailboxCreateConcurrency: config.registrationMailboxCreateConcurrency,
    registrationMailboxCreatePerSecond: config.registrationMailboxCreatePerSecond,
    registrationVipSendConcurrency: config.registrationVipSendConcurrency,
    registrationPollConcurrency: config.registrationPollConcurrency,
    registrationLoginConcurrency: config.registrationLoginConcurrency,
    registrationCertConcurrency: config.registrationCertConcurrency,
    registrationYydsQuotaBlockSeconds: config.registrationYydsQuotaBlockSeconds,
    mysqlConnectionLimit: config.mysql.connectionLimit,
    mysqlQueueLimit: config.mysql.queueLimit,
    updatedAt: 0
  });
}

export function normalizeRuntimeConfigInput(input: RuntimeConfigUpdateInput, base: RuntimeConfigView = DEFAULT_RUNTIME_CONFIG): RuntimeConfigView {
  const next: RuntimeConfigView = { ...base };
  next.imageAllowVideoReserveFallback = boolInput(input.imageAllowVideoReserveFallback, next.imageAllowVideoReserveFallback);
  next.imageAccountWaitMs = intInput(input.imageAccountWaitMs, next.imageAccountWaitMs, 0, 300000);
  next.imageMaxPollAttempts = intInput(input.imageMaxPollAttempts, next.imageMaxPollAttempts, 1, 120);
  next.imagePollIntervalMs = intInput(input.imagePollIntervalMs, next.imagePollIntervalMs, 1000, 60000);
  next.imageSyncWaitBudgetMs = intInput(input.imageSyncWaitBudgetMs, next.imageSyncWaitBudgetMs, 0, 300000);
  next.videoCreateTimeoutMs = intInput(input.videoCreateTimeoutMs, next.videoCreateTimeoutMs, 5000, 300000);
  next.videoPollTimeoutMs = intInput(input.videoPollTimeoutMs, next.videoPollTimeoutMs, 5000, 300000);
  next.modelAccountWaitMs = intInput(input.modelAccountWaitMs, next.modelAccountWaitMs, 0, 120000);
  next.accountLeaseTtlMs = intInput(input.accountLeaseTtlMs, next.accountLeaseTtlMs, 60000, 3600000);
  next.accountBalanceReconcileEnabled = boolInput(input.accountBalanceReconcileEnabled, next.accountBalanceReconcileEnabled);
  next.accountBalanceReconcileIntervalMinutes = intInput(input.accountBalanceReconcileIntervalMinutes, next.accountBalanceReconcileIntervalMinutes, 1, 1440);
  next.accountBalanceReconcileBatchSize = intInput(input.accountBalanceReconcileBatchSize, next.accountBalanceReconcileBatchSize, 1, 10000);
  next.accountBalanceReconcileConcurrency = intInput(input.accountBalanceReconcileConcurrency, next.accountBalanceReconcileConcurrency, 1, 50);
  next.accountBalanceReconcileScope = scopeInput(input.accountBalanceReconcileScope, next.accountBalanceReconcileScope);
  next.registrationConcurrency = intInput(input.registrationConcurrency, next.registrationConcurrency, 1, 100);
  next.registrationMaxInFlight = intInput(input.registrationMaxInFlight, next.registrationMaxInFlight, 1, 500);
  next.registrationMailboxCreateConcurrency = intInput(input.registrationMailboxCreateConcurrency, next.registrationMailboxCreateConcurrency, 1, 50);
  next.registrationMailboxCreatePerSecond = intInput(input.registrationMailboxCreatePerSecond, next.registrationMailboxCreatePerSecond, 1, 100);
  next.registrationVipSendConcurrency = intInput(input.registrationVipSendConcurrency, next.registrationVipSendConcurrency, 1, 100);
  next.registrationPollConcurrency = intInput(input.registrationPollConcurrency, next.registrationPollConcurrency, 1, 500);
  next.registrationLoginConcurrency = intInput(input.registrationLoginConcurrency, next.registrationLoginConcurrency, 1, 100);
  next.registrationCertConcurrency = intInput(input.registrationCertConcurrency, next.registrationCertConcurrency, 1, 100);
  next.registrationYydsQuotaBlockSeconds = intInput(input.registrationYydsQuotaBlockSeconds, next.registrationYydsQuotaBlockSeconds, 1, 86400);
  next.mysqlConnectionLimit = intInput(input.mysqlConnectionLimit, next.mysqlConnectionLimit, 1, 1000);
  next.mysqlQueueLimit = intInput(input.mysqlQueueLimit, next.mysqlQueueLimit, 0, 100000);
  next.restartRequiredKeys = [...RUNTIME_CONFIG_RESTART_REQUIRED_KEYS];
  next.updatedAt = Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : next.updatedAt;
  return next;
}

function intInput(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function boolInput(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true;
}

function scopeInput(value: unknown, fallback: AccountBalanceReconcileScope): AccountBalanceReconcileScope {
  return value === "active" || value === "non_disabled" || value === "all" || value === "depleted" ? value : fallback;
}
```

- [ ] **Step 4: Refactor RuntimeConfigService to schema-backed config**

Replace `src/services/runtime-config-service.ts` with:

```ts
import type { RuntimeConfigStore } from "../store/runtime-config-store.js";
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfigInput,
  type RuntimeConfigUpdateInput,
  type RuntimeConfigView
} from "./runtime-config-schema.js";

export type { RuntimeConfigUpdateInput, RuntimeConfigView } from "./runtime-config-schema.js";

export class RuntimeConfigService {
  constructor(
    private readonly store: RuntimeConfigStore,
    private readonly defaults: RuntimeConfigView = DEFAULT_RUNTIME_CONFIG
  ) {}

  async get(): Promise<RuntimeConfigView> {
    const stored = await this.store.get();
    return normalizeRuntimeConfigInput(stored ?? {}, { ...this.defaults, updatedAt: stored?.updatedAt ?? 0 });
  }

  async update(input: RuntimeConfigUpdateInput): Promise<RuntimeConfigView> {
    const current = await this.get();
    const next = normalizeRuntimeConfigInput({ ...input, updatedAt: Date.now() }, current);
    return normalizeRuntimeConfigInput(await this.store.save(next), this.defaults);
  }

  async seedDefaultsIfEmpty(): Promise<RuntimeConfigView> {
    const stored = await this.store.get();
    if (stored) return this.get();
    return this.store.save({ ...this.defaults, updatedAt: Date.now() });
  }
}
```

- [ ] **Step 5: Persist full runtime config JSON**

Modify `src/store/runtime-config-store.ts`:

```ts
import type { RuntimeConfigView } from "../services/runtime-config-schema.js";
```

Change `save()` value JSON to persist the whole normalized object:

```ts
valueJson: JSON.stringify(config),
```

Change `fromRow()`:

```ts
function fromRow(row: RuntimeConfigRow): RuntimeConfigView {
  const parsed = parseValueJson(row.value_json);
  return {
    ...parsed,
    updatedAt: Number(row.updated_at)
  } as RuntimeConfigView;
}
```

- [ ] **Step 6: Keep env as first-run seed and bootstrap only**

Modify `src/config/env.ts` so these fields still load as safe first-run defaults:

```ts
registrationYydsQuotaBlockSeconds: number;
accountBalanceReconcileScope: AccountBalanceReconcileScope;
mysql.connectionLimit: number;
mysql.queueLimit: number;
```

Add parsers if missing:

```ts
function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseAccountBalanceReconcileScope(value: string | undefined): AccountBalanceReconcileScope {
  const normalized = value?.trim();
  if (normalized === "active" || normalized === "non_disabled" || normalized === "all" || normalized === "depleted") {
    return normalized;
  }
  return "depleted";
}
```

- [ ] **Step 7: Seed DB runtime config on startup and use it in scheduled reconcile**

In `src/index.ts`, import:

```ts
import { runtimeConfigDefaultsFromAppConfig } from "./services/runtime-config-schema.js";
```

Construct the service with schema defaults:

```ts
const runtimeConfigService = new RuntimeConfigService(runtimeConfigStore, runtimeConfigDefaultsFromAppConfig(config));
await runtimeConfigService.seedDefaultsIfEmpty();
```

Inside scheduled balance reconcile, read runtime config each tick:

```ts
const runtimeConfig = await runtimeConfigService.get();
if (!runtimeConfig.accountBalanceReconcileEnabled) return;
const result = await reconcileAccountBalances({
  accountService,
  vipClient,
  scope: runtimeConfig.accountBalanceReconcileScope,
  limit: runtimeConfig.accountBalanceReconcileBatchSize,
  concurrency: runtimeConfig.accountBalanceReconcileConcurrency,
  reactivatePositive: true
});
```

- [ ] **Step 8: Use runtime config in image account waiting and polling**

In `src/server/app.ts`, any route that currently uses `options.imageAccountWaitMs`, `options.imageMaxPollAttempts`, or `options.imagePollIntervalMs` must read `await runtimeConfigService.get()` for the new request and use:

```ts
runtimeConfig.imageAccountWaitMs
runtimeConfig.imageMaxPollAttempts
runtimeConfig.imagePollIntervalMs
runtimeConfig.imageSyncWaitBudgetMs
```

Existing `imageAllowVideoReserveFallback` stays runtime-driven.

- [ ] **Step 9: Expose visual runtime config page in navigation**

Modify `web/src/types.ts`:

```ts
export type PanelId = "accounts" | "chat" | "image" | "probe" | "video" | "yydsConfig" | "runtimeConfig";
```

Extend `RuntimeConfigView` in `web/src/types.ts` with all fields from `src/services/runtime-config-schema.ts`.

Modify `web/src/app/ConsoleShell.tsx`:

```tsx
import { Settings2 } from "lucide-react";
import { RuntimeConfigPanel } from "../panels/RuntimeConfigPanel";
```

Add config nav button:

```tsx
<NavButton active={activePanel === "runtimeConfig"} icon={<Settings2 size={17} />} onClick={() => onPanelChange("runtimeConfig")}>
  ????
</NavButton>
```

Add render branch:

```tsx
{activePanel === "runtimeConfig" && <RuntimeConfigPanel apiKey={apiKey} />}
```

- [ ] **Step 10: Replace RuntimeConfigPanel with full production controls**

Update `web/src/panels/RuntimeConfigPanel.tsx` to show editable cards for:

- ??/???`imageAllowVideoReserveFallback`, `imageAccountWaitMs`, `imageMaxPollAttempts`, `imagePollIntervalMs`, `imageSyncWaitBudgetMs`, `videoCreateTimeoutMs`, `videoPollTimeoutMs`?
- ?????`accountBalanceReconcileEnabled`, `accountBalanceReconcileScope`, `accountBalanceReconcileIntervalMinutes`, `accountBalanceReconcileBatchSize`, `accountBalanceReconcileConcurrency`?
- ??/YYDS?`registrationConcurrency`, `registrationMaxInFlight`, `registrationMailboxCreateConcurrency`, `registrationMailboxCreatePerSecond`, `registrationVipSendConcurrency`, `registrationPollConcurrency`, `registrationLoginConcurrency`, `registrationCertConcurrency`, `registrationYydsQuotaBlockSeconds`?
- ????`mysqlConnectionLimit`, `mysqlQueueLimit`??? `Alert` ????????? NavOS ???????

Use Ant Design `InputNumber`, `Select`, `Switch`, `Alert`, `Card`, and one primary save button. Save all fields with `PUT /api/runtime-config`.

- [ ] **Step 11: Add admin UI test for runtime config visibility**

Append to `tests/admin-app.test.tsx`:

```ts
it("shows visual runtime configuration controls", async () => {
  render(<App />);
  await signInAsAdmin();
  fireEvent.click(await screen.findByRole("button", { name: /????/ }));
  expect(await screen.findByText("??/????")).toBeInTheDocument();
  expect(screen.getByText("????" )).toBeInTheDocument();
  expect(screen.getByText("??? YYDS ??" )).toBeInTheDocument();
  expect(screen.getByText(/?? NavOS/)).toBeInTheDocument();
});
```

If helper names differ in the existing file, adapt the render/sign-in lines to existing test helpers but keep the assertions.

- [ ] **Step 12: Update env docs to explain visual config ownership**

Modify `.env.example` and `.env` comments:

```env
# ?????????????????????? MySQL runtime_config?
# ?? IMAGE_/ACCOUNT_BALANCE_/REGISTRATION_/MYSQL_CONNECTION_LIMIT ??????????????????
```

Keep existing env keys as seed values for local deploy compatibility, but do not add new business-only envs without a corresponding runtime-config field.

- [ ] **Step 13: Run focused runtime config verification**

Run:

```powershell
npm test -- tests/config.test.ts tests/admin-app.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 14: Commit**

Run only if committing is desired:

```powershell
git add src/services/runtime-config-schema.ts src/services/runtime-config-service.ts src/store/runtime-config-store.ts src/config/env.ts src/index.ts src/server/app.ts web/src/types.ts web/src/panels/RuntimeConfigPanel.tsx web/src/app/ConsoleShell.tsx tests/config.test.ts tests/admin-app.test.tsx .env.example .env
git commit -m "feat: add visual runtime configuration"
```

Expected: one runtime-config foundation commit.

---

### Task 2: Provider failure classifier

**Files:**
- Create: `src/services/provider-failure-classifier.ts`
- Create: `tests/provider-failure-classifier.test.ts`
- Modify: `src/server/app.ts`
- Test: `tests/provider-failure-classifier.test.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Create `tests/provider-failure-classifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyProviderException,
  classifyProviderResult,
  classifyProviderSseEvent,
  providerFailureIsAccountRetryable
} from "../src/services/provider-failure-classifier.js";

describe("provider failure classifier", () => {
  it("marks structured quota errors as quota_exhausted", () => {
    const decision = classifyProviderResult({
      status: 402,
      headers: new Headers(),
      body: { error: { message: "当前账号积分不足", type: "insufficient_balance" } }
    });

    expect(decision).toMatchObject({
      kind: "quota_exhausted",
      accountAction: "deplete",
      externalStatus: 503
    });
    expect(providerFailureIsAccountRetryable(decision)).toBe(true);
  });

  it("does not scan successful assistant text for quota keywords", () => {
    const decision = classifyProviderResult({
      status: 200,
      headers: new Headers(),
      body: { output_text: "用户问：insufficient_balance 是什么意思？" }
    });

    expect(decision.kind).toBe("success");
    expect(decision.accountAction).toBe("release");
  });

  it("classifies invalid credentials as disabled account", () => {
    expect(classifyProviderResult({
      status: 401,
      headers: new Headers(),
      body: { error: { message: "invalid token" } }
    })).toMatchObject({
      kind: "invalid_account",
      accountAction: "disable",
      externalStatus: 503
    });
  });

  it("classifies rate limit with retry-after", () => {
    const headers = new Headers({ "retry-after": "12" });
    expect(classifyProviderResult({
      status: 429,
      headers,
      body: { error: { message: "rate limit exceeded" } }
    })).toMatchObject({
      kind: "rate_limited",
      accountAction: "cooldown",
      externalStatus: 429,
      retryAfterSeconds: 12
    });
  });

  it("classifies user prompt errors without punishing the account", () => {
    expect(classifyProviderResult({
      status: 400,
      headers: new Headers(),
      body: { error: { message: "invalid image_url", type: "invalid_request_error" } }
    })).toMatchObject({
      kind: "user_error",
      accountAction: "release",
      externalStatus: 400
    });
  });

  it("classifies only SSE error events", () => {
    expect(classifyProviderSseEvent("event: message\ndata: {\"text\":\"insufficient_balance docs\"}\n\n")?.kind).toBeUndefined();
    expect(classifyProviderSseEvent("event: error\ndata: {\"error\":{\"message\":\"余额不足\"}}\n\n")).toMatchObject({
      kind: "quota_exhausted",
      accountAction: "deplete"
    });
  });

  it("classifies network exceptions as temporary", () => {
    expect(classifyProviderException(new Error("fetch failed"))).toMatchObject({
      kind: "temporary",
      accountAction: "cooldown",
      externalStatus: 502
    });
  });
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run:

```powershell
npm test -- tests/provider-failure-classifier.test.ts
```

Expected: fail with module not found for `provider-failure-classifier.js`.

- [ ] **Step 3: Implement classifier**

Create `src/services/provider-failure-classifier.ts`:

```ts
import type { ProviderResult } from "../protocols/http.js";

export type ProviderFailureKind =
  | "success"
  | "quota_exhausted"
  | "invalid_account"
  | "rate_limited"
  | "temporary"
  | "user_error";

export type ProviderAccountAction = "release" | "deplete" | "disable" | "cooldown";

export interface ProviderFailureDecision {
  kind: ProviderFailureKind;
  accountAction: ProviderAccountAction;
  externalStatus: number;
  message: string;
  retryAfterSeconds?: number;
}

export function classifyProviderResult(result: Pick<ProviderResult, "status" | "body" | "headers">): ProviderFailureDecision {
  if (result.status >= 200 && result.status < 400) {
    return successDecision();
  }

  const retryAfterSeconds = retryAfterFromHeaders(result.headers);
  const text = structuredErrorText(result.body, true) ?? statusText(result.status);
  return classifyErrorText(text, result.status, retryAfterSeconds);
}

export function classifyProviderException(error: unknown): ProviderFailureDecision {
  const message = error instanceof Error && error.message ? error.message : "Upstream request failed";
  return {
    kind: "temporary",
    accountAction: "cooldown",
    externalStatus: 502,
    message
  };
}

export function classifyProviderSseEvent(event: string): ProviderFailureDecision | undefined {
  const lines = event.split(/\r?\n/);
  const eventName = lines
    .map((line) => /^event:\s*(.+)$/i.exec(line)?.[1]?.trim().toLowerCase())
    .find(Boolean);
  const data = lines
    .map((line) => /^data:\s?(.*)$/i.exec(line)?.[1])
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .trim();

  if (!data || data === "[DONE]" || eventName !== "error") {
    return undefined;
  }

  try {
    return classifyErrorText(structuredErrorText(JSON.parse(data), true) ?? data, 500);
  } catch {
    return classifyErrorText(data, 500);
  }
}

export function providerFailureIsAccountRetryable(decision: ProviderFailureDecision): boolean {
  return decision.accountAction === "deplete"
    || decision.accountAction === "disable"
    || decision.accountAction === "cooldown";
}

export function providerFailureIsSuccess(decision: ProviderFailureDecision): boolean {
  return decision.kind === "success";
}

function successDecision(): ProviderFailureDecision {
  return {
    kind: "success",
    accountAction: "release",
    externalStatus: 200,
    message: "success"
  };
}

function classifyErrorText(text: string, status: number, retryAfterSeconds?: number): ProviderFailureDecision {
  if (/insufficient[_ -]?balance|quota[_ -]?exhausted|积分不足|余额不足|额度不足/i.test(text)) {
    return { kind: "quota_exhausted", accountAction: "deplete", externalStatus: 503, message: text };
  }
  if (/invalid.*token|token.*invalid|credential|unauthorized|authentication|banned|account.*disabled/i.test(text)) {
    return { kind: "invalid_account", accountAction: "disable", externalStatus: 503, message: text };
  }
  if (status === 429 || /rate.?limit|too many|temporarily unavailable|try again later/i.test(text)) {
    return { kind: "rate_limited", accountAction: "cooldown", externalStatus: 429, message: text, retryAfterSeconds };
  }
  if (status >= 400 && status < 500 && /invalid|bad request|unsupported|policy|content|prompt|image_url|parameter|参数/i.test(text)) {
    return { kind: "user_error", accountAction: "release", externalStatus: status, message: text };
  }
  return {
    kind: "temporary",
    accountAction: "cooldown",
    externalStatus: status >= 500 ? 502 : 503,
    message: text
  };
}

function structuredErrorText(value: unknown, forceErrorContext: boolean): string | undefined {
  if (typeof value === "string" && forceErrorContext) {
    return value;
  }
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const parts: string[] = [];
  const explicitError = value.error;
  if (typeof explicitError === "string") {
    parts.push(explicitError);
  } else if (isPlainRecord(explicitError)) {
    parts.push(...recordTextParts(explicitError));
  }

  const code = numberValue(value.code) ?? numberValue(value.status) ?? numberValue(value.status_code);
  const type = stringValue(value.type);
  const hasErrorContext = forceErrorContext
    || parts.length > 0
    || Boolean(type && /error|failed|failure/i.test(type))
    || (code !== undefined && code !== 0 && code !== 200);

  if (hasErrorContext) {
    parts.push(...recordTextParts(value));
    for (const key of ["data", "result"]) {
      const nested = structuredErrorText(value[key], true);
      if (nested) {
        parts.push(nested);
      }
    }
  }

  const unique = [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
  return unique.length > 0 ? unique.join(" ") : undefined;
}

function recordTextParts(record: Record<string, unknown>): string[] {
  const keys = ["message", "msg", "error_message", "type", "code", "error_code", "status", "status_code", "reason"];
  return keys.flatMap((key) => {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return [value];
    if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
    return [];
  });
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function statusText(status: number): string {
  return `upstream returned HTTP ${status}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
```

- [ ] **Step 4: Wire app to classifier**

Modify `src/server/app.ts`:

```ts
import {
  classifyProviderException,
  classifyProviderResult,
  classifyProviderSseEvent,
  type ProviderFailureDecision
} from "../services/provider-failure-classifier.js";
```

Replace local `ProviderFailureKind`, `ProviderFailureDecision`, `providerFailureDecisionFromText`, `providerFailureDecisionFromSseEvent`, and `providerExceptionResult` logic with calls to the new classifier. Keep `createProviderFailureDetectionStream`, but inside it call:

```ts
function firstProviderFailureDecisionFromSseEvents(events: string[] | string): ProviderFailureDecision | undefined {
  const list = typeof events === "string" ? [events] : events;
  for (const event of list) {
    const decision = classifyProviderSseEvent(event);
    if (decision) {
      return decision;
    }
  }
  return undefined;
}

function providerExceptionResult(error: unknown): ProviderResult {
  const decision = classifyProviderException(error);
  return {
    status: decision.externalStatus,
    body: { error: { message: decision.message, type: decision.kind } },
    headers: new Headers()
  };
}
```

Replace quota/invalid/temporary branches in `forwardModelRequestWithAccountRotation()` with:

```ts
const decision = classifyProviderResult(result);
if (decision.accountAction === "deplete") {
  await accountService.depleteAccount(auth.account.uid);
  continue;
}
if (decision.accountAction === "disable") {
  await accountService.disableAccount(auth.account.uid);
  continue;
}
if (decision.accountAction === "cooldown") {
  await accountService.cooldownAccount(auth.account.uid, decision.retryAfterSeconds ?? MODEL_PROXY_RETRY_COOLDOWN_SECONDS);
  continue;
}

await finalizeModelLease(auth, result);
return result;
```

Update `applyStreamedProviderFailure()`:

```ts
async function applyStreamedProviderFailure(uid: string, decision: ProviderFailureDecision): Promise<void> {
  if (decision.accountAction === "deplete") {
    await accountService.depleteAccount(uid);
    return;
  }
  if (decision.accountAction === "disable") {
    await accountService.disableAccount(uid);
    return;
  }
  if (decision.accountAction === "cooldown") {
    await accountService.cooldownAccount(uid, decision.retryAfterSeconds ?? MODEL_PROXY_RETRY_COOLDOWN_SECONDS);
  }
}
```

- [ ] **Step 5: Run classifier and model tests**

Run:

```powershell
npm test -- tests/provider-failure-classifier.test.ts tests/server.test.ts
```

Expected: all listed tests pass. If `tests/server.test.ts` has old expectations for status/type, update the expected public error to `quota_exhausted`, `invalid_account`, `rate_limited`, `temporary`, or `user_error`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/services/provider-failure-classifier.ts src/server/app.ts tests/provider-failure-classifier.test.ts tests/server.test.ts
git commit -m "fix: classify provider failures before account rotation"
```

Expected: one commit containing only classifier/app/test changes.

---

### Task 3: Scoped balance reconcile and scheduler config

**Files:**
- Modify: `src/services/account-balance-reconciler.ts`
- Modify: `src/server/app.ts`
- Modify: `src/config/env.ts`
- Modify: `src/index.ts`
- Modify: `tests/account-balance-reconciler.test.ts`
- Modify: `tests/server.test.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing reconcile scope tests**

Append to `tests/account-balance-reconciler.test.ts`:

```ts
it("checks non-disabled accounts and demotes active zero-balance accounts", async () => {
  const store = new InMemoryAccountStore();
  const accountService = new AccountService(store);
  await accountService.importAccount({ uid: "active-empty", token: "t1", balanceRemaining: 500, balanceTotal: 2000, status: "active" });
  await accountService.importAccount({ uid: "depleted-full", token: "t2", balanceRemaining: 0, balanceTotal: 2000, status: "depleted" });
  await accountService.importAccount({ uid: "disabled-full", token: "t3", balanceRemaining: 0, balanceTotal: 2000, status: "disabled" });

  const vipClient = {
    queryBalance: vi.fn(async (uid: string) => {
      if (uid === "active-empty") return { availableBalance: 0, totalBalance: 2000 };
      if (uid === "depleted-full") return { availableBalance: 1200, totalBalance: 2000 };
      return { availableBalance: 1900, totalBalance: 2000 };
    })
  };

  const result = await reconcileAccountBalances({
    accountService,
    vipClient,
    scope: "non_disabled",
    limit: 10,
    concurrency: 4,
    reactivatePositive: true
  });

  expect(result).toMatchObject({
    checked: 2,
    restored: 1,
    updatedActive: 1,
    stillDepleted: 0,
    failed: 0
  });
  expect(await store.get("active-empty")).toMatchObject({ status: "depleted", balanceRemaining: 0 });
  expect(await store.get("depleted-full")).toMatchObject({ status: "active", balanceRemaining: 1200 });
  expect(await store.get("disabled-full")).toMatchObject({ status: "disabled", balanceRemaining: 0 });
});

it("scope all updates disabled balances without enabling disabled accounts", async () => {
  const store = new InMemoryAccountStore();
  const accountService = new AccountService(store);
  await accountService.importAccount({ uid: "disabled", token: "td", balanceRemaining: 0, balanceTotal: 0, status: "disabled" });
  const vipClient = { queryBalance: vi.fn(async () => ({ availableBalance: 888, totalBalance: 999 })) };

  const result = await reconcileAccountBalances({
    accountService,
    vipClient,
    scope: "all",
    limit: 10,
    concurrency: 1,
    reactivatePositive: true
  });

  expect(result).toMatchObject({ checked: 1, disabledUpdated: 1, restored: 0 });
  expect(await store.get("disabled")).toMatchObject({ status: "disabled", balanceRemaining: 888, balanceTotal: 999 });
});
```

Change the import at the top:

```ts
import { reconcileAccountBalances, reconcileDepletedAccountBalances } from "../src/services/account-balance-reconciler.js";
```

- [ ] **Step 2: Verify reconcile tests fail**

Run:

```powershell
npm test -- tests/account-balance-reconciler.test.ts
```

Expected: fail because `reconcileAccountBalances` and new result fields do not exist.

- [ ] **Step 3: Replace reconciler implementation**

Replace `src/services/account-balance-reconciler.ts` with this structure:

```ts
import type { VipBalanceClient } from "../protocols/vip-client.js";
import type { AccountRecord, AccountStatus } from "../store/account-store.js";
import type { AccountService } from "./account-service.js";
import type { AccountBalanceReconcileScope } from "./runtime-config-schema.js";

export interface AccountBalanceReconcileOptions {
  accountService: AccountService;
  vipClient: VipBalanceClient;
  scope?: AccountBalanceReconcileScope;
  limit?: number;
  concurrency?: number;
  reactivatePositive?: boolean;
}

export interface AccountBalanceReconcileFailure {
  uid: string;
  message: string;
}

export interface AccountBalanceReconcileResult {
  checked: number;
  restored: number;
  stillDepleted: number;
  updatedActive: number;
  disabledUpdated: number;
  failed: number;
  failures: AccountBalanceReconcileFailure[];
}

export async function reconcileDepletedAccountBalances(
  options: AccountBalanceReconcileOptions
): Promise<AccountBalanceReconcileResult> {
  return reconcileAccountBalances({ ...options, scope: "depleted", reactivatePositive: true });
}

export async function reconcileAccountBalances(
  options: AccountBalanceReconcileOptions
): Promise<AccountBalanceReconcileResult> {
  const limit = normalizePositiveInt(options.limit, 1000);
  const concurrency = Math.min(normalizePositiveInt(options.concurrency, 5), 50);
  const scope = options.scope ?? "depleted";
  const candidates = (await options.accountService.listProviderAccounts())
    .filter((account) => accountMatchesScope(account.status, scope))
    .sort((a, b) => a.lastBalanceAt - b.lastBalanceAt || a.createdAt - b.createdAt)
    .slice(0, limit);

  const result: AccountBalanceReconcileResult = {
    checked: 0,
    restored: 0,
    stillDepleted: 0,
    updatedActive: 0,
    disabledUpdated: 0,
    failed: 0,
    failures: []
  };

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < candidates.length) {
      const account = candidates[nextIndex];
      nextIndex += 1;
      if (account) {
        await reconcileOne(account, options, result);
      }
    }
  }));

  return result;
}

function accountMatchesScope(status: AccountStatus, scope: AccountBalanceReconcileScope): boolean {
  if (scope === "all") return true;
  if (scope === "non_disabled") return status !== "disabled";
  return status === scope;
}

async function reconcileOne(
  account: AccountRecord,
  options: AccountBalanceReconcileOptions,
  result: AccountBalanceReconcileResult
): Promise<void> {
  try {
    const balance = await options.vipClient.queryBalance(account.uid, account.token);
    result.checked += 1;

    if (account.status === "disabled") {
      await options.accountService.updateBalance(account.uid, balance.availableBalance, balance.totalBalance);
      result.disabledUpdated += 1;
      return;
    }

    const before = account.status;
    await options.accountService.updateBalance(account.uid, balance.availableBalance, balance.totalBalance);
    if (before === "depleted" && balance.availableBalance > 0 && options.reactivatePositive !== false) {
      result.restored += 1;
      return;
    }
    if (balance.availableBalance <= 0) {
      result.stillDepleted += 1;
      return;
    }
    result.updatedActive += 1;
  } catch (error) {
    result.failed += 1;
    result.failures.push({
      uid: account.uid,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return fallback;
  }
  return value;
}
```

- [ ] **Step 4: Wire API request body scope**

Modify import in `src/server/app.ts`:

```ts
import {
  reconcileAccountBalances,
} from "../services/account-balance-reconciler.js";
import type { AccountBalanceReconcileScope } from "../services/runtime-config-schema.js";
```

Add helper near request body helpers:

```ts
function reconcileScopeInput(value: unknown): AccountBalanceReconcileScope {
  return value === "active" || value === "non_disabled" || value === "all" || value === "depleted"
    ? value
    : "depleted";
}
```

In `/api/accounts/balances/reconcile`, call:

```ts
const result = await reconcileAccountBalances({
  accountService,
  vipClient,
  scope: reconcileScopeInput(body.scope),
  limit: positiveIntegerInput(body.limit, 1000, 10_000),
  concurrency: positiveIntegerInput(body.concurrency, 10, 50),
  reactivatePositive: body.reactivatePositive !== false
});
```

- [ ] **Step 5: Keep reconcile scheduling runtime-config driven**

Task 1 already added `accountBalanceReconcileScope` as a first-run env seed and DB runtime-config field. After replacing the reconciler, make sure `src/index.ts` scheduled reconcile still reads current DB config on every tick instead of static env:

```ts
const runtimeConfig = await runtimeConfigService.get();
if (!runtimeConfig.accountBalanceReconcileEnabled) return;
const result = await reconcileAccountBalances({
  accountService,
  vipClient,
  scope: runtimeConfig.accountBalanceReconcileScope,
  limit: runtimeConfig.accountBalanceReconcileBatchSize,
  concurrency: runtimeConfig.accountBalanceReconcileConcurrency,
  reactivatePositive: true
});
```

- [ ] **Step 6: Update env docs only**

Do not make `.env` the admin control plane. Ensure `.env.example` and `.env` keep `ACCOUNT_BALANCE_RECONCILE_SCOPE=depleted` only as a first-run seed, with comments pointing admins to the web ?????? page.

- [ ] **Step 7: Run tests**

Run:

```powershell
npm test -- tests/account-balance-reconciler.test.ts tests/config.test.ts tests/server.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/services/account-balance-reconciler.ts src/server/app.ts src/config/env.ts src/index.ts tests/account-balance-reconciler.test.ts tests/server.test.ts tests/config.test.ts .env.example .env
git commit -m "feat: reconcile account balances by scope"
```

Expected: one commit for reconcile backend/config.

---

### Task 4: Admin frontend batch balance check and create-only registration primary flow

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/panels/AccountsPanel.tsx`
- Modify: `tests/admin-app.test.tsx`

- [ ] **Step 1: Write failing frontend tests**

In `tests/admin-app.test.tsx`, replace the old “distinguishes fill target” expectation with a create-first expectation:

```ts
it("starts create registration as the primary account-pool action", async () => {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/registration/jobs" && init?.method === "GET") return Response.json([]);
    if (path === "/api/registration/jobs" && init?.method === "POST") return Response.json({ jobId: "job-create" });
    if (path === "/api/registration/jobs/job-create") {
      return Response.json({
        id: "job-create",
        mode: "create",
        state: "succeeded",
        count: 100,
        concurrency: 6,
        progress: { started: 100, completed: 100, failed: 0, total: 100 },
        logs: [{ at: 1000, level: "info", message: "create registration completed" }],
        createdAt: 1000,
        finishedAt: 2000
      });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);

  renderAppWithAccounts();

  await userEvent.clear(screen.getByLabelText("新增数量"));
  await userEvent.type(screen.getByLabelText("新增数量"), "100");
  await userEvent.clear(screen.getByLabelText("任务并发"));
  await userEvent.type(screen.getByLabelText("任务并发"), "6");
  await userEvent.click(screen.getByRole("button", { name: "新增注册" }));

  const postCall = fetchMock.mock.calls.find(([path, init]) => path === "/api/registration/jobs" && init?.method === "POST");
  expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ mode: "create", count: 100, concurrency: 6 });
  expect(screen.queryByRole("button", { name: "补齐账号池" })).not.toBeInTheDocument();
});

it("runs batch balance reconcile from the account panel", async () => {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/registration/jobs" && init?.method === "GET") return Response.json([]);
    if (path === "/api/accounts/balances/reconcile" && init?.method === "POST") {
      return Response.json({ checked: 3, restored: 1, stillDepleted: 1, updatedActive: 1, disabledUpdated: 0, failed: 0, failures: [] });
    }
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetchMock);

  renderAppWithAccounts();

  await userEvent.selectOptions(screen.getByLabelText("余额检查范围"), "non_disabled");
  await userEvent.click(screen.getByRole("button", { name: "批量检查余额" }));

  const call = fetchMock.mock.calls.find(([path, init]) => path === "/api/accounts/balances/reconcile" && init?.method === "POST");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ scope: "non_disabled", limit: 1000, concurrency: 10, reactivatePositive: true });
  expect(await screen.findByText(/已检查 3 个账号/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify frontend tests fail**

Run:

```powershell
npm test -- tests/admin-app.test.tsx
```

Expected: fail because the batch balance UI does not exist and fill button is still visible.

- [ ] **Step 3: Add frontend types**

Append to `web/src/types.ts`:

```ts
export type BalanceReconcileScope = "depleted" | "active" | "non_disabled" | "all";

export interface BalanceReconcileResult {
  checked: number;
  restored: number;
  stillDepleted: number;
  updatedActive: number;
  disabledUpdated: number;
  failed: number;
  failures: Array<{ uid: string; message: string }>;
}
```

- [ ] **Step 4: Update AccountsPanel state and handler**

Modify imports in `web/src/panels/AccountsPanel.tsx`:

```ts
import type {
  AccountListItem,
  BalanceReconcileResult,
  BalanceReconcileScope,
  RegistrationJobMode,
  RegistrationJobView,
  StatusState
} from "../types";
```

Remove `fillTarget` state from the main flow. Add balance reconcile state:

```ts
const [createCount, setCreateCount] = useState(100);
const [jobConcurrency, setJobConcurrency] = useState(6);
const [balanceScope, setBalanceScope] = useState<BalanceReconcileScope>("depleted");
const [balanceLimit, setBalanceLimit] = useState(1000);
const [balanceConcurrency, setBalanceConcurrency] = useState(10);
const [balanceReconcileResult, setBalanceReconcileResult] = useState<BalanceReconcileResult | undefined>();
const [batchBalanceRefreshing, setBatchBalanceRefreshing] = useState(false);
```

Keep `startRegistrationJob(mode)` compatible with `"single"` and `"create"`; remove the visible fill button. Add:

```ts
async function reconcileBalances() {
  setBatchBalanceRefreshing(true);
  setStatus({ kind: "loading", message: "批量检查余额中" });
  try {
    const result = await apiRequest<BalanceReconcileResult>(apiKey, "/api/accounts/balances/reconcile", {
      method: "POST",
      body: JSON.stringify({
        scope: balanceScope,
        limit: balanceLimit,
        concurrency: balanceConcurrency,
        reactivatePositive: true
      })
    });
    setBalanceReconcileResult(result);
    await onRefresh();
    setStatus({ kind: "ok", message: `已检查 ${result.checked} 个账号，恢复 ${result.restored} 个，失败 ${result.failed} 个` });
  } catch (error) {
    setStatus({ kind: "error", message: errorMessage(error) ?? "批量检查余额失败" });
  } finally {
    setBatchBalanceRefreshing(false);
  }
}
```

- [ ] **Step 5: Replace registration and balance JSX**

Replace the registration controls in `AccountsPanel.tsx` with:

```tsx
<div className="registration-ops" aria-label="注册任务">
  <div className="form-row two compact">
    <label className="text-field ant-field">
      <span>新增数量</span>
      <InputNumber
        aria-label="新增数量"
        max={10000}
        min={1}
        value={createCount}
        onChange={(value) => setCreateCount(clampJobNumber(value, 1, 10000))}
      />
    </label>
    <label className="text-field ant-field">
      <span>任务并发</span>
      <InputNumber
        aria-label="任务并发"
        max={100}
        min={1}
        value={jobConcurrency}
        onChange={(value) => setJobConcurrency(clampJobNumber(value, 1, 100))}
      />
    </label>
  </div>
  <div className="toolbar flush">
    <AntButton icon={<Play size={16} />} type="primary" onClick={() => void startRegistrationJob("create")}>
      新增注册
    </AntButton>
    <AntButton icon={<Play size={16} />} onClick={() => void startRegistrationJob("single")}>
      启动单个注册
    </AntButton>
    {job && !registrationJobIsTerminal(job) && (
      <AntButton icon={<Square size={16} />} onClick={() => void cancelRegistrationJob()}>
        取消任务
      </AntButton>
    )}
    {job && registrationJobIsTerminal(job) && (
      <AntButton onClick={closeRegistrationJobResult}>
        关闭任务结果
      </AntButton>
    )}
  </div>
</div>
```

Add a balance reconcile block below the panel header:

```tsx
<div className="registration-ops" aria-label="批量余额检查">
  <div className="form-row three compact">
    <label className="text-field">
      <span>余额检查范围</span>
      <select aria-label="余额检查范围" value={balanceScope} onChange={(event) => setBalanceScope(event.target.value as BalanceReconcileScope)}>
        <option value="depleted">只查耗尽</option>
        <option value="active">只查 active</option>
        <option value="non_disabled">查非停用</option>
        <option value="all">查全部</option>
      </select>
    </label>
    <label className="text-field ant-field">
      <span>检查数量</span>
      <InputNumber aria-label="检查数量" min={1} max={10000} value={balanceLimit} onChange={(value) => setBalanceLimit(clampJobNumber(value, 1, 10000))} />
    </label>
    <label className="text-field ant-field">
      <span>检查并发</span>
      <InputNumber aria-label="检查并发" min={1} max={50} value={balanceConcurrency} onChange={(value) => setBalanceConcurrency(clampJobNumber(value, 1, 50))} />
    </label>
  </div>
  <div className="toolbar flush">
    <AntButton icon={<RefreshCw size={16} />} loading={batchBalanceRefreshing} onClick={() => void reconcileBalances()}>
      批量检查余额
    </AntButton>
  </div>
  {balanceReconcileResult && (
    <p className="status">
      已检查 {balanceReconcileResult.checked} 个账号，恢复 {balanceReconcileResult.restored} 个，仍耗尽 {balanceReconcileResult.stillDepleted} 个，
      active 更新 {balanceReconcileResult.updatedActive} 个，disabled 更新 {balanceReconcileResult.disabledUpdated} 个，失败 {balanceReconcileResult.failed} 个
    </p>
  )}
</div>
```

- [ ] **Step 6: Run frontend tests**

Run:

```powershell
npm test -- tests/admin-app.test.tsx
```

Expected: all admin-app tests pass after updating old fill-specific assertions.

- [ ] **Step 7: Commit**

Run:

```powershell
git add web/src/types.ts web/src/panels/AccountsPanel.tsx tests/admin-app.test.tsx
git commit -m "feat: add batch balance reconcile UI"
```

Expected: one frontend commit.

---

### Task 5: Public image contract and no local image storage

**Files:**
- Modify: `src/protocols/image.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/image.test.ts`
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Write failing image tests**

Append to `tests/image.test.ts`:

```ts
import { normalizeOpenAIImageData, imageResponseToDisplayResults } from "../src/protocols/image.js";

it("keeps b64_json in public OpenAI b64_json responses", () => {
  expect(normalizeOpenAIImageData({ data: [{ b64_json: "aGVsbG8=" }] }, "b64_json")).toEqual([
    { b64_json: "aGVsbG8=" }
  ]);
});

it("keeps remote URLs in public OpenAI url responses", () => {
  expect(normalizeOpenAIImageData({ data: [{ url: "https://oss.test/image.png" }] }, "url")).toEqual([
    { url: "https://oss.test/image.png" }
  ]);
});

it("uses display data URLs only for admin display helpers", () => {
  expect(imageResponseToDisplayResults({ data: [{ b64_json: "aGVsbG8=" }] })).toEqual([
    { url: "data:image/png;base64,aGVsbG8=" }
  ]);
});

it("prefers extracted image data even when task status says failed", async () => {
  const result = normalizePolledImageTaskForTest({
    status: 200,
    headers: new Headers(),
    body: { status: "failed", error: "late status bug", data: [{ url: "https://oss.test/ok.png" }] }
  }, "task-ok", "url");

  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ data: [{ url: "https://oss.test/ok.png" }] });
});
```

Export a test-only wrapper by making `normalizePolledImageTask()` public as `normalizePolledImageTaskForTest` or by testing through `pollImageTask()` with a fake `ProviderHttpClient`. Prefer direct export:

```ts
export { normalizePolledImageTask as normalizePolledImageTaskForTest };
```

- [ ] **Step 2: Verify image tests fail**

Run:

```powershell
npm test -- tests/image.test.ts
```

Expected: fail because `normalizeOpenAIImageData`, `imageResponseToDisplayResults`, and success precedence are missing.

- [ ] **Step 3: Split image normalizers**

Modify `src/protocols/image.ts`:

```ts
export type ImageResponseFormat = "url" | "b64_json";

export interface OpenAIImageUrlItem {
  url: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface OpenAIImageB64Item {
  b64_json: string;
  sizeBytes?: number;
  sha256?: string;
}

export type OpenAIImageItem = OpenAIImageUrlItem | OpenAIImageB64Item;

export function normalizeOpenAIImageData(response: unknown, responseFormat: ImageResponseFormat): OpenAIImageItem[] {
  return collectImageItems(response)
    .map((item) => normalizeOneOpenAIImageItem(item, responseFormat))
    .filter((item): item is OpenAIImageItem => item !== undefined);
}

export function imageResponseToDisplayResults(response: unknown): ImageGenerationResult[] {
  return collectImageItems(response)
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const record = item as Record<string, unknown>;
      const result: ImageGenerationResult = { url: "" };
      if (typeof record.b64_json === "string" && record.b64_json) {
        result.url = `data:image/png;base64,${record.b64_json}`;
      } else if (typeof record.url === "string" && record.url) {
        result.url = record.url;
      } else {
        return undefined;
      }
      copyNumber(record, result, "sizeBytes", "sizeBytes");
      copyNumber(record, result, "size_bytes", "sizeBytes");
      copyString(record, result, "sha256", "sha256");
      return result;
    })
    .filter((item): item is ImageGenerationResult => item !== undefined);
}

export const imageResponseToResults = imageResponseToDisplayResults;

function normalizeOneOpenAIImageItem(item: unknown, responseFormat: ImageResponseFormat): OpenAIImageItem | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (responseFormat === "b64_json") {
    if (typeof record.b64_json !== "string" || !record.b64_json) return undefined;
    const result: OpenAIImageB64Item = { b64_json: record.b64_json };
    copyNumber(record, result as never, "sizeBytes", "sizeBytes");
    copyNumber(record, result as never, "size_bytes", "sizeBytes");
    copyString(record, result as never, "sha256", "sha256");
    return result;
  }
  if (typeof record.url !== "string" || !record.url) return undefined;
  const result: OpenAIImageUrlItem = { url: record.url };
  copyNumber(record, result as never, "sizeBytes", "sizeBytes");
  copyNumber(record, result as never, "size_bytes", "sizeBytes");
  copyString(record, result as never, "sha256", "sha256");
  return result;
}
```

- [ ] **Step 4: Preserve requested response_format**

Change `buildImageGenerationPayload()` signature:

```ts
export interface BuildImageGenerationPayloadOptions {
  defaultResponseFormat?: ImageResponseFormat;
}

export function buildImageGenerationPayload(
  body: Record<string, unknown>,
  options: BuildImageGenerationPayloadOptions = {}
): Record<string, unknown> {
  const responseFormat = normalizeResponseFormat(readString(body.response_format), options.defaultResponseFormat ?? "b64_json");
  // keep existing prompt/quality/size/n/reference logic
  return omitUndefined({
    model: readString(body.model)?.trim() || DEFAULT_IMAGE_MODEL,
    prompt,
    n,
    quality,
    size,
    response_format: responseFormat,
    output_format: readString(body.output_format)?.trim() || "png",
    background: readString(body.background)?.trim() || undefined,
    images: references.length > 0 ? references : undefined
  });
}

function normalizeResponseFormat(value: string | undefined, fallback: ImageResponseFormat): ImageResponseFormat {
  return value === "url" || value === "b64_json" ? value : fallback;
}
```

- [ ] **Step 5: Make poll success prefer outputs**

Change `pollCreatedImageTask()` to pass response format:

```ts
const responseFormat = normalizeResponseFormat(typeof payload.response_format === "string" ? payload.response_format : undefined, "b64_json");
const polled = await pollImageTask(client, taskId, pollBasePath, headers, responseFormat);
```

Change `pollImageTask()` and `normalizePolledImageTask()`:

```ts
export async function pollImageTask(
  client: ProviderHttpClient,
  taskId: string,
  pollBasePath: ImageTaskPollPath,
  headers: Record<string, string>,
  responseFormat: ImageResponseFormat = "b64_json"
): Promise<ProviderResult> {
  const polled = await client.requestJson("GET", `${pollBasePath}/${encodeURIComponent(taskId)}`, undefined, headers);
  if (polled.status < 200 || polled.status >= 300) return polled;
  return normalizePolledImageTask(polled, taskId, responseFormat);
}

function normalizePolledImageTask(polled: ProviderResult, taskId: string, responseFormat: ImageResponseFormat): ProviderResult {
  const results = normalizeOpenAIImageData(polled.body, responseFormat);
  if (results.length > 0) {
    return {
      ...polled,
      status: 200,
      body: {
        created: Math.floor(Date.now() / 1000),
        status: "succeeded",
        task_id: taskId,
        id: taskId,
        data: results
      }
    };
  }

  const status = readTaskStatus(polled.body);
  if (status === "succeeded" || status === "success" || status === "completed") {
    return {
      ...polled,
      status: 502,
      body: { error: { message: "Image task succeeded but no image output returned", type: "image_output_missing" } }
    };
  }
  if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
    return {
      ...polled,
      status: 500,
      body: { error: { message: readMessage(polled.body) ?? "Image task failed", type: "server_error" }, task_id: taskId, id: taskId }
    };
  }
  return {
    ...polled,
    status: 202,
    body: { created: Math.floor(Date.now() / 1000), status: "running", task_id: taskId, id: taskId, data: [] }
  };
}
```

- [ ] **Step 6: Wire public endpoint default to url**

Modify `src/server/app.ts`:

```ts
interface ImageGenerationHandleOptions {
  defaultResponseFormat?: "url" | "b64_json";
}

async function handleImageGeneration(
  request: FastifyRequest,
  reply: FastifyReply,
  handleOptions: ImageGenerationHandleOptions = {}
): Promise<void> {
  const payload = buildImageGenerationPayload(bodyRecord(request), {
    defaultResponseFormat: handleOptions.defaultResponseFormat ?? "b64_json"
  });
  // keep existing lease/retry logic
}
```

Call admin route with default b64:

```ts
await handleImageGeneration(request, reply, { defaultResponseFormat: "b64_json" });
```

Call public route with default url:

```ts
await handleImageGeneration(request, reply, { defaultResponseFormat: "url" });
```

When polling an existing image task, infer response format from `existingTask.raw` if possible:

```ts
const responseFormat = readStoredImageResponseFormat(existingTask.raw) ?? "url";
const result = await pollImageTask(client, params.taskId, existingTask.pollPath, headers, responseFormat);
```

Add helper:

```ts
function readStoredImageResponseFormat(raw: unknown): "url" | "b64_json" | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as Record<string, unknown>).response_format;
  return value === "url" || value === "b64_json" ? value : undefined;
}
```

- [ ] **Step 7: Run image/server tests**

Run:

```powershell
npm test -- tests/image.test.ts tests/server.test.ts
```

Expected: all listed tests pass and no response contains `cosUrl`, `cosKey`, `archiveStatus`, or `archiveError`.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/protocols/image.ts src/server/app.ts tests/image.test.ts tests/server.test.ts
git commit -m "fix: preserve public image response format"
```

Expected: one commit for image contract.

---

### Task 6: MySQL pool first-run seed, visual restart hint, and indexes

**Files:**
- Create: `src/store/mysql-config.ts`
- Modify: `src/config/env.ts`
- Modify: all MySQL store files listed in file map
- Modify: `.env.example`
- Modify: `.env`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Append to `tests/config.test.ts`:

```ts
it("loads MySQL pool limits as first-run env seed", () => {
  const config = loadConfig({
    MASTER_API_KEY: "master",
    PUBLIC_PROXY_API_KEYS: "public",
    PROVIDER_BASE_URL: "https://provider.test",
    VIP_HMAC_SECRET: "secret",
    MYSQL_CONNECTION_LIMIT: "100",
    MYSQL_QUEUE_LIMIT: "500"
  });

  expect(config.mysql.connectionLimit).toBe(100);
  expect(config.mysql.queueLimit).toBe(500);
});
```

- [ ] **Step 2: Verify config test fails**

Run:

```powershell
npm test -- tests/config.test.ts
```

Expected: fail because `connectionLimit` and `queueLimit` are not in the bootstrap MySQL config seed yet.

- [ ] **Step 3: Add shared MySQL config helper**

Create `src/store/mysql-config.ts`:

```ts
import mysql, { type Pool } from "mysql2/promise";

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  queueLimit: number;
}

export function createMysqlPool(config: MysqlConfig): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: config.queueLimit,
    namedPlaceholders: true
  });
}
```

- [ ] **Step 4: Update bootstrap env seed config**

Modify `src/config/env.ts`:

```ts
import type { MysqlConfig as MysqlEnvConfig } from "../store/mysql-config.js";
```

Remove the local `MysqlEnvConfig` interface. In `loadConfig().mysql` add:

```ts
connectionLimit: parsePositiveInt(env.MYSQL_CONNECTION_LIMIT, 100),
queueLimit: parseNonNegativeInt(env.MYSQL_QUEUE_LIMIT, 0)
```

- [ ] **Step 5: Replace hard-coded pool limits**

In every MySQL store, replace `mysql.createPool({ ... connectionLimit: 10 ... })` with:

```ts
import { createMysqlPool, type MysqlConfig } from "./mysql-config.js";
```

and constructor body:

```ts
constructor(config: MysqlConfig) {
  this.pool = createMysqlPool(config);
}
```

For `src/store/mysql-account-store.ts`, keep `mysql.createConnection()` for `createDatabaseIfMissing()`, but import the `MysqlConfig` type from `mysql-config.ts` instead of exporting it from account store.

- [ ] **Step 6: Add account index migration**

In `src/store/mysql-account-store.ts`, after column migrations in `ensureSchema()`:

```ts
await this.addIndexIfMissing(
  "idx_accounts_lease_pick",
  "CREATE INDEX idx_accounts_lease_pick ON accounts(status, rate_limited_until, lease_until, balance_remaining, last_used_at, created_at)"
);
await this.addIndexIfMissing(
  "idx_accounts_health",
  "CREATE INDEX idx_accounts_health ON accounts(status, last_balance_at, rate_limited_until)"
);
```

Add method:

```ts
private async addIndexIfMissing(indexName: string, ddl: string): Promise<void> {
  const [rows] = await this.pool.execute<RowDataPacket[]>(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts' AND INDEX_NAME = :indexName
     LIMIT 1`,
    { indexName }
  );
  if (rows.length === 0) {
    await this.pool.query(ddl);
  }
}
```

- [ ] **Step 7: Add task/domain indexes**

In `src/store/image-task-store.ts`, add after `CREATE TABLE`:

```ts
await this.addIndexIfMissing(
  "idx_image_tasks_account_updated",
  "CREATE INDEX idx_image_tasks_account_updated ON image_tasks(account_uid, updated_at)"
);
```

In `src/store/video-task-store.ts`, add:

```ts
await this.addIndexIfMissing(
  "idx_video_tasks_account_updated",
  "CREATE INDEX idx_video_tasks_account_updated ON video_tasks(account_uid, updated_at)"
);
```

In `src/store/yyds-domain-pool-store.ts`, add:

```ts
await this.addIndexIfMissing(
  "idx_yyds_domain_health_pick",
  "CREATE INDEX idx_yyds_domain_health_pick ON yyds_domain_health(status, cooldown_until, weight, last_success_at, last_failure_at)"
);
```

Use the same `INFORMATION_SCHEMA.STATISTICS` method with each table name.

- [ ] **Step 8: Update env docs as first-run seed only**

Add these values to `.env.example` and `.env` as first-run/restart seed values, with comments that normal admin changes happen in ??????:

```env
MYSQL_CONNECTION_LIMIT=100
MYSQL_QUEUE_LIMIT=0
```

- [ ] **Step 9: Run config and typecheck**

Run:

```powershell
npm test -- tests/config.test.ts
npm run typecheck
```

Expected: tests pass and both server/web TypeScript typechecks pass.

- [ ] **Step 10: Commit**

Run:

```powershell
git add src/store/mysql-config.ts src/store/mysql-account-store.ts src/store/image-task-store.ts src/store/video-task-store.ts src/store/runtime-config-store.ts src/store/yyds-domain-pool-store.ts src/store/yyds-mail-config-store.ts src/config/env.ts tests/config.test.ts .env.example .env
git commit -m "feat: configure mysql pools and production indexes"
```

Expected: one DB config/index commit; MySQL pool values are visible in runtime config and take full effect after restart.

---

### Task 7: Redis-backed YYDS mailbox create limiter with visual runtime defaults

**Files:**
- Create: `src/services/registration-mailbox-limiter.ts`
- Create: `tests/registration-mailbox-limiter.test.ts`
- Modify: `src/services/registration-service.ts`
- Modify: `src/config/env.ts`
- Modify: `src/index.ts`
- Modify: `tests/registration-service.test.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write limiter tests**

Create `tests/registration-mailbox-limiter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { RedisRegistrationMailboxLimiter } from "../src/services/registration-mailbox-limiter.js";

class FakeRedis {
  values = new Map<string, string>();
  ttls = new Map<string, number>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string, mode?: string, expiryMode?: string, ttlMs?: number) {
    if (mode === "NX" && this.values.has(key)) return null;
    this.values.set(key, value);
    if (expiryMode === "PX" && ttlMs) this.ttls.set(key, ttlMs);
    return "OK";
  }
  async incr(key: string) {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }
  async decr(key: string) {
    const next = Number(this.values.get(key) ?? "0") - 1;
    this.values.set(key, String(next));
    return next;
  }
  async expire() { return 1; }
  async pttl(key: string) { return this.ttls.get(key) ?? -1; }
}

describe("RedisRegistrationMailboxLimiter", () => {
  it("blocks mailbox create while quota fuse is active", async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRegistrationMailboxLimiter({
      redis,
      keyPrefix: "navos",
      concurrency: 2,
      perSecond: 2,
      sleep: async () => undefined
    });

    await limiter.blockQuota(30);
    await expect(limiter.run(() => Promise.resolve("ok"))).rejects.toThrow("YYDS mailbox quota exhausted");
  });

  it("runs work and releases slot", async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRegistrationMailboxLimiter({
      redis,
      keyPrefix: "navos",
      concurrency: 1,
      perSecond: 100,
      sleep: async () => undefined
    });

    await expect(limiter.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(redis.values.get("navos:registration:mailbox:create:inflight")).toBe("0");
  });
});
```

- [ ] **Step 2: Verify limiter tests fail**

Run:

```powershell
npm test -- tests/registration-mailbox-limiter.test.ts
```

Expected: fail with module not found.

- [ ] **Step 3: Implement limiter**

Create `src/services/registration-mailbox-limiter.ts`:

```ts
export interface RegistrationMailboxLimiterRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, nx: "NX", px: "PX", ttlMs: number): Promise<"OK" | null>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

export interface RegistrationMailboxLimiterOptions {
  redis: RegistrationMailboxLimiterRedis;
  keyPrefix: string;
  concurrency: number;
  perSecond: number;
  quotaBlockSeconds?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class RedisRegistrationMailboxLimiter {
  private readonly redis: RegistrationMailboxLimiterRedis;
  private readonly keyPrefix: string;
  private readonly concurrency: number;
  private readonly minIntervalMs: number;
  private readonly quotaBlockSeconds: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RegistrationMailboxLimiterOptions) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix.replace(/:+$/, "");
    this.concurrency = Math.max(1, options.concurrency);
    this.minIntervalMs = Math.ceil(1000 / Math.max(1, options.perSecond));
    this.quotaBlockSeconds = Math.max(1, options.quotaBlockSeconds ?? 300);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.assertQuotaOpen();
    await this.acquireSlot();
    try {
      await this.acquireQpsGate();
      return await work();
    } finally {
      await this.redis.decr(this.inflightKey());
    }
  }

  async blockQuota(seconds: number = this.quotaBlockSeconds): Promise<void> {
    await this.redis.set(this.quotaKey(), String(Date.now() + seconds * 1000), "NX", "PX", seconds * 1000);
  }

  private async assertQuotaOpen(): Promise<void> {
    const blockedUntil = await this.redis.get(this.quotaKey());
    if (blockedUntil) {
      throw new Error("YYDS mailbox quota exhausted; registration is temporarily paused");
    }
  }

  private async acquireSlot(): Promise<void> {
    while (true) {
      await this.assertQuotaOpen();
      const count = await this.redis.incr(this.inflightKey());
      await this.redis.expire(this.inflightKey(), 60);
      if (count <= this.concurrency) return;
      await this.redis.decr(this.inflightKey());
      await this.sleep(100);
    }
  }

  private async acquireQpsGate(): Promise<void> {
    while (true) {
      const acquired = await this.redis.set(this.qpsKey(), String(Date.now()), "NX", "PX", this.minIntervalMs);
      if (acquired === "OK") return;
      const ttl = await this.redis.pttl(this.qpsKey());
      await this.sleep(ttl > 0 ? ttl : this.minIntervalMs);
    }
  }

  private inflightKey(): string {
    return `${this.keyPrefix}:registration:mailbox:create:inflight`;
  }

  private qpsKey(): string {
    return `${this.keyPrefix}:registration:mailbox:create:qps`;
  }

  private quotaKey(): string {
    return `${this.keyPrefix}:registration:yyds:quota_exhausted_until`;
  }
}
```

- [ ] **Step 4: Wire limiter into RegistrationService**

Modify `src/services/registration-service.ts`:

```ts
import type { RedisRegistrationMailboxLimiter } from "./registration-mailbox-limiter.js";
```

Add to `RegistrationServiceOptions`:

```ts
mailboxLimiter?: RedisRegistrationMailboxLimiter;
```

Add private field and constructor assignment:

```ts
private readonly mailboxLimiter?: RedisRegistrationMailboxLimiter;
// constructor:
this.mailboxLimiter = options.mailboxLimiter;
```

Change `createMailboxInThrottledSlot()` final call:

```ts
const create = async () => await (await this.resolveYydsClient()).createMailbox(domain ? { domain } : undefined);
return this.mailboxLimiter ? await this.mailboxLimiter.run(create) : await create();
```

In `createMailboxWithRetry()` catch block, when error is quota exhausted:

```ts
if (error instanceof YydsMailError && error.failureKind === "quota_exhausted") {
  await this.mailboxLimiter?.blockQuota(error.retryAfterSeconds ?? 300);
  throw error;
}
```

- [ ] **Step 5: Wire runtime config/index**

Task 1 already added `registrationYydsQuotaBlockSeconds` as a first-run env seed and runtime-config field. Confirm `.env.example` and `.env` keep `REGISTRATION_YYDS_QUOTA_BLOCK_SECONDS=300` only as a first-run seed, and expose the live value in the web ?????? page.

In `src/index.ts`:

```ts
import Redis from "ioredis";
import { RedisRegistrationMailboxLimiter } from "./services/registration-mailbox-limiter.js";
```

Before `new RegistrationService()`:

```ts
const limiterRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const mailboxLimiter = new RedisRegistrationMailboxLimiter({
  redis: limiterRedis,
  keyPrefix: config.queuePrefix,
  concurrency: (await runtimeConfigService.get()).registrationMailboxCreateConcurrency,
  perSecond: (await runtimeConfigService.get()).registrationMailboxCreatePerSecond,
  quotaBlockSeconds: (await runtimeConfigService.get()).registrationYydsQuotaBlockSeconds
});
```

Pass into service:

```ts
mailboxLimiter,
mailboxMinIntervalMs: Math.ceil(1000 / Math.max(1, (await runtimeConfigService.get()).registrationMailboxCreatePerSecond))
```

Close Redis in `onClose`:

```ts
await limiterRedis.quit();
```

- [ ] **Step 6: Run limiter and registration tests**

Run:

```powershell
npm test -- tests/registration-mailbox-limiter.test.ts tests/registration-service.test.ts tests/config.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/services/registration-mailbox-limiter.ts src/services/registration-service.ts src/config/env.ts src/index.ts tests/registration-mailbox-limiter.test.ts tests/registration-service.test.ts tests/config.test.ts .env.example .env
git commit -m "feat: limit yyds mailbox creation globally"
```

Expected: one registration limiter commit.

---

### Task 8: Local Sub2Api-chain load harness and real-account mode

**Files:**
- Create: `scripts/load/fake-navos-provider.ts`
- Create: `scripts/load/sub2api-chain-load-test.ts`
- Create: `scripts/load/run-local-sub2api-chain.ps1`
- Modify: `package.json`
- Output: `docs/diagnostics/YYYY-MM-DD-sub2api-chain-load-report.md`

- [ ] **Step 1: Add package scripts**

Modify `package.json` scripts:

```json
"load:fake-provider": "tsx scripts/load/fake-navos-provider.ts",
"load:sub2api-chain": "tsx scripts/load/sub2api-chain-load-test.ts"
```

- [ ] **Step 2: Implement fake upstream for protocol smoke only**

This fake upstream exists to prove the test runner, streaming parser, report writer, and Sub2Api entry path are wired. It is not a production-readiness load result.

Create `scripts/load/fake-navos-provider.ts` with routes:

```ts
import Fastify from "fastify";

const app = Fastify({ logger: true });
const port = Number(process.env.FAKE_PROVIDER_PORT ?? 19088);
const delayMs = Number(process.env.FAKE_PROVIDER_DELAY_MS ?? 80);
let imagePolls = new Map<string, number>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post("/v1/chat/completions", async (_request, reply) => {
  await sleep(delayMs);
  await reply.send({ id: "chatcmpl_fake", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });
});

app.post("/v1/responses", async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  if (body.stream === true) {
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    for (let i = 0; i < 5; i += 1) {
      reply.raw.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: `chunk-${i}` })}\n\n`);
      await sleep(20);
    }
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
    return reply;
  }
  await sleep(delayMs);
  await reply.send({ id: "resp_fake", object: "response", output_text: "ok" });
});

app.post("/v1/messages", async (_request, reply) => {
  await sleep(delayMs);
  await reply.send({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] });
});

app.post("/api/tasks/navos-gpt-image-t2i", async (_request, reply) => {
  const id = `img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  imagePolls.set(id, 0);
  await reply.send({ code: 200, data: { task_id: id } });
});

app.get("/api/tasks/image/generations/:taskId", async (request, reply) => {
  const taskId = (request.params as { taskId: string }).taskId;
  const count = (imagePolls.get(taskId) ?? 0) + 1;
  imagePolls.set(taskId, count);
  if (count < 2) {
    await reply.send({ status: "running", data: [] });
    return;
  }
  await reply.send({ status: "succeeded", data: [{ url: `https://fake-oss.local/${taskId}.png`, b64_json: "aGVsbG8=" }] });
});

app.post("/api/tasks/navos-gpt-image-i2i", async (_request, reply) => {
  const id = `edit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  imagePolls.set(id, 0);
  await reply.send({ code: 200, data: { task_id: id } });
});

app.get("/api/tasks/image/edits/:taskId", async (request, reply) => {
  const taskId = (request.params as { taskId: string }).taskId;
  await reply.send({ status: "succeeded", data: [{ url: `https://fake-oss.local/${taskId}.png` }] });
});

app.listen({ host: "127.0.0.1", port });
```

- [ ] **Step 3: Implement load runner**

Create `scripts/load/sub2api-chain-load-test.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

interface Scenario {
  name: string;
  concurrency: number;
  requests: number;
  build: () => { path: string; body: unknown };
}

const baseUrl = (process.env.SUB2API_BASE_URL ?? "http://127.0.0.1:18080/v1").replace(/\/+$/, "");
const apiKey = process.env.SUB2API_API_KEY ?? "sk-local-openai-zgm2003";
const concurrencyCsv = (process.env.LOAD_CONCURRENCY ?? "100").split(",").map((item) => Number(item.trim())).filter(Number.isFinite);
const mode = process.env.LOAD_MODE ?? "real";

const scenarios: Scenario[] = concurrencyCsv.flatMap((concurrency) => [
  {
    name: `chat-${concurrency}`,
    concurrency,
    requests: concurrency,
    build: () => ({ path: "/chat/completions", body: { model: "gpt-5.5", messages: [{ role: "user", content: "ping" }] } })
  },
  {
    name: `responses-stream-${concurrency}`,
    concurrency,
    requests: concurrency,
    build: () => ({ path: "/responses", body: { model: "codex", input: "ping", stream: true } })
  },
  {
    name: `image-t2i-${Math.min(concurrency, 100)}`,
    concurrency: Math.min(concurrency, 100),
    requests: Math.min(concurrency, 100),
    build: () => ({ path: "/images/generations", body: { model: "gpt-image-2", prompt: "load test cat", response_format: "url" } })
  }
]);

async function runScenario(scenario: Scenario) {
  const latencies: number[] = [];
  let success = 0;
  let clientError = 0;
  let serverError = 0;
  let timeout = 0;
  let next = 0;

  async function worker() {
    while (next < scenario.requests) {
      next += 1;
      const { path, body } = scenario.build();
      const start = performance.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Number(process.env.LOAD_TIMEOUT_MS ?? 180000));
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);
        latencies.push(performance.now() - start);
        if (response.status >= 200 && response.status < 400) success += 1;
        else if (response.status >= 400 && response.status < 500) clientError += 1;
        else serverError += 1;
        await response.arrayBuffer();
      } catch {
        timeout += 1;
        latencies.push(performance.now() - start);
      }
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: scenario.concurrency }, worker));
  const elapsedMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const percentile = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
  return {
    name: scenario.name,
    total: scenario.requests,
    success,
    clientError,
    serverError,
    timeout,
    rps: Number((scenario.requests / (elapsedMs / 1000)).toFixed(2)),
    p50: Math.round(percentile(0.50)),
    p95: Math.round(percentile(0.95)),
    p99: Math.round(percentile(0.99))
  };
}

const results = [];
if (mode !== "real" && mode !== "fake") {
  throw new Error("LOAD_MODE must be real or fake");
}
for (const scenario of scenarios) {
  results.push(await runScenario(scenario));
}

await mkdir("docs/diagnostics", { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const markdown = [
  `# Sub2Api Chain Load Report ${date}`,
  "",
  `Base URL: ${baseUrl}`,
  `Mode: ${mode}`,
  "",
  "| scenario | total | success | 4xx | 5xx | timeout | rps | p50 ms | p95 ms | p99 ms |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((r) => `| ${r.name} | ${r.total} | ${r.success} | ${r.clientError} | ${r.serverError} | ${r.timeout} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} |`)
].join("\n");

const path = `docs/diagnostics/${date}-sub2api-chain-load-report.md`;
await writeFile(path, markdown, "utf8");
console.log(markdown);
console.log(`report=${path}`);
```

- [ ] **Step 4: Implement PowerShell wrapper**

Create `scripts/load/run-local-sub2api-chain.ps1`:

```powershell
param(
  [string]$Sub2ApiBaseUrl = "http://127.0.0.1:18080/v1",
  [string]$Sub2ApiApiKey = "sk-local-openai-zgm2003",
  [string]$Concurrency = "100,300,1000"
)

$ErrorActionPreference = "Stop"
$env:SUB2API_BASE_URL = $Sub2ApiBaseUrl
$env:SUB2API_API_KEY = $Sub2ApiApiKey
$env:LOAD_CONCURRENCY = $Concurrency

Write-Host "Running Sub2Api chain load test against $Sub2ApiBaseUrl"
npm run load:sub2api-chain
```

- [ ] **Step 5: Run harness against local Sub2Api**

Start local services separately:

```powershell
npm run load:fake-provider
npm run dev
```

Start local Sub2Api from its local directory with Windows-safe timezone:

```powershell
cd E:\Sub2Api
$env:TZ='UTC'
.\sub2api.exe
```

Run load test from `E:\navos-new`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\load\run-local-sub2api-chain.ps1 -Concurrency "100"
```

Expected: report file under `docs/diagnostics/` with non-empty table.

- [ ] **Step 6: Run mandatory real-account smoke through Sub2Api**

Set `PROVIDER_BASE_URL` to the real NavOS upstream, keep local NavOS and local Sub2Api in the chain, and use a Sub2Api API key bound to the real NavOS channel:

```powershell
$env:LOAD_MODE = "real"
$env:SUB2API_BASE_URL = "http://127.0.0.1:18080/v1"
$env:SUB2API_API_KEY = "sk-local-openai-zgm2003"
$env:LOAD_CONCURRENCY = "20"
npm run load:sub2api-chain
```

Expected:

- The report says `Mode: real`.
- Requests are routed through `http://127.0.0.1:18080/v1`.
- NavOS uses real imported accounts.
- Any `quota_exhausted` internal account is marked depleted and skipped.
- The test is considered a smoke only because concurrency is 20.

- [ ] **Step 7: Run staged real-account load**

Only run this after the account pool has enough active accounts for the target branch. Use real accounts because fake upstream cannot reveal real balance, timeout, provider polling, and upstream policy behavior:

```powershell
$env:LOAD_MODE = "real"
$env:SUB2API_BASE_URL = "http://127.0.0.1:18080/v1"
$env:SUB2API_API_KEY = "sk-local-openai-zgm2003"
powershell -ExecutionPolicy Bypass -File scripts\load\run-local-sub2api-chain.ps1 -Concurrency "100"
powershell -ExecutionPolicy Bypass -File scripts\load\run-local-sub2api-chain.ps1 -Concurrency "300"
powershell -ExecutionPolicy Bypass -File scripts\load\run-local-sub2api-chain.ps1 -Concurrency "1000"
```

Expected:

- Reports are written under `docs/diagnostics/`.
- `timeout`, `5xx`, and depleted counts are visible per scenario.
- If a branch fails at high concurrency, stop increasing concurrency and fix that branch before continuing.

- [ ] **Step 8: Commit**

Run:

```powershell
git add scripts/load/fake-navos-provider.ts scripts/load/sub2api-chain-load-test.ts scripts/load/run-local-sub2api-chain.ps1 package.json docs/diagnostics
git commit -m "test: add local sub2api chain load harness"
```

Expected: one test harness commit.

---

### Task 9: Verification matrix and real-account load-test gates

**Files:**
- Output: `docs/diagnostics/YYYY-MM-DD-sub2api-chain-load-report.md`
- Output: `docs/diagnostics/YYYY-MM-DD-sql-explain-report.md`

- [ ] **Step 1: Run targeted unit suites**

Run:

```powershell
npm test -- tests/provider-failure-classifier.test.ts tests/account-balance-reconciler.test.ts tests/image.test.ts tests/registration-mailbox-limiter.test.ts tests/config.test.ts tests/admin-app.test.tsx
```

Expected: all listed suites pass.

- [ ] **Step 2: Run full test and build**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected:

```text
Test Files  ... passed
```

`npm run typecheck` exits 0 and `npm run build` exits 0.

- [ ] **Step 3: Run local Sub2Api smoke before high concurrency**

Run through Sub2Api, not NavOS direct:

```powershell
$headers = @{ Authorization = "Bearer sk-local-openai-zgm2003"; "Content-Type" = "application/json" }
$body = @{ model = "gpt-5.5"; messages = @(@{ role = "user"; content = "ping" }) } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri "http://127.0.0.1:18080/v1/chat/completions" -Headers $headers -Method Post -Body $body
```

Expected: a normal OpenAI-compatible response. If it returns `INSUFFICIENT_BALANCE`, check both Sub2Api `api_keys.quota` and `users.balance` before changing NavOS code.

- [ ] **Step 4: Run staged real-account load**

Run:

```powershell
$env:LOAD_MODE = "real"
powershell -ExecutionPolicy Bypass -File scripts\load\run-local-sub2api-chain.ps1 -Concurrency "100"
powershell -ExecutionPolicy Bypass -File scripts\load\run-local-sub2api-chain.ps1 -Concurrency "300"
powershell -ExecutionPolicy Bypass -File scripts\load\run-local-sub2api-chain.ps1 -Concurrency "1000"
```

Expected:

- Process stays alive.
- No lease double-book test failure.
- `5xx` is not a snowball caused by one depleted account.
- Timeout count is explained by configured timeout, not permanent hanging.
- Real accounts are consumed and real upstream polling paths are exercised; fake-mode reports do not satisfy this gate.

- [ ] **Step 5: Record SQL explain**

Against local/test MySQL, run and save results:

```sql
EXPLAIN SELECT * FROM accounts
WHERE status = 'active'
  AND rate_limited_until <= 0
  AND lease_until <= 0
  AND balance_remaining >= 0
ORDER BY last_used_at ASC, created_at ASC
LIMIT 1
FOR UPDATE;

EXPLAIN SELECT * FROM image_tasks WHERE status = 'running' ORDER BY updated_at ASC LIMIT 100;
EXPLAIN SELECT * FROM video_tasks WHERE status = 'running' ORDER BY updated_at ASC LIMIT 100;
EXPLAIN SELECT * FROM yyds_domain_health WHERE status IN ('active','cooldown') ORDER BY weight DESC LIMIT 100;
```

Write `docs/diagnostics/YYYY-MM-DD-sql-explain-report.md` with:

```md
# SQL Explain Report

| query | key used | rows | notes |
|---|---|---:|---|
| account lease | idx_accounts_lease_pick |  |  |
| image running | idx_image_tasks_status |  |  |
| video running | idx_video_tasks_status |  |  |
| yyds domain pick | idx_yyds_domain_health_pick |  |  |
```

- [ ] **Step 6: Final local verification commit**

Run:

```powershell
git add docs/diagnostics
git commit -m "docs: record local sub2api chain verification"
```

Expected: diagnostics commit exists only after reports are real.

---

## Definition of Done

- One depleted internal NavOS account is marked depleted and skipped without killing the Sub2Api upstream.
- Structured quota, invalid credential, rate limit, temporary, and user errors have different account actions.
- Batch balance check is available in the web account panel with scope, limit, concurrency, and result summary.
- `disabled` accounts are never auto-enabled by reconcile.
- Public `/v1/images/generations` respects `response_format: "url"` and `response_format: "b64_json"`.
- Image task output wins over a misleading failed status when usable URL/base64 exists.
- No COS fields and no local image file storage are added.
- Registration primary UI is “新增注册 N 个”; “补齐账号池” is not a main action.
- MySQL pool limits are visible in runtime config, env-seeded for first boot, and key indexes exist.
- YYDS mailbox create has Redis-backed global concurrency/QPS/quota fuse and visual runtime defaults.
- Runtime configuration page exposes image/video timeouts, balance reconcile, registration concurrency, YYDS limiter, and MySQL pool settings; `.env` is no longer the normal admin control plane.
- Local Sub2Api-chain reports exist for staged concurrency, were generated through `http://127.0.0.1:18080/v1`, and include `Mode: real`.

## Execution recommendation

Use subagent-driven execution per task, because Tasks 1, 2, 3, 5, 6, 7, and 8 touch mostly independent files and can be reviewed separately. Do not run real-account high concurrency until Tasks 1-6 pass focused tests and the real-account smoke at concurrency 20 succeeds.
