# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T14:10:08.556Z
Ended: 2026-07-12T14:21:34.298Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 14 | 0 | 86 | 0 | 0 | 1.19 | 83443 | 83699 | 83719 |
| claude-opus-4-8-long-messages-100 | 100 | 98 | 0 | 2 | 0 | 0 | 0.15 | 97909 | 118599 | 685709 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | ok_marker | 14 |
| gpt-5.5-long-chat-100 | server_error | 86 |
| claude-opus-4-8-long-messages-100 | ok_marker | 98 |
| claude-opus-4-8-long-messages-100 | server_error | 2 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| gpt-5.5-long-chat-100 | 502 | server_error | {"error":{"message":"No provider account configured","type":"upstream_error"}} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |
| claude-opus-4-8-long-messages-100 | 502 | server_error | {"error":{"message":"Upstream request failed","type":"upstream_error"},"type":"error"} |