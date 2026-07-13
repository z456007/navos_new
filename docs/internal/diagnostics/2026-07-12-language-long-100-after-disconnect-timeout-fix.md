# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T14:58:53.380Z
Ended: 2026-07-12T14:59:45.438Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 100 | 0 | 0 | 0 | 0 | 5.67 | 14339 | 16799 | 17621 |
| claude-opus-4-8-long-messages-100 | 100 | 100 | 0 | 0 | 0 | 0 | 1.92 | 16824 | 43070 | 52034 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | ok_marker | 100 |
| claude-opus-4-8-long-messages-100 | ok_marker | 100 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| none | 0 | none | none |