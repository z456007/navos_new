# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T12:12:49.282Z
Ended: 2026-07-12T12:14:37.655Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 100 | 0 | 0 | 0 | 0 | 4.67 | 16466 | 20007 | 21407 |
| claude-opus-4-8-long-messages-100 | 100 | 71 | 0 | 29 | 0 | 0 | 0.92 | 17281 | 108241 | 108337 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | ok_marker | 99 |
| gpt-5.5-long-chat-100 | unknown | 1 |
| claude-opus-4-8-long-messages-100 | ok_marker | 71 |
| claude-opus-4-8-long-messages-100 | server_error | 29 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| gpt-5.5-long-chat-100 | 200 | unknown | {"id":"chatcmpl-E0nLFjj4ykB7LKVBQTw1DWlw5mY07","object":"chat.completion","created":1783858378,"model":"gpt-5.5","choices":[{"index":0,"message":{"role":"assistant"},"finish_reason":"stop"}]} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |