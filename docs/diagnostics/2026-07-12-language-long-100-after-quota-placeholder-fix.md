# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T14:33:05.206Z
Ended: 2026-07-12T14:43:13.189Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 100 | 0 | 0 | 0 | 0 | 5.62 | 13874 | 17098 | 17766 |
| claude-opus-4-8-long-messages-100 | 100 | 98 | 0 | 2 | 0 | 0 | 0.16 | 19061 | 40888 | 607954 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | ok_marker | 100 |
| claude-opus-4-8-long-messages-100 | ok_marker | 98 |
| claude-opus-4-8-long-messages-100 | server_error | 2 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |