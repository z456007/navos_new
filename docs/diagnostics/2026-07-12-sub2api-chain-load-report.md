# Sub2Api Chain Load Report 2026-07-12

Base URL: http://127.0.0.1:18080/v1
Mode: real
Timeout: 180000 ms
Report timezone: Asia/Shanghai

| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chat-20 | 20 | 20 | 0 | 0 | 0 | 0 | 1.01 | 9510 | 19805 | 19805 |
| responses-stream-20 | 20 | 20 | 0 | 0 | 0 | 0 | 0.74 | 14989 | 27050 | 27050 |
| image-t2i-20 | 20 | 2 | 18 | 0 | 0 | 0 | 0.32 | 249 | 62137 | 62137 |

## Notes

- This is a real-account smoke through local Sub2Api at `http://127.0.0.1:18080/v1`, not a high-concurrency production-readiness proof.
- `chat-20` and `responses-stream-20` completed with 20/20 success.
- `image-t2i-20` completed with 2/20 success and 18 client errors because the local Sub2Api fixture has `GATEWAY_IMAGE_CONCURRENCY_ENABLED=true` and `GATEWAY_IMAGE_CONCURRENCY_MAX_CONCURRENT_REQUESTS=2` with overflow mode `reject`.
- The initial image smoke failed with `403 Image generation is not enabled for this group`; the local `local-openai` group was updated via Sub2Api admin API to enable image generation before rerunning this report.
- Per plan, staged 100/300/1000 real-account load was not run after the image branch hit the configured local Sub2Api concurrency gate.

