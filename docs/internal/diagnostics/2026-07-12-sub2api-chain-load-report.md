# Sub2Api Chain Load Report 2026-07-12

Base URL: `http://127.0.0.1:3000/v1`
Mode: real
Report timezone: Asia/Shanghai

## Current conclusion

Sub2Api 现在没有再把 NavOS 的媒体 429 放大成 `503 No available compatible accounts`。图片/视频失败的主要来源是 NavOS 上游媒体任务启动频控。NavOS 已加入媒体上游 gate：

- 图片上游默认 `maxInFlight=1`。
- 图片成功/202 后继续占住 gate 60s，避免成功后立刻启动下一张触发频控。
- 图片 rate-limit 后 gate 冷却 180s，并在同一个用户请求内受控重试，不再把第一个 429 直接返回给 Sub2Api。
- Seedance 纯 T2V 任务创建 gate 会绑定 task_id，直到终态才释放；终态 rate-limit 后延迟释放。
- rate-limit 不再在同一个请求内瞬间 fan-out 到多账号。
- 语言模型链路也补了按模型/模型族的 rate-limit barrier：`gpt-5.5`、`claude-opus-4-8`、`codex` 在明确 429 / 频控文本 / Retry-After 后，会先冷却再换号或放行后续请求；普通 503 仍保持快速换号。
- Codex/Claude/GPT 的 streaming 错误流如果报 rate-limit，也会触发同一模型 gate，避免下一个长对话请求立刻继续冲上游。

## Real runs through Sub2Api

| time | scenario | request/concurrency | result | notes |
|---|---|---:|---|---|
| before final image retry | image-t2i,image-reference | 5/5 each | t2i 0/5, reference 0/5 | all were real 429 rate_limit; no Sub2Api 503 |
| after video gate/cooldown | seedance-t2v | 5/5 | 5/5 success | 480P, 5s, p50 271780ms, p95 451202ms |
| before same-request image retry | image-t2i | 2/2 | 1/2 success | first external request returned 429; second queued and succeeded |
| after same-request image retry | image-t2i | 2/2 | 2/2 success | p50 159303ms; external 4xx/5xx=0 |
| after same-request image retry | image-reference | 1/1 | 1/1 success | p50 69163ms; external 4xx/5xx=0 |
| final check | seedance-reference | 2/2 | 2/2 success | 480P, 5s, p50 181039ms |

## Diagnostic direct check

A direct diagnostic call to local NavOS `/api/images/generations` for reference image returned 429 while the same Sub2Api path also returned 429. This isolated the reference-image failure away from Sub2Api forwarding and into NavOS/upstream media pacing/current i2i rate window.

## Verification commands

```powershell
npx vitest run tests/account-service.test.ts tests/provider-failure-classifier.test.ts tests/server.test.ts tests/sub2api-chain-load-script.test.ts
npm run typecheck
$env:GOMAXPROCS='2'; go test -p 1 -tags unit ./internal/service -run "Test(OpenAIGatewayService_HandleOpenAIAccountUpstreamError|OpenAIGatewayServiceForwardImages_|RateLimitService_HandleOpenAIImageRateLimit|IsOpenAIImageRateLimitError|Handle429_|GetRateLimit429CooldownSettings|SetRateLimit429CooldownSettings)" -count=1
```

Latest verified local results:

- NavOS vitest slice: 4 files passed, 136 tests passed.
- NavOS typecheck: passed.
- Sub2Api OpenAI image/rate-limit unit slice: passed.
