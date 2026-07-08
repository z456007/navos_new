import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

describe("admin page", () => {
  it("serves the management console without exposing server secrets", async () => {
    const app = createApp({
      masterApiKey: "sk-secret-server-key",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      fetchImpl: async () => Response.json({ ok: true })
    });

    const response = await app.inject({ method: "GET", url: "/admin" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Navos 控制台");
    expect(response.body).toContain('id="root"');
    expect(response.body).toContain('type="module"');
    expect(response.body).not.toContain("/api/accounts");
    expect(response.body).not.toContain("/api/mail/yyds/accounts");
    expect(response.body).not.toContain("/v1/messages");
    expect(response.body).not.toContain("sk-secret-server-key");
  });
});
