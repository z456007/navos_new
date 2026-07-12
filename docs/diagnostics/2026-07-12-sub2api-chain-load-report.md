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
| codex-chat-10 | 10 | 0 | 0 | 10 | 0 | 0 | 0.43 | 21285 | 23068 | 23068 |
| claude-code-vision-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.86 | 11234 | 11692 | 11692 |
| deepseek-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.9 | 10069 | 11110 | 11110 |
| gpt-image-2-mixed-10 | 10 | 4 | 0 | 6 | 0 | 0 | 0.11 | 25752 | 89913 | 89913 |
| seedance-reference-video-10 | 10 | 0 | 0 | 10 | 0 | 0 | 0.8 | 10709 | 12570 | 12570 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| codex-chat-10 | server_error | 10 |
| gpt-image-2-mixed-10 | server_error | 6 |
| seedance-reference-video-10 | server_error | 10 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| codex-chat-10 | 502 | server_error | /responses | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| codex-chat-10 | 502 | server_error | /responses | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| codex-chat-10 | 502 | server_error | /responses | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| codex-chat-10 | 502 | server_error | /responses | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| codex-chat-10 | 502 | server_error | /responses | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
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