import fs from "node:fs";
import pathModule from "node:path";
import { performance } from "node:perf_hooks";
import { Agent, fetch as undiciFetch } from "undici";

const baseUrl = (process.env.SUB2API_BASE_URL || "http://127.0.0.1:3000/v1").replace(/\/+$/, "");
const gptKey = process.env.SUB2API_CODEX_API_KEY || process.env.SUB2API_API_KEY || "sk-local-openai-zgm2003";
const claudeKey = process.env.SUB2API_CLAUDE_API_KEY || "sk-local-claude-zgm2003";
const concurrency = Number.parseInt(process.env.LOAD_LANGUAGE_CONCURRENCY || "1000", 10);
const requests = Number.parseInt(process.env.LOAD_LANGUAGE_REQUESTS || String(concurrency), 10);
const timeoutMs = Number.parseInt(process.env.LOAD_TIMEOUT_MS || "1200000", 10);
const progressIntervalMs = Number.parseInt(process.env.LOAD_PROGRESS_INTERVAL_MS || "5000", 10);
const reportPath = process.env.LOAD_REPORT_PATH || "docs/diagnostics/2026-07-12-language-long-1000-20260712-200500.md";
const startedAt = new Date();
const dispatcher = new Agent({
  bodyTimeout: 0,
  headersTimeout: 0,
  connectTimeout: 30_000,
  connections: Math.max(4096, concurrency * 2 + 128),
  keepAliveTimeout: 120_000,
  keepAliveMaxTimeout: 120_000
});

function longOpenAiMessages(index) {
  const turns = [{ role: "system", content: "You are a long-context load-test assistant. Keep context accurately and answer in Chinese." }];
  for (let i = 0; i < 48; i += 1) {
    turns.push({ role: "user", content: `case ${index} turn ${i}: remember marker gpt55-${index}-${i}; also remember checksum ${(index + 17) * (i + 3)}.` });
    turns.push({ role: "assistant", content: `ack gpt55-${index}-${i}` });
  }
  turns.push({ role: "user", content: `Final long-context check for case ${index}: summarize the first five and last five markers, say gpt55-long-ok, and keep it within 180 Chinese characters.` });
  return turns;
}

function longAnthropicMessages(index) {
  const turns = [];
  for (let i = 0; i < 48; i += 1) {
    turns.push({ role: "user", content: `case ${index} turn ${i}: remember marker opus48-${index}-${i}; also remember checksum ${(index + 23) * (i + 5)}.` });
    turns.push({ role: "assistant", content: `ack opus48-${index}-${i}` });
  }
  turns.push({ role: "user", content: `Final long-context check for case ${index}: summarize the first five and last five markers, say opus48-long-ok, and keep it within 180 Chinese characters.` });
  return turns;
}

const scenarios = [
  {
    name: `gpt-5.5-long-chat-${requests}`,
    path: "/chat/completions",
    apiKey: gptKey,
    buildBody: (index) => ({ model: "gpt-5.5", messages: longOpenAiMessages(index), max_tokens: 2048, stream: false })
  },
  {
    name: `claude-opus-4-8-long-messages-${requests}`,
    path: "/messages",
    apiKey: claudeKey,
    buildBody: (index) => ({ model: "claude-opus-4-8", system: "You are a long-context load-test assistant. Keep context accurately and answer in Chinese.", messages: longAnthropicMessages(index), max_tokens: 2048, stream: false })
  }
];

function classify(status, text) {
  if (status === "timeout") return "timeout";
  if (status === "network") return "network_error";
  if (status === 401 || status === 403) return "auth_or_forbidden";
  if (/quota|insufficient|depleted|no available account|account_unavailable/i.test(text)) return "quota_or_depleted";
  if (status === 429 || /rate[_ -]?limit|too many|频率|限流|稍后再试/i.test(text)) return "rate_limit";
  if (/upstream.*temporarily|temporarily unavailable/i.test(text)) return "upstream_temporarily_unavailable";
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  if (/gpt55-long-ok|opus48-long-ok/.test(text)) return "ok_marker";
  return "unknown";
}

function snippet(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > 260 ? s.slice(0, 257) + "..." : s;
}

function errorDetails(error) {
  const message = String((error && error.message) || error);
  const cause = error && error.cause;
  const causeCode = cause && cause.code ? ` cause_code=${cause.code}` : "";
  const causeMessage = cause && cause.message ? ` cause=${cause.message}` : "";
  return `${message}${causeCode}${causeMessage}`;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}

async function runScenario(scenario) {
  const result = { name: scenario.name, total: requests, success: 0, clientError: 0, serverError: 0, timeout: 0, networkError: 0, completed: 0, started: 0, latencies: [], errorSummary: {}, samples: [] };
  let next = 0;
  const startedMs = performance.now();
  function record(status, category, body) {
    result.errorSummary[category] = (result.errorSummary[category] || 0) + 1;
    if (category !== "ok_marker" && result.samples.length < 10) {
      result.samples.push({ status, category, body: snippet(body) });
    }
  }
  async function worker() {
    while (next < requests) {
      const index = next++;
      result.started += 1;
      const start = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await undiciFetch(baseUrl + scenario.path, {
          method: "POST",
          headers: { authorization: `Bearer ${scenario.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(scenario.buildBody(index)),
          signal: controller.signal,
          dispatcher
        });
        const text = await response.text();
        const category = classify(response.status, text);
        if (response.status >= 200 && response.status < 400) {
          result.success += 1;
          record(response.status, category, text);
        } else if (response.status >= 400 && response.status < 500) {
          result.clientError += 1;
          record(response.status, category, text);
        } else {
          result.serverError += 1;
          record(response.status, category, text);
        }
      } catch (error) {
        const isAbort = error && error.name === "AbortError";
        if (isAbort) {
          result.timeout += 1;
          record("timeout", "timeout", errorDetails(error));
        } else {
          result.networkError += 1;
          record("network", "network_error", errorDetails(error));
        }
      } finally {
        clearTimeout(timer);
        result.latencies.push(performance.now() - start);
        result.completed += 1;
      }
    }
  }
  const progress = progressIntervalMs > 0 ? setInterval(() => {
    const elapsed = Math.max(1, performance.now() - startedMs);
    const rps = (result.completed / elapsed * 1000).toFixed(2);
    console.log(`[progress] ${new Date().toISOString()} ${scenario.name} started=${result.started}/${requests} completed=${result.completed}/${requests} success=${result.success} 4xx=${result.clientError} 5xx=${result.serverError} timeout=${result.timeout} network=${result.networkError} rps=${rps}`);
  }, progressIntervalMs) : undefined;
  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    if (progress) clearInterval(progress);
  }
  const elapsed = Math.max(1, performance.now() - startedMs);
  return { ...result, elapsedMs: Math.round(elapsed), rps: Number((result.completed / elapsed * 1000).toFixed(2)), p50: percentile(result.latencies, 50), p95: percentile(result.latencies, 95), p99: percentile(result.latencies, 99) };
}

function mdCell(value) { return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }

function writeReport(results) {
  const lines = [];
  lines.push("# Language Long Conversation 1000 Concurrency Report");
  lines.push("");
  lines.push(`Started: ${startedAt.toISOString()}`);
  lines.push(`Ended: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${baseUrl}`);
  lines.push(`Concurrency per scenario: ${concurrency}`);
  lines.push(`Requests per scenario: ${requests}`);
  lines.push("Models: gpt-5.5, claude-opus-4-8");
  lines.push("Long conversation turns: 48 user/assistant pairs + final user");
  lines.push("Max tokens: 2048");
  lines.push("");
  lines.push("| scenario | total | success | 4xx | 5xx | timeout | network | rps | p50 ms | p95 ms | p99 ms |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of results) lines.push(`| ${mdCell(r.name)} | ${r.total} | ${r.success} | ${r.clientError} | ${r.serverError} | ${r.timeout} | ${r.networkError} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} |`);
  lines.push("");
  lines.push("## Error Summary");
  lines.push("");
  lines.push("| scenario | category | count |");
  lines.push("|---|---|---:|");
  let any = false;
  for (const r of results) {
    for (const [category, count] of Object.entries(r.errorSummary).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`| ${mdCell(r.name)} | ${mdCell(category)} | ${count} |`);
      any = true;
    }
  }
  if (!any) lines.push("| none | none | 0 |");
  lines.push("");
  lines.push("## Failure Samples");
  lines.push("");
  lines.push("| scenario | status | category | body snippet |");
  lines.push("|---|---:|---|---|");
  any = false;
  for (const r of results) {
    for (const s of r.samples) {
      lines.push(`| ${mdCell(r.name)} | ${mdCell(s.status)} | ${mdCell(s.category)} | ${mdCell(s.body)} |`);
      any = true;
    }
  }
  if (!any) lines.push("| none | 0 | none | none |");
  fs.mkdirSync(pathModule.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`report=${reportPath}`);
}

console.log("# Language long-conversation load test");
console.log(`baseUrl=${baseUrl}`);
console.log(`concurrencyPerScenario=${concurrency} requestsPerScenario=${requests} timeoutMs=${timeoutMs}`);
console.log(`scenarios=${scenarios.map(s => s.name).join(", ")}`);
const results = await Promise.all(scenarios.map(runScenario));
for (const r of results) {
  console.log(`[result] ${r.name} total=${r.total} success=${r.success} 4xx=${r.clientError} 5xx=${r.serverError} timeout=${r.timeout} network=${r.networkError} rps=${r.rps} p50=${r.p50} p95=${r.p95} p99=${r.p99}`);
}
writeReport(results);

