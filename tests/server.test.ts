import { describe, expect, it, vi } from "vitest";
import { AccountService } from "../src/services/account-service.js";
import {
  RegistrationJobNotFoundError,
  RegistrationQueueUnavailableError
} from "../src/services/registration-job-service.js";
import { createApp } from "../src/server/app.js";
import { InMemoryAccountStore } from "../src/store/account-store.js";
import { InMemoryCosConfigStore } from "../src/store/cos-config-store.js";
import { InMemoryYydsMailConfigStore } from "../src/store/yyds-mail-config-store.js";
import { InMemoryVideoTaskStore } from "../src/store/video-task-store.js";

describe("server routes", () => {
  it("does not serve the built-in admin page from the backend", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    });

    const response = await app.inject({ method: "GET", url: "/admin" });

    expect(response.statusCode).toBe(404);
  });

  it("creates and reads registration jobs through protected routes", async () => {
    const registrationJobService = {
      createJob: vi.fn(async () => ({ jobId: "job-1" })),
      getJob: vi.fn(async () => ({
        id: "job-1",
        mode: "fill",
        state: "queued",
        target: 3,
        concurrency: 2,
        progress: { started: 0, completed: 0, failed: 0, total: 3 },
        logs: [],
        createdAt: 1000
      })),
      listJobs: vi.fn(async () => []),
      cancelJob: vi.fn(async () => ({
        id: "job-1",
        mode: "fill",
        state: "canceled",
        target: 3,
        concurrency: 2,
        progress: { started: 0, completed: 0, failed: 0, total: 3 },
        logs: [],
        createdAt: 1000,
        finishedAt: 2000
      }))
    };

    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      registrationJobService,
      fetchImpl: async () => Response.json({ ok: true })
    });

    expect((await app.inject({ method: "POST", url: "/api/registration/jobs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/registration/jobs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/registration/jobs/job-1" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/registration/jobs/job-1/cancel" })).statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/api/registration/jobs",
      headers: { authorization: "Bearer sk-test" },
      payload: { mode: "fill", target: 3, concurrency: 2 }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ jobId: "job-1" });
    expect(registrationJobService.createJob).toHaveBeenCalledWith({ mode: "fill", target: 3, concurrency: 2 });

    const listed = await app.inject({
      method: "GET",
      url: "/api/registration/jobs",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);

    const read = await app.inject({
      method: "GET",
      url: "/api/registration/jobs/job-1",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: "job-1", state: "queued" });

    const canceled = await app.inject({
      method: "POST",
      url: "/api/registration/jobs/job-1/cancel",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json()).toMatchObject({ id: "job-1", state: "canceled" });

    registrationJobService.createJob.mockRejectedValueOnce(new RegistrationQueueUnavailableError("redis unavailable"));
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/registration/jobs",
      headers: { authorization: "Bearer sk-test" },
      payload: { mode: "single" }
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ error: { type: "registration_queue_unavailable" } });
    expect(JSON.stringify(unavailable.json())).not.toContain("redis unavailable");

    registrationJobService.cancelJob.mockRejectedValueOnce(new RegistrationQueueUnavailableError("redis unavailable"));
    const cancelUnavailable = await app.inject({
      method: "POST",
      url: "/api/registration/jobs/job-1/cancel",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(cancelUnavailable.statusCode).toBe(503);
    expect(cancelUnavailable.json()).toMatchObject({ error: { type: "registration_queue_unavailable" } });
    expect(JSON.stringify(cancelUnavailable.json())).not.toContain("redis unavailable");
  });

  it("maps registration job route failure branches", async () => {
    const appOptions = {
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token" as const,
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    };

    const appWithoutJobs = createApp(appOptions);
    for (const request of [
      { method: "POST", url: "/api/registration/jobs", payload: { mode: "single" } },
      { method: "GET", url: "/api/registration/jobs" },
      { method: "GET", url: "/api/registration/jobs/job-1" },
      { method: "POST", url: "/api/registration/jobs/job-1/cancel" }
    ] as const) {
      const response = await appWithoutJobs.inject({
        ...request,
        headers: { authorization: "Bearer sk-test" }
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { type: "registration_queue_unavailable" } });
    }

    const registrationJobService = {
      createJob: vi.fn(async () => ({ jobId: "job-1" })),
      getJob: vi.fn(async () => undefined),
      listJobs: vi.fn(async () => []),
      cancelJob: vi.fn(async () => {
        throw new RegistrationJobNotFoundError();
      })
    };
    const app = createApp({ ...appOptions, registrationJobService });

    const missingRead = await app.inject({
      method: "GET",
      url: "/api/registration/jobs/job-missing",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(missingRead.statusCode).toBe(404);
    expect(missingRead.json()).toMatchObject({ error: { message: "Registration job not found" } });

    const missingCancel = await app.inject({
      method: "POST",
      url: "/api/registration/jobs/job-missing/cancel",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(missingCancel.statusCode).toBe(404);
    expect(missingCancel.json()).toMatchObject({ error: { message: "Registration job not found" } });

    registrationJobService.cancelJob.mockRejectedValueOnce(new Error("unexpected cancel failure"));
    const unknownCancel = await app.inject({
      method: "POST",
      url: "/api/registration/jobs/job-1/cancel",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(unknownCancel.statusCode).toBe(500);

    registrationJobService.listJobs.mockRejectedValueOnce(new RegistrationQueueUnavailableError("redis unavailable"));
    const listUnavailable = await app.inject({
      method: "GET",
      url: "/api/registration/jobs",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(listUnavailable.statusCode).toBe(503);
    expect(listUnavailable.json()).toMatchObject({ error: { type: "registration_queue_unavailable" } });
    expect(JSON.stringify(listUnavailable.json())).not.toContain("redis unavailable");

    registrationJobService.getJob.mockRejectedValueOnce(new RegistrationQueueUnavailableError("redis unavailable"));
    const readUnavailable = await app.inject({
      method: "GET",
      url: "/api/registration/jobs/job-1",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(readUnavailable.statusCode).toBe(503);
    expect(readUnavailable.json()).toMatchObject({ error: { type: "registration_queue_unavailable" } });
    expect(JSON.stringify(readUnavailable.json())).not.toContain("redis unavailable");
  });

  it("serves health without auth and protects protocol routes", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    const unauthorized = await app.inject({ method: "GET", url: "/v1/models" });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(authorized.statusCode).toBe(200);
  });

  it("serves the local model catalog when the upstream models endpoint is missing", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ detail: "Not Found" }, { status: 404 })
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "list",
      data: expect.arrayContaining([
        expect.objectContaining({ id: "gpt-5.5" }),
        expect.objectContaining({ id: "openai.gpt-5.5" }),
        expect.objectContaining({ id: "ospu-4.8" }),
        expect.objectContaining({ id: "ospu-4.6" }),
        expect.objectContaining({ id: "sonnet-4.6" }),
        expect.objectContaining({ id: "haiku-4.5" })
      ])
    });
  });

  it("lets public proxy keys access only the public model catalog and not admin routes", async () => {
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ error: { message: "public models should not hit upstream" } }, { status: 500 })
    });

    const models = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer sk-public" }
    });
    expect(models.statusCode).toBe(200);
    const ids = models.json().data.map((item: { id: string }) => item.id);
    expect(ids).toEqual([
      "claude.opus-4.8",
      "claude.sonnet-4.6",
      "claude.sonnet-4.5",
      "claude.haiku-4.5",
      "codex",
      "gpt-5.3-codex",
      "gpt-5.2-codex",
      "gpt-image-2"
    ]);
    expect(ids).not.toContain("gpt-5.5");
    expect(ids).not.toContain("qwen.qwen3.6-plus");

    const admin = await app.inject({
      method: "GET",
      url: "/api/accounts",
      headers: { authorization: "Bearer sk-public" }
    });
    expect(admin.statusCode).toBe(401);
  });

  it("proxies public chat only for claude and codex models", async () => {
    const forwarded: Array<{ path: string; body: Record<string, unknown> }> = [];
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        forwarded.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json({
          id: "chatcmpl-1",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
        });
      }
    });

    const codex = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "codex", messages: [{ role: "user", content: "hi" }] }
    });
    expect(codex.statusCode).toBe(200);
    expect(forwarded[0]).toMatchObject({
      path: "/chat/completions",
      body: { model: "openai.gpt-5.3-codex" }
    });

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "gpt-5.5", messages: [{ role: "user", content: "hi" }] }
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ error: { type: "model_not_allowed" } });
    expect(forwarded).toHaveLength(1);
  });

  it("allows public Anthropic messages only for Claude models", async () => {
    const forwarded: Record<string, unknown>[] = [];
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async (_url, init) => {
        forwarded.push(JSON.parse(String(init?.body ?? "{}")));
        return Response.json({ id: "msg-1", content: [{ type: "text", text: "ok" }] });
      }
    });

    const claude = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "claude.opus-4.8", max_tokens: 64, messages: [{ role: "user", content: "hi" }] }
    });
    expect(claude.statusCode).toBe(200);
    expect(forwarded[0]).toMatchObject({ model: "claude.opus-4.8" });

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "codex", max_tokens: 64, messages: [{ role: "user", content: "hi" }] }
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ error: { type: "model_not_allowed" } });
    expect(forwarded).toHaveLength(1);
  });

  it("handles browser CORS preflight and auth failures without a dev proxy", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    });

    const origin = "http://127.0.0.1:15173";
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/mail/yyds/config",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
    expect(String(preflight.headers["access-control-allow-methods"])).toContain("GET");
    expect(String(preflight.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
    expect(String(preflight.headers["access-control-allow-headers"]).toLowerCase()).toContain("content-type");

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/mail/yyds/config",
      headers: { origin }
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("protects yyds mailbox creation and requires dynamic config", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    });

    const unauthorized = await app.inject({ method: "POST", url: "/api/mail/yyds/accounts" });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/accounts",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(authorized.statusCode).toBe(503);
    expect(authorized.json()).toMatchObject({ error: { type: "mail_unavailable" } });
  });

  it("stores YYDS Mail config encrypted and uses it for mailbox creation", async () => {
    const yydsMailConfigStore = new InMemoryYydsMailConfigStore();
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      yydsMailBaseUrl: "https://mail.test/v1",
      yydsMailConfigStore,
      yydsMailConfigSecret: "12345678901234567890123456789012",
      fetchImpl: async (url, init) => {
        if (String(url).includes("mail.test")) {
          expect(init?.headers).toMatchObject({ "x-api-key": "ac-db-key" });
          return Response.json({
            success: true,
            data: { address: "navos-db@mail.test", id: "m1", token: "mail-token" }
          });
        }
        return Response.json({ ok: true });
      }
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/mail/yyds/config",
      headers: { authorization: "Bearer sk-test" },
      payload: { apiKey: "ac-db-key", enabled: true }
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ enabled: true, apiKeyConfigured: true });
    expect(JSON.stringify(saved.json())).not.toContain("ac-db-key");
    const raw = await yydsMailConfigStore.getRaw();
    expect(raw?.apiKeyEnc).toBeTruthy();
    expect(raw?.apiKeyEnc).not.toContain("ac-db-key");

    const mailbox = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/accounts",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(mailbox.statusCode).toBe(200);
    expect(mailbox.json()).toMatchObject({ address: "navos-db@mail.test" });
  });

  it("imports and lists accounts through protected account routes", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore()),
      fetchImpl: async () => Response.json({ ok: true })
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/accounts/import",
      payload: { uid: "u1", token: "t1" }
    });
    expect(unauthorized.statusCode).toBe(401);

    const imported = await app.inject({
      method: "POST",
      url: "/api/accounts/import",
      headers: { authorization: "Bearer sk-test" },
      payload: { uid: "u1", token: "token-abcdef", mailboxAddr: "a@mail.test" }
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ uid: "u1", tokenPreview: "token-ab..." });

    const listed = await app.inject({
      method: "GET",
      url: "/api/accounts",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      expect.objectContaining({ uid: "u1", tokenPreview: "token-ab..." })
    ]);
    expect(listed.json()[0]).not.toHaveProperty("token");
  });

  it("refreshes an account balance through the VIP balance protocol", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({
      uid: "u1",
      token: "token-1",
      balanceRemaining: 1000,
      balanceTotal: 1000
    });
    const vipClient = {
      queryBalance: vi.fn(async () => ({
        availableBalance: 1500,
        totalBalance: 2000
      }))
    };
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      vipClient,
      fetchImpl: async () => Response.json({ ok: true })
    });

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/accounts/u1/balance/refresh",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(refreshed.statusCode).toBe(200);
    expect(vipClient.queryBalance).toHaveBeenCalledWith("u1", "token-1");
    expect(refreshed.json()).toMatchObject({
      uid: "u1",
      balanceRemaining: 1500,
      balanceTotal: 2000
    });
    expect(await store.get("u1")).toMatchObject({
      balanceRemaining: 1500,
      balanceTotal: 2000
    });
  });

  it("creates and polls image generations through the protected local route", async () => {
    const paths: string[] = [];
    let forwardedBody: Record<string, unknown> | undefined;
    let forwardedAuth = "";
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 200, balanceTotal: 200 });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(`${init?.method ?? "GET"} ${path}`);
        forwardedAuth = String((init?.headers as Record<string, string>).authorization ?? "");
        if (path === "/api/tasks/navos-gpt-image-t2i") {
          forwardedBody = JSON.parse(String(init?.body));
          return Response.json({ code: 200, data: { task_id: "img_task_1", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_task_1") {
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/image.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "white robot", n: 9, quality: "high", size: "1536x1024" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "succeeded",
      task_id: "img_task_1",
      data: [{ url: "https://cdn.test/image.png" }]
    });
    expect(forwardedAuth).toBe("Bearer u1:t1");
    expect(paths).toEqual([
      "POST /api/tasks/navos-gpt-image-t2i",
      "GET /api/tasks/image/generations/img_task_1"
    ]);
    expect(forwardedBody).toEqual({
      prompt: "white robot",
      n: 4,
      quality: "high",
      size: "1536x1024",
      response_format: "b64_json",
      output_format: "png"
    });
    expect(await store.get("u1")).toMatchObject({
      balanceRemaining: 100,
      balanceTotal: 200,
      status: "active",
      leaseUntil: 0
    });
  });

  it("exposes public OpenAI-compatible image generations only for gpt-image-2", async () => {
    const paths: string[] = [];
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 200, balanceTotal: 200 });
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/api/tasks/navos-gpt-image-t2i") {
          return Response.json({ code: 200, data: { task_id: "img_task_public", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_task_public") {
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/public.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const generated = await app.inject({
      method: "POST",
      url: "/v1/images/generations",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "gpt-image-2", prompt: "white robot", n: 1, quality: "low", size: "1024x1024" }
    });

    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({
      task_id: "img_task_public",
      data: [{ url: "https://cdn.test/public.png" }]
    });
    expect(paths).toEqual([
      "POST /api/tasks/navos-gpt-image-t2i",
      "GET /api/tasks/image/generations/img_task_public"
    ]);
    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 100 });

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/images/generations",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "dall-e-3", prompt: "white robot" }
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ error: { type: "model_not_allowed" } });
    expect(paths).toHaveLength(2);
  });

  it("creates image edits with reference images through the protected local route", async () => {
    const paths: string[] = [];
    let forwardedForm: FormData | undefined;
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 300, balanceTotal: 300 });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/api/tasks/navos-gpt-image-i2i") {
          forwardedForm = init?.body as FormData;
          expect(init?.body).toBeInstanceOf(FormData);
          expect((init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
          return Response.json({ code: 200, data: { task_id: "img_edit_1", status: "queued" } });
        }
        if (path === "/api/tasks/image/edits/img_edit_1") {
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/edit.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        prompt: "turn it into a toy",
        images: ["data:image/png;base64,aGVsbG8="],
        n: 1,
        quality: "auto",
        size: "1024x1024"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "succeeded",
      task_id: "img_edit_1",
      data: [{ url: "https://cdn.test/edit.png" }]
    });
    expect(paths).toEqual([
      "POST /api/tasks/navos-gpt-image-i2i",
      "GET /api/tasks/image/edits/img_edit_1"
    ]);
    expect(forwardedForm?.get("prompt")).toBe("turn it into a toy");
    expect(forwardedForm?.get("model")).toBe("gpt-image-2");
    expect(forwardedForm?.getAll("image")).toHaveLength(1);
    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 200, leaseUntil: 0 });
  });

  it("archives successful image outputs to COS when COS is enabled", async () => {
    const cosConfigStore = new InMemoryCosConfigStore();
    const archiveImage = vi.fn(async () => ({
      cosUrl: "https://cdn.example.com/navos/images/2026/07/09/img_task_1_1.png",
      cosKey: "navos/images/2026/07/09/img_task_1_1.png",
      sizeBytes: 4321,
      sha256: "image-hash-1"
    }));
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 200, balanceTotal: 200 });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      cosConfigStore,
      cosConfigSecret: "12345678901234567890123456789012",
      archiveImage,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/tasks/navos-gpt-image-t2i") {
          return Response.json({ code: 200, data: { task_id: "img_task_1", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_task_1") {
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://oss.test/img_task_1.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path} ${init?.method ?? "GET"}` } }, { status: 404 });
      }
    });

    await app.inject({
      method: "PUT",
      url: "/api/cos/config",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        name: "main",
        secretId: "secret-id",
        secretKey: "secret-key",
        bucket: "bucket-123456",
        region: "ap-shanghai",
        publicDomain: "https://cdn.example.com",
        uploadPrefix: "navos/videos",
        enabled: true
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "white robot", n: 1, quality: "low", size: "1024x1024" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "succeeded",
      data: [{
        url: "https://oss.test/img_task_1.png",
        cosUrl: "https://cdn.example.com/navos/images/2026/07/09/img_task_1_1.png",
        archiveStatus: "archived",
        sizeBytes: 4321,
        sha256: "image-hash-1"
      }]
    });
    expect(archiveImage).toHaveBeenCalledWith({
      taskId: "img_task_1",
      index: 1,
      sourceUrl: "https://oss.test/img_task_1.png",
      config: expect.objectContaining({ bucket: "bucket-123456", uploadPrefix: "navos/videos" })
    });
  });

  it("returns the nested image task error instead of the upstream success envelope", async () => {
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 200, balanceTotal: 200 });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/tasks/navos-gpt-image-t2i") {
          return Response.json({ code: 200, msg: "success", data: { task_id: "img_task_failed", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_task_failed") {
          return Response.json({
            code: 200,
            msg: "success",
            data: { status: "failed", error: "创建图片任务失败" }
          });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "white robot", n: 1, quality: "low", size: "1024x1024" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { message: "创建图片任务失败" },
      task_id: "img_task_failed"
    });
    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 200, leaseUntil: 0 });
  });

  it("retries image generation on the next leased account when the first account task fails", async () => {
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 200, balanceTotal: 200 });
    await store.upsert({ uid: "u2", token: "t2", balanceRemaining: 200, balanceTotal: 200 });
    const authHeaders: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const authorization = String((init?.headers as Record<string, string>).authorization ?? "");
        authHeaders.push(authorization);
        if (path === "/api/tasks/navos-gpt-image-t2i" && authorization === "Bearer u1:t1") {
          return Response.json({ code: 200, msg: "success", data: { task_id: "img_bad", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_bad") {
          return Response.json({ code: 200, msg: "success", data: { status: "failed", error: "创建图片任务失败" } });
        }
        if (path === "/api/tasks/navos-gpt-image-t2i" && authorization === "Bearer u2:t2") {
          return Response.json({ code: 200, msg: "success", data: { task_id: "img_good", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_good") {
          return Response.json({ code: 200, msg: "success", data: { status: "succeeded", url: "https://cdn.test/good.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "white robot", n: 1, quality: "low", size: "1024x1024" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task_id: "img_good",
      data: [{ url: "https://cdn.test/good.png" }]
    });
    expect(authHeaders).toEqual([
      "Bearer u1:t1",
      "Bearer u1:t1",
      "Bearer u2:t2",
      "Bearer u2:t2"
    ]);
    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 200, leaseUntil: 0 });
    expect(await store.get("u2")).toMatchObject({ balanceRemaining: 100, leaseUntil: 0 });
  });

  it("exposes v1 video generation compatibility routes", async () => {
    const paths: string[] = [];
    const accountService = new AccountService(new InMemoryAccountStore());
    await accountService.importAccount({
      uid: "u1",
      token: "t1",
      balanceRemaining: 2000,
      balanceTotal: 2000
    });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (url, init) => {
        paths.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
        if (String(url).endsWith("/api/tasks/navos-seedance-video-generation")) {
          return Response.json({ task_id: "task_1", status: "queued" });
        }
        return Response.json({ task_id: "task_1", status: "success", video_url: "https://cdn.test/v.mp4" });
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/video/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "city skyline", durationSeconds: 5, resolution: "720P" }
    });

    const polled = await app.inject({
      method: "GET",
      url: "/v1/video/generations/task_1",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(created.statusCode).toBe(200);
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({ status: "succeeded", videoUrl: "https://cdn.test/v.mp4" });
    expect(paths).toEqual([
      "POST /api/tasks/navos-seedance-video-generation",
      "GET /api/tasks/video/generations/task_1"
    ]);
  });

  it("uploads and normalizes video references before forwarding task creation", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({
      uid: "u1",
      token: "t1",
      balanceRemaining: 2000,
      balanceTotal: 2000
    });
    const paths: string[] = [];
    let createdBody: Record<string, unknown> | undefined;
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path === "/api/uploads/file") {
          return Response.json({
            code: 200,
            data: { url: `https://cdn.test/upload-${paths.filter((item) => item === "/api/uploads/file").length}.bin` }
          });
        }
        if (path === "/api/tasks/navos-seedance-video-generation") {
          createdBody = JSON.parse(String(init?.body));
          return Response.json({ task_id: "task_ref", status: "queued" });
        }
        return Response.json({ error: { message: "unexpected path" } }, { status: 404 });
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "doubao-seedance-2-0-260128",
        prompt: "city skyline",
        durationSeconds: 5,
        resolution: "720P",
        aspectRatio: "16:9",
        mode: "omni_reference",
        generation_mode: "omni_reference",
        images: ["data:image/png;base64,aGVsbG8=", "https://assets.test/style.png"],
        imageRoles: ["first_frame", "reference_image"],
        videos: ["data:video/mp4;base64,AAAA"],
        videoRoles: ["reference_video"],
        audioRefs: ["https://assets.test/music.mp3"],
        audioRoles: ["reference_audio"]
      }
    });

    expect(created.statusCode).toBe(200);
    expect(paths).toEqual([
      "/api/uploads/file",
      "/api/uploads/file",
      "/api/tasks/navos-seedance-video-generation"
    ]);
    expect(createdBody).toMatchObject({
      model: "navos/doubao-seedance-2-0-260128",
      prompt: "city skyline",
      duration: 5,
      durationSeconds: 5,
      aspectRatio: "16:9",
      resolution: "720P",
      audio: true,
      mode: "omni_reference",
      generation_mode: "omni_reference",
      image: "https://cdn.test/upload-1.bin",
      imageRoles: ["first_frame"],
      videos: ["https://cdn.test/upload-2.bin"],
      videoRoles: ["reference_video"],
      audioRef: "https://assets.test/music.mp3",
      audioRoles: ["reference_audio"],
      metadata: {
        reference_images: ["https://assets.test/style.png"],
        reference_videos: ["https://cdn.test/upload-2.bin"],
        reference_audios: ["https://assets.test/music.mp3"],
        generate_audio: true
      }
    });
  });

  it("rejects video durations that exceed account resolution rules", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ task_id: "task_1", status: "queued" }));
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/api/video/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "city skyline", durationSeconds: 10, resolution: "1080P" }
    });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.message).toContain("1080P");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses one leased account per concurrent video create and depletes successful accounts", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1", balanceRemaining: 2000, balanceTotal: 2000 });
    await accountService.importAccount({ uid: "u2", token: "t2", balanceRemaining: 2000, balanceTotal: 2000 });
    const usedUids: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (_url, init) => {
        const authorization = String((init?.headers as Record<string, string>).authorization ?? "");
        usedUids.push(authorization.replace(/^Bearer\s+/, "").split(":")[0]);
        return Response.json({ task_id: `task_${usedUids.length}`, status: "queued" });
      }
    });

    const [first, second, third] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/video/generations",
        headers: { authorization: "Bearer sk-test" },
        payload: { prompt: "city skyline", durationSeconds: 15, resolution: "480P" }
      }),
      app.inject({
        method: "POST",
        url: "/api/video/generations",
        headers: { authorization: "Bearer sk-test" },
        payload: { prompt: "city skyline", durationSeconds: 10, resolution: "720P" }
      }),
      app.inject({
        method: "POST",
        url: "/api/video/generations",
        headers: { authorization: "Bearer sk-test" },
        payload: { prompt: "city skyline", durationSeconds: 5, resolution: "1080P" }
      })
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 200]);
    expect(third.statusCode).toBe(503);
    expect(usedUids.sort()).toEqual(["u1", "u2"]);
    expect((await store.get("u1"))?.status).toBe("depleted");
    expect((await store.get("u2"))?.status).toBe("depleted");
  });

  it("uses an existing 2000-credit video account before registering a new one", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "low", token: "t-low", balanceRemaining: 1000, balanceTotal: 2000 });
    await accountService.importAccount({ uid: "ready", token: "t-ready", balanceRemaining: 2000, balanceTotal: 2000 });
    const registrationService = {
      registerOne: vi.fn(async () => ({
        success: true,
        uid: "auto-video-should-not-run",
        token: "auto-token",
        balance: 2000
      }))
    };
    const usedUids: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      registrationService: registrationService as never,
      fetchImpl: async (_url, init) => {
        const authorization = String((init?.headers as Record<string, string>).authorization ?? "");
        usedUids.push(authorization.replace(/^Bearer\s+/, "").split(":")[0]);
        return Response.json({ task_id: "task_ready", status: "queued" });
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "city skyline", durationSeconds: 10, resolution: "720P" }
    });

    expect(created.statusCode).toBe(200);
    expect(registrationService.registerOne).not.toHaveBeenCalled();
    expect(usedUids).toEqual(["ready"]);
    expect((await store.get("low"))?.status).toBe("active");
    expect((await store.get("low"))?.leaseId).toBeUndefined();
    expect((await store.get("ready"))?.status).toBe("depleted");
  });

  it("auto-registers for video when existing accounts are below 2000 credits", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "low", token: "t-low", balanceRemaining: 1000, balanceTotal: 2000 });
    const registrationService = {
      registerOne: vi.fn(async () => {
        await accountService.importAccount({
          uid: "auto-video-2k",
          token: "auto-token-2k",
          mailboxAddr: "auto-video-2k@mail.test",
          mailboxToken: "mail-token",
          balanceRemaining: 2000,
          balanceTotal: 2000,
          status: "active"
        });
        return {
          success: true,
          uid: "auto-video-2k",
          token: "auto-token-2k",
          email: "auto-video-2k@mail.test",
          mailboxToken: "mail-token",
          balance: 2000
        };
      })
    };
    const usedHeaders: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      registrationService: registrationService as never,
      fetchImpl: async (_url, init) => {
        usedHeaders.push(String((init?.headers as Record<string, string>).authorization ?? ""));
        return Response.json({ task_id: "task_auto_2k", status: "queued" });
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "city skyline", durationSeconds: 10, resolution: "720P" }
    });

    expect(created.statusCode).toBe(200);
    expect(registrationService.registerOne).toHaveBeenCalledOnce();
    expect(usedHeaders).toEqual(["Bearer auto-video-2k:auto-token-2k"]);
    expect((await store.get("low"))?.status).toBe("active");
    expect((await store.get("auto-video-2k"))?.status).toBe("depleted");
  });

  it("auto-registers a one-shot video account when the pool has no available account", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    const registrationService = {
      registerOne: vi.fn(async () => {
        await accountService.importAccount({
          uid: "auto-video-1",
          token: "auto-token-1",
          mailboxAddr: "auto-video-1@mail.test",
          mailboxToken: "mail-token",
          balanceRemaining: 2000,
          balanceTotal: 2000,
          status: "active"
        });
        return {
          success: true,
          uid: "auto-video-1",
          token: "auto-token-1",
          email: "auto-video-1@mail.test",
          mailboxToken: "mail-token",
          balance: 2000
        };
      })
    };
    const usedHeaders: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      registrationService: registrationService as never,
      fetchImpl: async (_url, init) => {
        usedHeaders.push(String((init?.headers as Record<string, string>).authorization ?? ""));
        return Response.json({ task_id: "task_auto", status: "queued" });
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/video/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "city skyline", durationSeconds: 10, resolution: "720P" }
    });

    expect(created.statusCode).toBe(200);
    expect(registrationService.registerOne).toHaveBeenCalledOnce();
    expect(usedHeaders).toEqual(["Bearer auto-video-1:auto-token-1"]);
    expect((await store.get("auto-video-1"))?.status).toBe("depleted");
  });

  it("depletes a chat account when upstream reports insufficient balance", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1" });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async () => Response.json(
        { error: { message: "积分不足：insufficient_balance" } },
        { status: 402 }
      )
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "openai.gpt-5.5",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(402);
    expect((await store.get("u1"))?.status).toBe("depleted");
    expect((await store.get("u1"))?.rateLimitedUntil).toBe(0);
  });

  it("depletes a leased video account when upstream reports insufficient balance", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1", balanceRemaining: 2000, balanceTotal: 2000 });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async () => Response.json(
        { code: 402, msg: "积分不足：本次生成需要扣除积分 reason=insufficient_balance" },
        { status: 402 }
      )
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/video/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "city skyline", durationSeconds: 5, resolution: "720P" }
    });

    const account = await store.get("u1");
    expect(response.statusCode).toBe(402);
    expect(account?.status).toBe("depleted");
    expect(account?.leaseUntil).toBe(0);
    expect(account?.rateLimitedUntil).toBe(0);
  });

  it("stores COS config encrypted and never returns secrets", async () => {
    const cosConfigStore = new InMemoryCosConfigStore();
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      cosConfigStore,
      cosConfigSecret: "12345678901234567890123456789012",
      fetchImpl: async () => Response.json({ ok: true })
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/cos/config",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        name: "main",
        secretId: "secret-id",
        secretKey: "secret-key",
        bucket: "bucket-123456",
        region: "ap-shanghai",
        publicDomain: "https://cdn.example.com",
        uploadPrefix: "navos/videos",
        enabled: true
      }
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      name: "main",
      bucket: "bucket-123456",
      region: "ap-shanghai",
      publicDomain: "https://cdn.example.com",
      uploadPrefix: "navos/videos",
      secretIdConfigured: true,
      secretKeyConfigured: true
    });
    expect(JSON.stringify(saved.json())).not.toContain("secret-id");
    expect(JSON.stringify(saved.json())).not.toContain("secret-key");

    const raw = await cosConfigStore.getRaw();
    const originalSecretIdEnc = raw?.secretIdEnc;
    const originalSecretKeyEnc = raw?.secretKeyEnc;
    expect(originalSecretIdEnc).toBeTruthy();
    expect(originalSecretKeyEnc).toBeTruthy();
    expect(originalSecretIdEnc).not.toContain("secret-id");
    expect(originalSecretKeyEnc).not.toContain("secret-key");

    const updated = await app.inject({
      method: "PUT",
      url: "/api/cos/config",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        name: "main",
        secretId: "",
        secretKey: "",
        bucket: "bucket-123456",
        region: "ap-guangzhou",
        uploadPrefix: "navos/videos",
        enabled: true
      }
    });

    expect(updated.statusCode).toBe(200);
    expect((await cosConfigStore.getRaw())?.secretIdEnc).toBe(originalSecretIdEnc);
    expect((await cosConfigStore.getRaw())?.secretKeyEnc).toBe(originalSecretKeyEnc);
  });

  it("archives successful video output to COS and returns archived URL", async () => {
    const cosConfigStore = new InMemoryCosConfigStore();
    const videoTaskStore = new InMemoryVideoTaskStore();
    const archiveVideo = vi.fn(async () => ({
      cosUrl: "https://cdn.example.com/navos/videos/2026/07/08/task_1.mp4",
      cosKey: "navos/videos/2026/07/08/task_1.mp4",
      sizeBytes: 1234,
      sha256: "hash-1"
    }));
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      cosConfigStore,
      cosConfigSecret: "12345678901234567890123456789012",
      videoTaskStore,
      archiveVideo,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/api/tasks/video/generations/task_1")) {
          return Response.json({ task_id: "task_1", status: "success", video_url: "https://oss.test/task_1.mp4" });
        }
        return Response.json({ task_id: "task_1", status: "queued" });
      }
    });

    await app.inject({
      method: "PUT",
      url: "/api/cos/config",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        name: "main",
        secretId: "secret-id",
        secretKey: "secret-key",
        bucket: "bucket-123456",
        region: "ap-shanghai",
        publicDomain: "https://cdn.example.com",
        uploadPrefix: "navos/videos",
        enabled: true
      }
    });

    const polled = await app.inject({
      method: "GET",
      url: "/api/video/generations/task_1",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({
      id: "task_1",
      status: "succeeded",
      videoUrl: "https://oss.test/task_1.mp4",
      cosUrl: "https://cdn.example.com/navos/videos/2026/07/08/task_1.mp4",
      archiveStatus: "archived"
    });
    expect(archiveVideo).toHaveBeenCalledOnce();
    expect(await videoTaskStore.get("task_1")).toMatchObject({
      taskId: "task_1",
      sourceUrl: "https://oss.test/task_1.mp4",
      cosUrl: "https://cdn.example.com/navos/videos/2026/07/08/task_1.mp4",
      archiveStatus: "archived"
    });
  });
});
