import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { AccountIdentity, HeaderBag, ProviderAuthMode } from "../protocols/auth.js";
import { buildProviderAuthHeaders, isClientAuthorized } from "../protocols/auth.js";
import type { FetchLike, ProviderResult } from "../protocols/http.js";
import { ProviderHttpClient } from "../protocols/http.js";
import { forwardModelRequest } from "../protocols/model-proxy.js";
import { registerAccount } from "../protocols/register.js";
import { uploadAsset } from "../protocols/upload.js";
import { createVideoTask, getVideoTask } from "../protocols/video.js";
import { InMemoryAccountStore } from "../store/account-store.js";

export interface CreateAppOptions {
  masterApiKey: string;
  providerBaseUrl: string;
  providerAuthMode: ProviderAuthMode;
  defaultAccount?: AccountIdentity;
  fetchImpl?: FetchLike;
}

interface UploadRequestBody {
  source?: unknown;
  filename?: unknown;
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

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new InMemoryAccountStore(options.defaultAccount);
  const client = new ProviderHttpClient(options.providerBaseUrl, options.fetchImpl);

  function requireLocalAuth(request: FastifyRequest, reply: FastifyReply): boolean {
    if (isClientAuthorized(headersFromRequest(request), options.masterApiKey)) {
      return true;
    }
    void reply.status(401).send({ error: { message: "Invalid API key", type: "authentication_error" } });
    return false;
  }

  function providerHeaders(reply: FastifyReply): Record<string, string> | undefined {
    const account = store.getDefault();
    if (!account) {
      void reply.status(503).send({ error: { message: "No provider account configured", type: "account_unavailable" } });
      return undefined;
    }
    return buildProviderAuthHeaders(account, options.providerAuthMode);
  }

  app.get("/health", async () => ({ ok: true }));

  app.get("/v1/models", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = providerHeaders(reply);
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
    const headers = providerHeaders(reply);
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
    const headers = providerHeaders(reply);
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
    const headers = providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await registerAccount(client, bodyRecord(request), headers);
    await sendProviderResult(reply, result);
  });

  app.post("/api/uploads", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = providerHeaders(reply);
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

  app.post("/api/video/generations", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = providerHeaders(reply);
    if (!headers) {
      return;
    }
    const result = await createVideoTask(client, bodyRecord(request), headers);
    await sendProviderResult(reply, result);
  });

  app.get("/api/video/generations/:taskId", async (request, reply) => {
    if (!requireLocalAuth(request, reply)) {
      return;
    }
    const headers = providerHeaders(reply);
    if (!headers) {
      return;
    }
    const params = request.params as { taskId?: string };
    if (!params.taskId) {
      await reply.status(400).send({ error: { message: "taskId is required" } });
      return;
    }
    const result = await getVideoTask(client, params.taskId, headers);
    await sendProviderResult(reply, result);
  });

  return app;
}

