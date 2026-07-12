# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:18080/v1
Mode: real
Timeout: 180000 ms
Report timezone: Asia/Shanghai
LOAD_MIXED_ALL: true
Reference image: data-url

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chat-20 | 20 | 20 | 0 | 0 | 0 | 0 | 0.93 | 11800 | 21376 | 21376 |
| long-chat-20 | 20 | 20 | 0 | 0 | 0 | 0 | 0.59 | 19496 | 34065 | 34065 |
| vision-chat-20 | 20 | 0 | 20 | 0 | 0 | 0 | 1.54 | 7169 | 13010 | 13010 |
| deepseek-chat-20 | 20 | 0 | 0 | 20 | 0 | 0 | 1 | 10487 | 20065 | 20065 |
| image-t2i-20 | 20 | 2 | 18 | 0 | 0 | 0 | 0.3 | 30074 | 65961 | 65961 |
| image-reference-20 | 20 | 3 | 17 | 0 | 0 | 0 | 0.4 | 30067 | 50347 | 50347 |
| seedance-t2v-20 | 20 | 0 | 20 | 0 | 0 | 0 | 949.54 | 19 | 19 | 19 |
| seedance-reference-20 | 20 | 0 | 20 | 0 | 0 | 0 | 2343.4 | 7 | 7 | 7 |
| mixed-all-20 | 20 | 6 | 13 | 1 | 0 | 0 | 0.29 | 30023 | 69489 | 69489 |

## Error Summary

| scenario | category | count |
|---|---|---:|
| vision-chat-20 | client_error | 20 |
| deepseek-chat-20 | server_error | 20 |
| image-t2i-20 | rate_limit | 18 |
| image-reference-20 | rate_limit | 17 |
| seedance-t2v-20 | client_error | 20 |
| seedance-reference-20 | client_error | 20 |
| mixed-all-20 | client_error | 6 |
| mixed-all-20 | rate_limit | 7 |
| mixed-all-20 | server_error | 1 |

## Failure Samples

| scenario | status | category | path | body snippet |
|---|---:|---|---|---|
| vision-chat-20 | 400 | client_error | /chat/completions | {"error":{"message":"You uploaded an unsupported image. Please make sure your image is valid.","type":"invalid_request_error"}} |
| vision-chat-20 | 400 | client_error | /chat/completions | {"error":{"message":"You uploaded an unsupported image. Please make sure your image is valid.","type":"invalid_request_error"}} |
| vision-chat-20 | 400 | client_error | /chat/completions | {"error":{"message":"You uploaded an unsupported image. Please make sure your image is valid.","type":"invalid_request_error"}} |
| vision-chat-20 | 400 | client_error | /chat/completions | {"error":{"message":"You uploaded an unsupported image. Please make sure your image is valid.","type":"invalid_request_error"}} |
| vision-chat-20 | 400 | client_error | /chat/completions | {"error":{"message":"You uploaded an unsupported image. Please make sure your image is valid.","type":"invalid_request_error"}} |
| deepseek-chat-20 | 502 | server_error | /chat/completions | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| deepseek-chat-20 | 502 | server_error | /chat/completions | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| deepseek-chat-20 | 502 | server_error | /chat/completions | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| deepseek-chat-20 | 502 | server_error | /chat/completions | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| deepseek-chat-20 | 502 | server_error | /chat/completions | {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}} |
| image-t2i-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-t2i-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-t2i-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-t2i-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-t2i-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-reference-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-reference-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-reference-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-reference-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| image-reference-20 | 429 | rate_limit | /images/generations | {"error":{"message":"Concurrency limit exceeded for user, please retry later","type":"rate_limit_error"}} |
| seedance-t2v-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-t2v-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-t2v-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-t2v-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-t2v-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-20 | 404 | client_error | /video/generations | 404 page not found |
| seedance-reference-20 | 404 | client_error | /video/generations | 404 page not found |
| mixed-all-20 | 404 | client_error | /video/generations | 404 page not found |
| mixed-all-20 | 404 | client_error | /video/generations | 404 page not found |
| mixed-all-20 | 404 | client_error | /video/generations | 404 page not found |
| mixed-all-20 | 404 | client_error | /video/generations | 404 page not found |
| mixed-all-20 | 400 | client_error | /chat/completions | {"error":{"message":"You uploaded an unsupported image. Please make sure your image is valid.","type":"invalid_request_error"}} |