# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:3000/v1
Mode: real
Timeout: 240000 ms
Report timezone: Asia/Shanghai
LOAD_PRODUCTION_100: true
LOAD_SCENARIO_PARALLEL: true
LOAD_MIXED_ALL: false
Reference image: data-url
Reference video: not configured
Reference audio: not configured

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex-chat-1 | 1 | 0 | 0 | 1 | 0 | 0 | 0.09 | 11095 | 11095 | 11095 |
| claude-code-vision-chat-1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.24 | 4243 | 4243 | 4243 |
| deepseek-chat-1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.49 | 2026 | 2026 | 2026 |
| gpt-image-2-mixed-1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.02 | 66092 | 66092 | 66092 |
| seedance-reference-video-1 | 1 | 0 | 0 | 1 | 0 | 0 | 0.53 | 1901 | 1901 | 1901 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| codex-chat-1 | server_error | 1 |
| seedance-reference-video-1 | server_error | 1 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| codex-chat-1 | 502 | server_error | /responses | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| seedance-reference-video-1 | 502 | server_error | /videos/generations | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |