# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:3000/v1
Mode: real
Timeout: 360000 ms
Report timezone: Asia/Shanghai
LOAD_PRODUCTION_100: false
LOAD_SCENARIO_PARALLEL: false
LOAD_MIXED_ALL: false
LOAD_POLL_MEDIA: true
LOAD_SCENARIOS: seedance-t2v
LOAD_IMAGE_SIZE: 1024x1024
LOAD_VIDEO_RESOLUTION: 480P
LOAD_VIDEO_DURATION_SECONDS: 5
Reference image: data-url
Reference video: not configured
Reference audio: not configured

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| seedance-t2v-1 | 1 | 0 | 0 | 1 | 0 | 0 | 0.16 | 6104 | 6104 | 6104 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| seedance-t2v-1 | rate_limit | 1 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| seedance-t2v-1 | 500 | rate_limit | /videos/8ce2d77687ac4c4aa0e18f669f34b359 | {"id":"8ce2d77687ac4c4aa0e18f669f34b359","status":"failed","raw":{"code":200,"msg":"success","data":{"task_id":"8ce2d77687ac4c4aa0e18f669f34b359","id":"8ce2d77687ac4c4aa0e18f669f34b359","status":"failed","error":{"code":"video_asset_acti... |