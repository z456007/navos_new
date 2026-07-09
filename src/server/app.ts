import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { AccountIdentity, HeaderBag, ProviderAuthMode } from "../protocols/auth.js";
import { buildProviderAuthHeaders, isClientAuthorized } from "../protocols/auth.js";
import type { FetchLike, ProviderResult } from "../protocols/http.js";
import { ProviderHttpClient } from "../protocols/http.js";
import { buildImageGenerationPayload, createImageGeneration } from "../protocols/image.js";
import { forwardModelRequest, LOCAL_MODEL_IDS, PUBLIC_PROXY_MODEL_IDS } from "../protocols/model-proxy.js";
import { registerAccount } from "../protocols/register.js";
import { uploadAsset } from "../protocols/upload.js";
import type { VipBalanceClient } from "../protocols/vip-client.js";
import {
  assertVideoGenerationRules,
  createVideoTask,
  getVideoTask,
  normalizeVideoTaskStatus,
  prepareVideoTaskPayload,
  type NormalizedVideoTask
} from "../protocols/video.js";
import { YydsMailClient, YydsMailError } from "../protocols/mail/yyds-mail.js";
import { AccountService, IMAGE_ACCOUNT_COST } from "../services/account-service.js";
import { CosConfigService, type CosConfigInput, type EnabledCosConfig } from "../services/cos-config-service.js";
import { archiveImageToCos, type ArchiveImageResult } from "../services/image-archive.js";
import { archiveVideoToCos, type ArchiveVideoResult } from "../services/video-archive.js";
import { YydsMailConfigService, type YydsMailConfigInput } from "../services/yyds-mail-config-service.js";
import { SecretBox } from "../security/secretbox.js";
import { InMemoryAccountStore, type AccountRecord } from "../store/account-store.js";
import { InMemoryCosConfigStore, type CosConfigStore } from "../store/cos-config-store.js";
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
  cosConfigSecret?: string;
  cosConfigStore?: CosConfigStore;
  videoTaskStore?: VideoTaskStore;
  archiveImage?: (input: { taskId: string; index: number; sourceUrl: string; config: EnabledCosConfig }) => Promise<ArchiveImageResult>;
  archiveVideo?: (input: { taskId: string; sourceUrl: string; config: EnabledCosConfig }) => Promise<ArchiveVideoResult>;
  fetchImpl?: FetchLike;
  vipClient?: VipBalanceClient;
  registrationService?: RegistrationService;
  registrationJobService?: RegistrationJobServicePort;
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
  headers: Record<string, string>;
}

const CORS_ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const CORS_DEFAULT_ALLOW_HEADERS = "authorization,content-type,x-api-key";
const CORS_MAX_AGE_SECONDS = "86400";
const JSON_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

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
  await reply.status(result.status).send(result.body);
}

function providerResultIndicatesQuotaExhausted(result: ProviderResult): boolean {
  if (result.status === 402) {
    return true;
  }
  const bodyText = typeof result.body === "string"
    ? result.body
    : JSON.stringify(result.body);
  return /insufficient_balance|积分不足|余额不足/.test(bodyText);
}

function imageResultIsRetryable(result: ProviderResult): boolean {
  if (result.status < 500) {
    return false;
  }
  const bodyText = typeof result.body === "string"
    ? result.body
    : JSON.stringify(result.body);
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

function isPublicChatModelAllowed(model: string | undefined): boolean {
  if (!model) {
    return false;
  }
  return [
    "claude.opus-4.8",
    "claude.sonnet-4.6",
    "claude.sonnet-4.5",
    "claude.haiku-4.5",
    "codex",
    "gpt-5.3-codex",
    "gpt-5.2-codex"
  ].includes(model);
}

function isPublicMessagesModelAllowed(model: string | undefined): boolean {
  if (!model) {
    return false;
  }
  return [
    "claude.opus-4.8",
    "claude.sonnet-4.6",
    "claude.sonnet-4.5",
    "claude.haiku-4.5"
  ].includes(model);
}

function isPublicImageModelAllowed(model: string | undefined): boolean {
  return model === undefined || model === "gpt-image-2";
}

function normalizeSecretRoot(value: string): string {
  return value.length >= 32 ? value : createHash("sha256").update(value).digest("hex");
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: JSON_BODY_LIMIT_BYTES });
  const accountService = options.accountService ?? new AccountService(new InMemoryAccountStore(options.defaultAccount));
  const cosConfigStore = options.cosConfigStore ?? new InMemoryCosConfigStore();
  const cosConfigService = new CosConfigService(
    cosConfigStore,
    new SecretBox(normalizeSecretRoot(options.cosConfigSecret ?? options.masterApiKey))
  );
  const yydsMailConfigStore = options.yydsMailConfigStore ?? new InMemoryYydsMailConfigStore();
  const yydsMailConfigService = new YydsMailConfigService(
    yydsMailConfigStore,
    new SecretBox(
      normalizeSecretRoot(options.yydsMailConfigSecret ?? options.cosConfigSecret ?? options.masterApiKey),
      "navos:yyds_mail_config:v1"
    )
  );
  const videoTaskStore = options.videoTaskStore ?? new InMemoryVideoTaskStore();
  const archiveImage = options.archiveImage ?? ((input: { taskId: string; index: number; sourceUrl: string; config: EnabledCosConfig }) =>
    archiveImageToCos({ ...input, fetchImpl: options.fetchImpl }));
  const archiveVideo = options.archiveVideo ?? ((input: { taskId: string; sourceUrl: string; config: EnabledCosConfig }) =>
    archiveVideoToCos({ ...input, fetchImpl: options.fetchImpl }));
  const client = new ProviderHttpClient(options.providerBaseUrl, options.fetchImpl);

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
    return {
      account,
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

  async function leaseVideoAccountOrRegister(leaseId: string, reply: FastifyReply): Promise<AccountRecord | undefined> {
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

    const registrationResult = await registrationService.registerOne();
    if (!registrationResult.success) {
      await reply.status(503).send({
        error: {
          message: registrationResult.error ?? "Video account registration failed",
          type: "video_account_registration_failed"
        }
      });
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
      await reply.status(503).send({
        error: {
          message: "Video account registration completed, but no account could be leased",
          type: "account_unavailable"
        }
      });
      return undefined;
    }

    return registeredAccount;
  }

  async function leaseImageAccountOrRegister(
    leaseId: string,
    reply: FastifyReply,
    sendUnavailable: boolean = true
  ): Promise<AccountRecord | undefined> {
    const existingAccount = await accountService.leaseImageAccount(leaseId);
    if (existingAccount) {
      return existingAccount;
    }

    const registrationService = options.registrationService;
    if (!registrationService) {
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

    const registrationResult = await registrationService.registerOne();
    if (!registrationResult.success) {
      if (sendUnavailable) {
        await reply.status(503).send({
          error: {
            message: registrationResult.error ?? "Image account registration failed",
            type: "image_account_registration_failed"
          }
        });
      }
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

    const registeredAccount = await accountService.leaseImageAccount(leaseId);
    if (!registeredAccount) {
      if (sendUnavailable) {
        await reply.status(503).send({
          error: {
            message: "Image account registration completed, but no account could be leased",
            type: "account_unavailable"
          }
        });
      }
      return undefined;
    }

    return registeredAccount;
  }

  async function yydsClient(reply: FastifyReply): Promise<YydsMailClient | undefined> {
    const apiKey = await yydsMailConfigService.enabledApiKey();
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

  async function archiveVideoTask(task: NormalizedVideoTask): Promise<NormalizedVideoTask> {
    if (!task.id) {
      return task;
    }

    let record = await saveVideoTask(task);
    if (task.status !== "succeeded" || !task.videoUrl || !record) {
      return decorateVideoTask(task, record);
    }

    if (record.archiveStatus === "archived" && record.cosUrl) {
      return decorateVideoTask(task, record);
    }

    const config = await cosConfigService.enabledConfig();
    if (!config) {
      record = await videoTaskStore.upsert({
        taskId: task.id,
        status: task.status,
        sourceUrl: task.videoUrl,
        raw: task.raw,
        archiveStatus: "skipped",
        archiveError: "COS config is not enabled",
        completedAt: Date.now()
      });
      return decorateVideoTask(task, record);
    }

    await videoTaskStore.upsert({
      taskId: task.id,
      status: task.status,
      sourceUrl: task.videoUrl,
      raw: task.raw,
      archiveStatus: "archiving",
      completedAt: Date.now()
    });

    try {
      const archived = await archiveVideo({ taskId: task.id, sourceUrl: task.videoUrl, config });
      record = await videoTaskStore.upsert({
        taskId: task.id,
        status: task.status,
        sourceUrl: task.videoUrl,
        raw: task.raw,
        archiveStatus: "archived",
        archiveError: undefined,
        cosUrl: archived.cosUrl,
        cosKey: archived.cosKey,
        sizeBytes: archived.sizeBytes,
        sha256: archived.sha256,
        completedAt: Date.now(),
        archivedAt: Date.now()
      });
    } catch (error) {
      record = await videoTaskStore.upsert({
        taskId: task.id,
        status: task.status,
        sourceUrl: task.videoUrl,
        raw: task.raw,
        archiveStatus: "failed",
        archiveError: error instanceof Error ? error.message : "COS archive failed",
        completedAt: Date.now()
      });
    }

    return decorateVideoTask(task, record);
  }

  function decorateVideoTask(task: NormalizedVideoTask, record?: VideoTaskRecord): NormalizedVideoTask {
    if (!record) {
      return task;
    }
    return {
      ...task,
      cosUrl: record.cosUrl,
      cosKey: record.cosKey,
      archiveStatus: record.archiveStatus,
      archiveError: record.archiveError,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256
    };
  }

  async function archiveImageGenerationBody(body: unknown): Promise<unknown> {
    if (!isPlainRecord(body) || !Array.isArray(body.data)) {
      return body;
    }
    const taskId = typeof body.task_id === "string"
      ? body.task_id
      : typeof body.id === "string"
        ? body.id
        : "image";
    const config = await cosConfigService.enabledConfig();
    if (!config) {
      return {
        ...body,
        data: body.data.map((item) => isPlainRecord(item)
          ? { ...item, archiveStatus: "skipped", archiveError: "COS config is not enabled" }
          : item)
      };
    }

    const data = await Promise.all(body.data.map(async (item, index) => {
      if (!isPlainRecord(item)) {
        return item;
      }
      const sourceUrl = imageOutputSource(item);
      if (!sourceUrl) {
        return item;
      }
      try {
        const archived = await archiveImage({ taskId, index: index + 1, sourceUrl, config });
        return {
          ...item,
          cosUrl: archived.cosUrl,
          cosKey: archived.cosKey,
          archiveStatus: "archived",
          archiveError: undefined,
          sizeBytes: archived.sizeBytes,
          sha256: archived.sha256
        };
      } catch (error) {
        return {
          ...item,
          archiveStatus: "failed",
          archiveError: error instanceof Error ? error.message : "COS archive failed"
        };
      }
    }));
    return { ...body, data };
  }

  function imageOutputSource(item: Record<string, unknown>): string | undefined {
    if (typeof item.url === "string" && item.url) {
      return item.url;
    }
    if (typeof item.b64_json === "string" && item.b64_json) {
      return `data:image/png;base64,${item.b64_json}`;
    }
    return undefined;
  }

  function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    const auth = await providerAuth(reply);
    if (!auth) {
      return;
    }
    const result = await forwardModelRequest(client, { method: "GET", path: "/v1/models", headers: auth.headers });
    if (result.status === 404) {
      await reply.send(localModelCatalog());
      return;
    }
    await depleteProviderAccountIfNeeded(auth.account.uid, result);
    await sendProviderResult(reply, result);
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    if (isPublicProxyOnly(request) && !isPublicChatModelAllowed(readBodyModel(bodyRecord(request)))) {
      await sendModelNotAllowed(reply, "Only public Claude and Codex models are allowed on this endpoint");
      return;
    }
    const auth = await providerAuth(reply);
    if (!auth) {
      return;
    }
    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/chat/completions",
      body: bodyRecord(request),
      headers: auth.headers
    });
    await depleteProviderAccountIfNeeded(auth.account.uid, result);
    await sendProviderResult(reply, result);
  });

  app.post("/v1/messages", async (request, reply) => {
    if (!requirePublicProxyAuth(request, reply)) {
      return;
    }
    if (isPublicProxyOnly(request) && !isPublicMessagesModelAllowed(readBodyModel(bodyRecord(request)))) {
      await sendModelNotAllowed(reply, "Only public Claude models are allowed on this endpoint");
      return;
    }
    const auth = await providerAuth(reply);
    if (!auth) {
      return;
    }
    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/messages",
      body: bodyRecord(request),
      headers: auth.headers
    });
    await depleteProviderAccountIfNeeded(auth.account.uid, result);
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

  app.get("/api/cos/config", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await reply.send(await cosConfigService.get() ?? { configured: false });
  });

  app.put("/api/cos/config", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    try {
      await reply.send(await cosConfigService.save(bodyRecord(request) as CosConfigInput));
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

  async function handleCreateVideo(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!requireLocalAuth(request, reply)) {
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
    const account = await leaseVideoAccountOrRegister(leaseId, reply);
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

  async function handleGetVideoTask(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const params = request.params as { taskId?: string };
    if (!params.taskId) {
      await reply.status(400).send({ error: { message: "taskId is required" } });
      return;
    }
    const existingTask = await videoTaskStore.get(params.taskId);
    const taskAccount = existingTask?.accountUid ? await accountService.getProviderAccount(existingTask.accountUid) : undefined;
    const headers = taskAccount
      ? buildProviderAuthHeaders(taskAccount, options.providerAuthMode)
      : await providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await getVideoTask(client, params.taskId, headers);
    const body = await archiveVideoTask(result.body);
    await sendProviderResult(reply, { ...result, body });
  }

  async function handleImageGeneration(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = buildImageGenerationPayload(bodyRecord(request));
    } catch (error) {
      await sendBadRequest(reply, error);
      return;
    }

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
      const result = await createImageGeneration(client, payload, headers);
      lastResult = result;
      if (result.status === 200) {
        const body = await archiveImageGenerationBody(result.body);
        await accountService.consumeImageAccount(account.uid, leaseId, IMAGE_ACCOUNT_COST);
        await sendProviderResult(reply, { ...result, body });
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

  app.post("/api/images/generations", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    await handleImageGeneration(request, reply);
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

  app.post("/api/video/generations", handleCreateVideo);
  app.post("/v1/video/generations", handleCreateVideo);
  app.get("/api/video/generations/:taskId", handleGetVideoTask);
  app.get("/v1/video/generations/:taskId", handleGetVideoTask);

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
