import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { AccountIdentity, HeaderBag, ProviderAuthMode } from "../protocols/auth.js";
import { buildProviderAuthHeaders, isClientAuthorized } from "../protocols/auth.js";
import type { FetchLike, ProviderResult } from "../protocols/http.js";
import { ProviderHttpClient } from "../protocols/http.js";
import { forwardModelRequest } from "../protocols/model-proxy.js";
import { registerAccount } from "../protocols/register.js";
import { uploadAsset } from "../protocols/upload.js";
import { assertVideoGenerationRules, createVideoTask, getVideoTask, normalizeVideoTaskStatus, type NormalizedVideoTask } from "../protocols/video.js";
import { YydsMailClient, YydsMailError } from "../protocols/mail/yyds-mail.js";
import { AccountService } from "../services/account-service.js";
import { CosConfigService, type CosConfigInput, type EnabledCosConfig } from "../services/cos-config-service.js";
import { archiveVideoToCos, type ArchiveVideoResult } from "../services/video-archive.js";
import { YydsMailConfigService, type YydsMailConfigInput } from "../services/yyds-mail-config-service.js";
import { SecretBox } from "../security/secretbox.js";
import { InMemoryAccountStore } from "../store/account-store.js";
import { InMemoryCosConfigStore, type CosConfigStore } from "../store/cos-config-store.js";
import { InMemoryYydsMailConfigStore, type YydsMailConfigStore } from "../store/yyds-mail-config-store.js";
import { InMemoryVideoTaskStore, type VideoTaskRecord, type VideoTaskStore } from "../store/video-task-store.js";
import { adminAssetContentType, adminPageHtml, resolveAdminAsset } from "./admin-page.js";

export interface CreateAppOptions {
  masterApiKey: string;
  providerBaseUrl: string;
  providerAuthMode: ProviderAuthMode;
  defaultAccount?: AccountIdentity;
  accountService?: AccountService;
  yydsMailApiKey?: string;
  yydsMailBaseUrl?: string;
  yydsMailConfigSecret?: string;
  yydsMailConfigStore?: YydsMailConfigStore;
  cosConfigSecret?: string;
  cosConfigStore?: CosConfigStore;
  videoTaskStore?: VideoTaskStore;
  archiveVideo?: (input: { taskId: string; sourceUrl: string; config: EnabledCosConfig }) => Promise<ArchiveVideoResult>;
  fetchImpl?: FetchLike;
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

function headersFromRequest(request: FastifyRequest): HeaderBag {
  const headers: HeaderBag = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string" || Array.isArray(value)) {
      headers[key] = value;
    }
  }
  return headers;
}

function bodyRecord(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === "object"
    ? request.body as Record<string, unknown>
    : {};
}

async function sendProviderResult(reply: FastifyReply, result: ProviderResult): Promise<void> {
  await reply.status(result.status).send(result.body);
}

function normalizeSecretRoot(value: string): string {
  return value.length >= 32 ? value : createHash("sha256").update(value).digest("hex");
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
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
  const archiveVideo = options.archiveVideo ?? ((input: { taskId: string; sourceUrl: string; config: EnabledCosConfig }) =>
    archiveVideoToCos({ ...input, fetchImpl: options.fetchImpl }));
  const client = new ProviderHttpClient(options.providerBaseUrl, options.fetchImpl);

  function requireLocalAuth(request: FastifyRequest, reply: FastifyReply): boolean {
    if (isClientAuthorized(headersFromRequest(request), options.masterApiKey)) {
      return true;
    }
    void reply.status(401).send({ error: { message: "Invalid API key", type: "authentication_error" } });
    return false;
  }

  async function providerHeaders(reply: FastifyReply): Promise<Record<string, string> | undefined> {
    const account = await accountService.pickAccount();
    if (!account) {
      void reply.status(503).send({ error: { message: "No provider account configured", type: "account_unavailable" } });
      return undefined;
    }
    return buildProviderAuthHeaders(account, options.providerAuthMode);
  }

  async function yydsClient(reply: FastifyReply): Promise<YydsMailClient | undefined> {
    const apiKey = await yydsMailConfigService.enabledApiKey(options.yydsMailApiKey);
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

  app.get("/health", async () => ({ ok: true }));

  app.get("/admin", async (_request, reply) => {
    await reply.header("content-type", "text/html; charset=utf-8").send(adminPageHtml());
  });

  app.get("/admin/assets/:file", async (request, reply) => {
    const params = request.params as { file?: string };
    const assetPath = params.file ? resolveAdminAsset(params.file) : undefined;
    if (!assetPath) {
      await reply.status(404).send({ error: { message: "Admin asset not found" } });
      return;
    }
    try {
      const assetStat = await stat(assetPath);
      if (!assetStat.isFile()) {
        await reply.status(404).send({ error: { message: "Admin asset not found" } });
        return;
      }
      await reply.header("content-type", adminAssetContentType(assetPath)).send(createReadStream(assetPath));
    } catch {
      await reply.status(404).send({ error: { message: "Admin asset not found" } });
    }
  });

  app.get("/v1/models", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = await providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await forwardModelRequest(client, { method: "GET", path: "/v1/models", headers });
    await sendProviderResult(reply, result);
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = await providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/chat/completions",
      body: bodyRecord(request),
      headers
    });
    await sendProviderResult(reply, result);
  });

  app.post("/v1/messages", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = await providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/messages",
      body: bodyRecord(request),
      headers
    });
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
    const headers = await providerHeaders(reply);
    if (!headers) {
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
      headers
    });
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
    const account = await accountService.leaseVideoAccount(leaseId);
    if (!account) {
      await reply.status(503).send({ error: { message: "No available account for video generation", type: "account_unavailable" } });
      return;
    }

    const headers = buildProviderAuthHeaders(account, options.providerAuthMode);
    const result = await createVideoTask(client, body, headers);
    if (result.status >= 200 && result.status < 300) {
      await accountService.depleteVideoAccount(account.uid);
      const createdTask = normalizeVideoTaskStatus(result.body);
      if (createdTask.id) {
        await saveVideoTask(createdTask, account.uid);
      }
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

  app.post("/api/video/generations", handleCreateVideo);
  app.post("/v1/video/generations", handleCreateVideo);
  app.get("/api/video/generations/:taskId", handleGetVideoTask);
  app.get("/v1/video/generations/:taskId", handleGetVideoTask);

  return app;
}
