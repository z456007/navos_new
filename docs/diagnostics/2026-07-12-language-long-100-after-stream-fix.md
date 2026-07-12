# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T12:22:21.344Z
Ended: 2026-07-12T12:27:28.037Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 100 | 0 | 0 | 0 | 0 | 5.06 | 14228 | 17960 | 19719 |
| claude-opus-4-8-long-messages-100 | 100 | 89 | 0 | 0 | 0 | 11 | 0.33 | 17963 | 306654 | 306657 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | ok_marker | 100 |
| claude-opus-4-8-long-messages-100 | network_error | 11 |
| claude-opus-4-8-long-messages-100 | ok_marker | 89 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed |