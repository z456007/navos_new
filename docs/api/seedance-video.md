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

For requests authenticated with public proxy API keys, public `/v1` video routes accept omitted `model` or one of the supported Seedance aliases. Unsupported public model names are rejected before NavOS leases an account. Master-key requests through `/v1/video/*` are operational/admin compatibility and may be more permissive.

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

Defaults when request fields are omitted:

```text
resolution: 720P
durationSeconds: 5
```

```text
480P  <= 15 seconds
720P  <= 10 seconds
1080P <= 5 seconds
```

## Account And Credit Rules

NavOS leases a video-capable account only after authentication, model allow-list checks, and request validation pass. Capacity is consumed at the upstream task boundary, not merely because an HTTP request was accepted by auth.

```text
required balance to lease: 2000 credits
pre-lease validation/model failure: consumes no account
reference upload failure: releases the leased account
upstream task creation success (2xx): depletes the leased account immediately
upstream insufficient-balance/quota exhaustion: depletes the leased account
other upstream failures: release the leased account
```

For sellers, the capacity and billing boundary is upstream task creation success or a quota-exhausted upstream response. Keep a warm account pool when selling video generation. On-demand registration can add latency and can fail if mail or upstream registration is limited.

Set these variables before running the examples:

```bash
export BASE_URL="https://your-navos.example.com"
export NAVOS_API_KEY="sk-your-public-proxy-key"
```

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

Sample create response:

```json
{
  "task_id": "task_123",
  "status": "queued"
}
```

## Polling Example

```bash
curl "$BASE_URL/v1/video/generations/task_123" \
  -H "Authorization: Bearer $NAVOS_API_KEY"
```

Sample succeeded polling response:

```json
{
  "id": "task_123",
  "status": "succeeded",
  "videoUrl": "https://cdn.example.com/task_123.mp4"
}
```

Poll every 5 to 10 seconds until `status` is `succeeded` or `failed`.

Public polling returns `404 video_task_not_found` for unknown or orphan task ids.

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
400 model_not_allowed
```
With a public proxy API key, `/v1/video/generations` returns this when the request uses a non-Seedance model. Use one of the supported Seedance aliases or omit `model`.

```text
400 validation error
```
The requested duration is longer than the selected resolution allows. The response has a validation message containing the selected resolution's maximum duration, for example `1080P` max 5 seconds; do not rely on a stable `error.type` for duration validation.

```text
404 video_task_not_found
```
The public polling route did not find a task for the requested id.

```text
503 account_unavailable
```
No eligible video account has at least 2000 remaining credits, and NavOS has no registration service or no usable account path for this request.

```text
503 video_account_registration_failed
```
NavOS attempted to register an account for the video task, but registration failed. Public `/v1` responses return the generic message `Video account registration failed`; admin/local responses may include internal registration details.

Upstream insufficient balance or quota exhaustion:
NavOS forwards the upstream status and body for upstream insufficient-balance or quota-exhaustion responses. Clients should inspect the response body or message for `insufficient_balance` or equivalent provider text. NavOS marks the leased video account depleted when the upstream result indicates quota exhaustion.
