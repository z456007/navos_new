# Seedance Video Public Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Seedance video generation usable through public `/v1/video/*` routes and publish a downstream-facing usage document.

**Architecture:** Keep video task creation, polling, account leasing, and payload normalization in the existing server and protocol modules. Split route authentication at the route boundary: local `/api/video/*` keeps master-key auth, public `/v1/video/*` accepts master or public proxy keys. Add documentation without changing the one-shot 2000-credit account rule.

**Tech Stack:** TypeScript, Fastify, Vitest, React admin frontend, Markdown docs.

---

## File Structure

- Modify `src/server/app.ts`
  - Responsibility: route authentication and HTTP handler binding.
  - Change: let shared video create/poll internals accept an auth guard, then bind `/api/video/*` to local auth and `/v1/video/*` to public proxy auth.
- Modify `tests/server.test.ts`
  - Responsibility: route-level regression coverage.
  - Change: prove public proxy keys work on `/v1/video/*`, public proxy-only keys do not work on `/api/video/*`, duration validation happens before upstream calls, and accepted public video jobs still deplete one account.
- Create `docs/api/seedance-video.md`
  - Responsibility: user-facing API reference for downstream clients and sellers.
  - Content: endpoints, auth, model aliases, duration matrix, one-shot account rules, references, examples, polling, common errors, production notes.

---

### Task 1: Add Failing Server Tests For Public Video Routes

**Files:**
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Insert the public auth regression test**

Add this test after the existing `exposes v1 video generation compatibility routes` test in `tests/server.test.ts`:

```ts
  it("allows public proxy keys on v1 video routes while keeping api video routes local only", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({
      uid: "video-public",
      token: "provider-token",
      balanceRemaining: 2000,
      balanceTotal: 2000
    });
    const paths: string[] = [];
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (url, init) => {
        paths.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
        if (String(url).endsWith("/api/tasks/navos-seedance-video-generation")) {
          return Response.json({ task_id: "task_public", status: "queued" });
        }
        return Response.json({ task_id: "task_public", status: "success", video_url: "https://cdn.test/public.mp4" });
      }
    });

    const apiWithPublicKey = await app.inject({
      method: "POST",
      url: "/api/video/generations",
      headers: { authorization: "Bearer sk-public" },
      payload: { prompt: "city skyline", durationSeconds: 5, resolution: "720P" }
    });
    expect(apiWithPublicKey.statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/v1/video/generations",
      headers: { authorization: "Bearer sk-public" },
      payload: { prompt: "city skyline", durationSeconds: 5, resolution: "720P" }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ task_id: "task_public" });

    const polled = await app.inject({
      method: "GET",
      url: "/v1/video/generations/task_public",
      headers: { authorization: "Bearer sk-public" }
    });
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({ status: "succeeded", videoUrl: "https://cdn.test/public.mp4" });

    expect(paths).toEqual([
      "POST /api/tasks/navos-seedance-video-generation",
      "GET /api/tasks/video/generations/task_public"
    ]);
    expect((await store.get("video-public"))?.status).toBe("depleted");
  });
```

- [ ] **Step 2: Insert the public duration guard test**

Add this test near `rejects video durations that exceed account resolution rules`:

```ts
  it("rejects over-duration public video requests before leasing an account", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({
      uid: "video-ready",
      token: "provider-token",
      balanceRemaining: 2000,
      balanceTotal: 2000
    });
    const fetchImpl = vi.fn(async () => Response.json({ task_id: "task_1", status: "queued" }));
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/video/generations",
      headers: { authorization: "Bearer sk-public" },
      payload: { prompt: "city skyline", durationSeconds: 10, resolution: "1080P" }
    });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.message).toContain("1080P");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await store.get("video-ready")).toMatchObject({
      status: "active",
      balanceRemaining: 2000,
      leaseUntil: 0
    });
  });
```

- [ ] **Step 3: Run the new tests to verify they fail for the expected reason**

Run:

```powershell
npm test -- tests/server.test.ts
```

Expected before implementation:

```text
FAIL tests/server.test.ts
expected 401 to be 200
```

The failing assertion should be the public `/v1/video/generations` create request, because it still requires the master key.

---

### Task 2: Split Video Route Authentication

**Files:**
- Modify: `src/server/app.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Add an auth guard type**

In `src/server/app.ts`, inside `createApp` near the auth helper functions, add:

```ts
  type RequestAuthGuard = (request: FastifyRequest, reply: FastifyReply) => boolean;
```

- [ ] **Step 2: Update shared video handlers to receive an auth guard**

Replace the start of `handleCreateVideo` with:

```ts
  async function handleCreateVideo(
    request: FastifyRequest,
    reply: FastifyReply,
    requireAuth: RequestAuthGuard = requireLocalAuth
  ): Promise<void> {
    if (!requireAuth(request, reply)) {
      return;
    }
```

Replace the start of `handleGetVideoTask` with:

```ts
  async function handleGetVideoTask(
    request: FastifyRequest,
    reply: FastifyReply,
    requireAuth: RequestAuthGuard = requireLocalAuth
  ): Promise<void> {
    if (!requireAuth(request, reply)) {
      return;
    }
```

Keep the rest of each function unchanged.

- [ ] **Step 3: Bind local and public route wrappers separately**

Replace the current video route registrations:

```ts
  app.post("/api/video/generations", handleCreateVideo);
  app.post("/v1/video/generations", handleCreateVideo);
  app.get("/api/video/generations/:taskId", handleGetVideoTask);
  app.get("/v1/video/generations/:taskId", handleGetVideoTask);
```

with:

```ts
  app.post("/api/video/generations", async (request, reply) => {
    await handleCreateVideo(request, reply, requireLocalAuth);
  });
  app.post("/v1/video/generations", async (request, reply) => {
    await handleCreateVideo(request, reply, requirePublicProxyAuth);
  });
  app.get("/api/video/generations/:taskId", async (request, reply) => {
    await handleGetVideoTask(request, reply, requireLocalAuth);
  });
  app.get("/v1/video/generations/:taskId", async (request, reply) => {
    await handleGetVideoTask(request, reply, requirePublicProxyAuth);
  });
```

- [ ] **Step 4: Run server tests**

Run:

```powershell
npm test -- tests/server.test.ts
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 5: Commit tests and implementation**

Run:

```powershell
git add src/server/app.ts tests/server.test.ts
git commit -m "feat(video): allow public proxy seedance routes"
```

Expected:

```text
[main <hash>] feat(video): allow public proxy seedance routes
```

---

### Task 3: Publish Seedance Video API Documentation

**Files:**
- Create: `docs/api/seedance-video.md`

- [ ] **Step 1: Create the docs directory if missing**

Run:

```powershell
New-Item -ItemType Directory -Force docs/api
```

Expected:

```text
Directory: E:\navos-new\docs
```

- [ ] **Step 2: Add the API reference document**

Create `docs/api/seedance-video.md` with this content:

````markdown
# Seedance Video API

NavOS exposes Seedance video generation through OpenAI-style `/v1` routes so Sub2Api-compatible clients can use a normal base URL plus API key.

## Base URL And Auth

Use the NavOS deployment URL as the base URL.

```text
Authorization: Bearer <public-proxy-api-key>
Content-Type: application/json
```

Public routes:

```text
POST /v1/video/generations
GET  /v1/video/generations/{task_id}
```

Admin-only routes:

```text
POST /api/video/generations
GET  /api/video/generations/{task_id}
```

## Models

Supported aliases normalize to `navos/doubao-seedance-2-0-260128`:

```text
navos/doubao-seedance-2-0-260128
doubao-seedance-2-0-260128
doubao-seedance-2-0
seedance-2.0
seedance-2.0-pro
```

## Duration Rules

NavOS rejects requests that exceed the selected resolution limit before leasing an account.

```text
480P  <= 15 seconds
720P  <= 10 seconds
1080P <= 5 seconds
```

## Account And Credit Rules

Video generation uses one video-capable account per accepted task.

```text
required balance: 2000 credits
accepted create request: consumes one account
over-duration request: consumes no account
reference upload failure: releases the account
upstream insufficient balance: marks the account depleted
```

Keep a warm account pool when selling video generation. On-demand registration can add latency and can fail if mail or upstream registration is limited.

## Text-To-Video Example

```bash
curl -X POST "$BASE_URL/v1/video/generations" \
  -H "Authorization: Bearer $NAVOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "prompt": "A cinematic city skyline at sunset, slow dolly-in camera movement.",
    "resolution": "720P",
    "durationSeconds": 10,
    "aspectRatio": "16:9"
  }'
```

Read the task id from `task_id`, `taskId`, or `id`.

## Polling Example

```bash
curl "$BASE_URL/v1/video/generations/task_123" \
  -H "Authorization: Bearer $NAVOS_API_KEY"
```

Poll every 5 to 10 seconds until `status` is `succeeded` or `failed`.

Normalized statuses:

```text
queued
running
succeeded
failed
unknown
```

## Image Reference Example

```bash
curl -X POST "$BASE_URL/v1/video/generations" \
  -H "Authorization: Bearer $NAVOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-2.0",
    "prompt": "Animate the character walking through a neon street.",
    "resolution": "720P",
    "durationSeconds": 10,
    "aspectRatio": "9:16",
    "mode": "omni_reference",
    "generation_mode": "omni_reference",
    "images": [
      "https://assets.example.com/character.png",
      "https://assets.example.com/style.png"
    ],
    "imageRoles": [
      "first_frame",
      "reference_image"
    ]
  }'
```

Image limits:

```text
images: up to 9
roles: reference_image, first_frame, last_frame
```

## Omni Reference Example

```bash
curl -X POST "$BASE_URL/v1/video/generations" \
  -H "Authorization: Bearer $NAVOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "navos/doubao-seedance-2-0-260128",
    "prompt": "Create a short product reveal video with smooth camera motion.",
    "resolution": "480P",
    "durationSeconds": 15,
    "aspectRatio": "16:9",
    "mode": "omni_reference",
    "generation_mode": "omni_reference",
    "images": ["https://assets.example.com/product.png"],
    "imageRoles": ["reference_image"],
    "videos": ["https://assets.example.com/motion.mp4"],
    "videoRoles": ["reference_video"],
    "audioRefs": ["https://assets.example.com/music.mp3"],
    "audioRoles": ["reference_audio"],
    "audio": true
  }'
```

Reference limits:

```text
images: up to 9
videos: up to 3
audioRefs: up to 3
```

NavOS uploads local `data:` references and plain `http://` media references before forwarding the task upstream. `https://` references are passed through directly.

## Common Errors

```text
401 authentication_error
```

The API key is missing or not allowed for the selected route.

```text
400 duration rule violation
```

The requested duration is longer than the selected resolution allows.

```text
503 account_unavailable
```

No active account has at least 2000 remaining credits, and no registration service produced a usable account.

```text
503 video_account_registration_failed
```

NavOS attempted to register an account for the video task, but registration failed.

```text
402 or upstream insufficient balance
```

The leased upstream account did not have enough credits. NavOS marks that account depleted.
````

- [ ] **Step 3: Check Markdown references**

Run:

```powershell
Get-Content docs/api/seedance-video.md | Select-Object -First 40
```

Expected:

```text
# Seedance Video API
```

- [ ] **Step 4: Commit documentation**

Run:

```powershell
git add docs/api/seedance-video.md
git commit -m "docs: add seedance video api guide"
```

Expected:

```text
[main <hash>] docs: add seedance video api guide
```

---

### Task 4: Final Verification

**Files:**
- Verify: `src/server/app.ts`
- Verify: `tests/server.test.ts`
- Verify: `docs/api/seedance-video.md`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- tests/video.test.ts tests/account-service.test.ts tests/server.test.ts tests/web-lib.test.ts
```

Expected:

```text
Test Files  4 passed
```

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 3: Build server**

Run:

```powershell
npm run build:server
```

Expected:

```text
server build exits with code 0
```

- [ ] **Step 4: Build web**

Run:

```powershell
npm run build:web
```

Expected:

```text
web build exits with code 0
```

The existing Vite chunk-size warning is acceptable if there are no build errors.

- [ ] **Step 5: Check whitespace**

Run:

```powershell
git diff --check
```

Expected:

```text
no output
```

- [ ] **Step 6: Confirm commit history**

Run:

```powershell
git log --oneline -3
```

Expected top commits:

```text
<hash> docs: add seedance video api guide
<hash> feat(video): allow public proxy seedance routes
<hash> docs: design seedance video public contract
```
