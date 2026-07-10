# Production Concurrency and Vision Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make navos-new a safer Sub2Api upstream for concurrent chat/image traffic and multimodal Codex/Claude clients.

**Architecture:** Reuse the existing account lease primitives for model and image work. Store long-running image tasks so `202 running` results can be polled to terminal state, and add bounded waits rather than infinite hangs. Preserve OpenAI/Anthropic image content blocks when translating between chat, responses, and messages protocols.

**Tech Stack:** TypeScript, Fastify, MySQL/In-memory stores, Vitest.

---

### Task 1: Image async task persistence and polling

**Files:**
- Modify: `src/protocols/image.ts`
- Create: `src/store/image-task-store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/index.ts`
- Modify: `tests/server.test.ts`

- [ ] Write a failing server test where `/api/images/generations` returns `202 running` with a `task_id`, keeps the image account leased, then `GET /api/images/generations/:taskId` polls the upstream task to success, returns the image URL, consumes image balance, and releases the lease.
- [ ] Add an image task store with in-memory and MySQL implementations mirroring the existing video task store.
- [ ] Export image polling helpers from `src/protocols/image.ts` so POST and GET can share the same task-status normalization.
- [ ] Save running image tasks with account uid, lease id, poll path, status, raw body, and source URL.
- [ ] Add `/api/images/generations/:taskId` and `/v1/images/generations/:taskId` routes.

### Task 2: Bounded image account waiting

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `tests/server.test.ts`
- Modify: `tests/config.test.ts`

- [ ] Write a failing test where two concurrent image requests with one account both finish instead of the second immediately returning `503`.
- [ ] Add configurable `imageAccountWaitMs` with a finite default.
- [ ] Poll for a releasable image account until the wait budget expires; return `503` only after the bounded wait.

### Task 3: Model proxy lease-based concurrency

**Files:**
- Modify: `src/services/account-service.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/account-service.test.ts`
- Modify: `tests/server.test.ts`

- [ ] Write failing tests showing concurrent model requests lease distinct accounts first and do not all pile onto the same least-recently-used account.
- [ ] Add model lease/release methods to `AccountService`.
- [ ] Replace model-proxy `pickAccount()` with lease-based selection.
- [ ] Release/mark-used on non-streaming success, finalize streaming leases on stream end, and keep existing depletion/cooldown behavior on upstream errors.

### Task 4: Vision payload preservation for Codex and Claude

**Files:**
- Modify: `src/protocols/model-proxy.ts`
- Modify: `tests/model-proxy.test.ts`

- [ ] Write failing tests that Codex chat-completions `image_url` becomes Responses `input_image` instead of being dropped.
- [ ] Write failing tests that Claude chat-completions `image_url` becomes Anthropic `image` blocks instead of being forwarded as OpenAI-only parts.
- [ ] Keep native `/v1/messages` Anthropic image blocks passthrough.

### Task 5: Verification

**Files:**
- No production files.

- [ ] Run targeted tests: `npx vitest run tests/model-proxy.test.ts tests/account-service.test.ts tests/server.test.ts --testNamePattern "image task|concurrent image|model requests|image_url|input_image|vision|lease"`.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build:server`.
- [ ] Run `npm run build:web`.
- [ ] Run `git diff --check`.
