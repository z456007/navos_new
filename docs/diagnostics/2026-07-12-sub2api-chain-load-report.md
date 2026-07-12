# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:3000/v1
Mode: real
Timeout: 900000 ms
Report timezone: Asia/Shanghai
LOAD_PRODUCTION_100: true
LOAD_SCENARIO_PARALLEL: true
LOAD_MIXED_ALL: false
Reference image: data-url
Reference video: not configured
Reference audio: not configured

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex-chat-100 | 100 | 0 | 94 | 6 | 0 | 0 | 2.79 | 405 | 30166 | 35784 |
| claude-code-vision-chat-100 | 100 | 0 | 100 | 0 | 0 | 0 | 109.15 | 481 | 858 | 908 |
| deepseek-chat-100 | 100 | 0 | 100 | 0 | 0 | 0 | 32.45 | 1516 | 3060 | 3077 |
| gpt-image-2-mixed-100 | 100 | 0 | 100 | 0 | 0 | 0 | 32.55 | 2306 | 3011 | 3071 |
| seedance-reference-video-100 | 100 | 0 | 100 | 0 | 0 | 0 | 183.86 | 506 | 534 | 538 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| codex-chat-100 | rate_limit | 94 |
| codex-chat-100 | server_error | 6 |
| claude-code-vision-chat-100 | client_error | 100 |
| deepseek-chat-100 | rate_limit | 100 |
| gpt-image-2-mixed-100 | rate_limit | 100 |
| seedance-reference-video-100 | client_error | 100 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| codex-chat-100 | 429 | rate_limit | /responses | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| codex-chat-100 | 429 | rate_limit | /responses | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| codex-chat-100 | 429 | rate_limit | /responses | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| codex-chat-100 | 429 | rate_limit | /responses | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| codex-chat-100 | 429 | rate_limit | /responses | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| claude-code-vision-chat-100 | 403 | client_error | /messages | {"error":{"message":"This group does not allow /v1/messages dispatch","type":"permission_error"},"type":"error"} |
| claude-code-vision-chat-100 | 403 | client_error | /messages | {"error":{"message":"This group does not allow /v1/messages dispatch","type":"permission_error"},"type":"error"} |
| claude-code-vision-chat-100 | 403 | client_error | /messages | {"error":{"message":"This group does not allow /v1/messages dispatch","type":"permission_error"},"type":"error"} |
| claude-code-vision-chat-100 | 403 | client_error | /messages | {"error":{"message":"This group does not allow /v1/messages dispatch","type":"permission_error"},"type":"error"} |
| claude-code-vision-chat-100 | 403 | client_error | /messages | {"error":{"message":"This group does not allow /v1/messages dispatch","type":"permission_error"},"type":"error"} |
| deepseek-chat-100 | 429 | rate_limit | /chat/completions | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| deepseek-chat-100 | 429 | rate_limit | /chat/completions | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| deepseek-chat-100 | 429 | rate_limit | /chat/completions | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| deepseek-chat-100 | 429 | rate_limit | /chat/completions | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| deepseek-chat-100 | 429 | rate_limit | /chat/completions | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| gpt-image-2-mixed-100 | 429 | rate_limit | /images/generations | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| gpt-image-2-mixed-100 | 429 | rate_limit | /images/generations | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| gpt-image-2-mixed-100 | 429 | rate_limit | /images/generations | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| gpt-image-2-mixed-100 | 429 | rate_limit | /images/generations | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| gpt-image-2-mixed-100 | 429 | rate_limit | /images/generations | {"error":{"message":"Too many pending requests, please retry later","type":"rate_limit_error"}} |
| seedance-reference-video-100 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-video-100 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-video-100 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-video-100 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-video-100 | 404 | client_error | /video/generations | 404 page not found |