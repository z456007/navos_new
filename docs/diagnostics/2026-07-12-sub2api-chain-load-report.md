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
| image-t2i-5 | 5 | 0 | 5 | 0 | 0 | 0 | 0.21 | 9904 | 24067 | 24067 |
| image-reference-5 | 5 | 0 | 0 | 5 | 0 | 0 | 146.52 | 28 | 33 | 33 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| image-t2i-5 | rate_limit | 5 |
| image-reference-5 | server_error | 5 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| image-t2i-5 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| image-t2i-5 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| image-t2i-5 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| image-t2i-5 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| image-t2i-5 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| image-reference-5 | 503 | server_error | /images/generations | {"error":{"message":"No available compatible accounts","type":"api_error"}} |
| image-reference-5 | 503 | server_error | /images/generations | {"error":{"message":"No available compatible accounts","type":"api_error"}} |
| image-reference-5 | 503 | server_error | /images/generations | {"error":{"message":"No available compatible accounts","type":"api_error"}} |
| image-reference-5 | 503 | server_error | /images/generations | {"error":{"message":"No available compatible accounts","type":"api_error"}} |
| image-reference-5 | 503 | server_error | /images/generations | {"error":{"message":"No available compatible accounts","type":"api_error"}} |