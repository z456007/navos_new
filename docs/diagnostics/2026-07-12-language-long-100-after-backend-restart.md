# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T13:51:29.863Z
Ended: 2026-07-12T14:01:30.266Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 94 | 0 | 6 | 0 | 0 | 4.03 | 18268 | 24103 | 24786 |
| claude-opus-4-8-long-messages-100 | 100 | 99 | 0 | 1 | 0 | 0 | 0.17 | 21828 | 40305 | 600381 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | ok_marker | 94 |
| gpt-5.5-long-chat-100 | upstream_temporarily_unavailable | 6 |
| claude-opus-4-8-long-messages-100 | ok_marker | 99 |
| claude-opus-4-8-long-messages-100 | server_error | 1 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| gpt-5.5-long-chat-100 | 503 | upstream_temporarily_unavailable | {"error":{"message":"Service temporarily unavailable, please retry later","type":"api_error"}} |
| gpt-5.5-long-chat-100 | 503 | upstream_temporarily_unavailable | {"error":{"message":"Service temporarily unavailable, please retry later","type":"api_error"}} |
| gpt-5.5-long-chat-100 | 503 | upstream_temporarily_unavailable | {"error":{"message":"Service temporarily unavailable, please retry later","type":"api_error"}} |
| gpt-5.5-long-chat-100 | 503 | upstream_temporarily_unavailable | {"error":{"message":"Service temporarily unavailable, please retry later","type":"api_error"}} |
| gpt-5.5-long-chat-100 | 503 | upstream_temporarily_unavailable | {"error":{"message":"Service temporarily unavailable, please retry later","type":"api_error"}} |
| gpt-5.5-long-chat-100 | 503 | upstream_temporarily_unavailable | {"error":{"message":"Service temporarily unavailable, please retry later","type":"api_error"}} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |