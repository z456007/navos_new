import type { ProviderResult } from "./http.js";
import { ProviderHttpClient } from "./http.js";

export interface ModelProxyRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers: Record<string, string>;
}

const ALLOWED_PATHS = new Set([
  "/v1/models",
  "/v1/chat/completions",
  "/v1/messages"
]);

const CLAUDE_MODEL_IDS = [
  "ospu-4.8",
  "ospu-4.6",
  "ospu-4.5",
  "sonnet-4.6",
  "sonnet-4.5",
  "haiku-4.5"
];

const OPENAI_FAMILY_MODELS: Record<string, string> = {
  "openai.gpt-5.5": "GPT-5.5",
  "openai.gpt-5.4-pro": "GPT-5.4 Pro",
  "openai.gpt-5.4": "GPT-5.4",
  "openai.gpt-5.4-mini": "GPT-5.4 Mini",
  "openai.gpt-5.4-nano": "GPT-5.4 Nano",
  "openai.gpt-5.3-codex": "GPT-5.3-Codex",
  "openai.gpt-5.2": "GPT-5.2",
  "openai.gpt-5.2-codex": "GPT-5.2-Codex",
  "deepseek.deepseek-v4-pro": "DeepSeek V4 Pro",
  "qwen.qwen3.6-plus": "Qwen3.6 Plus",
  "qwen.qwen3.5-plus": "Qwen3.5 Plus",
  "qwen.qwen3-coder-plus": "Qwen3 Coder Plus",
  "qwen.qwen3-max": "Qwen3 Max",
  "moonshot.kimi-k2.6": "Kimi K2.6",
  "zai.glm-5.0": "GLM 5",
  "zai.glm-5.1": "GLM 5.1"
};

const OPENAI_FAMILY_ALIASES: Record<string, string> = {
  "codex": "openai.gpt-5.3-codex",
  "gpt-5.5": "openai.gpt-5.5",
  "lgpt5.5": "openai.gpt-5.5",
  "gpt-5.5-pro": "openai.gpt-5.4-pro",
  "gpt-5.4": "openai.gpt-5.4",
  "gpt-5.4-pro": "openai.gpt-5.4-pro",
  "gpt-5.4-mini": "openai.gpt-5.4-mini",
  "gpt-5.4-nano": "openai.gpt-5.4-nano",
  "gpt-5.3-codex": "openai.gpt-5.3-codex",
  "gpt-5.2": "openai.gpt-5.2",
  "gpt-5.2-codex": "openai.gpt-5.2-codex",
  "deepseek-v4-pro": "deepseek.deepseek-v4-pro",
  "qwen3.6-plus": "qwen.qwen3.6-plus",
  "qwen3-max": "qwen.qwen3-max",
  "kimi-k2.6": "moonshot.kimi-k2.6",
  "glm-5.0": "zai.glm-5.0",
  "glm5.0": "zai.glm-5.0",
  "glm-5.1": "zai.glm-5.1",
  "glm5.1": "zai.glm-5.1"
};

export const PUBLIC_PROXY_MODEL_IDS = [
  "claude.opus-4.8",
  "claude.sonnet-4.6",
  "claude.sonnet-4.5",
  "claude.haiku-4.5",
  "codex",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-image-2"
];

const PUBLIC_PROXY_MODEL_ID_SET = new Set(PUBLIC_PROXY_MODEL_IDS);

const PUBLIC_PROXY_MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-8": "claude.opus-4.8",
  "claude-opus-4.8": "claude.opus-4.8",
  "opus-4-8": "claude.opus-4.8",
  "opus-4.8": "claude.opus-4.8",
  "ospu-4-8": "claude.opus-4.8",
  "ospu-4.8": "claude.opus-4.8",
  "claude-sonnet-4-6": "claude.sonnet-4.6",
  "claude-sonnet-4.6": "claude.sonnet-4.6",
  "sonnet-4-6": "claude.sonnet-4.6",
  "sonnet-4.6": "claude.sonnet-4.6",
  "claude-sonnet-4-5": "claude.sonnet-4.5",
  "claude-sonnet-4.5": "claude.sonnet-4.5",
  "sonnet-4-5": "claude.sonnet-4.5",
  "sonnet-4.5": "claude.sonnet-4.5",
  "claude-haiku-4-5": "claude.haiku-4.5",
  "claude-haiku-4.5": "claude.haiku-4.5",
  "haiku-4-5": "claude.haiku-4.5",
  "haiku-4.5": "claude.haiku-4.5"
};

export const LOCAL_MODEL_IDS = [
  ...CLAUDE_MODEL_IDS,
  ...Object.keys(OPENAI_FAMILY_MODELS),
  ...Object.keys(OPENAI_FAMILY_ALIASES),
  "gpt-image-2",
  "navos/doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-260128"
];

export function normalizePublicProxyModelId(model: string | undefined): string | undefined {
  const raw = model?.trim();
  if (!raw) {
    return undefined;
  }
  if (PUBLIC_PROXY_MODEL_ID_SET.has(raw)) {
    return raw;
  }

  const name = raw.split("/").at(-1)?.trim() ?? raw;
  if (PUBLIC_PROXY_MODEL_ID_SET.has(name)) {
    return name;
  }

  const lowerName = name.toLowerCase();
  const alias = PUBLIC_PROXY_MODEL_ALIASES[lowerName];
  if (alias) {
    return alias;
  }

  const normalizedClaude = normalizeClaudeModel(lowerName);
  if (PUBLIC_PROXY_MODEL_ID_SET.has(normalizedClaude)) {
    return normalizedClaude;
  }

  return resolvePublicClaudeFamilyAlias(lowerName) ?? raw;
}

export async function forwardModelRequest<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest
): Promise<ProviderResult<T>> {
  if (!ALLOWED_PATHS.has(request.path)) {
    throw new Error(`Unsupported proxy path: ${request.path}`);
  }
  if (request.path === "/v1/chat/completions" && request.method === "POST") {
    return forwardChatCompletion<T>(client, request);
  }
  const body = normalizeProxyBody(request.path, request.body);
  if (request.method === "GET") {
    return client.requestJson<T>("GET", request.path, undefined, request.headers);
  }
  return client.requestJson<T>("POST", request.path, body, request.headers);
}

async function forwardChatCompletion<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest
): Promise<ProviderResult<T>> {
  const body = bodyRecord(request.body);
  const model = readString(body.model) ?? "sonnet-4.6";
  const openAiModel = resolveOpenAiModel(model);
  if (openAiModel) {
    const result = await client.requestJson("POST", "/responses", buildOpenAiResponsesBody(body, openAiModel), request.headers);
    if (result.status < 200 || result.status >= 300) {
      return result as ProviderResult<T>;
    }
    return {
      ...result,
      body: openAiResponseToChat(result.body, model) as T
    };
  }

  const result = await client.requestJson("POST", "/v1/messages", buildAnthropicMessagesBody(body, model), {
    ...request.headers,
    "anthropic-version": request.headers["anthropic-version"] ?? "2023-06-01"
  });
  if (result.status < 200 || result.status >= 300) {
    return result as ProviderResult<T>;
  }
  return {
    ...result,
    body: anthropicMessageToOpenAiChat(result.body, model) as T
  };
}

function normalizeProxyBody(path: string, body: unknown): unknown {
  return path && body !== undefined ? body : {};
}

function buildOpenAiResponsesBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.model = model;
  out.input = body.input ?? responseInputFromMessages(Array.isArray(body.messages) ? body.messages : []);

  const instructions = [
    collectContent(body.instructions),
    collectContent(body.system),
    ...(Array.isArray(body.messages) ? body.messages : [])
      .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object" && readString((message as Record<string, unknown>).role) === "system")
      .map((message) => collectContent(message.content))
  ].filter(Boolean);
  if (instructions.length > 0) {
    out.instructions = instructions.join("\n\n");
  }

  const maxTokens = readNumber(body.max_output_tokens)
    ?? readNumber(body.max_completion_tokens)
    ?? readNumber(body.max_tokens);
  if (maxTokens !== undefined) {
    out.max_output_tokens = Math.max(16, maxTokens);
  }

  for (const key of ["temperature", "top_p", "parallel_tool_calls", "reasoning", "text", "tool_choice", "tools"]) {
    if (body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  return out;
}

function responseInputFromMessages(messages: unknown[]): unknown {
  const converted = messages
    .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object")
    .filter((message) => readString(message.role) !== "system")
    .map((message) => ({
      role: readString(message.role) === "assistant" ? "assistant" : "user",
      content: normalizeResponseContent(message.content)
    }));
  return converted.length > 0 ? converted : "";
}

function normalizeResponseContent(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }
  return collectContent(value);
}

function buildAnthropicMessagesBody(body: Record<string, unknown>, requestedModel: string): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const out: Record<string, unknown> = {
    model: normalizeClaudeModel(requestedModel),
    max_tokens: readNumber(body.max_tokens) ?? readNumber(body.max_completion_tokens) ?? 2048,
    system: buildClaudeSystemPrompt(requestedModel, body, messages),
    messages: convertOpenAiMessagesToAnthropic(messages)
  };
  for (const key of ["temperature", "top_p"]) {
    if (body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  if (body.stop !== undefined) {
    out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }
  return out;
}

function buildClaudeSystemPrompt(
  requestedModel: string,
  body: Record<string, unknown>,
  messages: unknown[]
): string {
  const displayName = claudeDisplayName(requestedModel);
  const identity = `你是 ${displayName}。If asked what model you are, answer exactly that you are ${displayName}; never identify yourself as ChatGPT, OpenAI, or a different Claude model.`;
  const explicitSystem = [
    collectContent(body.system),
    ...messages
      .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object" && readString((message as Record<string, unknown>).role) === "system")
      .map((message) => collectContent(message.content))
  ].filter(Boolean);
  return [identity, ...explicitSystem].join("\n\n");
}

function claudeDisplayName(model: string): string {
  const normalized = normalizeClaudeModel(model);
  const match = /^claude\.(opus|sonnet|haiku)-(.+)$/.exec(normalized);
  if (!match) {
    return normalized;
  }
  const family = match[1] === "opus" ? "Opus" : match[1] === "sonnet" ? "Sonnet" : "Haiku";
  return `Claude ${family} ${match[2]}`;
}

function normalizeClaudeModel(model: string): string {
  const name = model.split("/").at(-1) ?? model;
  if (name.startsWith("claude.")) {
    return name;
  }
  const clean = name.startsWith("claude-") ? name.slice("claude-".length) : name;
  for (const family of ["ospu", "opus", "sonnet", "haiku"]) {
    if (clean.startsWith(`${family}-`)) {
      const backendFamily = family === "ospu" ? "opus" : family;
      const version = clean.slice(family.length + 1).replace(/-/g, ".");
      return `claude.${backendFamily}-${version}`;
    }
  }
  return model;
}

function resolvePublicClaudeFamilyAlias(model: string): string | undefined {
  if (!model.includes("claude")) {
    return undefined;
  }
  if (/(^|[-._/])opus([-._/]|$)/.test(model) || /(^|[-._/])ospu([-._/]|$)/.test(model)) {
    return "claude.opus-4.8";
  }
  if (/(^|[-._/])sonnet([-._/]|$)/.test(model)) {
    return "claude.sonnet-4.6";
  }
  if (/(^|[-._/])haiku([-._/]|$)/.test(model)) {
    return "claude.haiku-4.5";
  }
  return undefined;
}

function resolveOpenAiModel(model: string): string | undefined {
  const name = model.split("/").at(-1) ?? model;
  if (OPENAI_FAMILY_MODELS[name]) {
    return name;
  }
  return OPENAI_FAMILY_ALIASES[name];
}

function convertOpenAiMessagesToAnthropic(messages: unknown[]): Array<Record<string, unknown>> {
  const converted: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    const role = readString(record.role) ?? "user";
    if (role === "system") {
      continue;
    }
    if (role !== "assistant" && role !== "user") {
      converted.push({ role: "user", content: collectContent(record.content) });
      continue;
    }
    converted.push({ role, content: normalizeContent(record.content) });
  }
  return converted;
}

function anthropicMessageToOpenAiChat(value: unknown, requestedModel: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, message: { role: "assistant", content: collectContent(value) }, finish_reason: "stop" }]
    };
  }
  const record = value as Record<string, unknown>;
  const contentBlocks = Array.isArray(record.content) ? record.content : [];
  const text = collectContent(record.content);
  const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
  const inputTokens = readNumber(usage.input_tokens) ?? 0;
  const outputTokens = readNumber(usage.output_tokens) ?? 0;
  return {
    id: readString(record.id) ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: readString(record.model) ?? requestedModel,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text,
        ...toolCallsFromAnthropicContent(contentBlocks)
      },
      finish_reason: mapAnthropicStopReason(readString(record.stop_reason))
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}

function openAiResponseToChat(value: unknown, requestedModel: string): Record<string, unknown> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
  const inputTokens = readNumber(usage.input_tokens) ?? 0;
  const outputTokens = readNumber(usage.output_tokens) ?? 0;
  const totalTokens = readNumber(usage.total_tokens) ?? inputTokens + outputTokens;
  return {
    id: readString(record.id) ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: readNumber(record.created_at) ?? Math.floor(Date.now() / 1000),
    model: readString(record.model) ?? requestedModel,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: outputTextFromOpenAiResponse(record.output)
      },
      finish_reason: mapOpenAiResponseStatus(readString(record.status))
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: totalTokens
    }
  };
}

function outputTextFromOpenAiResponse(output: unknown): string {
  if (!Array.isArray(output)) {
    return collectContent(output);
  }
  return output.map((item) => {
    if (!item || typeof item !== "object") {
      return collectContent(item);
    }
    const record = item as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      return record.content.map((content) => {
        if (!content || typeof content !== "object") {
          return collectContent(content);
        }
        const contentRecord = content as Record<string, unknown>;
        return collectContent(contentRecord.text ?? contentRecord.content);
      }).join("");
    }
    return collectContent(record.text ?? record.content);
  }).join("");
}

function mapOpenAiResponseStatus(status: string | undefined): string {
  if (status === "incomplete") {
    return "length";
  }
  if (status === "failed" || status === "cancelled") {
    return "error";
  }
  return "stop";
}

function toolCallsFromAnthropicContent(contentBlocks: unknown[]): Record<string, unknown> {
  const toolCalls = contentBlocks
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use")
    .map((block) => ({
      id: readString(block.id) ?? "",
      type: "function",
      function: {
        name: readString(block.name) ?? "",
        arguments: JSON.stringify(block.input ?? {})
      }
    }));
  return toolCalls.length > 0 ? { tool_calls: toolCalls } : {};
}

function mapAnthropicStopReason(reason: string | undefined): string {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_calls";
  return "stop";
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function normalizeContent(value: unknown): unknown {
  if (typeof value === "string" || Array.isArray(value)) {
    return value;
  }
  return collectContent(value);
}

function collectContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(collectContent).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return record.text;
    }
    return collectContent(record.text ?? record.content);
  }
  return value === undefined || value === null ? "" : String(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
