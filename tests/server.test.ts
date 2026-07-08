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
      yydsMailApiKey: "ac-test",
      yydsMailBaseUrl: "https://mail.test/v1",
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

  it("protects and serves yyds mailbox creation", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
      yydsMailApiKey: "ac-test",
      yydsMailBaseUrl: "https://mail.test/v1",
      fetchImpl: async (url) => {
        if (String(url).includes("mail.test")) {
          return Response.json({
            success: true,
            data: { address: "navos-test@mail.test", id: "m1", token: "mail-token" }
          });
        }
        return Response.json({ ok: true });
      }
    });

    const unauthorized = await app.inject({ method: "POST", url: "/api/mail/yyds/accounts" });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "POST",
      url: "/api/mail/yyds/accounts",
      headers: { authorization: "Bearer sk-test" }
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({ address: "navos-test@mail.test", token: "mail-token" });
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

  it("exposes v1 video generation compatibility routes", async () => {
    const paths: string[] = [];
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      accountService: new AccountService(new InMemoryAccountStore({ uid: "u1", token: "t1" })),
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
    await accountService.importAccount({ uid: "u1", token: "t1" });
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
