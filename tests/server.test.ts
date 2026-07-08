import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

describe("server routes", () => {
  it("serves health without auth and protects protocol routes", async () => {
    const app = createApp({
      masterApiKey: "sk-test",
      providerBaseUrl: "https://upstream.test",
      providerAuthMode: "uid-token",
      defaultAccount: { uid: "u1", token: "t1" },
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
      defaultAccount: { uid: "u1", token: "t1" },
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
});
