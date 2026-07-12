# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T13:36:14.126Z
Ended: 2026-07-12T13:46:30.566Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 100 | 0 | 0 | 0 | 0 | 0.16 | 15849 | 19477 | 616421 |
| claude-opus-4-8-long-messages-100 | 100 | 99 | 0 | 1 | 0 | 0 | 0.17 | 17935 | 32831 | 600497 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | ok_marker | 100 |
| claude-opus-4-8-long-messages-100 | ok_marker | 99 |
| claude-opus-4-8-long-messages-100 | server_error | 1 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |