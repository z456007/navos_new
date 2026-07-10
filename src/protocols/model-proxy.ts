import { Transform } from "node:stream";
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
  "/v1/responses",
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
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "codex",
  "gpt-5.5",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-image-2"
];

const PUBLIC_PROXY_CLAUDE_MODEL_IDS = [
  "claude.opus-4.6",
  "claude.opus-4.7",
  "claude.opus-4.8",
  "claude.sonnet-4.6",
  "claude.sonnet-4.5",
  "claude.haiku-4.5"
];

const PUBLIC_PROXY_CHAT_MODEL_ID_SET = new Set([
  ...PUBLIC_PROXY_CLAUDE_MODEL_IDS,
  "codex",
  "gpt-5.5",
  "gpt-5.3-codex",
  "gpt-5.2-codex"
]);

const PUBLIC_PROXY_MESSAGES_MODEL_ID_SET = new Set(PUBLIC_PROXY_CLAUDE_MODEL_IDS);
const PUBLIC_PROXY_RESPONSES_MODEL_ID_SET = new Set([
  "codex",
  "gpt-5.5",
  "gpt-5.3-codex",
  "gpt-5.2-codex"
]);

const PUBLIC_PROXY_OPENAI_MODEL_ALIASES: Record<string, string> = {
  "openai.gpt-5.5": "gpt-5.5",
  "openai.gpt-5.3-codex": "gpt-5.3-codex",
  "openai.gpt-5.2-codex": "gpt-5.2-codex"
};

const PUBLIC_PROXY_MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-6": "claude.opus-4.6",
  "claude-opus-4.6": "claude.opus-4.6",
  "opus-4-6": "claude.opus-4.6",
  "opus-4.6": "claude.opus-4.6",
  "ospu-4-6": "claude.opus-4.6",
  "ospu-4.6": "claude.opus-4.6",
  "claude-opus-4-7": "claude.opus-4.7",
  "claude-opus-4.7": "claude.opus-4.7",
  "opus-4-7": "claude.opus-4.7",
  "opus-4.7": "claude.opus-4.7",
  "ospu-4-7": "claude.opus-4.7",
  "ospu-4.7": "claude.opus-4.7",
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

export function isPublicProxyChatModelAllowed(model: string | undefined): boolean {
  return Boolean(model && PUBLIC_PROXY_CHAT_MODEL_ID_SET.has(model));
}

export function isPublicProxyMessagesModelAllowed(model: string | undefined): boolean {
  return Boolean(model && PUBLIC_PROXY_MESSAGES_MODEL_ID_SET.has(model));
}

export function isPublicProxyResponsesModelAllowed(model: string | undefined): boolean {
  return Boolean(model && PUBLIC_PROXY_RESPONSES_MODEL_ID_SET.has(model));
}

export function normalizePublicProxyModelId(model: string | undefined): string | undefined {
  const raw = model?.trim();
  if (!raw) {
    return undefined;
  }

  const name = raw.split("/").at(-1)?.trim() ?? raw;
  const lowerName = name.toLowerCase();
  const alias = PUBLIC_PROXY_MODEL_ALIASES[lowerName];
  if (alias) {
    return alias;
  }

  const openAiAlias = PUBLIC_PROXY_OPENAI_MODEL_ALIASES[lowerName];
  if (openAiAlias) {
    return openAiAlias;
  }

  const normalizedClaude = normalizeClaudeModel(lowerName);
  if (PUBLIC_PROXY_MESSAGES_MODEL_ID_SET.has(normalizedClaude)) {
    return normalizedClaude;
  }

  if (PUBLIC_PROXY_CHAT_MODEL_ID_SET.has(lowerName) || lowerName === "gpt-image-2") {
    return lowerName;
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
  if (request.path === "/v1/messages" && request.method === "POST") {
    return forwardAnthropicMessages<T>(client, request);
  }
  if (request.path === "/v1/responses" && request.method === "POST") {
    return forwardOpenAiResponses<T>(client, request);
  }
  const body = normalizeProxyBody(request.path, request.body);
  if (request.method === "GET") {
    return client.requestJson<T>("GET", request.path, undefined, request.headers);
  }
  return client.requestJson<T>("POST", request.path, body, request.headers);
}

async function forwardAnthropicMessages<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest
): Promise<ProviderResult<T>> {
  const body = bodyRecord(request.body);
  const model = readString(body.model) ?? "sonnet-4.6";
  return client.requestJson<T>("POST", "/v1/messages", buildAnthropicMessagesPassthroughBody(body, model), {
    ...request.headers,
    "anthropic-version": request.headers["anthropic-version"] ?? "2023-06-01"
  });
}

async function forwardOpenAiResponses<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest
): Promise<ProviderResult<T>> {
  const body = bodyRecord(request.body);
  const model = readString(body.model) ?? "codex";
  const openAiModel = resolveOpenAiModel(model);
  if (!openAiModel) {
    return client.requestJson<T>("POST", "/responses", body, request.headers);
  }

  if (!usesOpenAiResponsesPath(openAiModel)) {
    return forwardResponsesViaChatCompletions<T>(client, request, model, openAiModel);
  }

  return client.requestJson<T>("POST", "/responses", buildNativeOpenAiResponsesBody(body, openAiModel), request.headers);
}

async function forwardResponsesViaChatCompletions<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest,
  requestedModel: string,
  openAiModel: string
): Promise<ProviderResult<T>> {
  const responsesBody = bodyRecord(request.body);
  const chatInput = buildChatBodyFromResponsesBody(responsesBody);
  const result = await client.requestJson("POST", "/chat/completions", buildOpenAiChatBody(chatInput, openAiModel), request.headers);
  if (result.status < 200 || result.status >= 300) {
    return result as ProviderResult<T>;
  }

  const contentType = result.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && isNodeReadable(result.body)) {
    return {
      ...result,
      body: result.body.pipe(createChatCompletionsToResponsesStream(requestedModel)) as T
    };
  }

  return {
    ...result,
    body: chatCompletionToOpenAiResponse(result.body, requestedModel) as T
  };
}

async function forwardChatCompletion<T = unknown>(
  client: ProviderHttpClient,
  request: ModelProxyRequest
): Promise<ProviderResult<T>> {
  const body = bodyRecord(request.body);
  const model = readString(body.model) ?? "sonnet-4.6";
  const openAiModel = resolveOpenAiModel(model);
  if (openAiModel) {
    if (!usesOpenAiResponsesPath(openAiModel)) {
      return client.requestJson<T>("POST", "/chat/completions", buildOpenAiChatBody(body, openAiModel), request.headers);
    }
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

function buildOpenAiChatBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== "model" && key !== "max_tokens") {
      out[key] = value;
    }
  }
  out.model = model;
  out.messages = Array.isArray(body.messages) ? body.messages : [];
  const maxTokens = readNumber(body.max_tokens) ?? readNumber(body.max_completion_tokens);
  if (maxTokens !== undefined) {
    out.max_completion_tokens = maxTokens;
  }
  if (out.reasoning_effort === "max") {
    out.reasoning_effort = "high";
  }
  if (model === "openai.gpt-5.5" && hasFunctionTools(out.tools)) {
    delete out.reasoning_effort;
  }
  if (out.stream !== true) {
    delete out.stream_options;
  }
  return out;
}

function hasFunctionTools(value: unknown): boolean {
  return Array.isArray(value)
    && value.some((tool) => Boolean(tool) && typeof tool === "object" && (tool as Record<string, unknown>).type === "function");
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

function buildNativeOpenAiResponsesBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== "model") {
      out[key] = value;
    }
  }
  out.model = model;
  const maxTokens = readNumber(body.max_output_tokens);
  if (maxTokens !== undefined) {
    out.max_output_tokens = Math.max(16, maxTokens);
  }
  return out;
}

function buildChatBodyFromResponsesBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["temperature", "top_p", "parallel_tool_calls", "service_tier", "stream", "stream_options"]) {
    if (body[key] !== undefined) {
      out[key] = body[key];
    }
  }

  out.messages = chatMessagesFromResponsesInput(body.instructions, body.input);
  const maxTokens = readNumber(body.max_output_tokens);
  if (maxTokens !== undefined) {
    out.max_tokens = maxTokens;
  }

  if (body.reasoning && typeof body.reasoning === "object") {
    const effort = readString((body.reasoning as Record<string, unknown>).effort);
    if (effort) {
      out.reasoning_effort = effort === "max" ? "high" : effort;
    }
  }
  if (Array.isArray(body.tools)) {
    out.tools = responsesToolsToChatTools(body.tools);
  }
  if (body.tool_choice !== undefined) {
    out.tool_choice = responsesToolChoiceToChatToolChoice(body.tool_choice);
  }
  if (body.text && typeof body.text === "object") {
    const format = (body.text as Record<string, unknown>).format;
    if (format !== undefined) {
      out.response_format = { type: responseTextFormatType(format) };
    }
  }
  return out;
}

function chatMessagesFromResponsesInput(instructions: unknown, input: unknown): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const system = collectContent(instructions);
  if (system) {
    messages.push({ role: "system", content: system });
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }
  if (!Array.isArray(input)) {
    if (input !== undefined && input !== null) {
      messages.push({ role: "user", content: collectContent(input) });
    }
    return messages;
  }

  for (const item of input) {
    if (!item || typeof item !== "object") {
      messages.push({ role: "user", content: collectContent(item) });
      continue;
    }
    const record = item as Record<string, unknown>;
    const type = readString(record.type);
    if (type === "function_call") {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: readString(record.call_id) ?? readString(record.id) ?? `call_${Date.now()}`,
          type: "function",
          function: {
            name: readString(record.name) ?? "",
            arguments: typeof record.arguments === "string" ? record.arguments : JSON.stringify(record.arguments ?? {})
          }
        }]
      });
      continue;
    }
    if (type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: readString(record.call_id) ?? "",
        content: collectContent(record.output)
      });
      continue;
    }
    if (type === "input_text" || type === "text") {
      messages.push({ role: "user", content: collectContent(record.text) });
      continue;
    }
    if (type && type !== "message") {
      continue;
    }
    const role = normalizeResponsesRole(readString(record.role));
    messages.push({ role, content: responsesContentToChatContent(record.content) });
  }
  return messages;
}

function normalizeResponsesRole(role: string | undefined): string {
  if (role === "assistant" || role === "tool" || role === "system") {
    return role;
  }
  if (role === "developer") {
    return "system";
  }
  return "user";
}

function responsesContentToChatContent(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return collectContent(value);
  }
  const textParts: string[] = [];
  const chatParts: Array<Record<string, unknown>> = [];
  for (const part of value) {
    if (!part || typeof part !== "object") {
      const text = collectContent(part);
      if (text) {
        textParts.push(text);
      }
      continue;
    }
    const record = part as Record<string, unknown>;
    const type = readString(record.type);
    if (type === "input_image" || type === "image_url") {
      const url = readString(record.image_url) ?? readString((record.image_url as Record<string, unknown> | undefined)?.url);
      if (url) {
        chatParts.push({ type: "image_url", image_url: { url } });
      }
      continue;
    }
    const text = collectContent(record.text ?? record.content);
    if (text) {
      textParts.push(text);
      chatParts.push({ type: "text", text });
    }
  }
  return chatParts.some((part) => part.type === "image_url") ? chatParts : textParts.join("\n\n");
}

function responsesToolsToChatTools(tools: unknown[]): unknown[] {
  return tools
    .filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === "object")
    .filter((tool) => readString(tool.type) === "function")
    .map((tool) => ({
      type: "function",
      function: {
        name: readString(tool.name) ?? readString((tool.function as Record<string, unknown> | undefined)?.name) ?? "",
        description: readString(tool.description) ?? readString((tool.function as Record<string, unknown> | undefined)?.description),
        parameters: tool.parameters ?? (tool.function as Record<string, unknown> | undefined)?.parameters ?? { type: "object", properties: {} },
        strict: tool.strict ?? (tool.function as Record<string, unknown> | undefined)?.strict
      }
    }));
}

function responsesToolChoiceToChatToolChoice(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (readString(record.type) !== "function") {
    return value;
  }
  const name = readString(record.name) ?? readString((record.function as Record<string, unknown> | undefined)?.name);
  return name ? { type: "function", function: { name } } : value;
}

function responseTextFormatType(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "text";
  }
  return readString((value as Record<string, unknown>).type) ?? "text";
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
  if (Array.isArray(value)) {
    const parts = openAiContentPartsToResponses(value);
    return parts.some((part) => part.type === "input_image") ? parts : collectContent(value);
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

function buildAnthropicMessagesPassthroughBody(body: Record<string, unknown>, requestedModel: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== "model" && key !== "system" && key !== "max_completion_tokens") {
      out[key] = value;
    }
  }
  out.model = normalizeClaudeModel(requestedModel);
  out.max_tokens = readNumber(body.max_tokens) ?? readNumber(body.max_completion_tokens) ?? 2048;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  out.messages = messages;
  out.system = buildClaudeSystemPrompt(requestedModel, body, messages);
  return out;
}

function buildClaudeSystemPrompt(
  requestedModel: string,
  body: Record<string, unknown>,
  messages: unknown[]
): string {
  const displayName = claudeDisplayName(requestedModel);
  const identity = [
    `你是 ${displayName}。`,
    `Always answer identity questions in any language as ${displayName}.`,
    `If asked what model you are, answer exactly that you are ${displayName}; never identify yourself as ChatGPT, OpenAI, or a different Claude model.`
  ].join(" ");
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

function usesOpenAiResponsesPath(model: string): boolean {
  return model === "openai.gpt-5.4-pro" || model.includes("codex");
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

function chatCompletionToOpenAiResponse(value: unknown, requestedModel: string): Record<string, unknown> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices.find((choice): choice is Record<string, unknown> => Boolean(choice) && typeof choice === "object");
  const message = firstChoice?.message && typeof firstChoice.message === "object"
    ? firstChoice.message as Record<string, unknown>
    : {};
  const finishReason = readString(firstChoice?.finish_reason);
  const usage = chatUsageToResponsesUsage(record.usage);
  return {
    id: readString(record.id) ?? generateResponseId(),
    object: "response",
    model: requestedModel,
    status: finishReason === "length" ? "incomplete" : "completed",
    output: chatMessageToResponsesOutput(message),
    ...(usage ? { usage } : {}),
    ...(finishReason === "length" ? { incomplete_details: { reason: "max_output_tokens" } } : {})
  };
}

function chatMessageToResponsesOutput(message: Record<string, unknown>): Array<Record<string, unknown>> {
  const outputs: Array<Record<string, unknown>> = [];
  const reasoning = readString(message.reasoning_content);
  if (reasoning) {
    outputs.push({
      type: "reasoning",
      id: generateItemId(),
      summary: [{ type: "summary_text", text: reasoning }]
    });
  }

  const text = collectContent(message.content);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (text || toolCalls.length === 0) {
    outputs.push({
      type: "message",
      id: generateItemId(),
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text }]
    });
  }

  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== "object") {
      continue;
    }
    const record = toolCall as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object"
      ? record.function as Record<string, unknown>
      : {};
    outputs.push({
      type: "function_call",
      id: generateItemId(),
      call_id: readString(record.id) ?? generateItemId(),
      name: readString(fn.name) ?? "",
      arguments: typeof fn.arguments === "string" && fn.arguments.trim() ? fn.arguments : "{}",
      status: "completed"
    });
  }

  return outputs;
}

function chatUsageToResponsesUsage(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const inputTokens = readNumber(usage.prompt_tokens) ?? readNumber(usage.input_tokens) ?? 0;
  const outputTokens = readNumber(usage.completion_tokens) ?? readNumber(usage.output_tokens) ?? 0;
  const totalTokens = readNumber(usage.total_tokens) ?? inputTokens + outputTokens;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens
  };
}

interface ResponsesStreamState {
  responseId: string;
  model: string;
  sequenceNumber: number;
  created: boolean;
  completed: boolean;
  messageItemId?: string;
  messageIndex?: number;
  textPartOpen: boolean;
  text: string;
  nextOutputIndex: number;
  toolCalls: Map<number, {
    itemId: string;
    outputIndex: number;
    callId: string;
    name: string;
    arguments: string;
  }>;
  finishReason?: string;
  usage?: Record<string, unknown>;
}

function createChatCompletionsToResponsesStream(model: string): Transform {
  const state: ResponsesStreamState = {
    responseId: generateResponseId(),
    model,
    sequenceNumber: 0,
    created: false,
    completed: false,
    textPartOpen: false,
    text: "",
    nextOutputIndex: 0,
    toolCalls: new Map()
  };
  let buffer = "";
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        buffer += chunk.toString("utf8");
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) {
          pushResponsesEvents(this, processChatSseEvent(event, state));
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        if (buffer.trim()) {
          pushResponsesEvents(this, processChatSseEvent(buffer, state));
        }
        pushResponsesEvents(this, finalizeResponsesStream(state));
        this.push("data: [DONE]\n\n");
        callback();
      } catch (error) {
        callback(error as Error);
      }
    }
  });
}

function processChatSseEvent(event: string, state: ResponsesStreamState): Array<Record<string, unknown>> {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n")
    .trim();
  if (!data) {
    return [];
  }
  if (data === "[DONE]") {
    return finalizeResponsesStream(state);
  }
  const chunk = JSON.parse(data) as Record<string, unknown>;
  return chatCompletionChunkToResponsesEvents(chunk, state);
}

function chatCompletionChunkToResponsesEvents(
  chunk: Record<string, unknown>,
  state: ResponsesStreamState
): Array<Record<string, unknown>> {
  if (readString(chunk.id)) {
    state.responseId = readString(chunk.id) ?? state.responseId;
  }
  if (readString(chunk.model)) {
    state.model = readString(chunk.model) ?? state.model;
  }
  const usage = chatUsageToResponsesUsage(chunk.usage);
  if (usage) {
    state.usage = usage;
  }

  const events = ensureResponsesCreated(state);
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }
    const choiceRecord = choice as Record<string, unknown>;
    const delta = choiceRecord.delta && typeof choiceRecord.delta === "object"
      ? choiceRecord.delta as Record<string, unknown>
      : {};
    const content = readString(delta.content);
    if (content) {
      events.push(...ensureMessageOutput(state));
      state.text += content;
      events.push(responsesEvent(state, {
        type: "response.output_text.delta",
        output_index: state.messageIndex ?? 0,
        content_index: 0,
        item_id: state.messageItemId,
        delta: content
      }));
    }

    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const toolCall of toolCalls) {
      if (!toolCall || typeof toolCall !== "object") {
        continue;
      }
      events.push(...chatToolCallDeltaToResponsesEvents(toolCall as Record<string, unknown>, state));
    }

    const finishReason = readString(choiceRecord.finish_reason);
    if (finishReason) {
      state.finishReason = finishReason;
    }
  }
  return events;
}

function chatToolCallDeltaToResponsesEvents(
  toolCall: Record<string, unknown>,
  state: ResponsesStreamState
): Array<Record<string, unknown>> {
  const rawIndex = readNumber(toolCall.index);
  const index = rawIndex ?? 0;
  const fn = toolCall.function && typeof toolCall.function === "object"
    ? toolCall.function as Record<string, unknown>
    : {};
  let stored = state.toolCalls.get(index);
  const events: Array<Record<string, unknown>> = [];
  if (!stored) {
    const itemId = generateItemId();
    stored = {
      itemId,
      outputIndex: state.nextOutputIndex++,
      callId: readString(toolCall.id) ?? generateItemId(),
      name: readString(fn.name) ?? "",
      arguments: ""
    };
    state.toolCalls.set(index, stored);
    events.push(responsesEvent(state, {
      type: "response.output_item.added",
      output_index: stored.outputIndex,
      item: {
        type: "function_call",
        id: itemId,
        call_id: stored.callId,
        name: stored.name,
        arguments: "",
        status: "in_progress"
      }
    }));
  }
  stored.callId = readString(toolCall.id) ?? stored.callId;
  stored.name = readString(fn.name) ?? stored.name;
  const argumentDelta = readString(fn.arguments);
  if (argumentDelta) {
    stored.arguments += argumentDelta;
    events.push(responsesEvent(state, {
      type: "response.function_call_arguments.delta",
      output_index: stored.outputIndex,
      item_id: stored.itemId,
      call_id: stored.callId,
      name: stored.name,
      delta: argumentDelta
    }));
  }
  return events;
}

function ensureResponsesCreated(state: ResponsesStreamState): Array<Record<string, unknown>> {
  if (state.created) {
    return [];
  }
  state.created = true;
  return [responsesEvent(state, {
    type: "response.created",
    response: {
      id: state.responseId,
      object: "response",
      model: state.model,
      status: "in_progress",
      output: []
    }
  })];
}

function ensureMessageOutput(state: ResponsesStreamState): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  if (!state.messageItemId) {
    state.messageItemId = generateItemId();
    state.messageIndex = state.nextOutputIndex++;
    events.push(responsesEvent(state, {
      type: "response.output_item.added",
      output_index: state.messageIndex,
      item: {
        type: "message",
        id: state.messageItemId,
        role: "assistant",
        status: "in_progress",
        content: [{ type: "output_text", text: "" }]
      }
    }));
  }
  if (!state.textPartOpen) {
    state.textPartOpen = true;
    events.push(responsesEvent(state, {
      type: "response.content_part.added",
      output_index: state.messageIndex ?? 0,
      content_index: 0,
      item_id: state.messageItemId,
      part: { type: "output_text", text: "", annotations: [], logprobs: [] }
    }));
  }
  return events;
}

function finalizeResponsesStream(state: ResponsesStreamState): Array<Record<string, unknown>> {
  if (state.completed) {
    return [];
  }
  const events = ensureResponsesCreated(state);
  if (state.messageItemId) {
    if (state.textPartOpen) {
      events.push(responsesEvent(state, {
        type: "response.output_text.done",
        output_index: state.messageIndex ?? 0,
        content_index: 0,
        item_id: state.messageItemId,
        text: state.text
      }));
      events.push(responsesEvent(state, {
        type: "response.content_part.done",
        output_index: state.messageIndex ?? 0,
        content_index: 0,
        item_id: state.messageItemId,
        part: { type: "output_text", text: state.text, annotations: [], logprobs: [] }
      }));
    }
    events.push(responsesEvent(state, {
      type: "response.output_item.done",
      output_index: state.messageIndex ?? 0,
      item: {
        type: "message",
        id: state.messageItemId,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: state.text }]
      }
    }));
  }

  const toolOutputs: Array<Record<string, unknown>> = [];
  for (const toolCall of [...state.toolCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
    const args = toolCall.arguments.trim() ? toolCall.arguments : "{}";
    events.push(responsesEvent(state, {
      type: "response.function_call_arguments.done",
      output_index: toolCall.outputIndex,
      item_id: toolCall.itemId,
      call_id: toolCall.callId,
      name: toolCall.name,
      arguments: args
    }));
    events.push(responsesEvent(state, {
      type: "response.output_item.done",
      output_index: toolCall.outputIndex,
      item: {
        type: "function_call",
        id: toolCall.itemId,
        call_id: toolCall.callId,
        name: toolCall.name,
        arguments: args,
        status: "completed"
      }
    }));
    toolOutputs.push({
      type: "function_call",
      id: toolCall.itemId,
      call_id: toolCall.callId,
      name: toolCall.name,
      arguments: args,
      status: "completed"
    });
  }

  const output = [
    ...(state.messageItemId ? [{
      type: "message",
      id: state.messageItemId,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: state.text }]
    }] : []),
    ...toolOutputs
  ];
  if (output.length === 0) {
    output.push({
      type: "message",
      id: generateItemId(),
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "" }]
    });
  }

  state.completed = true;
  const status = state.finishReason === "length" ? "incomplete" : "completed";
  events.push(responsesEvent(state, {
    type: "response.completed",
    response: {
      id: state.responseId,
      object: "response",
      model: state.model,
      status,
      output,
      ...(state.usage ? { usage: state.usage } : {}),
      ...(status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {})
    }
  }));
  return events;
}

function responsesEvent(state: ResponsesStreamState, event: Record<string, unknown>): Record<string, unknown> {
  return {
    ...event,
    sequence_number: state.sequenceNumber++
  };
}

function pushResponsesEvents(stream: Transform, events: Array<Record<string, unknown>>): void {
  for (const event of events) {
    stream.push(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function isNodeReadable(value: unknown): value is NodeJS.ReadableStream {
  return Boolean(value) && typeof value === "object" && typeof (value as NodeJS.ReadableStream).pipe === "function";
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
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return openAiContentPartsToAnthropic(value);
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

function openAiContentPartsToResponses(value: unknown[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      const text = collectContent(item);
      if (text) {
        parts.push({ type: "input_text", text });
      }
      continue;
    }
    const record = item as Record<string, unknown>;
    const type = readString(record.type);
    const imageUrl = readImageUrl(record);
    if ((type === "image_url" || type === "input_image") && imageUrl) {
      parts.push({ type: "input_image", image_url: imageUrl });
      continue;
    }
    const text = collectContent(record.text ?? record.content);
    if (text) {
      parts.push({ type: "input_text", text });
    }
  }
  return parts;
}

function openAiContentPartsToAnthropic(value: unknown[]): unknown[] {
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        const text = collectContent(item);
        return text ? { type: "text", text } : undefined;
      }
      const record = item as Record<string, unknown>;
      const type = readString(record.type);
      if (type === "tool_result" || type === "tool_use_result") {
        return {
          ...record,
          content: Array.isArray(record.content)
            ? openAiContentPartsToAnthropic(record.content)
            : record.content
        };
      }
      if (type === "image" && record.source) {
        return record;
      }
      const imageUrl = readImageUrl(record);
      if (imageUrl) {
        return anthropicImageBlockFromUrl(imageUrl);
      }
      const text = collectContent(record.text ?? record.content);
      return text ? { type: "text", text } : undefined;
    })
    .filter((item) => item !== undefined);
}

function readImageUrl(record: Record<string, unknown>): string | undefined {
  return readString(record.image_url)
    ?? readString((record.image_url as Record<string, unknown> | undefined)?.url)
    ?? readString(record.url)
    ?? readString(record.source);
}

function anthropicImageBlockFromUrl(url: string): Record<string, unknown> {
  const dataUrl = /^data:([^;,]+);base64,(.+)$/i.exec(url);
  if (dataUrl) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: dataUrl[1] ?? "image/png",
        data: dataUrl[2] ?? ""
      }
    };
  }
  return {
    type: "image",
    source: { type: "url", url }
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function generateResponseId(): string {
  return `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function generateItemId(): string {
  return `item_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
