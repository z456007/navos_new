import { randomBytes } from "node:crypto";
import type { FetchLike } from "../http.js";

export interface YydsMailbox {
  address: string;
  id?: string;
  token?: string;
}

export interface YydsMailClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  localPartFactory?: () => string;
}

export interface YydsMailboxAuth {
  address: string;
  token?: string;
}

export class YydsMailError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "YydsMailError";
    this.status = status;
    this.details = details;
  }
}

export class YydsMailClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly localPartFactory: () => string;

  constructor(options: YydsMailClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.localPartFactory = options.localPartFactory ?? defaultLocalPart;
  }

  async createMailbox(): Promise<YydsMailbox> {
    if (!this.apiKey) {
      throw new YydsMailError("YYDS Mail API key is not configured", 500, undefined);
    }

    const data = await this.request<{ address?: unknown; id?: unknown; token?: unknown }>("/accounts", {
      method: "POST",
      headers: this.headers({ json: true, apiKey: true }),
      body: JSON.stringify({ localPart: this.localPartFactory() })
    });

    if (typeof data.address !== "string" || !data.address) {
      throw new YydsMailError("YYDS Mail response did not include mailbox address", 502, data);
    }

    return {
      address: data.address,
      id: typeof data.id === "string" ? data.id : undefined,
      token: typeof data.token === "string" ? data.token : undefined
    };
  }

  async listMessages(auth: YydsMailboxAuth): Promise<unknown[]> {
    const data = await this.request<unknown>("/messages", {
      method: "GET",
      headers: this.headers({ token: auth.token }),
      address: auth.address
    });
    return normalizeMessageList(data);
  }

  async getMessage(messageId: string, auth: YydsMailboxAuth): Promise<unknown> {
    if (!messageId) {
      throw new YydsMailError("messageId is required", 400, undefined);
    }
    return this.request<unknown>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "GET",
      headers: this.headers({ token: auth.token }),
      address: auth.address
    });
  }

  async findVerificationCode(auth: YydsMailboxAuth): Promise<{ code?: string; message?: unknown }> {
    const messages = await this.listMessages(auth);
    for (const message of messages) {
      const messageId = readString(message, ["id", "messageId", "_id"]);
      const inlineCode = extractVerificationCode(message);
      if (inlineCode) {
        return { code: inlineCode, message };
      }
      if (!messageId) {
        continue;
      }
      const detail = await this.getMessage(messageId, auth);
      const detailCode = extractVerificationCode(detail);
      if (detailCode) {
        return { code: detailCode, message: detail };
      }
    }
    return {};
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST";
      headers: Record<string, string>;
      body?: BodyInit;
      address?: string;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.address) {
      url.searchParams.set("address", options.address);
    }
    const response = await this.fetchImpl(url.toString(), {
      method: options.method,
      headers: options.headers,
      body: options.body
    });
    const raw = await readBody(response);
    const parsed = parseJson(raw);
    if (!response.ok || parsedSuccessFalse(parsed)) {
      throw new YydsMailError(errorMessage(parsed, raw), response.status, parsed ?? raw);
    }
    return unwrapData(parsed) as T;
  }

  private headers(options: { json?: boolean; apiKey?: boolean; token?: string }): Record<string, string> {
    const headers: Record<string, string> = {
      "accept": "application/json",
      "user-agent": "NavosProtocolAdapter/0.1"
    };
    if (options.json) {
      headers["content-type"] = "application/json";
    }
    if (options.token) {
      headers["authorization"] = `Bearer ${options.token}`;
    } else if (options.apiKey || this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }
    return headers;
  }
}

function defaultLocalPart(): string {
  return `navos-${randomBytes(4).toString("hex")}`;
}

async function readBody(response: Response): Promise<string> {
  return response.text();
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parsedSuccessFalse(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).success === false);
}

function unwrapData(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) {
    return (value as Record<string, unknown>).data;
  }
  return value;
}

function normalizeMessageList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  for (const key of ["messages", "items", "list", "rows", "data"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const nested = normalizeMessageList(candidate);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  return [];
}

function errorMessage(parsed: unknown, raw: string): string {
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const detail = record.errorCode ?? record.error ?? record.message;
    if (typeof detail === "string" && detail) {
      return `YYDS Mail request failed: ${detail}`;
    }
  }
  return `YYDS Mail request failed: ${raw.slice(0, 200)}`;
}

function readString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return undefined;
}

function collectText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(collectText).join("\n");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return ["text", "textBody", "html", "htmlBody", "body", "content", "subject", "summary", "snippet"]
      .map((key) => collectText(record[key]))
      .join("\n");
  }
  return "";
}

export function extractVerificationCode(value: unknown): string | undefined {
  const text = collectText(value);
  const targeted = /(?:验证码|校验码|动态码|code|verification)[^0-9]{0,20}(\d{4,8})/i.exec(text);
  if (targeted?.[1]) {
    return targeted[1];
  }
  return /\b(\d{6})\b/.exec(text)?.[1];
}
