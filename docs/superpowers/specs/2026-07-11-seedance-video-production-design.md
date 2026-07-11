# Seedance Video Production Design

Date: 2026-07-11

## Goal

Make NavOS video generation usable as a production-grade upstream for Sub2Api-compatible clients.

The current backend can create and poll Seedance video tasks through local admin routes, but external users need a clear public contract: which endpoint to call, which API key works, what duration is allowed, how reference media is sent, and how account credits are consumed.

This design focuses on the smallest production-ready slice:

- publish a Seedance video usage document for downstream users
- make `/v1/video/generations` and `/v1/video/generations/:taskId` accept public proxy API keys, matching image generation behavior
- preserve the current one-shot 2000-credit video account model
- keep admin `/api/video/*` behavior unchanged

## Evidence From Current Code

Current implementation already has most of the video mechanics:

- `src/protocols/video.ts` defines duration limits:
  - `480P`: 15 seconds
  - `720P`: 10 seconds
  - `1080P`: 5 seconds
- `src/services/account-service.ts` requires `balanceRemaining >= 2000` for video leasing.
- `src/server/app.ts` depletes the leased account immediately after a successful upstream video task creation.
- concurrent video create requests use account leases, so two accepted jobs do not reuse the same account.
- when no eligible 2000-credit account exists, video creation can call the configured registration service to create one account and lease it.
- Seedance payload normalization supports text prompts plus image, video, and audio references.
- frontend and tests already expose duration rule tags and clamp 1080P to 5 seconds.

One important gap remains:

- `/v1/images/generations` uses public proxy authentication, but `/v1/video/generations` currently uses the same handler as local admin video routes, so it effectively requires the master key.

That gap blocks the intended Sub2Api-style contract where downstream users call NavOS with only the exported base URL and public API key.

## Non-Goals

- Do not add a public registration endpoint.
- Do not expose provider account uid, token, mailbox token, or raw provider credentials in public responses.
- Do not change the account depletion rule for video in this slice.
- Do not add a video capacity UI or preflight endpoint in this slice.
- Do not change image, chat, Claude, Codex, or registration behavior except where tests need shared helper coverage.
- Do not reintroduce COS backup or archive behavior.

## Public API Contract

### Create Video

Endpoint:

```text
POST /v1/video/generations
Authorization: Bearer <public-proxy-api-key>
Content-Type: application/json
```

Supported model aliases:

```text
navos/doubao-seedance-2-0-260128
doubao-seedance-2-0-260128
doubao-seedance-2-0
seedance-2.0
seedance-2.0-pro
```

Minimal request:

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "A cinematic city skyline at sunset, slow dolly-in camera movement.",
  "resolution": "720P",
  "durationSeconds": 10,
  "aspectRatio": "16:9"
}
```

Response remains upstream-compatible and is not wrapped in a new custom envelope. The client should read task id from `task_id`, `taskId`, or `id`.

### Poll Video

Endpoint:

```text
GET /v1/video/generations/{task_id}
Authorization: Bearer <public-proxy-api-key>
```

Normalized statuses:

```text
queued | running | succeeded | failed | unknown
```

The public document should tell clients to poll every 5 to 10 seconds and stop when status is `succeeded` or `failed`.

## Local Admin Contract

Admin routes remain master-key only:

```text
POST /api/video/generations
GET /api/video/generations/{task_id}
```

The admin panel continues to use `/api/video/*` with the master API key. This keeps local operations and public downstream access separated.

## Duration Rules

The duration matrix is a hard backend validation rule:

```text
480P  <= 15 seconds
720P  <= 10 seconds
1080P <= 5 seconds
```

Requests exceeding the rule return HTTP 400 before leasing an account or calling upstream.

The public document should describe this as a credit-protection rule, not only a UI rule. A rejected over-duration request must not consume an account.

## Account And Credit Semantics

Video generation uses a one-shot account model:

- an account must be `active`
- account balance must be at least `2000`
- a create request leases exactly one eligible account
- successful upstream task creation marks that account as `depleted` immediately
- upstream insufficient-balance responses also mark the leased account as `depleted`
- reference upload failure releases the account because no video task was created
- other upstream failures release the account unless they clearly indicate quota exhaustion

This matches the current assumption that a full Seedance video task can consume the usable balance of one registered account.

Public docs should be explicit: clients should treat each accepted video task as consuming one video-capable NavOS account. The final task result may still fail upstream, but the create step is the billing boundary currently enforced by NavOS.

## Concurrency Semantics

Video concurrency is bounded by the number of accounts that can be leased at the moment of creation.

Examples:

- 2 eligible accounts and 3 concurrent create requests: 2 may be accepted, 1 should receive account unavailable unless auto-registration produces another eligible account.
- 0 eligible accounts with registration configured: NavOS tries to register one new account for that request.
- 0 eligible accounts without registration configured: NavOS returns 503 `account_unavailable`.

The public document should recommend that sellers keep a warm pool of 2000-credit accounts when selling video generation, because on-demand registration adds latency and can fail due to email or upstream registration limits.

## Reference Media

The public document should cover the already-supported omni-reference payload:

- images: up to 9
- videos: up to 3
- audios: up to 3
- text prompt remains required
- when references are present, clients may set `mode` and `generation_mode` to `omni_reference`

Accepted image roles:

```text
reference_image
first_frame
last_frame
```

Accepted video role:

```text
reference_video
```

Accepted audio role:

```text
reference_audio
```

NavOS currently uploads local data URLs and plain `http://` media references before forwarding the task to upstream. `https://` URLs can be passed through directly.

## Documentation Deliverable

Add a public usage document, preferably:

```text
docs/api/seedance-video.md
```

The document should include:

- endpoint list
- authentication examples
- model aliases
- duration matrix
- one-shot 2000-credit account explanation
- polling workflow
- text-only example
- first-frame or reference-image example
- omni-reference example with image, video, and audio references
- common errors:
  - `401 authentication_error`
  - `400` duration rule violation
  - `503 account_unavailable`
  - `503 video_account_registration_failed`
  - upstream insufficient balance
- seller operation notes:
  - keep a warm account pool
  - poll tasks instead of holding a single long HTTP request
  - expect each accepted video task to consume one account

## Implementation Design

### Auth Split

Keep existing route paths, but do not directly bind `/v1/video/*` to the local admin handler.

Instead, route public and local entrypoints separately:

- `/api/video/*`: require local master key
- `/v1/video/*`: require local master key or public proxy key

The shared create/poll internals can stay reused after authentication passes.

### Tests

Add or adjust tests to prove:

- `/v1/video/generations` accepts a configured public proxy API key.
- `/v1/video/generations/:taskId` accepts a configured public proxy API key.
- `/api/video/generations` still rejects public proxy-only keys.
- over-duration public video requests return 400 and do not call upstream.
- accepted public video requests still lease and deplete one account.

Existing tests around references, duration, concurrent leasing, auto-registration, quota depletion, and no-COS output should remain green.

### Verification

Required local verification:

```text
npm test -- tests/video.test.ts tests/account-service.test.ts tests/server.test.ts tests/web-lib.test.ts
npm run typecheck
npm run build:server
npm run build:web
git diff --check
```

If a live smoke test is run, use a real public proxy API key against `/v1/video/generations`, then poll the returned task id through `/v1/video/generations/{task_id}`.

## Open Follow-Up

The next production polish slice can add a capacity endpoint and admin UI indicator, for example:

```text
GET /api/video/capacity
```

It would show eligible 2000-credit accounts, leased accounts, depleted accounts, and estimated concurrently acceptable video tasks. That is useful for selling capacity, but it is intentionally outside this first compatibility slice.
