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
| codex-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.9 | 9713 | 11121 | 11121 |
| claude-code-vision-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.83 | 11699 | 11978 | 11978 |
| deepseek-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 1 | 9530 | 10030 | 10030 |
| gpt-image-2-mixed-10 | 10 | 2 | 8 | 0 | 0 | 0 | 0.19 | 16623 | 54043 | 54043 |
| seedance-reference-video-10 | 10 | 7 | 0 | 3 | 0 | 0 | 0.12 | 9674 | 83014 | 83014 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-image-2-mixed-10 | rate_limit | 8 |
| seedance-reference-video-10 | server_error | 3 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-10 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |