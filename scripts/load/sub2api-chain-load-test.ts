import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

interface LoadRequest {
  path: string;
  body: unknown;
  apiKey?: string;
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

type FailureCategory =
  | "quota_or_depleted"
  | "account_action"
  | "rate_limit"
  | "timeout"
  | "client_error"
  | "server_error"
  | "network_error"
  | "unknown";

interface FailureSample {
  status: number | "timeout" | "network";
  category: FailureCategory;
  path: string;
  bodySnippet: string;
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
  errorSummary: Record<string, number>;
  failureSamples: FailureSample[];
}

const baseUrl = (process.env.SUB2API_BASE_URL ?? "http://127.0.0.1:3000/v1").replace(/\/+$/, "");
const defaultApiKey = process.env.SUB2API_API_KEY ?? "sk-local-openai-zgm2003";
const codexApiKey = process.env.SUB2API_CODEX_API_KEY ?? defaultApiKey;
const claudeApiKey = process.env.SUB2API_CLAUDE_API_KEY ?? "sk-local-claude-zgm2003";
const deepseekApiKey = process.env.SUB2API_DEEPSEEK_API_KEY ?? "sk-local-deepseek-zgm2003";
const imageApiKey = process.env.SUB2API_IMAGE_API_KEY ?? defaultApiKey;
const seedanceApiKey = process.env.SUB2API_SEEDANCE_API_KEY ?? "sk-local-seedance-zgm2003";
const timeoutMs = Number(process.env.LOAD_TIMEOUT_MS ?? 180000);
const reportTimeZone = process.env.LOAD_REPORT_TIME_ZONE ?? "Asia/Shanghai";
const requestsPerScenario = positiveInt(process.env.LOAD_REQUESTS_PER_SCENARIO, 0);
const includeMixedAll = process.env.LOAD_MIXED_ALL !== "false";
const production100 = process.env.LOAD_PRODUCTION_100 === "true";
const runScenariosInParallel = process.env.LOAD_SCENARIO_PARALLEL === "true" || production100;
const DEFAULT_REFERENCE_IMAGE_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAIAAAAWZq/8AAAEL0lEQVR42u3dsU0DQRCGUXcAGRWQUIc7oRLKoiYCIiQCAsiRrPP5fDf/zJO+Ciw/rXb3dvf09f0jKbSTn0ACWBLAkgCWAJYEsCSAJQEsASwJYEkASwBLAlgSwJIAlgCWBLAkgCUBLAEsCWBJAEsASwJYEsCSAJYAlgSwJIAlASwBLAlgSQBLAEsC+FLPrx9al3+tAAZYAAMMsAAWwAIYYAEMMMACGGCABbAAFsAAC2CAAT6kz/MZVIABrq50XQADDHAYWpgBBriP28mSAQa4j9uBkgEGuCfdIYwBBrgz3faMAQZ4hN6uhgEGeATdrowBBniW3maGAQZ4Ft1mjAEGeKjeHoYBBniu3gaGAQZ4tN50wwADPF1vtGGAAaY32DDAANMbbBhggOkNNpwB+OHpZUgRgBvrjTMMMMD0BhsGGGCAAQZ4BuAheoMMAwwwvcGGAQYYYIAB7g54oN4Iw/aB7QPTG2wYYIABBhjgvoCH6y1uGGCAAQYY4KaA0S1uGGCAAQYYYIABBlilAENb3zDAAAMMMMAAAwyw6gDGNcIwwAADDDDAAAMMsAAG2HHCyEOCpQCDmmIYYIABBhhggAEGGGCAAQYYYIABBhhgAQwwwADbBxbAAAMMMMAAA9wbMKJBhgEGmGEjMMAAAwywAAYYYIABBhhggAUwwAADDLAABhhggAEGGGCAAQYYRXdi0QswwP96fH/7C2CAAQ4GfCNjVgEG+HjAqyWzCjDAhQCvYIyrt5EArgX4KsbEAgxwRcALGRMLMMCHbSMtZHxZMrSV9QI8Yh/4FsbcAgxwiQ851jHmFmCAC32JtYIxumX1Ajz0U8qrGNMLMMAVv4VevspFL8AA1z3MgDHAAMefRsI4Ti/AAGMcrBdggE2PAQa444F+A3J9vQADjHGwXoABxhhggGcAnsM4RS/AAFvlCtYLMMC33nrXjHGWXoAB3ubmyh6M4/QCDPCW10dHM07UCzDA218Bnzg9DtULMMB3fMYhhXGuXoABvvtTLMUZR+sFGOCdnlOqyThdL8AAD2XcgC7AAB/zsuHhq1xt9AIM8JEPlO7PuBNdgAEu8cjwboz76QUY4BGMW9IFGOBUxsslN6YLMMBtB+T2bgEGuOEq1xy3AAPcbfd4oF6AAc6wveGjxwADDHDATSAAAwxwvGSAAQYYY4ABBhjjToAl02OApdEDMsDCGGAJY4AljAGWpqxyASySgxkDLIyDGQMsjIMZAywFT48BloIHZIClYMYAS8GMAZaCGQMsBa9yASwFD8gAS8GMAZaCGQMsBU+PAZaCB2SApWDGAEvBjAGWghkDLB3MGGApWDLAUjBjgKVgxgBLwYwBloYGsASwJIAlASwBLAlgSQBLAlgCWBLAkgCWAJYEsCSAJQEsASwJYEkASwJYAlgSwJIAlgCWBLAkgCUBLPXtF1CSxZ6X3shOAAAAAElFTkSuQmCC";
const referenceImageUrl = process.env.LOAD_REFERENCE_IMAGE_URL ?? DEFAULT_REFERENCE_IMAGE_URL;
const referenceVideoUrl = process.env.LOAD_REFERENCE_VIDEO_URL;
const referenceAudioUrl = process.env.LOAD_REFERENCE_AUDIO_URL;
const chatModel = process.env.LOAD_CHAT_MODEL ?? "gpt-5.5";
const codexModel = process.env.LOAD_CODEX_MODEL ?? "codex";
const claudeCodeModel = process.env.LOAD_CLAUDE_CODE_MODEL ?? "claude-sonnet-4-6";
const deepseekModel = process.env.LOAD_DEEPSEEK_MODEL ?? "deepseek-v4-pro";
const imageModel = process.env.LOAD_IMAGE_MODEL ?? "gpt-image-2";
const videoModel = process.env.LOAD_VIDEO_MODEL ?? "doubao-seedance-2-0-260128";
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
      apiKey: codexApiKey,
      body: { model: chatModel, messages: [{ role: "user", content: "ping" }], max_tokens: 256 }
    })
  },
  {
    name: "long-chat",
    build: (index) => ({
      path: "/chat/completions",
      apiKey: codexApiKey,
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
      apiKey: codexApiKey,
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
      apiKey: deepseekApiKey,
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
      apiKey: imageApiKey,
      body: { model: imageModel, prompt: `load test text-to-image ${index}`, response_format: "url", size: "1024x1024" }
    })
  },
  {
    name: "image-reference",
    build: (index) => ({
      path: "/images/generations",
      apiKey: imageApiKey,
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
      path: "/videos/generations",
      apiKey: seedanceApiKey,
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
      path: "/videos/generations",
      apiKey: seedanceApiKey,
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
  if (production100) {
    const target = requestsPerScenario > 0 ? requestsPerScenario : 100;
    return [
      { name: `codex-chat-${target}`, concurrency: target, requests: target, build: buildCodexConversation },
      { name: `claude-code-vision-chat-${target}`, concurrency: target, requests: target, build: buildClaudeCodeVisionConversation },
      { name: `deepseek-chat-${target}`, concurrency: target, requests: target, build: recipeByName("deepseek-chat").build },
      { name: `gpt-image-2-mixed-${target}`, concurrency: target, requests: target, build: buildGptImage2MixedGeneration },
      { name: `seedance-reference-video-${target}`, concurrency: target, requests: target, build: buildSeedanceReferenceVideo }
    ];
  }
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
  const errorSummary: Record<string, number> = {};
  const failureSamples: FailureSample[] = [];
  let success = 0;
  let clientError = 0;
  let serverError = 0;
  let timeout = 0;
  let networkError = 0;
  let next = 0;

  function recordFailure(
    status: number | "timeout" | "network",
    category: FailureCategory,
    path: string,
    bodyText: string
  ): void {
    errorSummary[category] = (errorSummary[category] ?? 0) + 1;
    if (failureSamples.length < 5) {
      failureSamples.push({
        status,
        category,
        path,
        bodySnippet: snippet(bodyText)
      });
    }
  }

  async function worker(): Promise<void> {
    while (next < scenario.requests) {
      const requestIndex = next;
      next += 1;
      const { path, body, apiKey } = scenario.build(requestIndex);
      const requestApiKey = apiKey ?? defaultApiKey;
      const start = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${requestApiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const responseBody = await response.text();
        if (response.status >= 200 && response.status < 400) success += 1;
        else if (response.status >= 400 && response.status < 500) {
          clientError += 1;
          recordFailure(response.status, classifyFailureBody(response.status, responseBody), path, responseBody);
        } else {
          serverError += 1;
          recordFailure(response.status, classifyFailureBody(response.status, responseBody), path, responseBody);
        }
        latencies.push(performance.now() - start);
      } catch (error) {
        if (isAbortError(error)) {
          timeout += 1;
          recordFailure("timeout", "timeout", path, errorMessage(error));
        } else {
          networkError += 1;
          recordFailure("network", "network_error", path, errorMessage(error));
        }
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
    p99: Math.round(percentile(0.99)),
    errorSummary,
    failureSamples
  };
}

const results: ScenarioResult[] = [];
if (runScenariosInParallel) {
  results.push(...await Promise.all(scenarios.map((scenario) => runScenario(scenario))));
} else {
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
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
  `LOAD_PRODUCTION_100: ${production100}`,
  `LOAD_SCENARIO_PARALLEL: ${runScenariosInParallel}`,
  `LOAD_MIXED_ALL: ${includeMixedAll}`,
  `Reference image: ${referenceImageUrl.startsWith("data:") ? "data-url" : referenceImageUrl}`,
  `Reference video: ${referenceVideoUrl ? "configured" : "not configured"}`,
  `Reference audio: ${referenceAudioUrl ? "configured" : "not configured"}`,
  "",
  "| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((r) => `| ${r.name} | ${r.total} | ${r.success} | ${r.clientError} | ${r.serverError} | ${r.timeout} | ${r.networkError} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} |`),
  "",
  "## Error Summary",
  "",
  "| scenario | category | count |",
  "|---|---|---:|",
  ...errorSummaryRows(results),
  "",
  "## Failure Samples",
  "",
  "| scenario | status | category | path | body snippet |",
  "|---|---:|---|---|---|",
  ...failureSampleRows(results)
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

function buildCodexConversation(index: number): LoadRequest {
  return {
    path: "/responses",
    apiKey: codexApiKey,
    body: {
      model: codexModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Codex real load case ${index}.`,
                "This is a production concurrency test through Sub2Api.",
                "Keep the answer short and include the word codex-ok."
              ].join(" ")
            }
          ]
        }
      ],
      max_output_tokens: 256,
      stream: false
    }
  };
}

function buildClaudeCodeVisionConversation(index: number): LoadRequest {
  const toolUseId = `toolu_load_${index}`;
  return {
    path: "/messages",
    apiKey: claudeApiKey,
    body: {
      model: claudeCodeModel,
      max_tokens: 512,
      stream: false,
      messages: [
        {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: toolUseId,
            name: "Read",
            input: { file_path: `reference-${index}.png` }
          }]
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: toolUseId,
            content: [
              {
                type: "text",
                text: "Claude Code real load vision check. I attached a reference image from a tool result. Tell me whether you can actually inspect the image, and describe what you see in one short Chinese sentence."
              },
              {
                type: "image",
                source: anthropicImageSource(referenceImageUrl)
              }
            ]
          }]
        }
      ]
    }
  };
}

function buildGptImage2MixedGeneration(index: number): LoadRequest {
  const withReference = index % 2 === 1;
  return {
    path: "/images/generations",
    apiKey: imageApiKey,
    body: {
      model: imageModel,
      prompt: withReference
        ? `real load gpt-image-2 reference image generation case ${index}: transform the attached reference into a clean product poster`
        : `real load gpt-image-2 text-to-image generation case ${index}: futuristic server rack in blue green light`,
      response_format: "url",
      size: "1024x1024",
      ...(withReference ? { images: [referenceImageUrl] } : {})
    }
  };
}

function buildSeedanceReferenceVideo(index: number): LoadRequest {
  const body: Record<string, unknown> = {
    model: videoModel,
    prompt: `real load seedance reference video case ${index}: camera pushes through a neon AI operations room, smooth cinematic motion`,
    images: [referenceImageUrl],
    imageRoles: ["first_frame"],
    duration: 5,
    aspect_ratio: "16:9",
    resolution: "720P",
    response_format: "url"
  };
  if (referenceVideoUrl) {
    body.videos = [referenceVideoUrl];
    body.videoRoles = ["reference_video"];
  }
  if (referenceAudioUrl) {
    body.audioRef = referenceAudioUrl;
    body.audioRoles = ["reference_audio"];
  }
  return { path: "/videos/generations", apiKey: seedanceApiKey, body };
}

function anthropicImageSource(url: string): Record<string, unknown> {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url);
  if (match) {
    return {
      type: "base64",
      media_type: match[1] ?? "image/png",
      data: match[2] ?? ""
    };
  }
  return { type: "url", url };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function classifyFailureBody(status: number, bodyText: string): FailureCategory {
  const text = bodyText.toLowerCase();
  if (/quota_exhausted|insufficient_balance|depleted|account_unavailable|no available account/i.test(bodyText)) {
    return "quota_or_depleted";
  }
  if (/disable|cooldown|deplete|release|rate_limited_until/i.test(bodyText)) {
    return "account_action";
  }
  if (status === 429 || /rate[_ -]?limit|too many requests|temporarily limited/i.test(bodyText)) {
    return "rate_limit";
  }
  if (/timeout|timed out|abort/i.test(text)) {
    return "timeout";
  }
  if (status >= 400 && status < 500) {
    return "client_error";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "unknown";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function snippet(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function markdownCell(value: unknown): string {
  return String(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function errorSummaryRows(results: ScenarioResult[]): string[] {
  const rows = results.flatMap((result) => {
    const entries = Object.entries(result.errorSummary).sort(([left], [right]) => left.localeCompare(right));
    return entries.map(([category, count]) => `| ${markdownCell(result.name)} | ${markdownCell(category)} | ${count} |`);
  });
  return rows.length > 0 ? rows : ["| none | none | 0 |"];
}

function failureSampleRows(results: ScenarioResult[]): string[] {
  const rows = results.flatMap((result) => result.failureSamples.map((sample) => (
    `| ${markdownCell(result.name)} | ${markdownCell(sample.status)} | ${markdownCell(sample.category)} | ${markdownCell(sample.path)} | ${markdownCell(sample.bodySnippet)} |`
  )));
  return rows.length > 0 ? rows : ["| none | 0 | none | none | none |"];
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
