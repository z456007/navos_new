import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

interface LoadRequest {
  path: string;
  body: unknown;
}

interface ScenarioRecipe {
  name: string;
  build: (index: number) => LoadRequest;
}

interface Scenario {
  name: string;
  concurrency: number;
  requests: number;
  build: (index: number) => LoadRequest;
}

interface ScenarioResult {
  name: string;
  total: number;
  success: number;
  clientError: number;
  serverError: number;
  timeout: number;
  networkError: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
}

const baseUrl = (process.env.SUB2API_BASE_URL ?? "http://127.0.0.1:18080/v1").replace(/\/+$/, "");
const apiKey = process.env.SUB2API_API_KEY ?? "sk-local-openai-zgm2003";
const timeoutMs = Number(process.env.LOAD_TIMEOUT_MS ?? 180000);
const reportTimeZone = process.env.LOAD_REPORT_TIME_ZONE ?? "Asia/Shanghai";
const requestsPerScenario = positiveInt(process.env.LOAD_REQUESTS_PER_SCENARIO, 0);
const includeMixedAll = process.env.LOAD_MIXED_ALL !== "false";
const referenceImageUrl = process.env.LOAD_REFERENCE_IMAGE_URL
  ?? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const chatModel = process.env.LOAD_CHAT_MODEL ?? "gpt-5.5";
const deepseekModel = process.env.LOAD_DEEPSEEK_MODEL ?? "deepseek-chat";
const imageModel = process.env.LOAD_IMAGE_MODEL ?? "gpt-image-2";
const videoModel = process.env.LOAD_VIDEO_MODEL ?? "seedance-1.0-pro";
const concurrencyCsv = (process.env.LOAD_CONCURRENCY ?? "100")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isInteger(item) && item > 0);
const mode = process.env.LOAD_MODE ?? "real";

if (mode !== "real" && mode !== "fake") {
  throw new Error("LOAD_MODE must be real or fake");
}
if (concurrencyCsv.length === 0) {
  throw new Error("LOAD_CONCURRENCY must include at least one positive integer");
}

const recipes: ScenarioRecipe[] = [
  {
    name: "chat",
    build: () => ({
      path: "/chat/completions",
      body: { model: chatModel, messages: [{ role: "user", content: "ping" }], max_tokens: 256 }
    })
  },
  {
    name: "long-chat",
    build: (index) => ({
      path: "/chat/completions",
      body: {
        model: chatModel,
        messages: longConversation(index),
        max_tokens: 4096
      }
    })
  },
  {
    name: "vision-chat",
    build: () => ({
      path: "/chat/completions",
      body: {
        model: chatModel,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Describe this reference image in one sentence." },
            { type: "image_url", image_url: { url: referenceImageUrl } }
          ]
        }],
        max_tokens: 512
      }
    })
  },
  {
    name: "deepseek-chat",
    build: () => ({
      path: "/chat/completions",
      body: {
        model: deepseekModel,
        messages: [{ role: "user", content: "DeepSeek pure text route smoke: answer with ok." }],
        max_tokens: 512
      }
    })
  },
  {
    name: "image-t2i",
    build: (index) => ({
      path: "/images/generations",
      body: { model: imageModel, prompt: `load test text-to-image ${index}`, response_format: "url", size: "1024x1024" }
    })
  },
  {
    name: "image-reference",
    build: (index) => ({
      path: "/images/generations",
      body: {
        model: imageModel,
        prompt: `load test reference image generation ${index}`,
        response_format: "url",
        images: [referenceImageUrl]
      }
    })
  },
  {
    name: "seedance-t2v",
    build: (index) => ({
      path: "/video/generations",
      body: {
        model: videoModel,
        prompt: `load test text-to-video ${index}`,
        duration: 5,
        aspect_ratio: "16:9",
        resolution: "720P"
      }
    })
  },
  {
    name: "seedance-reference",
    build: (index) => ({
      path: "/video/generations",
      body: {
        model: videoModel,
        prompt: `load test reference-to-video ${index}`,
        images: [referenceImageUrl],
        imageRoles: ["first_frame"],
        duration: 5,
        aspect_ratio: "16:9",
        resolution: "720P"
      }
    })
  }
];

const scenarios: Scenario[] = concurrencyCsv.flatMap((concurrency) => {
  const perScenarioRequests = requestsPerScenario > 0 ? requestsPerScenario : concurrency;
  const individual: Scenario[] = [
    { name: `chat-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("chat").build },
    { name: `long-chat-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("long-chat").build },
    { name: `vision-chat-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("vision-chat").build },
    { name: `deepseek-chat-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("deepseek-chat").build },
    { name: `image-t2i-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("image-t2i").build },
    { name: `image-reference-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("image-reference").build },
    { name: `seedance-t2v-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("seedance-t2v").build },
    { name: `seedance-reference-${concurrency}`, concurrency, requests: perScenarioRequests, build: recipeByName("seedance-reference").build }
  ];
  const mixedAll: Scenario = {
    name: `mixed-all-${concurrency}`,
    concurrency,
    requests: perScenarioRequests,
    build: (index) => recipes[index % recipes.length].build(index)
  };
  return includeMixedAll ? [...individual, mixedAll] : individual;
});

function recipeByName(name: string): ScenarioRecipe {
  const recipe = recipes.find((item) => item.name === name);
  if (!recipe) {
    throw new Error(`Unknown load scenario recipe: ${name}`);
  }
  return recipe;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const latencies: number[] = [];
  let success = 0;
  let clientError = 0;
  let serverError = 0;
  let timeout = 0;
  let networkError = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < scenario.requests) {
      const requestIndex = next;
      next += 1;
      const { path, body } = scenario.build(requestIndex);
      const start = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        await response.arrayBuffer();
        if (response.status >= 200 && response.status < 400) success += 1;
        else if (response.status >= 400 && response.status < 500) clientError += 1;
        else serverError += 1;
        latencies.push(performance.now() - start);
      } catch (error) {
        if (isAbortError(error)) timeout += 1;
        else networkError += 1;
        latencies.push(performance.now() - start);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: scenario.concurrency }, worker));
  const elapsedMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const percentile = (p: number): number => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
  return {
    name: scenario.name,
    total: scenario.requests,
    success,
    clientError,
    serverError,
    timeout,
    networkError,
    rps: Number((scenario.requests / Math.max(0.001, elapsedMs / 1000)).toFixed(2)),
    p50: Math.round(percentile(0.50)),
    p95: Math.round(percentile(0.95)),
    p99: Math.round(percentile(0.99))
  };
}

const results: ScenarioResult[] = [];
for (const scenario of scenarios) {
  results.push(await runScenario(scenario));
}

await mkdir("docs/diagnostics", { recursive: true });
const date = dateStamp(new Date(), reportTimeZone);
const markdown = [
  `# Sub2Api Chain Load Report ${date}`,
  "",
  `Base URL: ${baseUrl}`,
  `Mode: ${mode}`,
  `Timeout: ${timeoutMs} ms`,
  `Report timezone: ${reportTimeZone}`,
  `LOAD_MIXED_ALL: ${includeMixedAll}`,
  `Reference image: ${referenceImageUrl.startsWith("data:") ? "data-url" : referenceImageUrl}`,
  "",
  "| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((r) => `| ${r.name} | ${r.total} | ${r.success} | ${r.clientError} | ${r.serverError} | ${r.timeout} | ${r.networkError} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} |`)
].join("\n");

const path = `docs/diagnostics/${date}-sub2api-chain-load-report.md`;
await writeFile(path, markdown, "utf8");
console.log(markdown);
console.log(`report=${path}`);

function longConversation(index: number): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const turns: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: "You are a long-context load-test assistant. Keep context and answer briefly." }
  ];
  for (let i = 0; i < 24; i += 1) {
    turns.push({ role: "user", content: `case ${index} turn ${i}: remember marker ${index}-${i} and continue.` });
    turns.push({ role: "assistant", content: `ack marker ${index}-${i}` });
  }
  turns.push({ role: "user", content: `Summarize markers for case ${index} in one paragraph.` });
  return turns;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function dateStamp(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
