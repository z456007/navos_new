# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T12:12:33.844Z
Ended: 2026-07-12T12:12:38.112Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 1
Requests per scenario: 1
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.3 | 3286 | 3286 | 3286 |
| claude-opus-4-8-long-messages-1 | 1 | 1 | 0 | 0 | 0 | 0 | 0.24 | 4242 | 4242 | 4242 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-1 | ok_marker | 1 |
| claude-opus-4-8-long-messages-1 | ok_marker | 1 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| none | 0 | none | none |