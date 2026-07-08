import { describe, expect, it, vi } from "vitest";
import { AccountService } from "../src/services/account-service.js";
import { createApp } from "../src/server/app.js";
import { InMemoryAccountStore } from "../src/store/account-store.js";
import { InMemoryCosConfigStore } from "../src/store/cos-config-store.js";
import { InMemoryVideoTaskStore } from "../src/store/video-task-store.js";

describe("server routes", () => {
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
    expect(raw?.secretIdEnc).toBeTruthy();
    expect(raw?.secretKeyEnc).toBeTruthy();
    expect(raw?.secretIdEnc).not.toContain("secret-id");
    expect(raw?.secretKeyEnc).not.toContain("secret-key");

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
    expect((await cosConfigStore.getEnabledDecrypted())?.secretId).toBe("secret-id");
    expect((await cosConfigStore.getEnabledDecrypted())?.secretKey).toBe("secret-key");
  });

  it("archives successful video output to COS and returns archived URL", async () => {
    const cosConfigStore = new InMemoryCosConfigStore();
    const videoTaskStore = new InMemoryVideoTaskStore();
    await cosConfigStore.saveDecrypted({
      name: "main",
      secretId: "secret-id",
      secretKey: "secret-key",
      bucket: "bucket-123456",
      region: "ap-shanghai",
      publicDomain: "https://cdn.example.com",
      uploadPrefix: "navos/videos",
      enabled: true
    });
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
      videoTaskStore,
      archiveVideo,
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
