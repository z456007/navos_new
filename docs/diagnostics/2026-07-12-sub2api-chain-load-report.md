# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:3000/v1
Mode: real
Timeout: 300000 ms
Report timezone: Asia/Shanghai
LOAD_PRODUCTION_100: false
LOAD_SCENARIO_PARALLEL: false
LOAD_MIXED_ALL: false
LOAD_POLL_MEDIA: true
LOAD_SCENARIOS: image-t2i,image-reference
LOAD_IMAGE_SIZE: 1024x1024
LOAD_VIDEO_RESOLUTION: 480P
LOAD_VIDEO_DURATION_SECONDS: 5
LOAD_VIDEO_ASPECT_RATIO: 1:1
Reference image: data-url
Reference video: not configured
Reference audio: not configured

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| image-t2i-2 | 2 | 2 | 0 | 0 | 0 | 0 | 0.03 | 78097 | 78097 | 78097 |
| image-reference-2 | 2 | 2 | 0 | 0 | 0 | 0 | 0.08 | 25253 | 25253 | 25253 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| none | none | 0 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| none | 0 | none | none | none |