# Account Pool Operations Console Design

Date: 2026-07-08

## Goal

Turn the current account pool page into an operations console for managing authorized provider accounts and long-running registration jobs.

The UI must let an authenticated admin:

- import accounts manually, as today
- start one registration job
- start a fill-pool registration job with target size and concurrency
- watch job status, progress, recent log lines, and final results
- refresh the account pool when jobs finish
- keep using the existing video and proxy flows without waiting on registration HTTP requests

The registration protocol itself remains behind the existing `RegistrationService`. This spec only covers queueing, job lifecycle, polling, and UI controls around that service.

## Non-Goals

- No public registration endpoint.
- No unauthenticated queue controls.
- No browser-side registration protocol implementation.
- No live external registration calls in tests.
- No changes to video generation rules or COS archival behavior.

## Queue Choice

Use Redis with BullMQ for registration jobs.

Reasons:

- BullMQ is a Node.js queue library built on Redis and supports jobs, workers, progress updates, retries, and horizontal worker scaling.
- BullMQ `Queue` stores jobs until workers pick them up.
- BullMQ `Worker` runs async job processors and moves jobs to completed or failed states.
- BullMQ requires a Redis connection; production Redis must be configured deliberately, including persistence and a no-eviction memory policy.

References:

- https://docs.bullmq.io/
- https://docs.bullmq.io/guide/queues
- https://docs.bullmq.io/guide/workers
- https://docs.bullmq.io/guide/connections
- https://docs.bullmq.io/guide/going-to-production

## Dependencies And Configuration

Add runtime dependencies:

- `bullmq`
- `ioredis` if the installed BullMQ version does not expose enough connection control through plain options

Add environment variables:

- `REDIS_URL=redis://127.0.0.1:6379`
- `QUEUE_PREFIX=navos`
- `REGISTRATION_JOB_CONCURRENCY=2`
- `REGISTRATION_JOB_REMOVE_ON_COMPLETE=50`
- `REGISTRATION_JOB_REMOVE_ON_FAIL=100`

Keep existing values:

- `POOL_TARGET_SIZE`
- `REGISTRATION_CONCURRENCY`

Interpretation:

- `REGISTRATION_JOB_CONCURRENCY` controls BullMQ worker parallelism.
- `REGISTRATION_CONCURRENCY` controls how many account registration attempts one fill-pool job may run internally.
- `POOL_TARGET_SIZE` is the default target used when the UI starts a fill-pool job without overriding target.

## Backend Design

### New Modules

`src/services/registration-job-service.ts`

Owns the queue-facing API:

- `createSingleJob()`
- `createFillJob({ target, concurrency })`
- `getJob(jobId)`
- `listJobs()`
- `cancelJob(jobId)`

This service hides BullMQ details from Fastify routes.

`src/services/registration-worker.ts`

Owns worker creation and shutdown:

- creates a BullMQ `Worker`
- processes `single` jobs by calling `RegistrationService.registerOne()`
- processes `fill` jobs by calling `RegistrationService.fillPool(target, concurrency)`
- writes progress snapshots via BullMQ job progress
- records sanitized log lines and counters

The worker should be started from `src/index.ts` after stores and services are initialized. Fastify shutdown should close the worker and queue connections.

### Job Payload

```ts
type RegistrationJobPayload =
  | { mode: "single" }
  | { mode: "fill"; target: number; concurrency: number };
```

Validation:

- `target` must be an integer from 1 to 500.
- `concurrency` must be an integer from 1 to 20.
- defaults come from config.

### Job Snapshot

Routes return a stable UI shape:

```ts
interface RegistrationJobSnapshot {
  id: string;
  mode: "single" | "fill";
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  target?: number;
  concurrency?: number;
  progress: {
    started: number;
    completed: number;
    failed: number;
    total: number;
  };
  logs: Array<{
    at: number;
    level: "info" | "warn" | "error";
    message: string;
  }>;
  results?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}
```

Because the admin explicitly needs credentials returned from registration, job results may include `uid`, `token`, `email`, and `mailboxToken`. These responses must remain protected by `master_api_key` and must not be written to server logs.

### Routes

All routes require `master_api_key`.

`POST /api/registration/jobs`

Request:

```json
{ "mode": "single" }
```

or:

```json
{ "mode": "fill", "target": 10, "concurrency": 2 }
```

Response:

```json
{ "jobId": "..." }
```

`GET /api/registration/jobs/:jobId`

Returns `RegistrationJobSnapshot`.

`GET /api/registration/jobs`

Returns recent job snapshots, newest first.

`POST /api/registration/jobs/:jobId/cancel`

Cancels queued jobs. Running jobs should mark a cancellation request and stop before the next registration attempt if the current attempt cannot be interrupted.

### Legacy Route Handling

The current synchronous routes may remain temporarily:

- `POST /api/registration/register`
- `POST /api/registration/fill`
- `GET /api/registration/stats`

But the UI should use job routes only. A later cleanup can remove synchronous routes after the job UI is stable.

## Frontend Design

### Account Pool Page

Extend `AccountsPanel` with a new operations band above the table:

- `注册 1 个` button
- `补齐号池` button
- target size number input
- concurrency number input
- current job status tag
- progress bar
- cancel button when job is queued or running

Keep manual import visible but visually secondary.

### Job Status Area

Show:

- latest job id
- mode
- state
- completed / failed / total
- elapsed time
- last 8 log lines
- result summary

If a job returns credentials, render them only inside the protected admin page. Do not copy them into global notifications.

### Polling

Create a shared polling helper or hook:

- starts after job creation
- polls every 2 seconds while queued or running
- backs off to 5 seconds after transient failures
- backs off to 10 seconds after repeated failures
- stops when job is succeeded, failed, or canceled
- stops when component unmounts
- refreshes `/api/accounts` once when a job reaches terminal success or terminal partial failure

This polling helper can later be reused by video tasks and chatbot status.

## Data Flow

1. Admin opens account pool page.
2. UI loads accounts and recent registration jobs.
3. Admin clicks `注册 1 个` or `补齐号池`.
4. UI posts to `/api/registration/jobs`.
5. Backend validates payload and enqueues a BullMQ job.
6. Worker picks up the job and calls existing `RegistrationService`.
7. Worker updates progress and logs.
8. UI polls job snapshot.
9. On terminal state, UI refreshes accounts.

## Error Handling

- Redis unavailable during job creation returns `503 registration_queue_unavailable`.
- Missing registration service returns `503 registration_unavailable`.
- Invalid target/concurrency returns `400`.
- Worker errors mark the job `failed` and store a short error string.
- Partial fill-pool failures are represented as `succeeded` only when at least one account was registered and the worker completed normally; the progress counters still show failures.
- Job polling failures show a non-blocking warning and continue with backoff.

## Operational Notes

- Redis must be treated as part of runtime infrastructure.
- Production Redis should enable persistence. AOF is the preferred default.
- Redis `maxmemory-policy` should be `noeviction`.
- Queue keys should use the configured prefix, for example `navos:registration`.
- Worker concurrency should start conservatively.
- Server logs must not include account tokens, mailbox tokens, API keys, or registration result payloads.

## Testing Plan

Backend tests:

- creating a single job returns a `jobId`
- creating a fill job validates target and concurrency
- querying a job returns queued/running/terminal states
- worker calls `RegistrationService.registerOne()` for single jobs
- worker calls `RegistrationService.fillPool(target, concurrency)` for fill jobs
- canceling a queued job prevents execution
- Redis failures return a controlled 503
- job snapshots do not require live external provider calls

Frontend tests:

- account pool page renders registration controls
- `注册 1 个` posts `{ mode: "single" }`
- `补齐号池` posts `{ mode: "fill", target, concurrency }`
- page polls job status until terminal state
- account list refreshes after terminal state
- cancel button calls the cancel endpoint

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`

## Rollout Order

1. Add BullMQ/Redis config parsing and tests.
2. Add registration job service with mocked BullMQ in unit tests.
3. Add worker wrapper and lifecycle wiring in `src/index.ts`.
4. Add job routes.
5. Add account pool UI controls and polling.
6. Reuse the polling helper for video tasks in a separate follow-up.

## Open Constraint

The queue and UI are safe to implement against mocks. Live external registration execution must be verified manually by the project owner in their authorized environment.
