import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { AccountService } from "../src/services/account-service.js";
import {
  RegistrationJobNotFoundError,
  RegistrationQueueUnavailableError
} from "../src/services/registration-job-service.js";
import { createApp } from "../src/server/app.js";
import { InMemoryAccountStore } from "../src/store/account-store.js";
import { InMemoryYydsMailConfigStore } from "../src/store/yyds-mail-config-store.js";
import { SecretBox } from "../src/security/secretbox.js";
import { InMemoryVideoTaskStore } from "../src/store/video-task-store.js";
import { InMemoryYydsDomainPoolStore } from "../src/store/yyds-domain-pool-store.js";

async function startFakeUpstream(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "fake upstream failed");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake upstream did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    })
  };
}

function uidFromAuthorization(authorization: string | undefined): string {
  return (authorization ?? "").replace(/^Bearer\s+/i, "").split(":")[0] ?? "";
}

describe("server routes", () => {
  it("protects and returns YYDS domain pool state", async () => {
    const domainStore = new InMemoryYydsDomainPoolStore();
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      yydsDomainPoolStore: domainStore,
      yydsDomainFetchImpl: async () => [
        { domain: "healthy.test", isPublic: true, isVerified: true, isMxValid: true, dnsRecords: { status: "healthy", receivingReady: true } }
      ],
      fetchImpl: async () => Response.json({ ok: true })
    });

    expect((await app.inject({ method: "GET", url: "/api/mail/yyds/domains" })).statusCode).toBe(401);

    const publicKeyRefresh = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/domains/refresh",
      headers: { authorization: "Bearer sk-public" }
    });
    expect(publicKeyRefresh.statusCode).toBe(401);

    const refresh = await app.inject({ method: "POST", url: "/api/mail/yyds/domains/refresh", headers: { authorization: "Bearer sk-test" } });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().eligible).toEqual([{ domain: "healthy.test" }]);

    const listed = await app.inject({ method: "GET", url: "/api/mail/yyds/domains", headers: { authorization: "Bearer sk-test" } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().domains[0]).toMatchObject({ domain: "healthy.test", status: "active" });
  });

  it("roundtrips YYDS domain pool config through protected routes", async () => {
    const domainStore = new InMemoryYydsDomainPoolStore();
    const app = createApp({
      masterApiKey: "sk-test",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      yydsDomainPoolStore: domainStore,
      fetchImpl: async () => Response.json({ ok: true })
    });

    expect((await app.inject({
      method: "PUT",
      url: "/api/mail/yyds/domain-pool/config",
      payload: { enabled: false }
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "PUT",
      url: "/api/mail/yyds/domain-pool/config",
      headers: { authorization: "Bearer sk-public" },
      payload: { enabled: false }
    })).statusCode).toBe(401);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/mail/yyds/domain-pool/config",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        enabled: false,
        mode: "whitelist",
        whitelist: [" Example.COM ", "", "SECOND.test"],
        blacklist: ["BLOCKED.TEST"],
        refreshIntervalMinutes: 45
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      enabled: false,
      mode: "whitelist",
      whitelist: ["example.com", "second.test"],
      blacklist: ["blocked.test"],
      refreshIntervalMinutes: 45
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/mail/yyds/domains",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().config).toEqual(saved.json());
  });

  it("returns stable YYDS domain pool refresh errors for upstream failures and malformed payloads", async () => {
    const baseOptions = {
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token" as const,
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" }))
    };

    for (const fetchImpl of [
      async () => Response.json({ error: "unavailable" }, { status: 503 }),
      async () => {
        throw new Error("socket hang up with secret upstream details");
      },
      async () => new Response("not json", { headers: { "content-type": "application/json" } }),
      async () => Response.json({ data: [{}] }),
      async () => Response.json({ data: "not-array" })
    ]) {
      const app = createApp({
        ...baseOptions,
        fetchImpl
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/mail/yyds/domains/refresh",
        headers: { authorization: "Bearer sk-test" }
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({
        error: {
          type: "yyds_domain_fetch_error",
          message: "YYDS domain refresh failed"
        }
      });
      expect(response.body).not.toContain("socket hang up");
      expect(response.body).not.toContain("not json");
    }
  });

  it("does not report YYDS domain pool store failures as fetch errors", async () => {
    const domainStore = new InMemoryYydsDomainPoolStore();
    vi.spyOn(domainStore, "saveHealth").mockRejectedValue(new Error("database password leaked in stack trace"));
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      yydsDomainPoolStore: domainStore,
      yydsDomainFetchImpl: async () => [
        { domain: "healthy.test", isPublic: true, isVerified: true, isMxValid: true, dnsRecords: { status: "healthy", receivingReady: true } }
      ],
      fetchImpl: async () => Response.json({ ok: true })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/domains/refresh",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        type: "yyds_domain_pool_error",
        message: "YYDS domain pool refresh failed"
      }
    });
    expect(response.body).not.toContain("yyds_domain_fetch_error");
    expect(response.body).not.toContain("database password");
  });

  it("passes an abort signal to the YYDS domain pool public fetcher", async () => {
    let signal: AbortSignal | undefined;
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async (_url, init) => {
        signal = init?.signal;
        return Response.json({
          data: [
            { domain: "healthy.test", isPublic: true, isVerified: true, isMxValid: true, dnsRecords: { status: "healthy", receivingReady: true } }
          ]
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/domains/refresh",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(response.statusCode).toBe(200);
    expect(signal).toBeDefined();
  });

  it("skips malformed YYDS domain pool fetch items and refreshes healthy entries", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({
        data: [
          {},
          { domain: 123 },
          { domain: "healthy.test", isPublic: true, isVerified: true, isMxValid: true, dnsRecords: { status: "healthy", receivingReady: true } }
        ]
      })
    });

    const refresh = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/domains/refresh",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().eligible).toEqual([{ domain: "healthy.test" }]);
  });

  it("rejects malformed YYDS domain pool config bodies", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    });

    for (const payload of [
      { mode: "bad-mode" },
      { refreshIntervalMinutes: "30" },
      { refreshIntervalMinutes: 0 },
      { whitelist: "example.com" },
      { whitelist: ["example.com", 123] },
      { blacklist: ["blocked.test", false] },
      { enabled: "false" },
      { refreshIntervalMinute: 30 }
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/mail/yyds/domain-pool/config",
        headers: { authorization: "Bearer sk-test" },
        payload
      });
      expect(response.statusCode).toBe(400);
    }

    for (const payload of ["[]", "null", "\"not-object\""]) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/mail/yyds/domain-pool/config",
        headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
        payload
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("allows partial YYDS domain pool config updates without changing other fields", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    });

    const initial = await app.inject({
      method: "PUT",
      url: "/api/mail/yyds/domain-pool/config",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        enabled: true,
        mode: "whitelist",
        whitelist: ["Example.COM"],
        blacklist: ["Blocked.TEST"],
        refreshIntervalMinutes: 45
      }
    });
    expect(initial.statusCode).toBe(200);

    const partial = await app.inject({
      method: "PUT",
      url: "/api/mail/yyds/domain-pool/config",
      headers: { authorization: "Bearer sk-test" },
      payload: { enabled: false }
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json()).toEqual({
      enabled: false,
      mode: "whitelist",
      whitelist: ["example.com"],
      blacklist: ["blocked.test"],
      refreshIntervalMinutes: 45
    });
  });

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

  it("serves the local model catalog for the master key without a provider account", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore()),
      fetchImpl: async () => Response.json({ error: { message: "models should not require upstream" } }, { status: 500 })
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(response.statusCode).toBe(200);
    const ids = response.json().data.map((item: { id: string }) => item.id);
    expect(ids).toContain("gpt-image-2");
    expect(ids).toContain("navos/doubao-seedance-2-0-260128");
    expect(ids).toContain("doubao-seedance-2-0-260128");
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
    ]);
    expect(ids).not.toContain("claude.opus-4.8");
    expect(ids).not.toContain("qwen.qwen3.6-plus");

    const admin = await app.inject({
      method: "GET",
      url: "/api/accounts",
      headers: { authorization: "Bearer sk-public" }
    });
    expect(admin.statusCode).toBe(401);
  });

  it("proxies only public chat models", async () => {
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
      path: "/responses",
      body: { model: "openai.gpt-5.3-codex" }
    });

    const gpt55 = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "gpt-5.5", messages: [{ role: "user", content: "hi" }], max_tokens: 16 }
    });
    expect(gpt55.statusCode).toBe(200);
    expect(forwarded[1]).toMatchObject({
      path: "/chat/completions",
      body: { model: "openai.gpt-5.5" }
    });

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "gpt-5.4", messages: [{ role: "user", content: "hi" }] }
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ error: { type: "model_not_allowed" } });
    expect(forwarded).toHaveLength(2);
  });

  it("proxies public native responses models and preserves upstream stream headers", async () => {
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
        return new Response("data: {\"type\":\"response.completed\"}\n\ndata: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream", "x-request-id": "req_1" }
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "codex", input: "hi", stream: true, max_output_tokens: 16 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-request-id"]).toBe("req_1");
    expect(response.body).toContain("data: [DONE]");
    expect(forwarded[0]).toMatchObject({
      path: "/responses",
      body: { model: "openai.gpt-5.3-codex", input: "hi", stream: true }
    });
  });

  it("bridges public GPT-5.5 native responses streams through chat completions", async () => {
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
        const chunk = {
          id: "chatcmpl_1",
          model: "openai.gpt-5.5",
          choices: [{ delta: { content: "OK" }, finish_reason: null }]
        };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "gpt-5.5", input: "hi", stream: true, max_output_tokens: 16 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("\"type\":\"response.output_text.delta\"");
    expect(response.body).toContain("\"type\":\"response.completed\"");
    expect(response.body).toContain("data: [DONE]");
    expect(forwarded[0]).toMatchObject({
      path: "/chat/completions",
      body: { model: "openai.gpt-5.5", stream: true }
    });
  });

  it("blocks public native responses requests for non-public models", async () => {
    const forwarded: Record<string, unknown>[] = [];
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async (_url, init) => {
        forwarded.push(JSON.parse(String(init?.body ?? "{}")));
        return Response.json({ ok: true });
      }
    });

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "gpt-5.4", input: "hi" }
    });

    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ error: { type: "model_not_allowed" } });
    expect(forwarded).toHaveLength(0);
  });

  it("normalizes public Claude aliases before allow checks and forwarding", async () => {
    const forwarded: Array<{ path: string; body: Record<string, unknown> }> = [];
    const app = createApp({
      masterApiKey: "sk-master",
      publicProxyApiKeys: ["sk-public"],
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        forwarded.push({ path: new URL(String(url)).pathname, body });
        return Response.json({
          id: "msg-1",
          model: body.model,
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 }
        });
      }
    });

    const chat = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 8 }
    });
    expect(chat.statusCode).toBe(200);
    expect(forwarded[0]).toMatchObject({
      path: "/v1/messages",
      body: { model: "claude.sonnet-4.6" }
    });

    const messages = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer sk-public" },
      payload: { model: "claude-opus-4-7", messages: [{ role: "user", content: "hi" }], max_tokens: 8 }
    });
    expect(messages.statusCode).toBe(200);
    expect(forwarded[1]).toMatchObject({
      path: "/v1/messages",
      body: { model: "claude.opus-4.7" }
    });
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

  it("returns a repair hint when YYDS Mail config is encrypted with a stale secret", async () => {
    const yydsMailConfigStore = new InMemoryYydsMailConfigStore();
    const staleBox = new SecretBox("stale-config-secret-123456789012345678", "navos:yyds_mail_config:v1");
    await yydsMailConfigStore.saveRaw({
      enabled: true,
      apiKeyEnc: staleBox.encrypt("ac-stale-key")
    });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      yydsMailConfigStore,
      yydsMailConfigSecret: "current-config-secret-123456789012345",
      fetchImpl: async () => Response.json({ ok: true })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/accounts",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        type: "mail_unavailable",
        message: expect.stringContaining("YYDS Mail API key cannot be decrypted; re-save YYDS Mail config")
      }
    });
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

  it("accepts large uploaded reference images instead of rejecting them at the JSON body limit", async () => {
    const paths: string[] = [];
    const largeReferenceImage = `data:image/png;base64,${"A".repeat(1_200_000)}`;
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
          expect(init?.body).toBeInstanceOf(FormData);
          expect((init?.body as FormData).getAll("image")).toHaveLength(1);
          return Response.json({ code: 200, data: { task_id: "img_large_ref", status: "queued" } });
        }
        if (path === "/api/tasks/image/edits/img_large_ref") {
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/large-ref.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        prompt: "turn a large uploaded reference into an icon",
        images: [largeReferenceImage],
        n: 1,
        quality: "low",
        size: "1024x1024"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task_id: "img_large_ref",
      data: [{ url: "https://cdn.test/large-ref.png" }]
    });
    expect(paths).toEqual([
      "POST /api/tasks/navos-gpt-image-i2i",
      "GET /api/tasks/image/edits/img_large_ref"
    ]);
  });

  it("persists running image tasks and completes them through the image task route", async () => {
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 200, balanceTotal: 200 });
    let pollCount = 0;
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      imageMaxPollAttempts: 1,
      imagePollIntervalMs: 1,
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/tasks/navos-gpt-image-t2i") {
          return Response.json({ code: 200, data: { task_id: "img_async_1", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_async_1") {
          pollCount += 1;
          if (pollCount === 1) {
            return Response.json({ code: 200, data: { status: "running" } });
          }
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/async.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "high quality icon", n: 1, quality: "high", size: "1024x1024" }
    });

    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ status: "running", task_id: "img_async_1", data: [] });
    expect((await store.get("u1"))?.leaseUntil).toBeGreaterThan(Date.now());

    const polled = await app.inject({
      method: "GET",
      url: "/api/images/generations/img_async_1",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({
      status: "succeeded",
      task_id: "img_async_1",
      data: [{ url: "https://cdn.test/async.png" }]
    });
    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 100, leaseUntil: 0 });
  });

  it("returns a cached completed image task without polling upstream or consuming balance again", async () => {
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 300, balanceTotal: 300 });
    let pollCount = 0;
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      imageMaxPollAttempts: 1,
      imagePollIntervalMs: 1,
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/tasks/navos-gpt-image-t2i") {
          return Response.json({ code: 200, data: { task_id: "img_cached_1", status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_cached_1") {
          pollCount += 1;
          if (pollCount === 1) {
            return Response.json({ code: 200, data: { status: "running" } });
          }
          if (pollCount === 2) {
            return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/cached.png" } });
          }
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "high quality icon", n: 1, quality: "high", size: "1024x1024" }
    });
    expect(created.statusCode).toBe(202);

    const completed = await app.inject({
      method: "GET",
      url: "/api/images/generations/img_cached_1",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(completed.statusCode).toBe(200);

    const cached = await app.inject({
      method: "GET",
      url: "/api/images/generations/img_cached_1",
      headers: { authorization: "Bearer sk-test" }
    });

    expect(cached.statusCode).toBe(200);
    expect(cached.json()).toMatchObject({
      status: "succeeded",
      task_id: "img_cached_1",
      data: [{ url: "https://cdn.test/cached.png" }]
    });
    expect(pollCount).toBe(2);
    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 200, leaseUntil: 0 });
  });

  it("waits briefly for a busy image account instead of immediately failing concurrent image requests", async () => {
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 300, balanceTotal: 300 });
    let taskSeq = 0;
    let releaseFirstPoll!: () => void;
    const firstPollMayFinish = new Promise<void>((resolve) => {
      releaseFirstPoll = resolve;
    });
    let firstPollStarted = false;
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
      imageAccountWaitMs: 1000,
      imagePollIntervalMs: 1,
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/tasks/navos-gpt-image-t2i") {
          taskSeq += 1;
          return Response.json({ code: 200, data: { task_id: `img_concurrent_${taskSeq}`, status: "queued" } });
        }
        if (path === "/api/tasks/image/generations/img_concurrent_1") {
          firstPollStarted = true;
          await firstPollMayFinish;
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/first.png" } });
        }
        if (path === "/api/tasks/image/generations/img_concurrent_2") {
          return Response.json({ code: 200, data: { status: "succeeded", url: "https://cdn.test/second.png" } });
        }
        return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
      }
    });

    const first = app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "first icon", n: 1, quality: "low", size: "1024x1024" }
    });
    await vi.waitFor(() => expect(firstPollStarted).toBe(true));
    const second = app.inject({
      method: "POST",
      url: "/api/images/generations",
      headers: { authorization: "Bearer sk-test" },
      payload: { prompt: "second icon", n: 1, quality: "low", size: "1024x1024" }
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    releaseFirstPoll();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstResponse.json().data[0].url).toBe("https://cdn.test/first.png");
    expect(secondResponse.json().data[0].url).toBe("https://cdn.test/second.png");
    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 100, leaseUntil: 0 });
  });

  it("returns successful image outputs without COS archive metadata", async () => {
    const store = new InMemoryAccountStore();
    await store.upsert({ uid: "u1", token: "t1", balanceRemaining: 200, balanceTotal: 200 });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(store),
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
        url: "https://oss.test/img_task_1.png"
      }]
    });
    expect(response.json().data[0]).not.toHaveProperty("cosUrl");
    expect(response.json().data[0]).not.toHaveProperty("cosKey");
    expect(response.json().data[0]).not.toHaveProperty("archiveStatus");
    expect(response.json().data[0]).not.toHaveProperty("archiveError");
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

  it("retries model requests on the next account when upstream is temporarily unavailable", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1" });
    await accountService.importAccount({ uid: "u2", token: "t2" });
    const usedUids: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (_url, init) => {
        const authorization = String((init?.headers as Record<string, string>).authorization ?? "");
        const uid = authorization.replace(/^Bearer\s+/, "").split(":")[0];
        usedUids.push(uid);
        if (uid === "u1") {
          return Response.json(
            { error: { message: "Service temporarily unavailable" } },
            { status: 503 }
          );
        }
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(usedUids).toEqual(["u1", "u2"]);
    expect((await store.get("u1"))?.rateLimitedUntil).toBeGreaterThan(Date.now());
    expect((await store.get("u2"))?.status).toBe("active");
  });

  it("cools down model access failures and retries with the next account", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1" });
    await accountService.importAccount({ uid: "u2", token: "t2" });
    const usedUids: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (_url, init) => {
        const authorization = String((init?.headers as Record<string, string>).authorization ?? "");
        const uid = authorization.replace(/^Bearer\s+/, "").split(":")[0];
        usedUids.push(uid);
        if (uid === "u1") {
          return Response.json(
            { error: { message: "This account does not have access to this model" } },
            { status: 403 }
          );
        }
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    const firstAccount = await store.get("u1");
    expect(response.statusCode).toBe(200);
    expect(usedUids).toEqual(["u1", "u2"]);
    expect(firstAccount?.status).toBe("active");
    expect(firstAccount?.rateLimitedUntil).toBeGreaterThan(Date.now());
  });

  it("depletes exhausted model accounts and retries with the next account", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1" });
    await accountService.importAccount({ uid: "u2", token: "t2" });
    const usedUids: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (_url, init) => {
        const authorization = String((init?.headers as Record<string, string>).authorization ?? "");
        const uid = authorization.replace(/^Bearer\s+/, "").split(":")[0];
        usedUids.push(uid);
        if (uid === "u1") {
          return Response.json(
            { error: { message: "insufficient_balance" } },
            { status: 402 }
          );
        }
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(usedUids).toEqual(["u1", "u2"]);
    expect((await store.get("u1"))?.status).toBe("depleted");
    expect((await store.get("u2"))?.status).toBe("active");
  });

  it("depletes a model account when a streamed provider error reports insufficient balance", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1", balanceRemaining: 1000, balanceTotal: 1000 });
    const encoder = new TextEncoder();
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async () => new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: error\ndata: {"error":{"message":"insufficient_balance"}}\n\n'));
            controller.close();
          }
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      )
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        stream: true,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("insufficient_balance");
    await vi.waitFor(async () => {
      expect((await store.get("u1"))?.status).toBe("depleted");
    });
  });

  it("rotates to the next model account after a fake upstream streamed insufficient balance error", async () => {
    const upstreamUids: string[] = [];
    const fakeUpstream = await startFakeUpstream((request, response) => {
      request.resume();
      const uid = uidFromAuthorization(request.headers.authorization);
      upstreamUids.push(uid);
      response.setHeader("content-type", "text/event-stream");
      if (uid === "u1") {
        response.end('event: error\ndata: {"error":{"message":"insufficient_balance: u1 empty"}}\n\n');
        return;
      }
      response.end([
        'data: {"choices":[{"delta":{"content":"OK"},"index":0}]}',
        "data: [DONE]",
        ""
      ].join("\n\n"));
    });
    try {
      const store = new InMemoryAccountStore();
      const accountService = new AccountService(store);
      await accountService.importAccount({ uid: "u1", token: "t1", balanceRemaining: 1000, balanceTotal: 1000 });
      await accountService.importAccount({ uid: "u2", token: "t2", balanceRemaining: 1000, balanceTotal: 1000 });
      const app = createApp({
        masterApiKey: "sk-test",
        providerBaseUrl: fakeUpstream.baseUrl,
        providerAuthMode: "uid-token",
        accountService
      });

      const first = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { authorization: "Bearer sk-test" },
        payload: {
          model: "gpt-5.5",
          stream: true,
          messages: [{ role: "user", content: "hello" }]
        }
      });

      expect(first.statusCode).toBe(200);
      expect(first.body).toContain("insufficient_balance");
      await vi.waitFor(async () => {
        expect((await store.get("u1"))?.status).toBe("depleted");
      });

      const second = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { authorization: "Bearer sk-test" },
        payload: {
          model: "gpt-5.5",
          stream: true,
          messages: [{ role: "user", content: "hello again" }]
        }
      });

      expect(second.statusCode).toBe(200);
      expect(second.body).toContain("OK");
      expect(upstreamUids).toEqual(["u1", "u2"]);
      expect((await store.get("u1"))?.status).toBe("depleted");
      expect((await store.get("u2"))?.status).toBe("active");
    } finally {
      await fakeUpstream.close();
    }
  });

  it("does not deplete successful model accounts when assistant text mentions insufficient_balance", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "u1", token: "t1", balanceRemaining: 1000, balanceTotal: 1000 });
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async () => Response.json({
        id: "chatcmpl_1",
        object: "chat.completion",
        choices: [{
          message: { role: "assistant", content: "The literal word insufficient_balance is documentation text." },
          finish_reason: "stop"
        }]
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "explain this error token" }]
      }
    });

    expect(response.statusCode).toBe(200);
    const account = await store.get("u1");
    expect(account?.status).toBe("active");
    expect(account?.balanceRemaining).toBe(1000);
  });

  it("auto-registers a model account when the pool has no available account", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    const registrationService = {
      registerOne: vi.fn(async () => {
        await accountService.importAccount({
          uid: "auto-model-1",
          token: "auto-token-1",
          mailboxAddr: "auto-model-1@mail.test",
          mailboxToken: "mail-token",
          balanceRemaining: 1000,
          balanceTotal: 1000,
          status: "active"
        });
        return {
          success: true,
          uid: "auto-model-1",
          token: "auto-token-1",
          email: "auto-model-1@mail.test",
          mailboxToken: "mail-token",
          balance: 1000
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
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(registrationService.registerOne).toHaveBeenCalledOnce();
    expect(usedHeaders).toEqual(["Bearer auto-model-1:auto-token-1"]);
  });

  it("shares one auto-registration across concurrent model requests", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    let finishRegistration!: () => void;
    const registrationStarted = new Promise<void>((resolve) => {
      finishRegistration = resolve;
    });
    const registrationService = {
      registerOne: vi.fn(async () => {
        await registrationStarted;
        await accountService.importAccount({
          uid: "auto-shared-1",
          token: "auto-shared-token-1",
          balanceRemaining: 1000,
          balanceTotal: 1000,
          status: "active"
        });
        return {
          success: true,
          uid: "auto-shared-1",
          token: "auto-shared-token-1",
          balance: 1000
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
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
        });
      }
    });

    const requests = Array.from({ length: 4 }, () => app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }]
      }
    }));

    await vi.waitFor(() => expect(registrationService.registerOne).toHaveBeenCalledOnce());
    finishRegistration();
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(registrationService.registerOne).toHaveBeenCalledOnce();
    expect(usedHeaders).toEqual([
      "Bearer auto-shared-1:auto-shared-token-1",
      "Bearer auto-shared-1:auto-shared-token-1",
      "Bearer auto-shared-1:auto-shared-token-1",
      "Bearer auto-shared-1:auto-shared-token-1"
    ]);
  });

  it("leases model accounts so concurrent chat requests spread across the active pool", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    for (const uid of ["u1", "u2", "u3", "u4"]) {
      await accountService.importAccount({ uid, token: `token-${uid}`, balanceRemaining: 1000, balanceTotal: 1000 });
    }
    const usedUids: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      fetchImpl: async (_url, init) => {
        const authorization = String((init?.headers as Record<string, string>).authorization ?? "");
        usedUids.push(authorization.replace(/^Bearer\s+/i, "").split(":")[0] ?? "");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
        });
      }
    });

    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: `hello ${index}` }]
      }
    })));

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
    expect(usedUids.slice(0, 4).sort()).toEqual(["u1", "u2", "u3", "u4"]);
    expect(new Set(usedUids.slice(4)).size).toBeGreaterThan(1);
  });

  it("does not repeatedly auto-register within one failing model request", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    const registrationService = {
      registerOne: vi.fn(async () => {
        const uid = `auto-fail-${registrationService.registerOne.mock.calls.length}`;
        await accountService.importAccount({
          uid,
          token: "auto-token",
          balanceRemaining: 1000,
          balanceTotal: 1000,
          status: "active"
        });
        return {
          success: true,
          uid,
          token: "auto-token",
          balance: 1000
        };
      })
    };
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService,
      registrationService: registrationService as never,
      fetchImpl: async () => Response.json(
        { error: { message: "Service temporarily unavailable" } },
        { status: 503 }
      )
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(response.statusCode).toBe(503);
    expect(registrationService.registerOne).toHaveBeenCalledOnce();
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

  it("does not expose COS config routes", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      fetchImpl: async () => Response.json({ ok: true })
    });

    const read = await app.inject({
      method: "GET",
      url: "/api/cos/config",
      headers: { authorization: "Bearer sk-test" }
    });
    const saved = await app.inject({
      method: "PUT",
      url: "/api/cos/config",
      headers: { authorization: "Bearer sk-test" },
      payload: { enabled: true }
    });

    expect(read.statusCode).toBe(404);
    expect(saved.statusCode).toBe(404);
  });

  it("returns successful video output without COS archive metadata", async () => {
    const videoTaskStore = new InMemoryVideoTaskStore();
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      videoTaskStore,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/api/tasks/video/generations/task_1")) {
          return Response.json({ task_id: "task_1", status: "success", video_url: "https://oss.test/task_1.mp4" });
        }
        return Response.json({ task_id: "task_1", status: "queued" });
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
      videoUrl: "https://oss.test/task_1.mp4"
    });
    expect(polled.json()).not.toHaveProperty("cosUrl");
    expect(polled.json()).not.toHaveProperty("cosKey");
    expect(polled.json()).not.toHaveProperty("archiveStatus");
    expect(polled.json()).not.toHaveProperty("archiveError");
    expect(await videoTaskStore.get("task_1")).toMatchObject({
      taskId: "task_1",
      sourceUrl: "https://oss.test/task_1.mp4",
      status: "succeeded"
    });
  });
});
