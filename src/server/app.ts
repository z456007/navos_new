import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { AccountIdentity, HeaderBag, ProviderAuthMode } from "../protocols/auth.js";
import { buildProviderAuthHeaders, isClientAuthorized } from "../protocols/auth.js";
import type { FetchLike, ProviderResult } from "../protocols/http.js";
import { ProviderHttpClient } from "../protocols/http.js";
import {
  buildImageGenerationPayload,
  createImageGeneration,
  imageTaskPollPathForPayload,
  pollImageTask,
  readImageTaskId
} from "../protocols/image.js";
import {
  forwardModelRequest,
  isPublicProxyChatModelAllowed,
  isPublicProxyMessagesModelAllowed,
  isPublicProxyResponsesModelAllowed,
  LOCAL_MODEL_IDS,
  normalizePublicProxyModelId,
  PUBLIC_PROXY_MODEL_IDS
} from "../protocols/model-proxy.js";
import { registerAccount } from "../protocols/register.js";
import { uploadAsset } from "../protocols/upload.js";
import type { VipBalanceClient } from "../protocols/vip-client.js";
import {
  assertVideoGenerationRules,
  createVideoTask,
  getVideoTask,
  isSeedanceVideoModel,
  normalizeVideoTaskStatus,
  prepareVideoTaskPayload,
  type NormalizedVideoTask
} from "../protocols/video.js";
import { YydsMailClient, YydsMailError } from "../protocols/mail/yyds-mail.js";
import { AccountService, IMAGE_ACCOUNT_COST } from "../services/account-service.js";
import {
  assertYydsDomainPoolConfigInput,
  isValidYydsDomainPoolDomain,
  normalizeYydsDomainPoolConfigInput,
  YYDS_DOMAIN_POOL_MAX_DOMAINS,
  YydsDomainPool,
  YydsDomainPoolConfigValidationError,
  YydsDomainPoolSourceValidationError,
  type YydsFetchedDomain
} from "../services/yyds-domain-pool.js";
import {
  YydsMailConfigDecryptError,
  YydsMailConfigService,
  type YydsMailConfigInput
} from "../services/yyds-mail-config-service.js";
import { SecretBox } from "../security/secretbox.js";
import { InMemoryAccountStore, type AccountRecord } from "../store/account-store.js";
import { InMemoryImageTaskStore, type ImageTaskRecord, type ImageTaskStore } from "../store/image-task-store.js";
import { InMemoryYydsDomainPoolStore, type YydsDomainPoolStore } from "../store/yyds-domain-pool-store.js";
import { InMemoryYydsMailConfigStore, type YydsMailConfigStore } from "../store/yyds-mail-config-store.js";
import { InMemoryVideoTaskStore, type VideoTaskRecord, type VideoTaskStore } from "../store/video-task-store.js";
import type { RegistrationService } from "../services/registration-service.js";
import {
  RegistrationJobNotFoundError,
  RegistrationQueueUnavailableError,
  type RegistrationJobServicePort
} from "../services/registration-job-service.js";
import type { RegistrationJobCreateInput } from "../services/registration-job-types.js";

export interface CreateAppOptions {
  masterApiKey: string;
  publicProxyApiKeys?: string[];
  providerBaseUrl: string;
  providerAuthMode: ProviderAuthMode;
  defaultAccount?: AccountIdentity;
  accountService?: AccountService;
  yydsMailBaseUrl?: string;
  yydsMailConfigSecret?: string;
  yydsMailConfigStore?: YydsMailConfigStore;
  yydsDomainPoolStore?: YydsDomainPoolStore;
  yydsDomainFetchImpl?: () => Promise<unknown[]>;
  imageTaskStore?: ImageTaskStore;
  videoTaskStore?: VideoTaskStore;
  fetchImpl?: FetchLike;
  vipClient?: VipBalanceClient;
  registrationService?: RegistrationService;
  registrationJobService?: RegistrationJobServicePort;
  imageMaxPollAttempts?: number;
  imagePollIntervalMs?: number;
  imageAccountWaitMs?: number;
  modelAccountWaitMs?: number;
}

interface UploadRequestBody {
  source?: unknown;
  filename?: unknown;
}

interface MailboxQuery {
  address?: string;
  token?: string;
}

interface CooldownBody {
  seconds?: unknown;
}

interface ProviderAuthContext {
  account: AccountRecord;
  leaseId?: string;
  headers: Record<string, string>;
}

type ProviderFailureKind = "quota" | "temporary" | "invalid";

interface ProviderFailureDecision {
  kind: ProviderFailureKind;
  text: string;
}

const CORS_ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const CORS_DEFAULT_ALLOW_HEADERS = "authorization,content-type,x-api-key";
const CORS_MAX_AGE_SECONDS = "86400";
const JSON_BODY_LIMIT_BYTES = 64 * 1024 * 1024;
const MODEL_PROXY_MAX_ATTEMPTS = 5;
const MODEL_PROXY_RETRY_COOLDOWN_SECONDS = 30;
const DEFAULT_IMAGE_ACCOUNT_WAIT_MS = 120_000;
const DEFAULT_MODEL_ACCOUNT_WAIT_MS = 30_000;
const ACCOUNT_WAIT_POLL_INTERVAL_MS = 100;
const DEFAULT_YYDS_DOMAINS_URL = "https://maliapi.215.im/v1/domains";
const YYDS_DOMAIN_FETCH_TIMEOUT_MS = 10_000;

function headersFromRequest(request: FastifyRequest): HeaderBag {
  const headers: HeaderBag = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string" || Array.isArray(value)) {
      headers[key] = value;
    }
  }
  return headers;
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

function applyCorsHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const origin = headerString(request.headers.origin);
  if (!origin) {
    return;
  }

  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", CORS_ALLOW_METHODS);
  reply.header(
    "access-control-allow-headers",
    headerString(request.headers["access-control-request-headers"]) ?? CORS_DEFAULT_ALLOW_HEADERS
  );
  reply.header("access-control-max-age", CORS_MAX_AGE_SECONDS);
}

function bodyRecord(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === "object"
    ? request.body as Record<string, unknown>
    : {};
}

async function sendProviderResult(reply: FastifyReply, result: ProviderResult): Promise<void> {
  copyProviderResponseHeaders(reply, result.headers);
  await reply.status(result.status).send(result.body);
}

function copyProviderResponseHeaders(reply: FastifyReply, headers: Headers): void {
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if ([
      "connection",
      "content-length",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade"
    ].includes(lower)) {
      return;
    }
    reply.header(key, value);
  });
}

function providerResultBodyText(result: ProviderResult): string {
  return typeof result.body === "string"
    ? result.body
    : JSON.stringify(result.body) ?? "";
}

function providerResultIndicatesQuotaExhausted(result: ProviderResult): boolean {
  if (result.status === 402) {
    return true;
  }
  return providerFailureDecisionFromText(providerResultErrorText(result))?.kind === "quota";
}

function providerResultIndicatesTemporaryFailure(result: ProviderResult): boolean {
  const errorText = providerResultErrorText(result);
  if (result.status === 403 && /access|permission|forbidden|model|not available/i.test(errorText)) {
    return true;
  }
  if ([408, 409, 425, 429].includes(result.status) || result.status >= 500) {
    return true;
  }
  return providerFailureDecisionFromText(errorText)?.kind === "temporary";
}

function providerResultIndicatesInvalidAccount(result: ProviderResult): boolean {
  const errorText = providerResultErrorText(result);
  if (result.status === 403) {
    return /banned|disabled|invalid.*token|credential/i.test(errorText);
  }
  if (result.status === 401) {
    return true;
  }
  return providerFailureDecisionFromText(errorText)?.kind === "invalid";
}

function providerResultErrorText(result: ProviderResult): string {
  if (result.status >= 400) {
    return providerResultBodyText(result);
  }
  return providerStructuredErrorText(result.body) ?? "";
}

function providerStructuredErrorText(value: unknown, forceErrorContext: boolean = false): string | undefined {
  if (typeof value === "string") {
    return forceErrorContext ? value : undefined;
  }
  if (!isPlainRecordValue(value)) {
    return undefined;
  }

  const parts: string[] = [];
  const explicitError = value.error;
  if (typeof explicitError === "string") {
    parts.push(explicitError);
  } else if (isPlainRecordValue(explicitError)) {
    parts.push(...errorRecordTextParts(explicitError));
  }

  const code = readProviderErrorNumber(value.code)
    ?? readProviderErrorNumber(value.status)
    ?? readProviderErrorNumber(value.status_code);
  const type = readProviderErrorString(value.type);
  const hasErrorContext = forceErrorContext
    || parts.length > 0
    || Boolean(type && /error|failed|failure/i.test(type))
    || (code !== undefined && code !== 0 && code !== 200);

  if (hasErrorContext) {
    parts.push(...errorRecordTextParts(value));
    if (isPlainRecordValue(value.data)) {
      const nested = providerStructuredErrorText(value.data, true);
      if (nested) {
        parts.push(nested);
      }
    }
  }

  const uniqueParts = [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
  return uniqueParts.length > 0 ? uniqueParts.join(" ") : undefined;
}

function errorRecordTextParts(record: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const key of ["message", "msg", "error_message", "type", "code", "error_code", "status", "status_code", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      parts.push(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      parts.push(String(value));
    }
  }
  return parts;
}

function readProviderErrorString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readProviderErrorNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPlainRecordValue(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function providerFailureDecisionFromText(text: string | undefined): ProviderFailureDecision | undefined {
  if (!text) {
    return undefined;
  }
  if (/insufficient_balance|积分不足|余额不足/i.test(text)) {
    return { kind: "quota", text };
  }
  if (/banned|disabled|invalid.*token|credential|unauthorized|authentication/i.test(text)) {
    return { kind: "invalid", text };
  }
  if (/temporar|rate.?limit|too many|timeout|timed out|overload|upstream|access|permission|forbidden|model|not available/i.test(text)) {
    return { kind: "temporary", text };
  }
  return undefined;
}

function isNodeReadable(value: unknown): value is NodeJS.ReadableStream {
  return Boolean(value) && typeof value === "object" && typeof (value as NodeJS.ReadableStream).pipe === "function";
}

function createProviderFailureDetectionStream(
  onFailure: (decision: ProviderFailureDecision) => Promise<void>
): Transform {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let detected = false;

  function inspectText(text: string): ProviderFailureDecision | undefined {
    if (!text || detected) {
      return undefined;
    }
    buffer += text;
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    if (buffer.length > 64 * 1024) {
      buffer = buffer.slice(-64 * 1024);
    }
    return firstProviderFailureDecisionFromSseEvents(events);
  }

  function completeDetection(decision: ProviderFailureDecision | undefined, done: (error?: Error | null) => void): boolean {
    if (!decision || detected) {
      return false;
    }
    detected = true;
    Promise.resolve(onFailure(decision)).then(
      () => done(),
      (error: unknown) => done(error instanceof Error ? error : new Error(String(error)))
    );
    return true;
  }

  return new Transform({
    transform(chunk, encoding, callback) {
      const text = typeof chunk === "string"
        ? decoder.write(Buffer.from(chunk, encoding as BufferEncoding))
        : decoder.write(Buffer.from(chunk as Uint8Array));
      const decision = inspectText(text);
      if (decision && !detected) {
        detected = true;
        Promise.resolve(onFailure(decision)).then(
          () => {
            this.push(chunk);
            callback();
          },
          (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)))
        );
        return;
      }
      this.push(chunk);
      callback();
    },
    flush(callback) {
      const decision = inspectText(decoder.end()) ?? firstProviderFailureDecisionFromSseEvents(buffer.trim() ? [buffer] : []);
      if (completeDetection(decision, callback)) {
        return;
      }
      callback();
    }
  });
}

function firstProviderFailureDecisionFromSseEvents(events: string[] | string): ProviderFailureDecision | undefined {
  const list = typeof events === "string" ? [events] : events;
  for (const event of list) {
    const decision = providerFailureDecisionFromSseEvent(event);
    if (decision) {
      return decision;
    }
  }
  return undefined;
}

function providerFailureDecisionFromSseEvent(event: string): ProviderFailureDecision | undefined {
  const lines = event.split(/\r?\n/);
  const eventName = lines
    .map((line) => /^event:\s*(.+)$/i.exec(line)?.[1]?.trim().toLowerCase())
    .find(Boolean);
  const data = lines
    .map((line) => /^data:\s?(.*)$/i.exec(line)?.[1])
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    return providerFailureDecisionFromText(providerStructuredErrorText(parsed, eventName === "error"));
  } catch {
    return eventName === "error" ? providerFailureDecisionFromText(data) : undefined;
  }
}

function providerExceptionResult(error: unknown): ProviderResult {
  return {
    status: 502,
    body: {
      error: {
        message: error instanceof Error ? error.message : "Upstream request failed",
        type: "upstream_error"
      }
    },
    headers: new Headers()
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function imageResultIsRetryable(result: ProviderResult): boolean {
  if (result.status < 500) {
    return false;
  }
  const bodyText = providerResultBodyText(result);
  return /Image task failed|创建图片任务失败|upstream|server_error|temporar/i.test(bodyText);
}

function localModelCatalog() {
  return {
    object: "list",
    data: LOCAL_MODEL_IDS.map((id) => ({
      id,
      object: "model",
      owned_by: "navos"
    }))
  };
}

function publicModelCatalog() {
  return {
    object: "list",
    data: PUBLIC_PROXY_MODEL_IDS.map((id) => ({
      id,
      object: "model",
      owned_by: "navos"
    }))
  };
}

function readBodyModel(body: Record<string, unknown>): string | undefined {
  return typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
}

function normalizePublicProxyBody(body: Record<string, unknown>): Record<string, unknown> {
  const model = normalizePublicProxyModelId(readBodyModel(body));
  return model && model !== body.model ? { ...body, model } : body;
}

function isPublicChatModelAllowed(model: string | undefined): boolean {
  return isPublicProxyChatModelAllowed(model);
}

function isPublicMessagesModelAllowed(model: string | undefined): boolean {
  return isPublicProxyMessagesModelAllowed(model);
}

function isPublicResponsesModelAllowed(model: string | undefined): boolean {
  return isPublicProxyResponsesModelAllowed(model);
}

function isPublicImageModelAllowed(model: string | undefined): boolean {
  return model === undefined || model === "gpt-image-2";
}

function normalizeSecretRoot(value: string): string {
  return value.length >= 32 ? value : createHash("sha256").update(value).digest("hex");
}

class YydsDomainFetchError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("YYDS domain fetch failed");
    this.name = "YydsDomainFetchError";
    this.cause = cause;
  }
}

async function fetchPublicYydsDomains(fetchImpl: FetchLike = fetch): Promise<YydsFetchedDomain[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YYDS_DOMAIN_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(DEFAULT_YYDS_DOMAINS_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch YYDS public domains: ${response.status} ${response.statusText}`.trim());
    }

    const body = await response.json() as unknown;
    const domains = Array.isArray(body)
      ? body
      : isPlainRecordValue(body) && Array.isArray(body.data)
        ? body.data
        : undefined;
    if (!domains) {
      throw new Error("YYDS public domains response must be an array or { data: array }");
    }
    return normalizeFetchedYydsDomains(domains);
  } catch (error) {
    throw new YydsDomainFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchInjectedYydsDomains(fetchDomains: () => Promise<unknown[]>): Promise<YydsFetchedDomain[]> {
  try {
    return normalizeFetchedYydsDomains(await fetchDomains());
  } catch (error) {
    throw new YydsDomainFetchError(error);
  }
}

function normalizeFetchedYydsDomains(domains: unknown[]): YydsFetchedDomain[] {
  if (domains.length > YYDS_DOMAIN_POOL_MAX_DOMAINS) {
    throw new Error(`YYDS public domains response contains more than ${YYDS_DOMAIN_POOL_MAX_DOMAINS} domains`);
  }
  const normalized = domains
    .filter((item): item is Record<string, unknown> => (
      isPlainRecordValue(item)
      && typeof item.domain === "string"
      && isValidYydsDomainPoolDomain(item.domain)
    ))
    .map((item) => item as unknown as YydsFetchedDomain);
  if (domains.length > 0 && normalized.length === 0) {
    throw new Error("YYDS public domains response did not contain valid domain records");
  }
  return normalized;
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: JSON_BODY_LIMIT_BYTES });
  const accountService = options.accountService ?? new AccountService(new InMemoryAccountStore(options.defaultAccount));
  const yydsMailConfigStore = options.yydsMailConfigStore ?? new InMemoryYydsMailConfigStore();
  const yydsDomainPoolStore = options.yydsDomainPoolStore ?? new InMemoryYydsDomainPoolStore();
  const yydsDomainPool = new YydsDomainPool({
    store: yydsDomainPoolStore,
    fetchDomains: async () => (options.yydsDomainFetchImpl
      ? fetchInjectedYydsDomains(options.yydsDomainFetchImpl)
      : fetchPublicYydsDomains(options.fetchImpl))
  });
  let yydsDomainPoolRefreshInflight: Promise<Awaited<ReturnType<YydsDomainPool["refresh"]>>> | undefined;
  const yydsMailConfigService = new YydsMailConfigService(
    yydsMailConfigStore,
    new SecretBox(
      normalizeSecretRoot(options.yydsMailConfigSecret ?? options.masterApiKey),
      "navos:yyds_mail_config:v1"
    )
  );
  const videoTaskStore = options.videoTaskStore ?? new InMemoryVideoTaskStore();
  const imageTaskStore = options.imageTaskStore ?? new InMemoryImageTaskStore();
  const client = new ProviderHttpClient(options.providerBaseUrl, options.fetchImpl);
  let providerRegistrationAttempt: Promise<boolean> | undefined;

  app.addHook("onRequest", async (request, reply) => {
    applyCorsHeaders(request, reply);
    if (request.method === "OPTIONS") {
      await reply.status(204).send();
    }
  });

  function isLocalAuthorized(request: FastifyRequest): boolean {
    return isClientAuthorized(headersFromRequest(request), options.masterApiKey);
  }

  function isPublicProxyAuthorized(request: FastifyRequest): boolean {
    const publicKeys = options.publicProxyApiKeys ?? [];
    return publicKeys.some((key) => isClientAuthorized(headersFromRequest(request), key));
  }

  type RequestAuthGuard = (request: FastifyRequest, reply: FastifyReply) => boolean;
  type VideoAccountLeaseOptions = { exposeRegistrationErrors?: boolean };
  type VideoCreateOptions = { exposeRegistrationErrors?: boolean };
  type VideoTaskLookupOptions = { requireKnownTask?: boolean };

  function requireLocalAuth(request: FastifyRequest, reply: FastifyReply): boolean {
    if (isLocalAuthorized(request)) {
      return true;
    }
    void reply.status(401).send({ error: { message: "Invalid API key", type: "authentication_error" } });
    return false;
  }

  function requirePublicProxyAuth(request: FastifyRequest, reply: FastifyReply): boolean {
    if (isLocalAuthorized(request) || isPublicProxyAuthorized(request)) {
      return true;
    }
    void reply.status(401).send({ error: { message: "Invalid API key", type: "authentication_error" } });
    return false;
  }

  function isPublicProxyOnly(request: FastifyRequest): boolean {
    return !isLocalAuthorized(request) && isPublicProxyAuthorized(request);
  }

  async function sendModelNotAllowed(reply: FastifyReply, message: string): Promise<void> {
    await reply.status(400).send({ error: { message, type: "model_not_allowed" } });
  }

  async function providerAuth(reply: FastifyReply): Promise<ProviderAuthContext | undefined> {
    const account = await accountService.pickAccount();
    if (!account) {
      void reply.status(503).send({ error: { message: "No provider account configured", type: "account_unavailable" } });
      return undefined;
    }
    return authContextForAccount(account);
  }

  function authContextForAccount(account: AccountRecord, leaseId?: string): ProviderAuthContext {
    return {
      account,
      leaseId,
      headers: buildProviderAuthHeaders(account, options.providerAuthMode)
    };
  }

  async function providerHeaders(reply: FastifyReply): Promise<Record<string, string> | undefined> {
    return (await providerAuth(reply))?.headers;
  }

  async function depleteProviderAccountIfNeeded(uid: string, result: ProviderResult): Promise<void> {
    if (providerResultIndicatesQuotaExhausted(result)) {
      await accountService.depleteAccount(uid);
    }
  }

  async function applyStreamedProviderFailure(uid: string, decision: ProviderFailureDecision): Promise<void> {
    if (decision.kind === "quota") {
      await accountService.depleteAccount(uid);
      return;
    }
    if (decision.kind === "invalid") {
      await accountService.disableAccount(uid);
      return;
    }
    await accountService.cooldownAccount(uid, MODEL_PROXY_RETRY_COOLDOWN_SECONDS);
  }

  function wrapStreamingProviderResultForAccount(uid: string, leaseId: string | undefined, result: ProviderResult): ProviderResult {
    const contentType = result.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") || !isNodeReadable(result.body)) {
      return result;
    }
    let failed = false;
    const detector = createProviderFailureDetectionStream(async (decision) => {
      failed = true;
      await applyStreamedProviderFailure(uid, decision);
    });
    detector.once("finish", () => {
      if (!failed && leaseId) {
        void accountService.releaseModelAccount(uid, leaseId);
      }
    });
    return {
      ...result,
      body: result.body.pipe(detector)
    };
  }

  async function registerProviderAccountIfPossible(): Promise<boolean> {
    if (providerRegistrationAttempt) {
      return providerRegistrationAttempt;
    }

    const registrationService = options.registrationService;
    if (!registrationService) {
      return false;
    }

    providerRegistrationAttempt = (async () => {
      const registrationResult = await registrationService.registerOne();
      if (!registrationResult.success) {
        return false;
      }

      if (registrationResult.uid && registrationResult.token) {
        const savedAccount = await accountService.getProviderAccount(registrationResult.uid);
        if (!savedAccount) {
          await accountService.importAccount({
            uid: registrationResult.uid,
            token: registrationResult.token,
            mailboxAddr: registrationResult.email,
            mailboxToken: registrationResult.mailboxToken,
            balanceRemaining: registrationResult.balance,
            balanceTotal: registrationResult.balance,
            status: "active"
          });
        }
      }

      return true;
    })().finally(() => {
      providerRegistrationAttempt = undefined;
    });

    return providerRegistrationAttempt;
  }

  async function leaseModelAccountOrRegister(leaseId: string, allowRegister: boolean): Promise<{
    auth?: ProviderAuthContext;
    registered: boolean;
  }> {
    let account = await accountService.leaseModelAccount(leaseId);
    let registered = false;
    if (!account && allowRegister) {
      registered = await registerProviderAccountIfPossible();
    }
    if (!account && registered) {
      account = await accountService.leaseModelAccount(leaseId);
    }
    if (!account) {
      return { registered };
    }
    return { auth: authContextForAccount(account, leaseId), registered };
  }

  async function modelAuthOrWait(leaseId: string, allowRegister: boolean): Promise<{
    auth?: ProviderAuthContext;
    registered: boolean;
  }> {
    const deadline = Date.now() + Math.max(0, options.modelAccountWaitMs ?? DEFAULT_MODEL_ACCOUNT_WAIT_MS);
    let first = true;
    let registered = false;
    while (first || Date.now() < deadline) {
      first = false;
      const next = await leaseModelAccountOrRegister(leaseId, allowRegister && !registered);
      if (next.registered) {
        registered = true;
      }
      if (next.auth) {
        return { auth: next.auth, registered };
      }
      if (!await hasActiveModelAccountCandidate()) {
        break;
      }
      await delay(Math.min(ACCOUNT_WAIT_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }
    return { registered };
  }

  async function hasActiveModelAccountCandidate(): Promise<boolean> {
    const now = Date.now();
    return (await accountService.listAccounts()).some((account) =>
      account.status === "active" && account.rateLimitedUntil <= now
    );
  }

  async function finalizeModelLease(auth: ProviderAuthContext, result: ProviderResult): Promise<void> {
    if (!auth.leaseId) {
      return;
    }
    const contentType = result.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return;
    }
    await accountService.releaseModelAccount(auth.account.uid, auth.leaseId);
  }

  async function forwardModelRequestWithAccountRotation(
    path: "/v1/chat/completions" | "/v1/responses" | "/v1/messages",
    body: Record<string, unknown>
  ): Promise<ProviderResult> {
    let lastResult: ProviderResult | undefined;
    let registeredDuringRequest = false;

    for (let attempt = 0; attempt < MODEL_PROXY_MAX_ATTEMPTS; attempt += 1) {
      const leaseId = `model:${randomUUID()}`;
      const nextAuth = await modelAuthOrWait(leaseId, !registeredDuringRequest);
      if (nextAuth.registered) {
        registeredDuringRequest = true;
      }
      const auth = nextAuth.auth;
      if (!auth) {
        break;
      }

      const result = wrapStreamingProviderResultForAccount(auth.account.uid, auth.leaseId, await forwardModelRequest(client, {
        method: "POST",
        path,
        body,
        headers: auth.headers
      }).catch(providerExceptionResult));
      lastResult = result;

      if (providerResultIndicatesQuotaExhausted(result)) {
        await accountService.depleteAccount(auth.account.uid);
        continue;
      }

      if (providerResultIndicatesInvalidAccount(result)) {
        await accountService.disableAccount(auth.account.uid);
        continue;
      }

      if (providerResultIndicatesTemporaryFailure(result)) {
        await accountService.cooldownAccount(auth.account.uid, MODEL_PROXY_RETRY_COOLDOWN_SECONDS);
        continue;
      }

      await finalizeModelLease(auth, result);
      return result;
    }

    return lastResult ?? {
      status: 503,
      body: { error: { message: "No provider account configured", type: "account_unavailable" } },
      headers: new Headers()
    };
  }

  async function leaseVideoAccountOrRegister(
    leaseId: string,
    reply: FastifyReply,
    leaseOptions: VideoAccountLeaseOptions = {}
  ): Promise<AccountRecord | undefined> {
    const existingAccount = await accountService.leaseVideoAccount(leaseId);
    if (existingAccount) {
      return existingAccount;
    }

    const registrationService = options.registrationService;
    if (!registrationService) {
      await reply.status(503).send({
        error: {
          message: "No available account for video generation",
          type: "account_unavailable"
        }
      });
      return undefined;
    }

    const exposeRegistrationErrors = leaseOptions.exposeRegistrationErrors ?? true;
    const sendVideoRegistrationFailed = async (message?: string): Promise<void> => {
      await reply.status(503).send({
        error: {
          message: exposeRegistrationErrors
            ? message ?? "Video account registration failed"
            : "Video account registration failed",
          type: "video_account_registration_failed"
        }
      });
    };
    const errorMessage = (error: unknown): string | undefined => {
      if (error instanceof Error) {
        return error.message;
      }
      return typeof error === "string" ? error : undefined;
    };

    try {
      const registrationResult = await registrationService.registerOne();
      if (!registrationResult.success) {
        await sendVideoRegistrationFailed(registrationResult.error);
        return undefined;
      }

      if (registrationResult.uid && registrationResult.token) {
        const savedAccount = await accountService.getProviderAccount(registrationResult.uid);
        if (!savedAccount) {
          await accountService.importAccount({
            uid: registrationResult.uid,
            token: registrationResult.token,
            mailboxAddr: registrationResult.email,
            mailboxToken: registrationResult.mailboxToken,
            balanceRemaining: registrationResult.balance,
            balanceTotal: registrationResult.balance,
            status: "active"
          });
        }
      }

      const registeredAccount = await accountService.leaseVideoAccount(leaseId);
      if (!registeredAccount) {
        await sendVideoRegistrationFailed("Video account registration completed, but no account could be leased");
        return undefined;
      }

      return registeredAccount;
    } catch (error) {
      await sendVideoRegistrationFailed(errorMessage(error));
      return undefined;
    }
  }

  async function leaseImageAccountOrRegister(
    leaseId: string,
    reply: FastifyReply,
    sendUnavailable: boolean = true
  ): Promise<AccountRecord | undefined> {
    const waitMs = sendUnavailable ? Math.max(0, options.imageAccountWaitMs ?? DEFAULT_IMAGE_ACCOUNT_WAIT_MS) : 0;
    const deadline = Date.now() + waitMs;
    let attemptedRegistration = false;
    do {
      const existingAccount = await accountService.leaseImageAccount(leaseId);
      if (existingAccount) {
        return existingAccount;
      }

      if (!attemptedRegistration && options.registrationService) {
        attemptedRegistration = true;
        await registerProviderAccountIfPossible();
        const registeredAccount = await accountService.leaseImageAccount(leaseId);
        if (registeredAccount) {
          return registeredAccount;
        }
      }

      if (Date.now() >= deadline) {
        break;
      }
      await delay(Math.min(ACCOUNT_WAIT_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    } while (Date.now() <= deadline);

    if (sendUnavailable) {
      await reply.status(503).send({
        error: {
          message: "No available account for image generation",
          type: "account_unavailable"
        }
      });
    }
    return undefined;
  }

  async function yydsClient(reply: FastifyReply): Promise<YydsMailClient | undefined> {
    let apiKey: string | undefined;
    try {
      apiKey = await yydsMailConfigService.enabledApiKey();
    } catch (error) {
      if (error instanceof YydsMailConfigDecryptError) {
        await reply.status(503).send({ error: { message: error.message, type: "mail_unavailable" } });
        return undefined;
      }
      throw error;
    }
    if (!apiKey) {
      await reply.status(503).send({ error: { message: "YYDS Mail API key is not configured", type: "mail_unavailable" } });
      return undefined;
    }
    return new YydsMailClient({
      baseUrl: options.yydsMailBaseUrl ?? "https://maliapi.215.im/v1",
      apiKey,
      fetchImpl: options.fetchImpl
    });
  }

  async function sendYydsError(reply: FastifyReply, error: unknown): Promise<void> {
    if (error instanceof YydsMailError) {
      await reply.status(error.status >= 400 && error.status < 600 ? error.status : 502)
        .send({ error: { message: error.message, type: "yyds_mail_error" } });
      return;
    }
    throw error;
  }

  async function sendBadRequest(reply: FastifyReply, error: unknown): Promise<void> {
    await reply.status(400).send({ error: { message: error instanceof Error ? error.message : "Invalid request" } });
  }

  async function sendYydsDomainPoolOperationError(reply: FastifyReply): Promise<void> {
    await reply.status(500).send({
      error: {
        type: "yyds_domain_pool_error",
        message: "YYDS domain pool operation failed"
      }
    });
  }

  async function refreshYydsDomainPool(): Promise<Awaited<ReturnType<YydsDomainPool["refresh"]>>> {
    if (!yydsDomainPoolRefreshInflight) {
      yydsDomainPoolRefreshInflight = yydsDomainPool.refresh()
        .finally(() => {
          yydsDomainPoolRefreshInflight = undefined;
        });
    }
    return yydsDomainPoolRefreshInflight;
  }

  async function sendRegistrationQueueUnavailable(
    reply: FastifyReply,
    message = "Registration queue is unavailable"
  ): Promise<void> {
    await reply.status(503).send({
      error: {
        message,
        type: "registration_queue_unavailable"
      }
    });
  }

  function mailboxQuery(request: FastifyRequest): MailboxQuery {
    return request.query && typeof request.query === "object" ? request.query as MailboxQuery : {};
  }

  async function saveVideoTask(task: NormalizedVideoTask, accountUid?: string): Promise<VideoTaskRecord | undefined> {
    if (!task.id) {
      return undefined;
    }
    return videoTaskStore.upsert({
      taskId: task.id,
      accountUid,
      status: task.status,
      sourceUrl: task.videoUrl,
      raw: task.raw,
      completedAt: task.status === "succeeded" ? Date.now() : undefined
    });
  }

  async function saveImageTaskFromResult(
    result: ProviderResult,
    pollPath: ImageTaskRecord["pollPath"],
    accountUid?: string,
    leaseId?: string
  ): Promise<ImageTaskRecord | undefined> {
    const taskId = readImageTaskId(result.body);
    if (!taskId) {
      return undefined;
    }
    const status = readImageResponseStatus(result.body, result.status);
    return imageTaskStore.upsert({
      taskId,
      accountUid,
      leaseId,
      pollPath,
      status,
      sourceUrl: readFirstImageUrl(result.body),
      raw: result.body,
      completedAt: status === "succeeded" || status === "failed" ? Date.now() : undefined
    });
  }

  function readImageResponseStatus(body: unknown, httpStatus: number): string {
    if (httpStatus === 202) {
      return "running";
    }
    if (httpStatus >= 500) {
      return "failed";
    }
    const status = readDeepImageString(body, ["status", "state"])?.toLowerCase();
    if (status === "success" || status === "completed") {
      return "succeeded";
    }
    if (status) {
      return status;
    }
    return httpStatus >= 200 && httpStatus < 300 ? "succeeded" : "failed";
  }

  function isTerminalImageTask(task: ImageTaskRecord): boolean {
    return ["succeeded", "success", "completed", "failed", "error", "cancelled", "canceled"]
      .includes(task.status.toLowerCase());
  }

  function cachedImageTaskResult(task: ImageTaskRecord): ProviderResult | undefined {
    if (!isTerminalImageTask(task)) {
      return undefined;
    }
    const status = task.status.toLowerCase();
    const succeeded = status === "succeeded" || status === "success" || status === "completed";
    const body = task.raw ?? {
      created: Math.floor((task.completedAt ?? task.updatedAt) / 1000),
      status: succeeded ? "succeeded" : "failed",
      task_id: task.taskId,
      id: task.taskId,
      data: succeeded && task.sourceUrl ? [{ url: task.sourceUrl }] : []
    };
    return {
      status: succeeded ? 200 : 500,
      body,
      headers: new Headers()
    };
  }

  function readFirstImageUrl(body: unknown): string | undefined {
    if (!body || typeof body !== "object") {
      return undefined;
    }
    if (Array.isArray(body)) {
      return body.map(readFirstImageUrl).find(Boolean);
    }
    const record = body as Record<string, unknown>;
    if (typeof record.url === "string") {
      return record.url;
    }
    if (Array.isArray(record.data)) {
      return record.data.map(readFirstImageUrl).find(Boolean);
    }
    return readFirstImageUrl(record.data) ?? readFirstImageUrl(record.result) ?? readFirstImageUrl(record.output);
  }

  function readDeepImageString(value: unknown, keys: string[]): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === "string" && record[key]) {
        return record[key];
      }
    }
    return readDeepImageString(record.data, keys) ?? readDeepImageString(record.result, keys);
  }

  app.get("/health", async () => ({ ok: true }));

  app.get("/v1/models", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    if (isPublicProxyOnly(request)) {
      await reply.send(publicModelCatalog());
      return;
    }
    await reply.send(localModelCatalog());
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    const body = isPublicProxyOnly(request)
      ? normalizePublicProxyBody(bodyRecord(request))
      : bodyRecord(request);
    if (isPublicProxyOnly(request) && !isPublicChatModelAllowed(readBodyModel(body))) {
      await sendModelNotAllowed(reply, "Only public Claude and Codex models are allowed on this endpoint");
      return;
    }
    const result = await forwardModelRequestWithAccountRotation("/v1/chat/completions", body);
    await sendProviderResult(reply, result);
  });

  app.post("/v1/responses", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    const body = isPublicProxyOnly(request)
      ? normalizePublicProxyBody(bodyRecord(request))
      : bodyRecord(request);
    if (isPublicProxyOnly(request) && !isPublicResponsesModelAllowed(readBodyModel(body))) {
      await sendModelNotAllowed(reply, "Only public Codex and GPT Responses models are allowed on this endpoint");
      return;
    }
    const result = await forwardModelRequestWithAccountRotation("/v1/responses", body);
    await sendProviderResult(reply, result);
  });

  app.post("/v1/messages", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    const body = isPublicProxyOnly(request)
      ? normalizePublicProxyBody(bodyRecord(request))
      : bodyRecord(request);
    if (isPublicProxyOnly(request) && !isPublicMessagesModelAllowed(readBodyModel(body))) {
      await sendModelNotAllowed(reply, "Only public Claude models are allowed on this endpoint");
      return;
    }
    const result = await forwardModelRequestWithAccountRotation("/v1/messages", body);
    await sendProviderResult(reply, result);
  });

  app.post("/api/register", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = await providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await registerAccount(client, bodyRecord(request), headers);
    await sendProviderResult(reply, result);
  });

  app.post("/api/accounts/import", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    try {
      await reply.send(await accountService.importAccount(bodyRecord(request) as { uid: string; token: string }));
    } catch (error) {
      await reply.status(400).send({ error: { message: error instanceof Error ? error.message : "Invalid account import" } });
    }
  });

  app.get("/api/accounts", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await reply.send(await accountService.listAccounts());
  });

  app.get("/api/accounts/:uid", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const params = request.params as { uid?: string };
    const account = params.uid ? await accountService.getAccount(params.uid) : undefined;
    if (!account) {
      await reply.status(404).send({ error: { message: "Account not found" } });
      return;
    }
    await reply.send(account);
  });

  app.post("/api/accounts/:uid/balance/refresh", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const vipClient = options.vipClient;
    if (!vipClient) {
      await reply.status(503).send({
        error: {
          message: "VIP balance client is not configured",
          type: "balance_refresh_unavailable"
        }
      });
      return;
    }
    const params = request.params as { uid?: string };
    const account = params.uid ? await accountService.getProviderAccount(params.uid) : undefined;
    if (!account) {
      await reply.status(404).send({ error: { message: "Account not found" } });
      return;
    }

    try {
      const balance = await vipClient.queryBalance(account.uid, account.token);
      const updated = await accountService.updateBalance(
        account.uid,
        balance.availableBalance,
        balance.totalBalance
      );
      if (!updated) {
        await reply.status(404).send({ error: { message: "Account not found" } });
        return;
      }
      await reply.send(updated);
    } catch (error) {
      await reply.status(502).send({
        error: {
          message: error instanceof Error ? error.message : "VIP balance refresh failed",
          type: "balance_refresh_failed"
        }
      });
    }
  });

  app.get("/api/mail/yyds/config", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await reply.send(await yydsMailConfigService.get() ?? { configured: false });
  });

  app.put("/api/mail/yyds/config", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    try {
      await reply.send(await yydsMailConfigService.save(bodyRecord(request) as YydsMailConfigInput));
    } catch (error) {
      await sendBadRequest(reply, error);
    }
  });

  app.get("/api/mail/yyds/domains", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    try {
      await reply.send({
        config: await yydsDomainPoolStore.getConfig(),
        domains: await yydsDomainPool.listCandidates()
      });
    } catch {
      await sendYydsDomainPoolOperationError(reply);
    }
  });

  app.post("/api/mail/yyds/domains/refresh", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    try {
      await reply.send(await refreshYydsDomainPool());
    } catch (error) {
      if (error instanceof YydsDomainFetchError || error instanceof YydsDomainPoolSourceValidationError) {
        await reply.status(502).send({
          error: {
            type: "yyds_domain_fetch_error",
            message: "YYDS domain refresh failed"
          }
        });
        return;
      }
      await reply.status(500).send({
        error: {
          type: "yyds_domain_pool_error",
          message: "YYDS domain pool refresh failed"
        }
      });
    }
  });

  app.put("/api/mail/yyds/domain-pool/config", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    try {
      assertYydsDomainPoolConfigInput(request.body);
      const current = await yydsDomainPoolStore.getConfig();
      const next = normalizeYydsDomainPoolConfigInput(request.body, current);
      await yydsDomainPoolStore.saveConfig(next);
      await reply.send(await yydsDomainPoolStore.getConfig());
    } catch (error) {
      if (error instanceof YydsDomainPoolConfigValidationError) {
        await sendBadRequest(reply, error);
        return;
      }
      await sendYydsDomainPoolOperationError(reply);
    }
  });

  app.post("/api/accounts/:uid/enable", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const params = request.params as { uid?: string };
    const account = params.uid ? await accountService.enableAccount(params.uid) : undefined;
    if (!account) {
      await reply.status(404).send({ error: { message: "Account not found" } });
      return;
    }
    await reply.send(account);
  });

  app.post("/api/accounts/:uid/disable", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const params = request.params as { uid?: string };
    const account = params.uid ? await accountService.disableAccount(params.uid) : undefined;
    if (!account) {
      await reply.status(404).send({ error: { message: "Account not found" } });
      return;
    }
    await reply.send(account);
  });

  app.post("/api/accounts/:uid/cooldown", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const params = request.params as { uid?: string };
    const body = request.body as CooldownBody | undefined;
    const seconds = typeof body?.seconds === "number" ? body.seconds : 600;
    const account = params.uid ? await accountService.cooldownAccount(params.uid, seconds) : undefined;
    if (!account) {
      await reply.status(404).send({ error: { message: "Account not found" } });
      return;
    }
    await reply.send(account);
  });

  app.post("/api/mail/yyds/accounts", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const client = await yydsClient(reply);
    if (!client) {
      return;
    }
    try {
      await reply.send(await client.createMailbox());
    } catch (error) {
      await sendYydsError(reply, error);
    }
  });

  app.get("/api/mail/yyds/messages", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const client = await yydsClient(reply);
    if (!client) {
      return;
    }
    const query = mailboxQuery(request);
    if (!query.address) {
      await reply.status(400).send({ error: { message: "address is required" } });
      return;
    }
    try {
      await reply.send(await client.listMessages({ address: query.address, token: query.token }));
    } catch (error) {
      await sendYydsError(reply, error);
    }
  });

  app.get("/api/mail/yyds/messages/:messageId", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const client = await yydsClient(reply);
    if (!client) {
      return;
    }
    const query = mailboxQuery(request);
    const params = request.params as { messageId?: string };
    if (!query.address || !params.messageId) {
      await reply.status(400).send({ error: { message: "address and messageId are required" } });
      return;
    }
    try {
      await reply.send(await client.getMessage(params.messageId, { address: query.address, token: query.token }));
    } catch (error) {
      await sendYydsError(reply, error);
    }
  });

  app.post("/api/mail/yyds/verification-code", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const client = await yydsClient(reply);
    if (!client) {
      return;
    }
    const body = bodyRecord(request);
    if (typeof body.address !== "string") {
      await reply.status(400).send({ error: { message: "address is required" } });
      return;
    }
    try {
      await reply.send(await client.findVerificationCode({
        address: body.address,
        token: typeof body.token === "string" ? body.token : undefined
      }));
    } catch (error) {
      await sendYydsError(reply, error);
    }
  });

  app.post("/api/uploads", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const auth = await providerAuth(reply);
    if (!auth) {
      return;
    }

    const body = request.body as UploadRequestBody | undefined;
    if (typeof body?.source !== "string") {
      await reply.status(400).send({ error: { message: "source must be a data URL or http(s) URL" } });
      return;
    }

    const result = await uploadAsset(client, {
      source: body.source,
      filename: typeof body.filename === "string" ? body.filename : undefined,
      headers: auth.headers
    });
    await depleteProviderAccountIfNeeded(auth.account.uid, result);
    await sendProviderResult(reply, result);
  });

  async function handleCreateVideo(
    request: FastifyRequest,
    reply: FastifyReply,
    requireAuth: RequestAuthGuard = requireLocalAuth,
    createOptions: VideoCreateOptions = {}
  ): Promise<void> {
    if (!requireAuth(request, reply)) {
      return;
    }
    const body = bodyRecord(request);
    try {
      assertVideoGenerationRules(body);
    } catch (error) {
      await sendBadRequest(reply, error);
      return;
    }

    const leaseId = `video:${randomUUID()}`;
    const account = await leaseVideoAccountOrRegister(leaseId, reply, {
      exposeRegistrationErrors: createOptions.exposeRegistrationErrors
    });
    if (!account) {
      return;
    }

    const headers = buildProviderAuthHeaders(account, options.providerAuthMode);
    let taskPayload: Record<string, unknown>;
    try {
      taskPayload = await prepareVideoTaskPayload(client, body, headers);
    } catch (error) {
      await accountService.releaseVideoAccount(account.uid, leaseId);
      await reply.status(502).send({
        error: {
          message: error instanceof Error ? error.message : "Video reference upload failed",
          type: "video_reference_upload_failed"
        }
      });
      return;
    }

    const result = await createVideoTask(client, taskPayload, headers);
    if (result.status >= 200 && result.status < 300) {
      await accountService.depleteVideoAccount(account.uid);
      const createdTask = normalizeVideoTaskStatus(result.body);
      if (createdTask.id) {
        await saveVideoTask(createdTask, account.uid);
      }
    } else if (providerResultIndicatesQuotaExhausted(result)) {
      await accountService.depleteVideoAccount(account.uid);
    } else {
      await accountService.releaseVideoAccount(account.uid, leaseId);
    }
    await sendProviderResult(reply, result);
  }

  async function handleGetVideoTask(
    request: FastifyRequest,
    reply: FastifyReply,
    requireAuth: RequestAuthGuard = requireLocalAuth,
    taskOptions: VideoTaskLookupOptions = {}
  ): Promise<void> {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { taskId?: string };
    if (!params.taskId) {
      await reply.status(400).send({ error: { message: "taskId is required" } });
      return;
    }
    const existingTask = await videoTaskStore.get(params.taskId);
    if (taskOptions.requireKnownTask && !existingTask) {
      await reply.status(404).send({
        error: {
          message: "Video task not found",
          type: "video_task_not_found"
        }
      });
      return;
    }
    const taskAccount = existingTask?.accountUid ? await accountService.getProviderAccount(existingTask.accountUid) : undefined;
    if (taskOptions.requireKnownTask && !taskAccount) {
      await reply.status(404).send({
        error: {
          message: "Video task not found",
          type: "video_task_not_found"
        }
      });
      return;
    }
    const headers = taskAccount
      ? buildProviderAuthHeaders(taskAccount, options.providerAuthMode)
      : await providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await getVideoTask(client, params.taskId, headers);
    if (result.body.id) {
      await saveVideoTask(result.body, existingTask?.accountUid);
    }
    await sendProviderResult(reply, result);
  }

  async function handleImageGeneration(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = buildImageGenerationPayload(bodyRecord(request));
    } catch (error) {
      await sendBadRequest(reply, error);
      return;
    }

    const pollPath = imageTaskPollPathForPayload(payload);
    let lastResult: ProviderResult | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const leaseId = `image:${randomUUID()}`;
      const account = await leaseImageAccountOrRegister(leaseId, reply, !lastResult);
      if (!account) {
        if (lastResult) {
          await sendProviderResult(reply, lastResult);
        }
        return;
      }

      const headers = buildProviderAuthHeaders(account, options.providerAuthMode);
      const result = await createImageGeneration(client, payload, headers, {
        maxAttempts: options.imageMaxPollAttempts,
        intervalMs: options.imagePollIntervalMs
      });
      lastResult = result;
      if (result.status === 200) {
        await accountService.consumeImageAccount(account.uid, leaseId, IMAGE_ACCOUNT_COST);
        await saveImageTaskFromResult(result, pollPath, account.uid, leaseId);
        await sendProviderResult(reply, result);
        return;
      }
      if (result.status === 202) {
        await saveImageTaskFromResult(result, pollPath, account.uid, leaseId);
        await sendProviderResult(reply, result);
        return;
      }
      if (providerResultIndicatesQuotaExhausted(result)) {
        await accountService.depleteAccount(account.uid);
        continue;
      }
      await accountService.releaseImageAccount(account.uid, leaseId);
      if (!imageResultIsRetryable(result)) {
        await sendProviderResult(reply, result);
        return;
      }
      await accountService.cooldownAccount(account.uid, 30);
    }

    await sendProviderResult(reply, lastResult ?? {
      status: 503,
      body: { error: { message: "All image accounts attempted — none succeeded", type: "server_error" } },
      headers: new Headers()
    });
  }

  async function handleGetImageGeneration(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const params = request.params as { taskId?: string };
    if (!params.taskId) {
      await reply.status(400).send({ error: { message: "taskId is required" } });
      return;
    }
    const existingTask = await imageTaskStore.get(params.taskId);
    if (!existingTask) {
      await reply.status(404).send({ error: { message: "Image task not found" } });
      return;
    }
    const cachedResult = cachedImageTaskResult(existingTask);
    if (cachedResult) {
      await sendProviderResult(reply, cachedResult);
      return;
    }
    const taskAccount = existingTask.accountUid ? await accountService.getProviderAccount(existingTask.accountUid) : undefined;
    const headers = taskAccount
      ? buildProviderAuthHeaders(taskAccount, options.providerAuthMode)
      : await providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await pollImageTask(client, params.taskId, existingTask.pollPath, headers);
    const status = readImageResponseStatus(result.body, result.status);
    if (existingTask.accountUid && result.status === 200) {
      await accountService.consumeImageAccount(existingTask.accountUid, existingTask.leaseId, IMAGE_ACCOUNT_COST);
    } else if (existingTask.accountUid && result.status !== 202) {
      if (providerResultIndicatesQuotaExhausted(result)) {
        await accountService.depleteAccount(existingTask.accountUid);
      } else {
        await accountService.releaseImageAccount(existingTask.accountUid, existingTask.leaseId);
      }
    }
    await saveImageTaskFromResult(result, existingTask.pollPath, existingTask.accountUid, existingTask.leaseId);
    if (status === "succeeded" || status === "failed") {
      await imageTaskStore.upsert({
        taskId: existingTask.taskId,
        accountUid: existingTask.accountUid,
        leaseId: existingTask.leaseId,
        pollPath: existingTask.pollPath,
        status,
        sourceUrl: readFirstImageUrl(result.body),
        raw: result.body,
        completedAt: Date.now()
      });
    }
    await sendProviderResult(reply, result);
  }

  app.post("/api/images/generations", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await handleImageGeneration(request, reply);
  });

  app.get("/api/images/generations/:taskId", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await handleGetImageGeneration(request, reply);
  });

  app.post("/v1/images/generations", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    if (!isPublicImageModelAllowed(readBodyModel(bodyRecord(request)))) {
      await sendModelNotAllowed(reply, "Only gpt-image-2 is allowed on this endpoint");
      return;
    }
    await handleImageGeneration(request, reply);
  });

  app.get("/v1/images/generations/:taskId", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    await handleGetImageGeneration(request, reply);
  });

  app.post("/api/video/generations", async (request, reply) => {
    await handleCreateVideo(request, reply, requireLocalAuth);
  });
  app.post("/v1/video/generations", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    const publicProxyOnly = isPublicProxyOnly(request);
    if (publicProxyOnly && !isSeedanceVideoModel(bodyRecord(request).model)) {
      await sendModelNotAllowed(reply, "Only Seedance video models are allowed on this endpoint");
      return;
    }
    await handleCreateVideo(request, reply, () => true, {
      exposeRegistrationErrors: !publicProxyOnly
    });
  });
  app.get("/api/video/generations/:taskId", async (request, reply) => {
    await handleGetVideoTask(request, reply, requireLocalAuth);
  });
  app.get("/v1/video/generations/:taskId", async (request, reply) => {
    await handleGetVideoTask(request, reply, requirePublicProxyAuth, {
      requireKnownTask: isPublicProxyOnly(request)
    });
  });

  app.post("/api/registration/register", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    const svc = options.registrationService;
    if (!svc) {
      await reply.status(503).send({ error: { message: "Registration service is not configured" } });
      return;
    }
    const result = await svc.registerOne();
    await reply.status(result.success ? 201 : 500).send(result);
  });
  app.post("/api/registration/fill", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    const svc = options.registrationService;
    if (!svc) {
      await reply.status(503).send({ error: { message: "Registration service is not configured" } });
      return;
    }
    const body = bodyRecord(request);
    const target = typeof body.target === "number" && body.target > 0 ? body.target : 10;
    const concurrency = typeof body.concurrency === "number" && body.concurrency > 0 ? body.concurrency : 5;
    await reply.send(await svc.fillPool(target, concurrency));
  });
  app.get("/api/registration/stats", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    const svc = options.registrationService;
    if (!svc) {
      await reply.status(503).send({ error: { message: "Registration service is not configured" } });
      return;
    }
    await reply.send(await svc.getStats());
  });

  app.post("/api/registration/jobs", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    const svc = options.registrationJobService;
    if (!svc) {
      await sendRegistrationQueueUnavailable(reply, "Registration job service is not configured");
      return;
    }
    try {
      await reply.send(await svc.createJob(bodyRecord(request) as RegistrationJobCreateInput));
    } catch (error) {
      if (error instanceof RegistrationQueueUnavailableError) {
        await sendRegistrationQueueUnavailable(reply);
        return;
      }
      await sendBadRequest(reply, error);
    }
  });

  app.get("/api/registration/jobs", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    const svc = options.registrationJobService;
    if (!svc) {
      await sendRegistrationQueueUnavailable(reply, "Registration job service is not configured");
      return;
    }
    try {
      await reply.send(await svc.listJobs());
    } catch (error) {
      if (error instanceof RegistrationQueueUnavailableError) {
        await sendRegistrationQueueUnavailable(reply);
        return;
      }
      throw error;
    }
  });

  app.get("/api/registration/jobs/:jobId", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    const svc = options.registrationJobService;
    if (!svc) {
      await sendRegistrationQueueUnavailable(reply, "Registration job service is not configured");
      return;
    }
    const params = request.params as { jobId?: string };
    try {
      const job = params.jobId ? await svc.getJob(params.jobId) : undefined;
      if (!job) {
        await reply.status(404).send({ error: { message: "Registration job not found" } });
        return;
      }
      await reply.send(job);
    } catch (error) {
      if (error instanceof RegistrationQueueUnavailableError) {
        await sendRegistrationQueueUnavailable(reply);
        return;
      }
      throw error;
    }
  });

  app.post("/api/registration/jobs/:jobId/cancel", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) return;
    const svc = options.registrationJobService;
    if (!svc) {
      await sendRegistrationQueueUnavailable(reply, "Registration job service is not configured");
      return;
    }
    const params = request.params as { jobId?: string };
    try {
      if (!params.jobId) {
        throw new RegistrationJobNotFoundError();
      }
      await reply.send(await svc.cancelJob(params.jobId));
    } catch (error) {
      if (error instanceof RegistrationJobNotFoundError) {
        await reply.status(404).send({ error: { message: "Registration job not found" } });
        return;
      }
      if (error instanceof RegistrationQueueUnavailableError) {
        await sendRegistrationQueueUnavailable(reply);
        return;
      }
      throw error;
    }
  });

  return app;
}
