import { describe, expect, it } from "vitest";
import {
  YydsMailClient,
  YydsMailError,
  extractVerificationCode
} from "../src/protocols/mail/yyds-mail.js";

describe("YydsMailClient", () => {
  it("creates a mailbox with x-api-key auth and a generated local part", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json({
          success: true,
          data: { address: "navos-test@mail.test", id: "m1", token: "mail-token" }
        });
      },
      localPartFactory: () => "navos-test"
    });

    const mailbox = await client.createMailbox();

    expect(mailbox).toEqual({ address: "navos-test@mail.test", id: "m1", token: "mail-token" });
    expect(calls[0]?.url).toBe("https://mail.test/v1/accounts");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({
      "accept": "application/json",
      "content-type": "application/json",
      "x-api-key": "ac-test"
    });
    expect(calls[0]?.init.body).toBe(JSON.stringify({ localPart: "navos-test" }));
  });

  it("creates a mailbox with an explicit domain when provided", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      localPartFactory: () => "navos-test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json({
          success: true,
          data: { address: "navos-test@healthy.test", id: "m1", token: "mail-token", domain: "healthy.test", subdomain: "" }
        });
      }
    });

    const mailbox = await client.createMailbox({ domain: "healthy.test" });

    expect(mailbox).toMatchObject({ address: "navos-test@healthy.test", domain: "healthy.test" });
    expect(calls[0]?.init.body).toBe(JSON.stringify({ localPart: "navos-test", domain: "healthy.test" }));
  });

  it("classifies quota exhausted responses separately from normal rate limits", async () => {
    const quotaClient = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json(
        { success: false, error: "quota exhausted", errorCode: "quota_exhausted" },
        { status: 429, headers: { "Retry-After": "28800" } }
      )
    });
    await expect(quotaClient.createMailbox()).rejects.toMatchObject({
      status: 429,
      failureKind: "quota_exhausted",
      retryAfterSeconds: 28800
    });
  });

  it("classifies generic mailbox failures with mailbox_create_failed failureKind", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json(
        { success: false, error: "provider temporarily unavailable", errorCode: "provider_unavailable" },
        { status: 503 }
      )
    });

    await expect(client.createMailbox()).rejects.toMatchObject({
      status: 503,
      failureKind: "mailbox_create_failed"
    });
  });

  it("classifies successful mailbox responses missing address as mailbox_create_failed failureKind", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json({
        success: true,
        data: { id: "m1", token: "mail-token", domain: "healthy.test" }
      })
    });

    await expect(client.createMailbox()).rejects.toMatchObject({
      status: 502,
      failureKind: "mailbox_create_failed"
    });
  });

  it("classifies message failures with message_poll_failed failureKind", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json(
        { success: false, error: "mailbox not ready", errorCode: "mailbox_not_ready" },
        { status: 502 }
      )
    });

    await expect(client.listMessages({ address: "a@mail.test", token: "mail-token" })).rejects.toMatchObject({
      status: 502,
      failureKind: "message_poll_failed"
    });
  });

  it("classifies normal rate limits with rate_limited failureKind and retry delay", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json(
        { success: false, error: "too many account creation requests" },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    });

    await expect(client.createMailbox()).rejects.toMatchObject({
      status: 429,
      failureKind: "rate_limited",
      retryAfterSeconds: 60
    });
  });

  it("does not classify unrelated domain fields as domain_rejected failureKind", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json(
        { success: false, error: "provider failed", errorCode: "provider_failed", domain: "healthy.test" },
        { status: 500 }
      )
    });

    await expect(client.createMailbox({ domain: "healthy.test" })).rejects.toMatchObject({
      status: 500,
      failureKind: "mailbox_create_failed"
    });
  });

  it("does not classify rate-limit text in non-error JSON fields as rate_limited failureKind", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json(
        { success: false, error: "provider failed", errorCode: "provider_failed", domain: "rate-limit.test" },
        { status: 500 }
      )
    });

    await expect(client.createMailbox()).rejects.toMatchObject({
      status: 500,
      failureKind: "mailbox_create_failed"
    });
  });

  it("classifies raw non-JSON rate limit text as rate_limited failureKind", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => new Response("Too many account creation requests", { status: 500 })
    });

    await expect(client.createMailbox()).rejects.toMatchObject({
      status: 500,
      failureKind: "rate_limited"
    });
  });

  it("classifies explicit invalid domain failures with domain_rejected failureKind", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json(
        { success: false, error: "domain not allowed", errorCode: "invalid_domain" },
        { status: 400 }
      )
    });

    await expect(client.createMailbox({ domain: "blocked.test" })).rejects.toMatchObject({
      status: 400,
      failureKind: "domain_rejected"
    });
  });

  it("lists and reads messages with mailbox bearer token and address query", async () => {
    const urls: string[] = [];
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).includes("/messages/msg_1")) {
          return Response.json({ success: true, data: { id: "msg_1", text: "验证码 123456" } });
        }
        return Response.json({ success: true, data: [{ id: "msg_1", subject: "login" }] });
      }
    });

    const messages = await client.listMessages({ address: "a@mail.test", token: "mail-token" });
    const detail = await client.getMessage("msg_1", { address: "a@mail.test", token: "mail-token" });

    expect(messages).toEqual([{ id: "msg_1", subject: "login" }]);
    expect(detail).toEqual({ id: "msg_1", text: "验证码 123456" });
    expect(urls).toEqual([
      "https://mail.test/v1/messages?address=a%40mail.test",
      "https://mail.test/v1/messages/msg_1?address=a%40mail.test"
    ]);
  });

  it("unwraps YYDS message container shapes used by the live protocol", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json({
        success: true,
        data: {
          messages: [
            { id: "msg_1", subject: "验证码" }
          ]
        }
      })
    });

    await expect(client.listMessages({ address: "a@mail.test", token: "mail-token" }))
      .resolves.toEqual([{ id: "msg_1", subject: "验证码" }]);
  });

  it("finds verification codes from YYDS detail fields used by the live protocol", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async (url) => {
        if (String(url).includes("/messages/msg_1")) {
          return Response.json({
            success: true,
            data: { id: "msg_1", textBody: "您的验证码是 654321，5 分钟内有效。" }
          });
        }
        return Response.json({
          success: true,
          data: {
            messages: [{ id: "msg_1", subject: "登录确认" }]
          }
        });
      }
    });

    await expect(client.findVerificationCode({ address: "a@mail.test", token: "mail-token" }))
      .resolves.toMatchObject({ code: "654321" });
  });

  it("raises a typed error for YYDS failure responses", async () => {
    const client = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: async () => Response.json({ success: false, errorCode: "NO_BALANCE" }, { status: 402 })
    });

    await expect(client.createMailbox()).rejects.toBeInstanceOf(YydsMailError);
  });
});

describe("extractVerificationCode", () => {
  it("extracts verification codes from Chinese or English mail content", () => {
    expect(extractVerificationCode("您的验证码是 834921，5 分钟内有效")).toBe("834921");
    expect(extractVerificationCode("verification code: 527100")).toBe("527100");
  });

  it("extracts verification codes from YYDS textBody, htmlBody, and snippet fields", () => {
    expect(extractVerificationCode({ textBody: "验证码：123456" })).toBe("123456");
    expect(extractVerificationCode({ htmlBody: "<p>verification code: 234567</p>" })).toBe("234567");
    expect(extractVerificationCode({ snippet: "动态码 345678" })).toBe("345678");
  });

  it("returns undefined when no code is present", () => {
    expect(extractVerificationCode("welcome to navos")).toBeUndefined();
  });
});
