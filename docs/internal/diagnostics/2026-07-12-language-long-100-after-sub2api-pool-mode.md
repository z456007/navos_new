# Language Long Conversation 1000 Concurrency Report

Started: 2026-07-12T14:27:41.969Z
Ended: 2026-07-12T14:27:59.858Z
Base URL: http://127.0.0.1:3000/v1
Concurrency per scenario: 100
Requests per scenario: 100
Models: gpt-5.5, claude-opus-4-8
Long conversation turns: 48 user/assistant pairs + final user
Max tokens: 2048

| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.5-long-chat-100 | 100 | 80 | 0 | 0 | 0 | 20 | 5.59 | 16248 | 17867 | 17876 |
| claude-opus-4-8-long-messages-100 | 100 | 48 | 0 | 0 | 0 | 52 | 5.6 | 17832 | 17852 | 17857 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| gpt-5.5-long-chat-100 | network_error | 20 |
| gpt-5.5-long-chat-100 | ok_marker | 75 |
| gpt-5.5-long-chat-100 | quota_or_depleted | 5 |
| claude-opus-4-8-long-messages-100 | network_error | 52 |
| claude-opus-4-8-long-messages-100 | ok_marker | 47 |
| claude-opus-4-8-long-messages-100 | quota_or_depleted | 1 |

## Failure Samples

| scenario | status | category | body snippet |
|---|---:|---|---|
| gpt-5.5-long-chat-100 | 200 | quota_or_depleted | {"id":"chatcmpl-7f7d1e8065b44dddadf8ddda","object":"chat.completion","created":1783866475,"model":"gpt-5.5","choices":[{"index":0,"message":{"role":"assistant","content":"Insufficient credits, task paused..."},"finish_reason":"stop"}]} |
| gpt-5.5-long-chat-100 | 200 | quota_or_depleted | {"id":"chatcmpl-6b4b77af418041ddbc3f4cff","object":"chat.completion","created":1783866476,"model":"gpt-5.5","choices":[{"index":0,"message":{"role":"assistant","content":"Insufficient credits, task paused..."},"finish_reason":"stop"}]} |
| gpt-5.5-long-chat-100 | 200 | quota_or_depleted | {"id":"chatcmpl-c5e76b85ad53473e82e5c701","object":"chat.completion","created":1783866477,"model":"gpt-5.5","choices":[{"index":0,"message":{"role":"assistant","content":"Insufficient credits, task paused..."},"finish_reason":"stop"}]} |
| gpt-5.5-long-chat-100 | 200 | quota_or_depleted | {"id":"chatcmpl-b031caa3cfc84407bbf66d92","object":"chat.completion","created":1783866478,"model":"gpt-5.5","choices":[{"index":0,"message":{"role":"assistant","content":"Insufficient credits, task paused..."},"finish_reason":"stop"}]} |
| gpt-5.5-long-chat-100 | 200 | quota_or_depleted | {"id":"chatcmpl-fd6353ecd9974a1fb71868fb","object":"chat.completion","created":1783866478,"model":"gpt-5.5","choices":[{"index":0,"message":{"role":"assistant","content":"Insufficient credits, task paused..."},"finish_reason":"stop"}]} |
| gpt-5.5-long-chat-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| gpt-5.5-long-chat-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| gpt-5.5-long-chat-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| gpt-5.5-long-chat-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| gpt-5.5-long-chat-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | 200 | quota_or_depleted | {"id":"msg_e7cf001f54b24f16931ee46c","type":"message","role":"assistant","content":[{"type":"text","text":"Insufficient credits, task paused..."}],"model":"claude-3-5-sonnet-20241022","stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":0,"... |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |
| claude-opus-4-8-long-messages-100 | network | network_error | fetch failed cause_code=ECONNRESET cause=read ECONNRESET |