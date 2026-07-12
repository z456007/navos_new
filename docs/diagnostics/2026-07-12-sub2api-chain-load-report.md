# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:3000/v1
Mode: real
Timeout: 180000 ms
Report timezone: Asia/Shanghai
LOAD_PRODUCTION_100: true
LOAD_SCENARIO_PARALLEL: true
LOAD_MIXED_ALL: false
Reference image: data-url
Reference video: not configured
Reference audio: not configured

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.98 | 8616 | 10225 | 10225 |
| claude-code-vision-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.73 | 10487 | 13742 | 13742 |
| deepseek-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 1.07 | 8884 | 9316 | 9316 |
| gpt-image-2-mixed-10 | 10 | 2 | 0 | 8 | 0 | 0 | 0.14 | 23838 | 71924 | 71924 |
| seedance-reference-video-10 | 10 | 0 | 0 | 10 | 0 | 0 | 0.71 | 9105 | 14149 | 14149 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-image-2-mixed-10 | server_error | 8 |
| seedance-reference-video-10 | server_error | 10 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| gpt-image-2-mixed-10 | 502 | server_error | /images/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| gpt-image-2-mixed-10 | 502 | server_error | /images/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| gpt-image-2-mixed-10 | 502 | server_error | /images/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| gpt-image-2-mixed-10 | 502 | server_error | /images/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| gpt-image-2-mixed-10 | 502 | server_error | /images/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |