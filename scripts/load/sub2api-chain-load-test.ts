import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

interface Scenario {
  name: string;
  concurrency: number;
  requests: number;
  build: () => { path: string; body: unknown };
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

const scenarios: Scenario[] = concurrencyCsv.flatMap((concurrency) => [
  {
    name: `chat-${concurrency}`,
    concurrency,
    requests: concurrency,
    build: () => ({ path: "/chat/completions", body: { model: "gpt-5.5", messages: [{ role: "user", content: "ping" }] } })
  },
  {
    name: `responses-stream-${concurrency}`,
    concurrency,
    requests: concurrency,
    build: () => ({ path: "/responses", body: { model: "codex", input: "ping", stream: true } })
  },
  {
    name: `image-t2i-${Math.min(concurrency, 100)}`,
    concurrency: Math.min(concurrency, 100),
    requests: Math.min(concurrency, 100),
    build: () => ({ path: "/images/generations", body: { model: "gpt-image-2", prompt: "load test cat", response_format: "url" } })
  }
]);

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
      next += 1;
      const { path, body } = scenario.build();
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
  "",
  "| scenario | total | success | 4xx | 5xx | timeout | network error | rps | p50 ms | p95 ms | p99 ms |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((r) => `| ${r.name} | ${r.total} | ${r.success} | ${r.clientError} | ${r.serverError} | ${r.timeout} | ${r.networkError} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} |`)
].join("\n");

const path = `docs/diagnostics/${date}-sub2api-chain-load-report.md`;
await writeFile(path, markdown, "utf8");
console.log(markdown);
console.log(`report=${path}`);

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function dateStamp(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
