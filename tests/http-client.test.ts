import { describe, expect, it } from "vitest";
import { createProviderFetch, ProviderHttpClient } from "../src/protocols/http.js";

describe("ProviderHttpClient", () => {
  it("posts JSON to the provider and returns status with body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new ProviderHttpClient("https://upstream.test", fetchImpl);
    const result = await client.requestJson("POST", "/api/example", { a: 1 }, { authorization: "Bearer t" });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://upstream.test/api/example");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer t", "content-type": "application/json" });
  });

  it("escapes non-ascii JSON before sending to provider", async () => {
    let sentBody = "";
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return Response.json({ ok: true });
    };

    const client = new ProviderHttpClient("https://upstream.test", fetchImpl);
    await client.requestJson("POST", "/v1/messages", { content: "你是什么模型？" });

    expect(sentBody).toContain("\\u4f60\\u662f\\u4ec0\\u4e48\\u6a21\\u578b\\uff1f");
    expect(sentBody).not.toContain("你是什么模型？");
  });
  it("uses a provider dispatcher with long body/header timeouts by default", async () => {
    const calls: Array<{ init: RequestInit & { dispatcher?: unknown } }> = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {} });
      return Response.json({ ok: true });
    };
    const fetchWithProviderDefaults = createProviderFetch(fetchImpl);
    const client = new ProviderHttpClient("https://upstream.test", fetchWithProviderDefaults);

    await client.requestJson("POST", "/v1/messages", { model: "claude.opus-4.8", messages: [] });

    expect(calls[0]?.init.dispatcher).toBeDefined();
  });
});
