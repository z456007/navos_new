# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:3000/v1
Mode: real
Timeout: 180000 ms
Report timezone: Asia/Shanghai
LOAD_PRODUCTION_100: true
LOAD_SCENARIO_PARALLEL: true
LOAD_MIXED_ALL: false
LOAD_POLL_MEDIA: true
Reference image: data-url
Reference video: not configured
Reference audio: not configured

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.92 | 9750 | 10871 | 10871 |
| claude-code-vision-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.84 | 10576 | 11857 | 11857 |
| deepseek-chat-10 | 10 | 10 | 0 | 0 | 0 | 0 | 0.98 | 9874 | 10224 | 10224 |
| gpt-image-2-mixed-10 | 10 | 0 | 10 | 0 | 0 | 0 | 0.39 | 10762 | 25421 | 25421 |
| seedance-reference-video-10 | 10 | 0 | 0 | 8 | 2 | 0 | 0.06 | 16976 | 180004 | 180004 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-image-2-mixed-10 | rate_limit | 10 |
| seedance-reference-video-10 | rate_limit | 7 |
| seedance-reference-video-10 | server_error | 1 |
| seedance-reference-video-10 | timeout | 2 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| gpt-image-2-mixed-10 | 429 | rate_limit | /images/generations | {"error":{"message":"请求频率超过限制 server_error","type":"rate_limit_error"}} |
| seedance-reference-video-10 | 500 | rate_limit | /videos/e9223a3a8ebb4842b02d1978dfea41fa | {"id":"e9223a3a8ebb4842b02d1978dfea41fa","status":"failed","raw":{"code":200,"msg":"success","data":{"task_id":"e9223a3a8ebb4842b02d1978dfea41fa","id":"e9223a3a8ebb4842b02d1978dfea41fa","status":"failed","error":{"code":"video_asset_acti... |
| seedance-reference-video-10 | 500 | rate_limit | /videos/f7c8db1263594649b7d3b6605a927565 | {"id":"f7c8db1263594649b7d3b6605a927565","status":"failed","raw":{"code":200,"msg":"success","data":{"task_id":"f7c8db1263594649b7d3b6605a927565","id":"f7c8db1263594649b7d3b6605a927565","status":"failed","error":{"code":"video_asset_acti... |
| seedance-reference-video-10 | 500 | rate_limit | /videos/3b058a70b9b143b4964af2aa74f50137 | {"id":"3b058a70b9b143b4964af2aa74f50137","status":"failed","raw":{"code":200,"msg":"success","data":{"task_id":"3b058a70b9b143b4964af2aa74f50137","id":"3b058a70b9b143b4964af2aa74f50137","status":"failed","error":{"code":"video_asset_acti... |
| seedance-reference-video-10 | 500 | rate_limit | /videos/ca8e006564aa46228e54f7b45656c713 | {"id":"ca8e006564aa46228e54f7b45656c713","status":"failed","raw":{"code":200,"msg":"success","data":{"task_id":"ca8e006564aa46228e54f7b45656c713","id":"ca8e006564aa46228e54f7b45656c713","status":"failed","error":{"code":"video_asset_acti... |
| seedance-reference-video-10 | 500 | rate_limit | /videos/ccf721afb00e437a91eb08aea82c4ece | {"id":"ccf721afb00e437a91eb08aea82c4ece","status":"failed","raw":{"code":200,"msg":"success","data":{"task_id":"ccf721afb00e437a91eb08aea82c4ece","id":"ccf721afb00e437a91eb08aea82c4ece","status":"failed","error":{"code":"video_asset_acti... |