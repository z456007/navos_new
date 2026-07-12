export type ProviderFailureKind = "quota_exhausted" | "invalid_account" | "rate_limited" | "temporary" | "user_error" | "none";
export type ProviderAccountAction = "deplete" | "disable" | "cooldown" | "release" | "none";

export interface ProviderFailureDecision {
  kind: ProviderFailureKind;
  accountAction: ProviderAccountAction;
  externalStatus: number;
  message: string;
  retryAfterSeconds?: number;
}

export interface ProviderClassifierResultInput {
  status: number;
  body: unknown;
  headers: Headers;
}

type ClassifiedKind = Exclude<ProviderFailureKind, "none">;

const QUOTA_PATTERN = /insufficient[_ -]?balance|quota[_ -]?(exhausted|exceeded)|积分不足|余额不足|额度不足/i;
const INVALID_ACCOUNT_PATTERN = /invalid.*token|token.*invalid|credential|unauthorized|authentication|banned|account.*disabled/i;
const RATE_LIMIT_PATTERN = /rate.?limit|too many|temporarily unavailable|try again later|频率.*限制|请求频率|限流|稍后再试/i;
const USER_ERROR_PATTERN = /invalid|bad request|unsupported|policy|content|prompt|image_url|parameter|参数/i;

export function classifyProviderResult(result: ProviderClassifierResultInput): ProviderFailureDecision {
  const errorText = providerErrorText(result.body, result.status >= 400);
  if (result.status >= 200 && result.status < 300 && !errorText) {
    return {
      kind: "none",
      accountAction: "none",
      externalStatus: result.status,
      message: "success"
    };
  }

  const kind = classifyErrorText(errorText, result.status);
  return decisionForKind(kind, {
    status: result.status,
    message: errorText || defaultMessageForKind(kind),
    retryAfterSeconds: parseRetryAfterSeconds(result.headers)
  });
}

export function classifyProviderSseEvent(event: string): ProviderFailureDecision | undefined {
  const lines = event.split(/\r?\n/);
  const eventName = lines
    .map((line) => /^event:\s*(.+)$/i.exec(line)?.[1]?.trim().toLowerCase())
    .find(Boolean);
  const data = lines
    .map((line) => /^data:\s?(.*)$/i.exec(line)?.[1])
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .trim();

  if (!data || data === "[DONE]" || eventName !== "error") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    const errorText = providerErrorText(parsed, true);
    return errorText ? classifyTextDecision(errorText, 200) : undefined;
  } catch {
    return classifyTextDecision(data, 200);
  }
}

export function classifyProviderException(error: unknown): ProviderFailureDecision {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Upstream request failed";
  return {
    kind: "temporary",
    accountAction: "cooldown",
    externalStatus: 502,
    message
  };
}

export function providerFailureIsAccountRetryable(decision: ProviderFailureDecision): boolean {
  return decision.accountAction === "deplete"
    || decision.accountAction === "disable"
    || decision.accountAction === "cooldown";
}

function classifyTextDecision(text: string, status: number): ProviderFailureDecision | undefined {
  const kind = classifyErrorText(text, status);
  if (kind === "temporary" && status >= 200 && status < 300 && !hasKnownFailureSignal(text)) {
    return undefined;
  }
  return decisionForKind(kind, { status, message: text });
}

function classifyErrorText(text: string | undefined, status: number): ClassifiedKind {
  const value = text ?? "";
  if (status === 402 || QUOTA_PATTERN.test(value)) {
    return "quota_exhausted";
  }
  if (status === 401 || INVALID_ACCOUNT_PATTERN.test(value)) {
    return "invalid_account";
  }
  if (status === 429 || RATE_LIMIT_PATTERN.test(value)) {
    return "rate_limited";
  }
  if (status >= 400 && status < 500 && USER_ERROR_PATTERN.test(value)) {
    return "user_error";
  }
  return "temporary";
}

function hasKnownFailureSignal(text: string): boolean {
  return QUOTA_PATTERN.test(text)
    || INVALID_ACCOUNT_PATTERN.test(text)
    || RATE_LIMIT_PATTERN.test(text)
    || USER_ERROR_PATTERN.test(text);
}

function decisionForKind(
  kind: ClassifiedKind,
  input: { status: number; message: string; retryAfterSeconds?: number }
): ProviderFailureDecision {
  switch (kind) {
    case "quota_exhausted":
      return {
        kind,
        accountAction: "deplete",
        externalStatus: 503,
        message: input.message
      };
    case "invalid_account":
      return {
        kind,
        accountAction: "disable",
        externalStatus: 503,
        message: input.message
      };
    case "rate_limited":
      return {
        kind,
        accountAction: "cooldown",
        externalStatus: 429,
        message: input.message,
        ...(input.retryAfterSeconds ? { retryAfterSeconds: input.retryAfterSeconds } : {})
      };
    case "user_error":
      return {
        kind,
        accountAction: "release",
        externalStatus: input.status,
        message: input.message
      };
    case "temporary":
      return {
        kind,
        accountAction: "cooldown",
        externalStatus: input.status === 503 ? 503 : 502,
        message: input.message
      };
  }
}

function defaultMessageForKind(kind: ClassifiedKind): string {
  switch (kind) {
    case "quota_exhausted":
      return "Provider quota exhausted";
    case "invalid_account":
      return "Provider account is invalid";
    case "rate_limited":
      return "Provider rate limited the request";
    case "user_error":
      return "Provider rejected the request";
    case "temporary":
      return "Provider request failed temporarily";
  }
}

function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) {
    return undefined;
  }
  const seconds = Number.parseInt(value, 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function providerErrorText(value: unknown, forceErrorContext = false): string | undefined {
  if (typeof value === "string") {
    return forceErrorContext ? value : undefined;
  }
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const parts = collectErrorTextParts(value, forceErrorContext);
  const uniqueParts = [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
  return uniqueParts.length > 0 ? uniqueParts.join(" ") : undefined;
}

function collectErrorTextParts(record: Record<string, unknown>, forceErrorContext: boolean): string[] {
  const parts: string[] = [];
  const explicitError = record.error;
  const hasExplicitError = explicitError !== undefined && explicitError !== null;
  const type = stringPart(record.type);
  const code = stringPart(record.code) ?? stringPart(record.error_code) ?? stringPart(record.status_code);
  const status = stringPart(record.status);
  const hasErrorContext = forceErrorContext
    || hasExplicitError
    || Boolean(type && /error|failed|failure/i.test(type))
    || Boolean(status && statusIndicatesError(status))
    || Boolean(code && code !== "0" && code !== "200");

  if (typeof explicitError === "string") {
    parts.push(explicitError);
  } else if (isPlainRecord(explicitError)) {
    parts.push(...collectErrorTextParts(explicitError, true));
  }

  if (hasErrorContext) {
    parts.push(...errorRecordTextParts(record));
  }

  for (const key of ["data", "result"] as const) {
    const nested = record[key];
    if (isPlainRecord(nested)) {
      const nestedParts = collectErrorTextParts(nested, hasErrorContext);
      parts.push(...nestedParts);
    }
  }

  return parts;
}

function errorRecordTextParts(record: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const key of ["message", "msg", "error_message", "type", "code", "error_code", "status_code", "reason"]) {
    const part = stringPart(record[key]);
    if (part) {
      parts.push(part);
    }
  }
  const status = stringPart(record.status);
  if (status && statusIndicatesError(status)) {
    parts.push(status);
  }
  return parts;
}

function statusIndicatesError(status: string): boolean {
  return /fail|error|cancel|reject|denied|invalid|expired/i.test(status);
}

function stringPart(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
