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
  imageResponseToDisplayResults,
  imageTaskPollPathForPayload,
  normalizeOpenAIImageData,
  pollImageTask,
  readImageTaskId,
  type ImageResponseFormat
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
import { pipeProviderStream } from "../protocols/provider-stream.js";
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
import { reconcileAccountBalances } from "../services/account-balance-reconciler.js";
import { AccountService, IMAGE_ACCOUNT_COST } from "../services/account-service.js";
import { RuntimeConfigService, type RuntimeConfigUpdateInput } from "../services/runtime-config-service.js";
import {
  classifyProviderException,
  classifyProviderResult,
  classifyProviderSseEvent,
  providerFailureIsAccountRetryable,
  type ProviderFailureDecision
} from "../services/provider-failure-classifier.js";
import { DEFAULT_RUNTIME_CONFIG, type AccountBalanceReconcileScope } from "../services/runtime-config-schema.js";
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
import { InMemoryRuntimeConfigStore } from "../store/runtime-config-store.js";
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
  imageAllowVideoReserveFallback?: boolean;
  runtimeConfigService?: RuntimeConfigService;
  modelAccountWaitMs?: number;
  modelRateLimitGateCooldownMs?: number;
  imageMaxInFlight?: number;
  imageGatePostTaskCooldownMs?: number;
  videoT2vMaxInFlight?: number;
  videoT2vGateTtlMs?: number;
  mediaRateLimitGateCooldownMs?: number;
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

const CORS_ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const CORS_DEFAULT_ALLOW_HEADERS = "authorization,content-type,x-api-key";
const CORS_MAX_AGE_SECONDS = "86400";
const JSON_BODY_LIMIT_BYTES = 64 * 1024 * 1024;
const MODEL_PROXY_MAX_ATTEMPTS = 5;
const MODEL_PROXY_RETRY_COOLDOWN_SECONDS = 30;
const DEFAULT_IMAGE_ACCOUNT_WAIT_MS = 120_000;
const DEFAULT_IMAGE_MAX_IN_FLIGHT = 1;
const DEFAULT_IMAGE_GATE_POST_TASK_COOLDOWN_MS = 60_000;
const DEFAULT_MODEL_ACCOUNT_WAIT_MS = 30_000;
const DEFAULT_MODEL_RATE_LIMIT_GATE_COOLDOWN_MS = 60_000;
const DEFAULT_VIDEO_T2V_MAX_IN_FLIGHT = 2;
const DEFAULT_VIDEO_T2V_GATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MEDIA_RATE_LIMIT_GATE_COOLDOWN_MS = 180_000;
const ACCOUNT_WAIT_POLL_INTERVAL_MS = 100;
const DEFAULT_YYDS_DOMAINS_URL = "https://maliapi.215.im/v1/domains";
const YYDS_DOMAIN_FETCH_TIMEOUT_MS = 10_000;
const MODEL_RATE_LIMIT_GATE_TEXT_PATTERN = /rate.?limit|too many|频率.*限制|请求频率|限流|稍后再试|try again later/i;

class AsyncSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxInFlight: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.maxInFlight) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.queue.shift();
      if (next) {
        next();
      }
    };
  }
}

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

function positiveIntegerInput(value: unknown, fallback: number, max?: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  const normalized = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  return max === undefined ? normalized : Math.min(normalized, max);
}

function accountBalanceReconcileScopeInput(value: unknown): AccountBalanceReconcileScope {
  return value === "active" || value === "non_disabled" || value === "all" || value === "depleted"
    ? value
    : "depleted";
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

interface ProviderFailureLogInput {
  kind: "model" | "image" | "video";
  route: string;
  status: number;
  body: unknown;
  model?: string;
  accountUid?: string;
  attempt?: number;
}

function logProviderFailure(input: ProviderFailureLogInput): void {
  if (input.status < 500) {
    return;
  }
  const payload: Record<string, unknown> = {
    kind: input.kind,
    route: input.route,
    status: input.status,
    bodySnippet: providerFailureBodySnippet(input.body)
  };
  if (input.model) {
    payload.model = input.model;
  }
  if (input.accountUid) {
    payload.accountUid = input.accountUid;
  }
  if (input.attempt !== undefined) {
    payload.attempt = input.attempt;
  }
  console.log("navos.provider_failure", JSON.stringify(payload));
}

function providerFailureBodySnippet(body: unknown): string {
  let text: string;
  try {
    text = typeof body === "string" ? body : JSON.stringify(body) ?? "";
  } catch {
    text = String(body);
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 800 ? `${normalized.slice(0, 797)}...` : normalized;
}

function providerResultIndicatesQuotaExhausted(result: ProviderResult): boolean {
  return classifyProviderResult(result).accountAction === "deplete";
}

function isPlainRecordValue(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
    const decision = classifyProviderSseEvent(event);
    if (decision) {
      return decision;
    }
  }
  return undefined;
}

function providerExceptionResult(error: unknown): ProviderResult {
  const decision = classifyProviderException(error);
  return {
    status: decision.externalStatus,
    body: {
      error: {
        message: decision.message,
        type: decision.kind
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
  const runtimeConfigService = options.runtimeConfigService ?? new RuntimeConfigService(
    new InMemoryRuntimeConfigStore(),
    {
      ...DEFAULT_RUNTIME_CONFIG,
      imageAllowVideoReserveFallback: options.imageAllowVideoReserveFallback ?? DEFAULT_RUNTIME_CONFIG.imageAllowVideoReserveFallback,
      imageAccountWaitMs: options.imageAccountWaitMs ?? DEFAULT_RUNTIME_CONFIG.imageAccountWaitMs,
      imageMaxPollAttempts: options.imageMaxPollAttempts ?? DEFAULT_RUNTIME_CONFIG.imageMaxPollAttempts,
      imagePollIntervalMs: options.imagePollIntervalMs ?? DEFAULT_RUNTIME_CONFIG.imagePollIntervalMs,
      modelAccountWaitMs: options.modelAccountWaitMs ?? DEFAULT_RUNTIME_CONFIG.modelAccountWaitMs
    }
  );
  const client = new ProviderHttpClient(options.providerBaseUrl, options.fetchImpl);
  const modelRateLimitGateCooldownMs = Math.max(
    0,
    Math.trunc(options.modelRateLimitGateCooldownMs ?? DEFAULT_MODEL_RATE_LIMIT_GATE_COOLDOWN_MS)
  );
  const modelRateLimitGateUntil = new Map<string, number>();
  const modelRateLimitGateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const imageGenerationGate = new AsyncSemaphore(Math.max(1, Math.trunc(options.imageMaxInFlight ?? DEFAULT_IMAGE_MAX_IN_FLIGHT)));
  const imageGatePostTaskCooldownMs = Math.max(
    0,
    Math.trunc(options.imageGatePostTaskCooldownMs ?? DEFAULT_IMAGE_GATE_POST_TASK_COOLDOWN_MS)
  );
  const videoT2vGate = new AsyncSemaphore(Math.max(1, Math.trunc(options.videoT2vMaxInFlight ?? DEFAULT_VIDEO_T2V_MAX_IN_FLIGHT)));
  const videoT2vGateTtlMs = Math.max(1_000, Math.trunc(options.videoT2vGateTtlMs ?? DEFAULT_VIDEO_T2V_GATE_TTL_MS));
  const mediaRateLimitGateCooldownMs = Math.max(
    0,
    Math.trunc(options.mediaRateLimitGateCooldownMs ?? DEFAULT_MEDIA_RATE_LIMIT_GATE_COOLDOWN_MS)
  );
  const videoT2vGateReleases = new Map<string, () => void>();
  const videoT2vGateTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  type VideoAccountLeaseOptions = { exposeRegistrationErrors?: boolean; sendUnavailable?: boolean };
  type VideoCreateOptions = { exposeRegistrationErrors?: boolean };
  type VideoTaskLookupOptions = { requireKnownTask?: boolean };

  function isTextToVideoTaskPayload(payload: Record<string, unknown>): boolean {
    return !hasNonEmptyArray(payload.image_urls)
      && !hasNonEmptyArray(payload.image_with_roles)
      && !hasNonEmptyArray(payload.video_urls)
      && !hasNonEmptyArray(payload.audio_urls);
  }

  function hasNonEmptyArray(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
  }

  function videoTaskIsTerminal(status: string | undefined): boolean {
    return status === "succeeded" || status === "failed";
  }

  function gateReleaseDelayForDecision(decision: ProviderFailureDecision | undefined): number {
    return decision?.kind === "rate_limited" ? mediaRateLimitGateCooldownMs : 0;
  }

  function imageGateReleaseDelay(result: ProviderResult, decision: ProviderFailureDecision | undefined): number {
    const rateLimitDelay = gateReleaseDelayForDecision(decision);
    if (rateLimitDelay > 0) {
      return rateLimitDelay;
    }
    return result.status === 200 || result.status === 202 ? imageGatePostTaskCooldownMs : 0;
  }

  function modelRateLimitKeyForRequest(
    path: "/v1/chat/completions" | "/v1/responses" | "/v1/messages",
    body: Record<string, unknown>
  ): string {
    const rawModel = readBodyModel(body);
    if (!rawModel) {
      return `route:${path}`;
    }
    const normalized = (normalizePublicProxyModelId(rawModel) ?? rawModel).toLowerCase();
    if (normalized === "codex" || normalized.includes("codex")) {
      return "model:codex";
    }
    return `model:${normalized}`;
  }

  function shouldHoldModelRateLimitGate(
    decision: ProviderFailureDecision,
    result?: ProviderResult
  ): boolean {
    if (decision.kind !== "rate_limited") {
      return false;
    }
    return decision.retryAfterSeconds !== undefined
      || result?.status === 429
      || MODEL_RATE_LIMIT_GATE_TEXT_PATTERN.test(decision.message);
  }

  function modelRateLimitGateDelayMs(decision: ProviderFailureDecision): number {
    const retryAfterMs = decision.retryAfterSeconds ? decision.retryAfterSeconds * 1000 : 0;
    return Math.max(modelRateLimitGateCooldownMs, retryAfterMs);
  }

  async function waitForModelRateLimitGate(key: string): Promise<void> {
    while (true) {
      const delayMs = (modelRateLimitGateUntil.get(key) ?? 0) - Date.now();
      if (delayMs <= 0) {
        return;
      }
      await delay(delayMs);
    }
  }

  function holdModelRateLimitGate(key: string | undefined, decision: ProviderFailureDecision, result?: ProviderResult): void {
    if (!key || !shouldHoldModelRateLimitGate(decision, result)) {
      return;
    }
    const delayMs = modelRateLimitGateDelayMs(decision);
    if (delayMs <= 0) {
      return;
    }
    const until = Date.now() + delayMs;
    const currentUntil = modelRateLimitGateUntil.get(key) ?? 0;
    if (until <= currentUntil) {
      return;
    }
    const existingTimer = modelRateLimitGateTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    modelRateLimitGateUntil.set(key, until);
    const timer = setTimeout(() => {
      if ((modelRateLimitGateUntil.get(key) ?? 0) <= until) {
        modelRateLimitGateUntil.delete(key);
        modelRateLimitGateTimers.delete(key);
      }
    }, delayMs);
    timer.unref?.();
    modelRateLimitGateTimers.set(key, timer);
  }

  function releaseMediaGate(release: () => void, delayMs = 0): void {
    if (delayMs <= 0) {
      release();
      return;
    }
    const timer = setTimeout(release, delayMs);
    timer.unref?.();
  }

  function holdVideoT2vGate(
    taskId: string | undefined,
    status: string | undefined,
    release: (() => void) | undefined,
    decision?: ProviderFailureDecision
  ): void {
    if (!release) {
      return;
    }
    if (!taskId || videoTaskIsTerminal(status)) {
      releaseMediaGate(release, gateReleaseDelayForDecision(decision));
      return;
    }
    releaseVideoT2vGate(taskId);
    videoT2vGateReleases.set(taskId, release);
    const timer = setTimeout(() => releaseVideoT2vGate(taskId), videoT2vGateTtlMs);
    timer.unref?.();
    videoT2vGateTimers.set(taskId, timer);
  }

  function releaseVideoT2vGate(taskId: string | undefined, delayMs = 0): void {
    if (!taskId) {
      return;
    }
    const release = videoT2vGateReleases.get(taskId);
    if (!release) {
      return;
    }
    const timer = videoT2vGateTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      videoT2vGateTimers.delete(taskId);
    }
    if (delayMs > 0) {
      const delayedTimer = setTimeout(() => releaseVideoT2vGate(taskId), delayMs);
      delayedTimer.unref?.();
      videoT2vGateTimers.set(taskId, delayedTimer);
      return;
    }
    videoT2vGateReleases.delete(taskId);
    release();
  }

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

  async function applyStreamedProviderFailure(
    uid: string,
    decision: ProviderFailureDecision,
    modelRateLimitKey?: string,
    leaseId?: string
  ): Promise<void> {
    if (decision.accountAction === "deplete") {
      await accountService.depleteAccount(uid);
      return;
    }
    if (decision.accountAction === "disable") {
      await accountService.disableAccount(uid);
      return;
    }
    if (decision.accountAction === "cooldown") {
      holdModelRateLimitGate(modelRateLimitKey, decision);
      await accountService.cooldownAccount(uid, decision.retryAfterSeconds ?? MODEL_PROXY_RETRY_COOLDOWN_SECONDS);
      return;
    }
    if (decision.accountAction === "release" || decision.accountAction === "none") {
      await accountService.releaseModelAccount(uid, leaseId);
    }
  }

  function wrapStreamingProviderResultForAccount(
    uid: string,
    leaseId: string | undefined,
    result: ProviderResult,
    modelRateLimitKey?: string
  ): ProviderResult {
    const contentType = result.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") || !isNodeReadable(result.body)) {
      return result;
    }
    let failed = false;
    let finalized = false;
    const releaseIfClean = (): void => {
      if (finalized || failed || !leaseId) {
        return;
      }
      finalized = true;
      void accountService.releaseModelAccount(uid, leaseId);
    };
    const detector = createProviderFailureDetectionStream(async (decision) => {
      failed = true;
      finalized = true;
      await applyStreamedProviderFailure(uid, decision, modelRateLimitKey, leaseId);
    });
    detector.once("finish", releaseIfClean);
    detector.once("close", releaseIfClean);
    return {
      ...result,
      body: pipeProviderStream(result.body, detector, {
        onError: (error) => {
          console.log("navos.provider_stream_error", JSON.stringify({
            kind: "model",
            accountUid: uid,
            message: error instanceof Error ? error.message : String(error)
          }));
        }
      })
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

  async function leaseModelAccountOrRegister(
    leaseId: string,
    allowRegister: boolean,
    leaseTtlMs: number
  ): Promise<{
    auth?: ProviderAuthContext;
    registered: boolean;
  }> {
    let account = await accountService.leaseModelAccount(leaseId, leaseTtlMs);
    let registered = false;
    if (!account && allowRegister) {
      registered = await registerProviderAccountIfPossible();
    }
    if (!account && registered) {
      account = await accountService.leaseModelAccount(leaseId, leaseTtlMs);
    }
    if (!account) {
      return { registered };
    }
    return { auth: authContextForAccount(account, leaseId), registered };
  }

  async function modelAuthOrWait(
    leaseId: string,
    allowRegister: boolean,
    waitMs: number,
    leaseTtlMs: number
  ): Promise<{
    auth?: ProviderAuthContext;
    registered: boolean;
  }> {
    const deadline = Date.now() + Math.max(0, waitMs);
    let first = true;
    let registered = false;
    let hasCandidate = true;
    while (first || Date.now() < deadline) {
      first = false;
      const next = await leaseModelAccountOrRegister(leaseId, allowRegister && !registered, leaseTtlMs);
      if (next.registered) {
        registered = true;
      }
      if (next.auth) {
        return { auth: next.auth, registered };
      }
      if (!hasCandidate) {
        break;
      }
      hasCandidate = await hasActiveModelAccountCandidate();
      if (!hasCandidate) {
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

  function externalProviderFailureResult(decision: ProviderFailureDecision): ProviderResult {
    return {
      status: decision.externalStatus,
      body: { error: { message: decision.message, type: decision.kind } },
      headers: new Headers()
    };
  }

  function exhaustedAccountRetryFailureResult(
    lastResult: ProviderResult,
    lastDecision: ProviderFailureDecision | undefined
  ): ProviderResult {
    return lastDecision?.kind === "rate_limited"
      ? externalProviderFailureResult(lastDecision)
      : lastResult;
  }

  async function forwardModelRequestWithAccountRotation(
    path: "/v1/chat/completions" | "/v1/responses" | "/v1/messages",
    body: Record<string, unknown>
  ): Promise<ProviderResult> {
    let lastResult: ProviderResult | undefined;
    let lastDecision: ProviderFailureDecision | undefined;
    let registeredDuringRequest = false;
    const modelRateLimitKey = modelRateLimitKeyForRequest(path, body);
    const runtimeConfig = await runtimeConfigService.get();
    const modelAccountWaitMs = Math.max(
      0,
      Math.trunc(runtimeConfig.modelAccountWaitMs ?? options.modelAccountWaitMs ?? DEFAULT_MODEL_ACCOUNT_WAIT_MS)
    );
    const accountLeaseTtlMs = Math.max(
      1_000,
      Math.trunc(runtimeConfig.accountLeaseTtlMs ?? DEFAULT_RUNTIME_CONFIG.accountLeaseTtlMs)
    );

    for (let attempt = 0; attempt < MODEL_PROXY_MAX_ATTEMPTS; attempt += 1) {
      await waitForModelRateLimitGate(modelRateLimitKey);
      const leaseId = `model:${randomUUID()}`;
      const nextAuth = await modelAuthOrWait(leaseId, !registeredDuringRequest, modelAccountWaitMs, accountLeaseTtlMs);
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
      }).catch(providerExceptionResult), modelRateLimitKey);
      logProviderFailure({
        kind: "model",
        route: path,
        model: readBodyModel(body),
        accountUid: auth.account.uid,
        status: result.status,
        body: result.body,
        attempt: attempt + 1
      });
      lastResult = result;

      const decision = classifyProviderResult(result);
      lastDecision = decision;
      if (decision.accountAction === "deplete") {
        await accountService.depleteAccount(auth.account.uid);
        continue;
      }

      if (decision.accountAction === "disable") {
        await accountService.disableAccount(auth.account.uid);
        continue;
      }

      if (decision.accountAction === "cooldown") {
        holdModelRateLimitGate(modelRateLimitKey, decision, result);
        await accountService.cooldownAccount(
          auth.account.uid,
          decision.retryAfterSeconds ?? MODEL_PROXY_RETRY_COOLDOWN_SECONDS
        );
        continue;
      }

      await finalizeModelLease(auth, result);
      return result;
    }

    return lastDecision && lastDecision.accountAction !== "release" && lastDecision.accountAction !== "none"
      ? externalProviderFailureResult(lastDecision)
      : lastResult ?? {
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
      if (leaseOptions.sendUnavailable ?? true) {
        await reply.status(503).send({
          error: {
            message: "No available account for video generation",
            type: "account_unavailable"
          }
        });
      }
      return undefined;
    }

    const exposeRegistrationErrors = leaseOptions.exposeRegistrationErrors ?? true;
    const sendVideoRegistrationFailed = async (message?: string): Promise<void> => {
      if (!(leaseOptions.sendUnavailable ?? true)) {
        return;
      }
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
    const runtimeConfig = await runtimeConfigService.get();
    const waitMs = sendUnavailable ? Math.max(0, runtimeConfig.imageAccountWaitMs ?? DEFAULT_IMAGE_ACCOUNT_WAIT_MS) : 0;
    const deadline = Date.now() + waitMs;
    let attemptedRegistration = false;
    do {
      const existingAccount = await accountService.leaseImageAccount(
        leaseId,
        undefined,
        undefined,
        runtimeConfig.imageAllowVideoReserveFallback
      );
      if (existingAccount) {
        return existingAccount;
      }

      if (!attemptedRegistration && options.registrationService && runtimeConfig.imageAllowVideoReserveFallback) {
        attemptedRegistration = true;
        await registerProviderAccountIfPossible();
        const registeredAccount = await accountService.leaseImageAccount(
          leaseId,
          undefined,
          undefined,
          runtimeConfig.imageAllowVideoReserveFallback
        );
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

  async function saveVideoTask(
    task: NormalizedVideoTask,
    accountUid?: string,
    taskIdOverride?: string
  ): Promise<VideoTaskRecord | undefined> {
    const taskId = taskIdOverride ?? task.id;
    if (!taskId) {
      return undefined;
    }
    return videoTaskStore.upsert({
      taskId,
      accountUid,
      status: task.status,
      sourceUrl: task.videoUrl,
      raw: task.raw,
      completedAt: task.status === "succeeded" || task.status === "failed" ? Date.now() : undefined
    });
  }

  async function settleVideoAccountFromBilling(uid: string, leaseId: string | undefined, body: unknown): Promise<void> {
    const remaining = readVideoBillingNumber(body, ["remaining_amount", "remainingAmount", "available_balance", "availableBalance"]);
    const total = readVideoBillingNumber(body, ["total_amount", "totalAmount", "balance_total", "balanceTotal"]);
    if (remaining !== undefined) {
      await accountService.releaseVideoAccount(uid, leaseId);
      await accountService.updateBalance(uid, remaining, total);
      return;
    }
    await accountService.releaseVideoAccount(uid, leaseId);
  }

  function readVideoBillingNumber(body: unknown, keys: string[]): number | undefined {
    for (const record of collectVideoBillingRecords(body)) {
      for (const key of keys) {
        const parsed = numericVideoBillingValue(record[key]);
        if (parsed !== undefined) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  function collectVideoBillingRecords(value: unknown, depth = 0): Array<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 4) {
      return [];
    }
    const record = value as Record<string, unknown>;
    const records: Array<Record<string, unknown>> = [];
    if (record.billing && typeof record.billing === "object" && !Array.isArray(record.billing)) {
      records.push(record.billing as Record<string, unknown>);
    }
    for (const key of ["raw", "data", "result", "output"] as const) {
      records.push(...collectVideoBillingRecords(record[key], depth + 1));
    }
    return records;
  }

  function numericVideoBillingValue(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.trunc(parsed);
      }
    }
    return undefined;
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

  function cachedImageTaskResult(task: ImageTaskRecord, defaultResponseFormat: ImageResponseFormat): ProviderResult | undefined {
    if (!isTerminalImageTask(task)) {
      return undefined;
    }
    const status = task.status.toLowerCase();
    const responseFormat = imageResponseFormatFromTask(task, defaultResponseFormat);
    const displayMode = defaultResponseFormat === "b64_json";
    const data = task.raw ? (displayMode ? imageResponseToDisplayResults(task.raw) : normalizeOpenAIImageData(task.raw, responseFormat)) : [];
    const succeeded = data.length > 0 || status === "succeeded" || status === "success" || status === "completed";
    const body = task.raw ?? {
      created: Math.floor((task.completedAt ?? task.updatedAt) / 1000),
      status: succeeded ? "succeeded" : "failed",
      task_id: task.taskId,
      id: task.taskId,
      response_format: responseFormat,
      data: succeeded && task.sourceUrl ? [{ url: task.sourceUrl }] : []
    };
    if (data.length > 0 && body && typeof body === "object" && !Array.isArray(body)) {
      (body as Record<string, unknown>).response_format = responseFormat;
      (body as Record<string, unknown>).status = "succeeded";
      (body as Record<string, unknown>).data = data;
    }
    return {
      status: succeeded ? 200 : 500,
      body,
      headers: new Headers()
    };
  }

  function imageResponseFormatFromTask(task: ImageTaskRecord, fallback: ImageResponseFormat): ImageResponseFormat {
    return readImageResponseFormat(task.raw) ?? fallback;
  }

  function readImageResponseFormat(value: unknown): ImageResponseFormat | undefined {
    const responseFormat = readDeepImageString(value, ["response_format"]);
    if (responseFormat === "url" || responseFormat === "b64_json") {
      return responseFormat;
    }
    return imageDataShapeResponseFormat(value);
  }

  function imageDataShapeResponseFormat(value: unknown): ImageResponseFormat | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const format = imageDataShapeResponseFormat(item);
        if (format) {
          return format;
        }
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.b64_json === "string" && record.b64_json) {
      return "b64_json";
    }
    if (typeof record.url === "string" && record.url) {
      return "url";
    }
    return imageDataShapeResponseFormat(record.data)
      ?? imageDataShapeResponseFormat(record.result)
      ?? imageDataShapeResponseFormat(record.output);
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

  app.delete("/api/accounts/:uid", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const params = request.params as { uid?: string };
    const deleted = params.uid ? await accountService.deleteAccount(params.uid) : false;
    if (!deleted) {
      await reply.status(404).send({ error: { message: "Account not found" } });
      return;
    }
    await reply.send({ deleted: true });
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

  app.post("/api/accounts/balances/reconcile", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const vipClient = options.vipClient;
    if (!vipClient) {
      await reply.status(503).send({
        error: {
          message: "VIP balance client is not configured",
          type: "balance_reconcile_unavailable"
        }
      });
      return;
    }

    try {
      const body = bodyRecord(request);
      const result = await reconcileAccountBalances({
        accountService,
        vipClient,
        scope: accountBalanceReconcileScopeInput(body.scope),
        limit: positiveIntegerInput(body.limit, 1000, 10_000),
        concurrency: positiveIntegerInput(body.concurrency, 5, 50),
        reactivatePositive: body.reactivatePositive !== false
      });
      await reply.send(result);
    } catch (error) {
      await reply.status(502).send({
        error: {
          message: error instanceof Error ? error.message : "VIP balance reconcile failed",
          type: "balance_reconcile_failed"
        }
      });
    }
  });

  app.get("/api/runtime-config", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await reply.send(await runtimeConfigService.get());
  });

  app.put("/api/runtime-config", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    try {
      await reply.send(await runtimeConfigService.update(bodyRecord(request) as RuntimeConfigUpdateInput));
    } catch (error) {
      await sendBadRequest(reply, error);
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

    let lastResult: ProviderResult | undefined;
    let lastDecision: ProviderFailureDecision | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const leaseId = `video:${randomUUID()}`;
      const account = await leaseVideoAccountOrRegister(leaseId, reply, {
        exposeRegistrationErrors: createOptions.exposeRegistrationErrors,
        sendUnavailable: !lastResult
      });
      if (!account) {
        if (lastResult) {
          await sendProviderResult(reply, exhaustedAccountRetryFailureResult(lastResult, lastDecision));
        }
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

      const videoGateRelease = isTextToVideoTaskPayload(taskPayload)
        ? await videoT2vGate.acquire()
        : undefined;
      let result: ProviderResult;
      try {
        result = await createVideoTask(client, taskPayload, headers);
      } catch (error) {
        videoGateRelease?.();
        throw error;
      }
      logProviderFailure({
        kind: "video",
        route: request.url,
        model: readBodyModel(body),
        accountUid: account.uid,
        status: result.status,
        body: result.body,
        attempt: attempt + 1
      });
      lastResult = result;
      lastDecision = classifyProviderResult(result);
      if (result.status >= 200 && result.status < 300) {
        await settleVideoAccountFromBilling(account.uid, leaseId, result.body);
        const createdTask = normalizeVideoTaskStatus(result.body);
        if (createdTask.id) {
          await saveVideoTask(createdTask, account.uid);
        }
        holdVideoT2vGate(createdTask.id, createdTask.status, videoGateRelease, lastDecision);
        await sendProviderResult(reply, result);
        return;
      }
      videoGateRelease?.();
      if (lastDecision.accountAction === "deplete") {
        await accountService.depleteVideoAccount(account.uid);
      } else if (lastDecision.accountAction === "disable") {
        await accountService.disableAccount(account.uid);
      } else if (lastDecision.accountAction === "cooldown") {
        await accountService.cooldownAccount(account.uid, lastDecision.retryAfterSeconds ?? MODEL_PROXY_RETRY_COOLDOWN_SECONDS);
      } else {
        await accountService.releaseVideoAccount(account.uid, leaseId);
      }
      if (lastDecision.kind === "rate_limited") {
        await sendProviderResult(reply, externalProviderFailureResult(lastDecision));
        return;
      }
      if (!providerFailureIsAccountRetryable(lastDecision)) {
        await sendProviderResult(reply, result);
        return;
      }
    }

    await sendProviderResult(reply, lastResult
      ? exhaustedAccountRetryFailureResult(lastResult, lastDecision)
      : {
      status: 503,
      body: { error: { message: "All video accounts attempted; none succeeded", type: "server_error" } },
      headers: new Headers()
    });
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
    if (existingTask?.accountUid && result.status === 200) {
      await settleVideoAccountFromBilling(existingTask.accountUid, undefined, result.body);
      const decision = classifyProviderResult(result);
      if (providerFailureIsAccountRetryable(decision)) {
        await applyStreamedProviderFailure(existingTask.accountUid, decision);
      }
    }
    if (result.body.id) {
      await saveVideoTask(result.body, existingTask?.accountUid, params.taskId);
    }
    if (videoTaskIsTerminal(result.body.status)) {
      const decision = classifyProviderResult({ ...result, body: result.body.raw ?? result.body });
      const delayMs = gateReleaseDelayForDecision(decision);
      releaseVideoT2vGate(params.taskId, delayMs);
      releaseVideoT2vGate(result.body.id, delayMs);
    }
    await sendProviderResult(reply, result);
  }

  async function handleImageGeneration(
    request: FastifyRequest,
    reply: FastifyReply,
    defaultResponseFormat: ImageResponseFormat = "b64_json"
  ): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = buildImageGenerationPayload(bodyRecord(request), defaultResponseFormat);
    } catch (error) {
      await sendBadRequest(reply, error);
      return;
    }

    const pollPath = imageTaskPollPathForPayload(payload);
    const runtimeConfig = await runtimeConfigService.get();
    let lastResult: ProviderResult | undefined;
    let lastDecision: ProviderFailureDecision | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const leaseId = `image:${randomUUID()}`;
      const account = await leaseImageAccountOrRegister(leaseId, reply, !lastResult);
      if (!account) {
        if (lastResult) {
          await sendProviderResult(reply, exhaustedAccountRetryFailureResult(lastResult, lastDecision));
        }
        return;
      }

      const headers = buildProviderAuthHeaders(account, options.providerAuthMode);
      let imageGateRelease: (() => void) | undefined = await imageGenerationGate.acquire();
      let result: ProviderResult;
      try {
        result = await createImageGeneration(client, payload, headers, {
          maxAttempts: runtimeConfig.imageMaxPollAttempts,
          intervalMs: runtimeConfig.imagePollIntervalMs,
          outputMode: defaultResponseFormat === "b64_json" ? "display" : undefined
        });
      } catch (error) {
        imageGateRelease();
        imageGateRelease = undefined;
        throw error;
      }
      logProviderFailure({
        kind: "image",
        route: request.url,
        model: readBodyModel(payload),
        accountUid: account.uid,
        status: result.status,
        body: result.body,
        attempt: attempt + 1
      });
      lastResult = result;
      lastDecision = classifyProviderResult(result);
      const releaseImageGate = (delayMs = 0) => {
        if (!imageGateRelease) {
          return;
        }
        const release = imageGateRelease;
        imageGateRelease = undefined;
        releaseMediaGate(release, delayMs);
      };
      if (result.status === 200) {
        releaseImageGate(imageGateReleaseDelay(result, lastDecision));
        await accountService.consumeImageAccount(account.uid, leaseId, IMAGE_ACCOUNT_COST);
        await saveImageTaskFromResult(result, pollPath, account.uid, leaseId);
        await sendProviderResult(reply, result);
        return;
      }
      if (result.status === 202) {
        releaseImageGate(imageGateReleaseDelay(result, lastDecision));
        await saveImageTaskFromResult(result, pollPath, account.uid, leaseId);
        await sendProviderResult(reply, result);
        return;
      }
      const failedGateDelayMs = imageGateReleaseDelay(result, lastDecision);
      releaseImageGate(failedGateDelayMs);
      if (lastDecision.accountAction === "deplete") {
        await accountService.depleteAccount(account.uid);
        continue;
      }
      if (lastDecision.kind === "rate_limited") {
        await accountService.cooldownAccount(account.uid, lastDecision.retryAfterSeconds ?? 30);
        if (attempt < MODEL_PROXY_MAX_ATTEMPTS - 1) {
          if (failedGateDelayMs > 0) {
            await delay(failedGateDelayMs);
          }
          continue;
        }
        await sendProviderResult(reply, externalProviderFailureResult(lastDecision));
        return;
      }
      await accountService.releaseImageAccount(account.uid, leaseId);
      if (!imageResultIsRetryable(result)) {
        await sendProviderResult(reply, result);
        return;
      }
      await accountService.cooldownAccount(account.uid, 30);
    }

    await sendProviderResult(reply, lastResult
      ? exhaustedAccountRetryFailureResult(lastResult, lastDecision)
      : {
      status: 503,
      body: { error: { message: "All image accounts attempted — none succeeded", type: "server_error" } },
      headers: new Headers()
    });
  }

  async function handleGetImageGeneration(
    request: FastifyRequest,
    reply: FastifyReply,
    defaultResponseFormat: ImageResponseFormat = "b64_json"
  ): Promise<void> {
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
    const responseFormat = imageResponseFormatFromTask(existingTask, defaultResponseFormat);
    const pollResponseFormat = defaultResponseFormat === "b64_json" ? "display" : responseFormat;
    const cachedResult = cachedImageTaskResult(existingTask, defaultResponseFormat);
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
    const result = await pollImageTask(client, params.taskId, existingTask.pollPath, headers, pollResponseFormat);
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
      if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
        (result.body as Record<string, unknown>).response_format ??= responseFormat;
      }
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
    await handleImageGeneration(request, reply, "b64_json");
  });

  app.get("/api/images/generations/:taskId", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await handleGetImageGeneration(request, reply, "b64_json");
  });

  app.post("/v1/images/generations", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    if (!isPublicImageModelAllowed(readBodyModel(bodyRecord(request)))) {
      await sendModelNotAllowed(reply, "Only gpt-image-2 is allowed on this endpoint");
      return;
    }
    await handleImageGeneration(request, reply, "url");
  });

  app.get("/v1/images/generations/:taskId", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    await handleGetImageGeneration(request, reply, "url");
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
