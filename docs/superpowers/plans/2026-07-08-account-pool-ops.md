# Account Pool Operations Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Redis/BullMQ-backed registration jobs and account-pool UI controls so admins can start, monitor, cancel, and review registration work without long HTTP requests.

**Architecture:** Introduce a small queue boundary around BullMQ so route tests and worker tests run without Redis. Fastify routes create and read queue jobs; a worker process runs existing `RegistrationService` work and writes progress snapshots. The React account-pool panel creates jobs, polls snapshots with backoff, and refreshes accounts when jobs finish.

**Tech Stack:** Node.js, Fastify, TypeScript, BullMQ, Redis, React, Vitest, Testing Library.

---

## File Structure

- Modify `package.json` and `package-lock.json` to add `bullmq` and `ioredis`.
- Modify `.env.example` with Redis and registration job settings.
- Modify `src/config/env.ts` to parse Redis and job settings.
- Modify `tests/config.test.ts` to cover new settings.
- Create `src/services/registration-job-types.ts` for shared job payload, state, progress, log, and snapshot types.
- Create `src/services/registration-job-service.ts` for route-facing job operations independent of BullMQ implementation details.
- Create `src/services/bullmq-registration-queue.ts` for BullMQ Queue integration.
- Create `src/services/registration-worker.ts` for worker processing and cancellation checks.
- Create `tests/registration-job-service.test.ts` with an in-memory queue fake.
- Create `tests/registration-worker.test.ts` with mocked `RegistrationService`.
- Modify `src/server/app.ts` to expose job routes.
- Modify `tests/server.test.ts` to verify job route auth and behavior.
- Modify `src/index.ts` to create Redis/BullMQ queue and worker and close them on shutdown.
- Modify `web/src/types.ts` to add registration job UI types.
- Create `web/src/lib/registration-job.ts` for job normalization and state helpers.
- Create `web/src/lib/polling.ts` for reusable polling delay logic.
- Modify `web/src/panels/AccountsPanel.tsx` to add job controls and status.
- Modify `tests/admin-app.test.tsx` and `tests/web-lib.test.ts` for UI and helper coverage.

---

## Task 1: Dependencies And Config

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `src/config/env.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Install queue dependencies**

Run:

```bash
npm install bullmq ioredis
```

Expected: `package.json` contains `bullmq` and `ioredis` under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Write failing config test**

In `tests/config.test.ts`, extend the first test input and assertions:

```ts
const config = loadConfig({
  MASTER_API_KEY: "sk-test",
  PROVIDER_BASE_URL: "https://upstream.test",
  PROVIDER_ACCOUNT_UID: "u1",
  PROVIDER_ACCOUNT_TOKEN: "t1",
  YYDS_MAIL_API_KEY: "ac-test",
  YYDS_MAIL_BASE_URL: "https://mail.test/v1",
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: "3307",
  MYSQL_USER: "root",
  MYSQL_PASSWORD: "root",
  MYSQL_DATABASE: "navos_test",
  VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
  REDIS_URL: "redis://127.0.0.1:6380",
  QUEUE_PREFIX: "navos-test",
  REGISTRATION_JOB_CONCURRENCY: "3",
  REGISTRATION_JOB_REMOVE_ON_COMPLETE: "25",
  REGISTRATION_JOB_REMOVE_ON_FAIL: "75"
});

expect(config.redisUrl).toBe("redis://127.0.0.1:6380");
expect(config.queuePrefix).toBe("navos-test");
expect(config.registrationJobConcurrency).toBe(3);
expect(config.registrationJobRemoveOnComplete).toBe(25);
expect(config.registrationJobRemoveOnFail).toBe(75);
```

- [ ] **Step 3: Run config test and verify it fails**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL because `redisUrl`, `queuePrefix`, `registrationJobConcurrency`, `registrationJobRemoveOnComplete`, and `registrationJobRemoveOnFail` do not exist on `AppConfig`.

- [ ] **Step 4: Implement config parsing**

In `src/config/env.ts`, extend `AppConfig`:

```ts
  redisUrl: string;
  queuePrefix: string;
  registrationJobConcurrency: number;
  registrationJobRemoveOnComplete: number;
  registrationJobRemoveOnFail: number;
```

In `loadConfig`, add:

```ts
    redisUrl: env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    queuePrefix: env.QUEUE_PREFIX?.trim() || "navos",
    registrationJobConcurrency: parsePositiveInt(env.REGISTRATION_JOB_CONCURRENCY, 2),
    registrationJobRemoveOnComplete: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_COMPLETE, 50),
    registrationJobRemoveOnFail: parsePositiveInt(env.REGISTRATION_JOB_REMOVE_ON_FAIL, 100)
```

In `.env.example`, add:

```env
REDIS_URL=redis://127.0.0.1:6379
QUEUE_PREFIX=navos
REGISTRATION_JOB_CONCURRENCY=2
REGISTRATION_JOB_REMOVE_ON_COMPLETE=50
REGISTRATION_JOB_REMOVE_ON_FAIL=100
```

- [ ] **Step 5: Run config test and verify it passes**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json package-lock.json .env.example src/config/env.ts tests/config.test.ts
git commit -m "feat(config): add registration queue settings"
```

---

## Task 2: Queue Types And Job Service

**Files:**
- Create: `src/services/registration-job-types.ts`
- Create: `src/services/registration-job-service.ts`
- Create: `tests/registration-job-service.test.ts`

- [ ] **Step 1: Create failing job service tests**

Create `tests/registration-job-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RegistrationJobService, type RegistrationQueuePort } from "../src/services/registration-job-service.js";
import type { RegistrationJobSnapshot, RegistrationJobState } from "../src/services/registration-job-types.js";

class FakeRegistrationQueue implements RegistrationQueuePort {
  readonly jobs = new Map<string, RegistrationJobSnapshot>();
  private nextId = 1;

  async add(data: { mode: "single" } | { mode: "fill"; target: number; concurrency: number }): Promise<string> {
    const id = `job-${this.nextId++}`;
    this.jobs.set(id, {
      id,
      mode: data.mode,
      state: "queued",
      target: data.mode === "fill" ? data.target : undefined,
      concurrency: data.mode === "fill" ? data.concurrency : undefined,
      progress: { started: 0, completed: 0, failed: 0, total: data.mode === "fill" ? data.target : 1 },
      logs: [],
      createdAt: 1000
    });
    return id;
  }

  async get(id: string): Promise<RegistrationJobSnapshot | undefined> {
    return this.jobs.get(id);
  }

  async list(): Promise<RegistrationJobSnapshot[]> {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async cancel(id: string): Promise<RegistrationJobSnapshot | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next: RegistrationJobSnapshot = { ...job, state: "canceled" as RegistrationJobState, finishedAt: 2000 };
    this.jobs.set(id, next);
    return next;
  }
}

describe("RegistrationJobService", () => {
  it("creates single and fill jobs with validation", async () => {
    const queue = new FakeRegistrationQueue();
    const service = new RegistrationJobService(queue, {
      defaultTarget: 8,
      defaultConcurrency: 2
    });

    await expect(service.createJob({ mode: "fill", target: 0, concurrency: 2 })).rejects.toThrow(/target/);
    await expect(service.createJob({ mode: "fill", target: 8, concurrency: 0 })).rejects.toThrow(/concurrency/);

    const single = await service.createJob({ mode: "single" });
    const fill = await service.createJob({ mode: "fill" });

    expect(single).toEqual({ jobId: "job-1" });
    expect(fill).toEqual({ jobId: "job-2" });
    expect(await service.getJob("job-2")).toMatchObject({
      id: "job-2",
      mode: "fill",
      target: 8,
      concurrency: 2
    });
  });

  it("lists and cancels jobs", async () => {
    const service = new RegistrationJobService(new FakeRegistrationQueue(), {
      defaultTarget: 5,
      defaultConcurrency: 1
    });

    const created = await service.createJob({ mode: "single" });
    expect(await service.listJobs()).toHaveLength(1);

    const canceled = await service.cancelJob(created.jobId);
    expect(canceled).toMatchObject({ id: created.jobId, state: "canceled" });
    await expect(service.cancelJob("missing")).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run job service test and verify it fails**

Run:

```bash
npm test -- tests/registration-job-service.test.ts
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Add shared job types**

Create `src/services/registration-job-types.ts`:

```ts
export type RegistrationJobMode = "single" | "fill";
export type RegistrationJobState = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type RegistrationJobCreateInput =
  | { mode: "single" }
  | { mode: "fill"; target?: number; concurrency?: number };

export type RegistrationJobPayload =
  | { mode: "single"; cancelRequested?: boolean }
  | { mode: "fill"; target: number; concurrency: number; cancelRequested?: boolean };

export interface RegistrationJobProgress {
  started: number;
  completed: number;
  failed: number;
  total: number;
}

export interface RegistrationJobLog {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RegistrationJobSnapshot {
  id: string;
  mode: RegistrationJobMode;
  state: RegistrationJobState;
  target?: number;
  concurrency?: number;
  progress: RegistrationJobProgress;
  logs: RegistrationJobLog[];
  results?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface RegistrationJobCreateResponse {
  jobId: string;
}
```

- [ ] **Step 4: Add route-facing job service**

Create `src/services/registration-job-service.ts`:

```ts
import type {
  RegistrationJobCreateResponse,
  RegistrationJobCreateInput,
  RegistrationJobPayload,
  RegistrationJobSnapshot
} from "./registration-job-types.js";

export interface RegistrationQueuePort {
  add(data: RegistrationJobPayload): Promise<string>;
  get(id: string): Promise<RegistrationJobSnapshot | undefined>;
  list(): Promise<RegistrationJobSnapshot[]>;
  cancel(id: string): Promise<RegistrationJobSnapshot | undefined>;
}

export class RegistrationJobNotFoundError extends Error {
  constructor() {
    super("registration job not found");
  }
}

export class RegistrationQueueUnavailableError extends Error {
  constructor(message = "registration queue unavailable") {
    super(message);
  }
}

export interface RegistrationJobServiceOptions {
  defaultTarget: number;
  defaultConcurrency: number;
}

export interface RegistrationJobServicePort {
  createJob(input: RegistrationJobCreateInput): Promise<RegistrationJobCreateResponse>;
  getJob(id: string): Promise<RegistrationJobSnapshot | undefined>;
  listJobs(): Promise<RegistrationJobSnapshot[]>;
  cancelJob(id: string): Promise<RegistrationJobSnapshot>;
}

export class RegistrationJobService implements RegistrationJobServicePort {
  constructor(
    private readonly queue: RegistrationQueuePort,
    private readonly options: RegistrationJobServiceOptions
  ) {}

  async createJob(input: RegistrationJobCreateInput): Promise<RegistrationJobCreateResponse> {
    const payload = this.normalizePayload(input);
    return { jobId: await this.queue.add(payload) };
  }

  async getJob(id: string): Promise<RegistrationJobSnapshot | undefined> {
    return this.queue.get(id);
  }

  async listJobs(): Promise<RegistrationJobSnapshot[]> {
    return this.queue.list();
  }

  async cancelJob(id: string): Promise<RegistrationJobSnapshot> {
    const snapshot = await this.queue.cancel(id);
    if (!snapshot) {
      throw new RegistrationJobNotFoundError();
    }
    return snapshot;
  }

  private normalizePayload(input: RegistrationJobCreateInput): RegistrationJobPayload {
    if (input.mode === "single") {
      return { mode: "single" };
    }
    const target = input.target ?? this.options.defaultTarget;
    const concurrency = input.concurrency ?? this.options.defaultConcurrency;
    if (!Number.isInteger(target) || target < 1 || target > 500) {
      throw new Error("target must be an integer from 1 to 500");
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      throw new Error("concurrency must be an integer from 1 to 20");
    }
    return { mode: "fill", target, concurrency };
  }
}
```

- [ ] **Step 5: Run job service test and verify it passes**

Run:

```bash
npm test -- tests/registration-job-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/services/registration-job-types.ts src/services/registration-job-service.ts tests/registration-job-service.test.ts
git commit -m "feat(registration): add job service abstraction"
```

---

## Task 3: BullMQ Queue Adapter

**Files:**
- Create: `src/services/bullmq-registration-queue.ts`
- Create: `tests/bullmq-registration-queue.test.ts`

- [ ] **Step 1: Write failing adapter tests with mocked BullMQ**

Create `tests/bullmq-registration-queue.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationJobSnapshot } from "../src/services/registration-job-types.js";

const bullmqMocks = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  getJobs: vi.fn(),
  updateData: vi.fn()
}));

const redisMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn()
}));

const { add, getJob, getJobs, updateData } = bullmqMocks;
const { set: redisSet } = redisMocks;

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add, getJob, getJobs, close: vi.fn() }))
}));

vi.mock("ioredis", () => ({
  default: vi.fn(() => ({ get: redisMocks.get, set: redisMocks.set, del: redisMocks.del, quit: vi.fn() }))
}));

describe("BullmqRegistrationQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds jobs and maps BullMQ jobs to snapshots", async () => {
    add.mockResolvedValue({ id: "job-1" });
    getJob.mockResolvedValue({
      id: "job-1",
      name: "registration",
      data: { mode: "single" },
      progress: { started: 0, completed: 0, failed: 0, total: 1, logs: [] },
      returnvalue: { success: true },
      failedReason: undefined,
      timestamp: 1000,
      processedOn: 1100,
      finishedOn: 1200,
      getState: vi.fn(async () => "completed")
    });

    const { BullmqRegistrationQueue } = await import("../src/services/bullmq-registration-queue.js");
    const queue = new BullmqRegistrationQueue({
      redisUrl: "redis://127.0.0.1:6379",
      queuePrefix: "navos",
      removeOnComplete: 50,
      removeOnFail: 100
    });

    expect(await queue.add({ mode: "single" })).toBe("job-1");
    expect(add).toHaveBeenCalledWith("registration", { mode: "single" }, {
      removeOnComplete: 50,
      removeOnFail: 100
    });

    const snapshot = await queue.get("job-1");
    expect(snapshot).toMatchObject<Partial<RegistrationJobSnapshot>>({
      id: "job-1",
      mode: "single",
      state: "succeeded",
      results: { success: true }
    });
  });

  it("records cancellation requests for running jobs", async () => {
    getJob.mockResolvedValue({
      id: "job-2",
      data: { mode: "fill", target: 3, concurrency: 1 },
      progress: { started: 1, completed: 1, failed: 0, total: 3, logs: [] },
      timestamp: 1000,
      getState: vi.fn(async () => "active"),
      updateData
    });

    const { BullmqRegistrationQueue } = await import("../src/services/bullmq-registration-queue.js");
    const queue = new BullmqRegistrationQueue({
      redisUrl: "redis://127.0.0.1:6379",
      queuePrefix: "navos",
      removeOnComplete: 50,
      removeOnFail: 100
    });

    const canceled = await queue.cancel("job-2");
    expect(redisSet).toHaveBeenCalledWith("navos:registration:cancel:job-2", "1", "EX", 86400);
    expect(updateData).toHaveBeenCalledWith({ mode: "fill", target: 3, concurrency: 1, cancelRequested: true });
    expect(canceled).toMatchObject({ id: "job-2", state: "running" });
  });
});
```

- [ ] **Step 2: Run adapter test and verify it fails**

Run:

```bash
npm test -- tests/bullmq-registration-queue.test.ts
```

Expected: FAIL because `src/services/bullmq-registration-queue.ts` does not exist.

- [ ] **Step 3: Implement BullMQ adapter**

Create `src/services/bullmq-registration-queue.ts`:

```ts
import { Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import {
  RegistrationQueueUnavailableError,
  type RegistrationQueuePort
} from "./registration-job-service.js";
import type {
  RegistrationJobPayload,
  RegistrationJobProgress,
  RegistrationJobSnapshot,
  RegistrationJobState,
  RegistrationJobLog
} from "./registration-job-types.js";

export interface BullmqRegistrationQueueOptions {
  redisUrl: string;
  queuePrefix: string;
  removeOnComplete: number;
  removeOnFail: number;
}

type BullmqRegistrationProgress = RegistrationJobProgress & {
  logs?: RegistrationJobLog[];
};

export class BullmqRegistrationQueue implements RegistrationQueuePort {
  readonly queue: Queue<RegistrationJobPayload>;
  private readonly connection: IORedis;
  private readonly cancelConnection: IORedis;
  private readonly removeOnComplete: number;
  private readonly removeOnFail: number;
  private readonly queuePrefix: string;

  constructor(options: BullmqRegistrationQueueOptions) {
    this.queuePrefix = options.queuePrefix;
    this.removeOnComplete = options.removeOnComplete;
    this.removeOnFail = options.removeOnFail;
    this.connection = new IORedis(options.redisUrl, { maxRetriesPerRequest: null });
    this.cancelConnection = new IORedis(options.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<RegistrationJobPayload>("registration", {
      prefix: options.queuePrefix,
      connection: this.connection
    });
  }

  async add(data: RegistrationJobPayload): Promise<string> {
    try {
      const job = await this.queue.add("registration", data, {
        removeOnComplete: this.removeOnComplete,
        removeOnFail: this.removeOnFail
      });
      return String(job.id);
    } catch (error) {
      throw new RegistrationQueueUnavailableError(error instanceof Error ? error.message : undefined);
    }
  }

  async get(id: string): Promise<RegistrationJobSnapshot | undefined> {
    const job = await this.queue.getJob(id);
    return job ? snapshotFromJob(job) : undefined;
  }

  async list(): Promise<RegistrationJobSnapshot[]> {
    const jobs = await this.queue.getJobs(["waiting", "active", "completed", "failed", "delayed"], 0, 20, false);
    return Promise.all(jobs.map(snapshotFromJob));
  }

  async cancel(id: string): Promise<RegistrationJobSnapshot | undefined> {
    const job = await this.queue.getJob(id);
    if (!job) return undefined;
    const state = await job.getState();
    if (state === "waiting" || state === "delayed") {
      await job.remove();
      return canceledSnapshot(job);
    }
    await this.cancelConnection.set(this.cancelKey(id), "1", "EX", 86400);
    if (typeof job.updateData === "function") {
      await job.updateData({ ...job.data, cancelRequested: true } as RegistrationJobPayload & { cancelRequested: true });
    }
    return snapshotFromJob(job);
  }

  async isCancelRequested(id: string): Promise<boolean> {
    return await this.cancelConnection.get(this.cancelKey(id)) === "1";
  }

  async clearCancelRequest(id: string): Promise<void> {
    await this.cancelConnection.del(this.cancelKey(id));
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
    await this.cancelConnection.quit();
  }

  private cancelKey(id: string): string {
    return `${this.queuePrefix}:registration:cancel:${id}`;
  }
}

async function snapshotFromJob(job: Job<RegistrationJobPayload>): Promise<RegistrationJobSnapshot> {
  const state = await job.getState();
  const progress = normalizeProgress(job.progress);
  const data = job.data;
  return {
    id: String(job.id),
    mode: data.mode,
    state: mapState(state, job.returnvalue),
    target: data.mode === "fill" ? data.target : undefined,
    concurrency: data.mode === "fill" ? data.concurrency : undefined,
    progress,
    logs: progress.logs ?? [],
    results: job.returnvalue,
    error: job.failedReason,
    createdAt: job.timestamp,
    startedAt: job.processedOn ?? undefined,
    finishedAt: job.finishedOn ?? undefined
  };
}

function canceledSnapshot(job: Job<RegistrationJobPayload>): RegistrationJobSnapshot {
  return {
    id: String(job.id),
    mode: job.data.mode,
    state: "canceled",
    target: job.data.mode === "fill" ? job.data.target : undefined,
    concurrency: job.data.mode === "fill" ? job.data.concurrency : undefined,
    progress: normalizeProgress(job.progress),
    logs: normalizeProgress(job.progress).logs ?? [],
    createdAt: job.timestamp,
    finishedAt: Date.now()
  };
}

function normalizeProgress(value: unknown): BullmqRegistrationProgress {
  if (value && typeof value === "object") {
    const record = value as Partial<BullmqRegistrationProgress>;
    return {
      started: Number(record.started ?? 0),
      completed: Number(record.completed ?? 0),
      failed: Number(record.failed ?? 0),
      total: Number(record.total ?? 0),
      logs: Array.isArray(record.logs) ? record.logs : []
    };
  }
  return { started: 0, completed: 0, failed: 0, total: 0, logs: [] };
}

function mapState(state: string, returnValue?: unknown): RegistrationJobState {
  if (state === "completed" && isCanceledReturnValue(returnValue)) return "canceled";
  if (state === "completed") return "succeeded";
  if (state === "failed") return "failed";
  if (state === "active") return "running";
  return "queued";
}

function isCanceledReturnValue(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { canceled?: unknown }).canceled === true);
}
```

- [ ] **Step 4: Run adapter test and verify it passes**

Run:

```bash
npm test -- tests/bullmq-registration-queue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/services/bullmq-registration-queue.ts tests/bullmq-registration-queue.test.ts
git commit -m "feat(registration): add bullmq queue adapter"
```

---

## Task 4: Registration Worker Processor

**Files:**
- Create: `src/services/registration-worker.ts`
- Create: `tests/registration-worker.test.ts`

- [ ] **Step 1: Write failing worker tests**

Create `tests/registration-worker.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { processRegistrationJob } from "../src/services/registration-worker.js";
import type { RegistrationService } from "../src/services/registration-service.js";

function job(data: unknown, id = "job-1") {
  return {
    id,
    data,
    progressCalls: [] as unknown[],
    async updateProgress(value: unknown) {
      this.progressCalls.push(value);
    }
  };
}

describe("processRegistrationJob", () => {
  it("processes one registration job", async () => {
    const registrationService = {
      registerOne: vi.fn(async () => ({ success: true, uid: "u1", token: "t1" }))
    } as unknown as RegistrationService;
    const fakeJob = job({ mode: "single" });

    const result = await processRegistrationJob(fakeJob, registrationService);

    expect(registrationService.registerOne).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: true, uid: "u1", token: "t1" });
    expect(fakeJob.progressCalls.at(-1)).toMatchObject({ completed: 1, failed: 0, total: 1 });
  });

  it("processes fill jobs with progress", async () => {
    const registrationService = {
      registerOne: vi
        .fn()
        .mockResolvedValueOnce({ success: true, uid: "u1" })
        .mockResolvedValueOnce({ success: false, error: "mail unavailable" })
        .mockResolvedValueOnce({ success: true, uid: "u2" }),
      getStats: vi.fn(async () => ({ poolSize: 0, activeCount: 0, depletedCount: 0, disabledCount: 0 }))
    } as unknown as RegistrationService;
    const fakeJob = job({ mode: "fill", target: 3, concurrency: 2 });

    const result = await processRegistrationJob(fakeJob, registrationService);

    expect(registrationService.registerOne).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ target: 3, completed: 2, failed: 1 });
    expect(fakeJob.progressCalls.at(-1)).toMatchObject({ started: 3, completed: 2, failed: 1, total: 3 });
  });

  it("stops fill jobs before the next batch when cancellation is requested", async () => {
    const registrationService = {
      registerOne: vi.fn(async () => ({ success: true, uid: "u1" })),
      getStats: vi.fn(async () => ({ poolSize: 0, activeCount: 0, depletedCount: 0, disabledCount: 0 }))
    } as unknown as RegistrationService;
    const isCancelRequested = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const fakeJob = job({ mode: "fill", target: 3, concurrency: 1 }, "job-cancel");

    const result = await processRegistrationJob(fakeJob, registrationService, { isCancelRequested });

    expect(registrationService.registerOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ canceled: true, target: 3, completed: 1, failed: 0 });
    expect(fakeJob.progressCalls.at(-1)).toMatchObject({ started: 1, completed: 1, failed: 0, total: 3 });
  });
});
```

- [ ] **Step 2: Run worker test and verify it fails**

Run:

```bash
npm test -- tests/registration-worker.test.ts
```

Expected: FAIL because `src/services/registration-worker.ts` does not exist.

- [ ] **Step 3: Implement worker processor and worker factory**

Create `src/services/registration-worker.ts`:

```ts
import { Worker, type Job } from "bullmq";
import type { RegistrationService, RegistrationResult } from "./registration-service.js";
import type { RegistrationJobPayload, RegistrationJobLog, RegistrationJobProgress } from "./registration-job-types.js";

export interface RegistrationWorkerOptions {
  redisUrl: string;
  queuePrefix: string;
  concurrency: number;
  registrationService: RegistrationService;
  isCancelRequested?: (jobId: string) => Promise<boolean>;
  clearCancelRequest?: (jobId: string) => Promise<void>;
}

type ProgressWithLogs = RegistrationJobProgress & { logs: RegistrationJobLog[] };

export interface RegistrationProcessorOptions {
  isCancelRequested?: (jobId: string) => Promise<boolean>;
  clearCancelRequest?: (jobId: string) => Promise<void>;
}

export async function processRegistrationJob(
  job: Pick<Job<RegistrationJobPayload>, "id" | "data" | "updateProgress">,
  registrationService: RegistrationService,
  options: RegistrationProcessorOptions = {}
): Promise<unknown> {
  const jobId = String(job.id);
  const canceled = async () => job.data.cancelRequested === true || await options.isCancelRequested?.(jobId) === true;

  if (await canceled()) {
    await job.updateProgress(progress(0, 0, 0, job.data.mode === "fill" ? job.data.target : 1, [
      { at: Date.now(), level: "warn", message: "registration job canceled before start" }
    ]));
    await options.clearCancelRequest?.(jobId);
    return { canceled: true };
  }

  if (job.data.mode === "single") {
    await job.updateProgress(progress(1, 0, 0, 1, [{ at: Date.now(), level: "info", message: "started single registration" }]));
    const result = await registrationService.registerOne();
    await job.updateProgress(progress(1, result.success ? 1 : 0, result.success ? 0 : 1, 1, [
      { at: Date.now(), level: result.success ? "info" : "error", message: result.success ? "single registration completed" : result.error ?? "single registration failed" }
    ]));
    if (!result.success) {
      await options.clearCancelRequest?.(jobId);
      throw new Error(result.error ?? "single registration failed");
    }
    await options.clearCancelRequest?.(jobId);
    return result;
  }

  const stats = await registrationService.getStats();
  const total = Math.max(0, job.data.target - stats.activeCount);
  const results: RegistrationResult[] = [];
  let started = 0;
  let completed = 0;
  let failed = 0;
  await job.updateProgress(progress(started, completed, failed, total, [{ at: Date.now(), level: "info", message: "started fill registration" }]));

  while (started < total) {
    if (await canceled()) {
      await job.updateProgress(progress(started, completed, failed, total, [
        { at: Date.now(), level: "warn", message: "registration job canceled" }
      ]));
      await options.clearCancelRequest?.(jobId);
      return { canceled: true, target: job.data.target, started, completed, failed, results };
    }
    const batchSize = Math.min(job.data.concurrency, total - started);
    started += batchSize;
    await job.updateProgress(progress(started, completed, failed, total, [{ at: Date.now(), level: "info", message: `started ${started}/${total}` }]));
    const batch = await Promise.all(Array.from({ length: batchSize }, () => registrationService.registerOne()));
    results.push(...batch);
    completed = results.filter((item) => item.success).length;
    failed = results.length - completed;
    await job.updateProgress(progress(started, completed, failed, total, [{ at: Date.now(), level: "info", message: `completed ${completed}, failed ${failed}` }]));
  }

  await options.clearCancelRequest?.(jobId);
  return {
    target: job.data.target,
    started,
    completed,
    failed,
    results
  };
}

export function createRegistrationWorker(options: RegistrationWorkerOptions): Worker<RegistrationJobPayload> {
  return new Worker<RegistrationJobPayload>(
    "registration",
    (job) => processRegistrationJob(job, options.registrationService, {
      isCancelRequested: options.isCancelRequested,
      clearCancelRequest: options.clearCancelRequest
    }),
    {
      prefix: options.queuePrefix,
      concurrency: options.concurrency,
      connection: redisConnectionOptions(options.redisUrl)
    }
  );
}

function progress(
  started: number,
  completed: number,
  failed: number,
  total: number,
  logs: RegistrationJobLog[]
): ProgressWithLogs {
  return { started, completed, failed, total, logs };
}

function redisConnectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  const dbPath = url.pathname.replace("/", "");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: dbPath ? Number(dbPath) : undefined
  };
}
```

- [ ] **Step 4: Run worker test and verify it passes**

Run:

```bash
npm test -- tests/registration-worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/services/registration-worker.ts tests/registration-worker.test.ts
git commit -m "feat(registration): add queue worker processor"
```

---

## Task 5: Fastify Job Routes

**Files:**
- Modify: `src/server/app.ts`
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Write failing route tests**

Add this import near the top of `tests/server.test.ts`:

```ts
import { RegistrationQueueUnavailableError } from "../src/services/registration-job-service.js";
```

Add this test inside the existing `describe("server routes", () => { ... })` block in `tests/server.test.ts`:

```ts
  it("creates and reads registration jobs through protected routes", async () => {
    const registrationJobService = {
      createJob: vi.fn(async () => ({ jobId: "job-1" })),
      getJob: vi.fn(async () => ({
        id: "job-1",
        mode: "fill",
        state: "queued",
        target: 3,
        concurrency: 2,
        progress: { started: 0, completed: 0, failed: 0, total: 3 },
        logs: [],
        createdAt: 1000
      })),
      listJobs: vi.fn(async () => []),
      cancelJob: vi.fn(async () => ({
        id: "job-1",
        mode: "fill",
        state: "canceled",
        target: 3,
        concurrency: 2,
        progress: { started: 0, completed: 0, failed: 0, total: 3 },
        logs: [],
        createdAt: 1000,
        finishedAt: 2000
      }))
    };

    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      registrationJobService,
      fetchImpl: async () => Response.json({ ok: true })
    });

    expect((await app.inject({ method: "POST", url: "/api/registration/jobs" })).statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/api/registration/jobs",
      headers: { authorization: "Bearer sk-test" },
      payload: { mode: "fill", target: 3, concurrency: 2 }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ jobId: "job-1" });
    expect(registrationJobService.createJob).toHaveBeenCalledWith({ mode: "fill", target: 3, concurrency: 2 });

    const listed = await app.inject({
      method: "GET",
      url: "/api/registration/jobs",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);

    const read = await app.inject({
      method: "GET",
      url: "/api/registration/jobs/job-1",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: "job-1", state: "queued" });

    const canceled = await app.inject({
      method: "POST",
      url: "/api/registration/jobs/job-1/cancel",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json()).toMatchObject({ id: "job-1", state: "canceled" });

    registrationJobService.createJob.mockRejectedValueOnce(new RegistrationQueueUnavailableError("redis unavailable"));
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/registration/jobs",
      headers: { authorization: "Bearer sk-test" },
      payload: { mode: "single" }
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ error: { type: "registration_queue_unavailable" } });
  });
```

- [ ] **Step 2: Run server route test and verify it fails**

Run:

```bash
npm test -- tests/server.test.ts -t "registration jobs"
```

Expected: FAIL because `registrationJobService` is not part of `CreateAppOptions` and routes do not exist.

- [ ] **Step 3: Add CreateApp option type and routes**

In `src/server/app.ts`, import:

```ts
import {
  RegistrationJobNotFoundError,
  RegistrationQueueUnavailableError,
  type RegistrationJobServicePort
} from "../services/registration-job-service.js";
import type { RegistrationJobCreateInput } from "../services/registration-job-types.js";
```

Add to `CreateAppOptions`:

```ts
  registrationJobService?: RegistrationJobServicePort;
```

Before `return app;`, add:

```ts
  app.post("/api/registration/jobs", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    if (!options.registrationJobService) {
      await reply.status(503).send({ error: { message: "Registration job service is not configured", type: "registration_queue_unavailable" } });
      return;
    }
    try {
      await reply.send(await options.registrationJobService.createJob(bodyRecord(request) as RegistrationJobCreateInput));
    } catch (error) {
      if (error instanceof RegistrationQueueUnavailableError) {
        await reply.status(503).send({ error: { message: error.message, type: "registration_queue_unavailable" } });
        return;
      }
      await sendBadRequest(reply, error);
    }
  });

  app.get("/api/registration/jobs", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    if (!options.registrationJobService) {
      await reply.status(503).send({ error: { message: "Registration job service is not configured", type: "registration_queue_unavailable" } });
      return;
    }
    await reply.send(await options.registrationJobService.listJobs());
  });

  app.get("/api/registration/jobs/:jobId", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    if (!options.registrationJobService) {
      await reply.status(503).send({ error: { message: "Registration job service is not configured", type: "registration_queue_unavailable" } });
      return;
    }
    const params = request.params as { jobId?: string };
    const job = params.jobId ? await options.registrationJobService.getJob(params.jobId) : undefined;
    if (!job) {
      await reply.status(404).send({ error: { message: "Registration job not found" } });
      return;
    }
    await reply.send(job);
  });

  app.post("/api/registration/jobs/:jobId/cancel", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    if (!options.registrationJobService) {
      await reply.status(503).send({ error: { message: "Registration job service is not configured", type: "registration_queue_unavailable" } });
      return;
    }
    const params = request.params as { jobId?: string };
    try {
      await reply.send(await options.registrationJobService.cancelJob(String(params.jobId ?? "")));
    } catch (error) {
      if (error instanceof RegistrationJobNotFoundError) {
        await reply.status(404).send({ error: { message: error.message } });
        return;
      }
      await reply.status(404).send({ error: { message: error instanceof Error ? error.message : "Registration job not found" } });
    }
  });
```

- [ ] **Step 4: Run server route test and verify it passes**

Run:

```bash
npm test -- tests/server.test.ts -t "registration jobs"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/server/app.ts tests/server.test.ts
git commit -m "feat(server): add registration job routes"
```

---

## Task 6: Runtime Wiring And Shutdown

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Wire queue, service, and worker**

In `src/index.ts`, add imports:

```ts
import { BullmqRegistrationQueue } from "./services/bullmq-registration-queue.js";
import { RegistrationJobService } from "./services/registration-job-service.js";
import { createRegistrationWorker } from "./services/registration-worker.js";
```

After `registrationService`, add:

```ts
const registrationQueue = new BullmqRegistrationQueue({
  redisUrl: config.redisUrl,
  queuePrefix: config.queuePrefix,
  removeOnComplete: config.registrationJobRemoveOnComplete,
  removeOnFail: config.registrationJobRemoveOnFail
});

const registrationJobService = new RegistrationJobService(registrationQueue, {
  defaultTarget: config.poolTargetSize > 0 ? config.poolTargetSize : 10,
  defaultConcurrency: config.registrationConcurrency
});

const registrationWorker = createRegistrationWorker({
  redisUrl: config.redisUrl,
  queuePrefix: config.queuePrefix,
  concurrency: config.registrationJobConcurrency,
  registrationService,
  isCancelRequested: (jobId) => registrationQueue.isCancelRequested(jobId),
  clearCancelRequest: (jobId) => registrationQueue.clearCancelRequest(jobId)
});
```

Pass into `createApp`:

```ts
  registrationJobService
```

After `createApp`, add:

```ts
app.addHook("onClose", async () => {
  await registrationWorker.close();
  await registrationQueue.close();
});
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/index.ts
git commit -m "feat(registration): wire queue worker runtime"
```

---

## Task 7: Frontend Types, Helpers, And Polling

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/lib/registration-job.ts`
- Create: `web/src/lib/polling.ts`
- Modify: `tests/web-lib.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add these imports at the top of `tests/web-lib.test.ts`:

```ts
import { normalizeRegistrationJob, registrationJobIsTerminal } from "../web/src/lib/registration-job";
import { nextPollingDelay } from "../web/src/lib/polling";
```

Add this test inside the existing `describe("web helper modules", () => { ... })` block:

```ts
it("normalizes registration job data for polling", () => {
  const job = normalizeRegistrationJob({
    id: "job-1",
    mode: "fill",
    state: "completed",
    progress: { started: 2, completed: 1, failed: 1, total: 3 },
    logs: [{ at: 1000, level: "info", message: "started" }],
    createdAt: 900
  });

  expect(job).toMatchObject({
    id: "job-1",
    mode: "fill",
    state: "succeeded",
    progress: { started: 2, completed: 1, failed: 1, total: 3 }
  });
  expect(registrationJobIsTerminal(job)).toBe(true);
  expect(nextPollingDelay(0)).toBe(2000);
  expect(nextPollingDelay(1)).toBe(5000);
  expect(nextPollingDelay(2)).toBe(10000);
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
npm test -- tests/web-lib.test.ts
```

Expected: FAIL because helper modules do not exist.

- [ ] **Step 3: Add frontend types**

In `web/src/types.ts`, add:

```ts
export type RegistrationJobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type RegistrationJobMode = "single" | "fill";

export interface RegistrationJobLog {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RegistrationJobView {
  id: string;
  mode: RegistrationJobMode;
  state: RegistrationJobState;
  target?: number;
  concurrency?: number;
  progress: {
    started: number;
    completed: number;
    failed: number;
    total: number;
  };
  logs: RegistrationJobLog[];
  results?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}
```

- [ ] **Step 4: Add registration job helper**

Create `web/src/lib/registration-job.ts`:

```ts
import type { RegistrationJobState, RegistrationJobView } from "../types";

export function normalizeRegistrationJob(raw: unknown): RegistrationJobView {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const progress = record.progress && typeof record.progress === "object"
    ? record.progress as Record<string, unknown>
    : {};
  return {
    id: readString(record.id) ?? "",
    mode: readString(record.mode) === "single" ? "single" : "fill",
    state: mapRegistrationJobState(readString(record.state)),
    target: readNumber(record.target),
    concurrency: readNumber(record.concurrency),
    progress: {
      started: readNumber(progress.started) ?? 0,
      completed: readNumber(progress.completed) ?? 0,
      failed: readNumber(progress.failed) ?? 0,
      total: readNumber(progress.total) ?? 0
    },
    logs: Array.isArray(record.logs)
      ? record.logs.map(normalizeLog).filter((item): item is RegistrationJobView["logs"][number] => Boolean(item))
      : [],
    results: record.results,
    error: readString(record.error),
    createdAt: readNumber(record.createdAt) ?? 0,
    startedAt: readNumber(record.startedAt),
    finishedAt: readNumber(record.finishedAt)
  };
}

export function registrationJobIsTerminal(job: RegistrationJobView): boolean {
  return job.state === "succeeded" || job.state === "failed" || job.state === "canceled";
}

function mapRegistrationJobState(value: string | undefined): RegistrationJobState {
  if (value === "completed" || value === "succeeded") return "succeeded";
  if (value === "active" || value === "running") return "running";
  if (value === "failed") return "failed";
  if (value === "canceled") return "canceled";
  return "queued";
}

function normalizeLog(value: unknown): RegistrationJobView["logs"][number] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const level = record.level === "warn" || record.level === "error" ? record.level : "info";
  return {
    at: readNumber(record.at) ?? Date.now(),
    level,
    message: readString(record.message) ?? ""
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
```

- [ ] **Step 5: Add polling helper**

Create `web/src/lib/polling.ts`:

```ts
export function nextPollingDelay(failureCount: number): number {
  if (failureCount <= 0) return 2000;
  if (failureCount === 1) return 5000;
  return 10000;
}
```

- [ ] **Step 6: Run helper tests and verify they pass**

Run:

```bash
npm test -- tests/web-lib.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add web/src/types.ts web/src/lib/registration-job.ts web/src/lib/polling.ts tests/web-lib.test.ts
git commit -m "feat(web): add registration job helpers"
```

---

## Task 8: Account Pool Job UI

**Files:**
- Modify: `web/src/panels/AccountsPanel.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/admin-app.test.tsx`

- [ ] **Step 1: Write failing UI test**

Add this test inside the existing `describe("admin app gate", () => { ... })` block in `tests/admin-app.test.tsx`:

```ts
  it("starts and polls a registration job from the account pool", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk-local" });
      if (path === "/api/accounts") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "GET") {
        return Response.json([]);
      }
      if (path === "/api/registration/jobs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ mode: "single" });
        return Response.json({ jobId: "job-1" });
      }
      if (path === "/api/registration/jobs/job-1") {
        return Response.json({
          id: "job-1",
          mode: "single",
          state: "succeeded",
          progress: { started: 1, completed: 1, failed: 0, total: 1 },
          logs: [{ at: 1000, level: "info", message: "single registration completed" }],
          results: { success: true, uid: "uid-1", token: "tok-1" },
          createdAt: 900,
          finishedAt: 1100
        });
      }
      return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Master API Key"), { target: { value: "sk-local" } });
    fireEvent.click(screen.getByRole("button", { name: "进入控制台" }));

    await screen.findByRole("button", { name: "注册 1 个" });
    fireEvent.click(screen.getByRole("button", { name: "注册 1 个" }));

    await waitFor(() => expect(screen.getByText("job-1")).toBeInTheDocument());
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("single registration completed")).toBeInTheDocument();
  });
```

If the existing tests use mojibake labels in this environment, replace `"进入控制台"` with the exact button name already used in the first admin-app test.

- [ ] **Step 2: Run UI test and verify it fails**

Run:

```bash
npm test -- tests/admin-app.test.tsx -t "registration job"
```

Expected: FAIL because the registration controls are not present.

- [ ] **Step 3: Implement account pool job controls**

In `web/src/panels/AccountsPanel.tsx`, change the existing React import to:

```ts
import { type FormEvent, useEffect, useRef, useState } from "react";
```

Change the existing lucide import to include `Play` and `Square`:

```ts
import { Ban, Play, Power, RefreshCw, Square, Timer, UserPlus } from "lucide-react";
```

Add helper imports:

```ts
import { normalizeRegistrationJob, registrationJobIsTerminal } from "../lib/registration-job";
import { nextPollingDelay } from "../lib/polling";
import type { RegistrationJobView } from "../types";
```

Add state:

```ts
  const [job, setJob] = useState<RegistrationJobView | undefined>();
  const [jobTarget, setJobTarget] = useState(10);
  const [jobConcurrency, setJobConcurrency] = useState(2);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollFailures = useRef(0);
```

Add recent-job loading and cleanup:

```ts
  useEffect(() => {
    let disposed = false;

    async function loadRecentRegistrationJobs() {
      try {
        const response = await apiRequest<unknown[]>(apiKey, "/api/registration/jobs", { method: "GET" });
        const latest = Array.isArray(response) ? response.map(normalizeRegistrationJob)[0] : undefined;
        if (!disposed && latest) {
          setJob(latest);
          if (!registrationJobIsTerminal(latest)) {
            void pollRegistrationJob(latest.id);
          }
        }
      } catch {
        // Recent jobs are convenience state; account management should still load if Redis is down.
      }
    }

    void loadRecentRegistrationJobs();
    return () => {
      disposed = true;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }
    };
  }, [apiKey]);
```

Add functions:

```ts
  async function startRegistrationJob(mode: "single" | "fill") {
    setStatus({ kind: "loading", message: "创建注册任务中" });
    const payload = mode === "single"
      ? { mode }
      : { mode, target: jobTarget, concurrency: jobConcurrency };
    try {
      const created = await apiRequest<{ jobId: string }>(apiKey, "/api/registration/jobs", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setStatus({ kind: "loading", message: "注册任务运行中" });
      await pollRegistrationJob(created.jobId);
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "创建注册任务失败" });
    }
  }

  async function pollRegistrationJob(jobId: string) {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = undefined;
    }
    try {
      const response = await apiRequest<unknown>(apiKey, `/api/registration/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
      const nextJob = normalizeRegistrationJob(response);
      setJob(nextJob);
      pollFailures.current = 0;
      if (registrationJobIsTerminal(nextJob)) {
        setStatus({ kind: nextJob.state === "failed" ? "error" : "ok", message: `注册任务 ${nextJob.state}` });
        const loaded = await onRefresh();
        onAccountsChange(loaded);
        return;
      }
      pollTimer.current = setTimeout(() => void pollRegistrationJob(jobId), nextPollingDelay(0));
    } catch (error) {
      pollFailures.current += 1;
      setStatus({ kind: "error", message: errorMessage(error) ?? "查询注册任务失败" });
      pollTimer.current = setTimeout(() => void pollRegistrationJob(jobId), nextPollingDelay(pollFailures.current));
    }
  }

  async function cancelRegistrationJob() {
    if (!job) return;
    await apiRequest<unknown>(apiKey, `/api/registration/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
    await pollRegistrationJob(job.id);
  }
```

Add a form section above manual import:

```tsx
      <div className="registration-ops">
        <div className="form-row three compact">
          <label className="text-field">
            <span>目标数量</span>
            <input min={1} max={500} type="number" value={jobTarget} onChange={(event) => setJobTarget(Number(event.target.value))} />
          </label>
          <label className="text-field">
            <span>并发数</span>
            <input min={1} max={20} type="number" value={jobConcurrency} onChange={(event) => setJobConcurrency(Number(event.target.value))} />
          </label>
          <div className="toolbar flush">
            <button className="button primary" onClick={() => void startRegistrationJob("single")} type="button">
              <Play size={16} aria-hidden="true" />
              注册 1 个
            </button>
            <button className="button" onClick={() => void startRegistrationJob("fill")} type="button">
              <Play size={16} aria-hidden="true" />
              补齐号池
            </button>
          </div>
        </div>
        {job && (
          <div className="job-strip">
            <strong className="mono">{job.id}</strong>
            <span>{job.state}</span>
            <span>{job.progress.completed}/{job.progress.total} 完成</span>
            <span>{job.progress.failed} 失败</span>
            {!registrationJobIsTerminal(job) && (
              <button className="icon-button" onClick={() => void cancelRegistrationJob()} title="取消任务" type="button">
                <Square size={15} aria-hidden="true" />
              </button>
            )}
            <ol className="event-list">
              {job.logs.slice(-8).map((item) => <li key={`${item.at}-${item.message}`}>{item.message}</li>)}
            </ol>
            {job.results !== undefined && (
              <pre className="json-block job-result">{JSON.stringify(job.results, null, 2)}</pre>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 4: Add account job styles**

In `web/src/styles.css`, add near the form/table styles:

```css
.registration-ops {
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: #f8fbff;
  padding: 14px;
}

.job-strip {
  display: grid;
  grid-template-columns: auto auto auto auto minmax(120px, 1fr);
  align-items: start;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #ffffff;
  padding: 12px;
}

.job-strip .event-list,
.job-strip .job-result {
  grid-column: 1 / -1;
}

.job-result {
  max-height: 220px;
  overflow: auto;
}
```

- [ ] **Step 5: Run UI test and verify it passes**

Run:

```bash
npm test -- tests/admin-app.test.tsx -t "registration job"
```

Expected: PASS.

- [ ] **Step 6: Run all frontend tests**

Run:

```bash
npm test -- tests/admin-app.test.tsx tests/web-lib.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add web/src/panels/AccountsPanel.tsx web/src/styles.css tests/admin-app.test.tsx
git commit -m "feat(web): add registration job controls"
```

---

## Task 9: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Check working tree**

Run:

```bash
git status --short
```

Expected: no unexpected untracked files. If generated build output appears, leave ignored files alone.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test
```

Expected: PASS with all test files passing.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output except line-ending warnings.

- [ ] **Step 6: Final commit if needed**

If verification fixes produced changes, run:

```bash
git add .
git commit -m "chore: verify registration job console"
```

Expected: a commit only if files changed after the previous task commits.
