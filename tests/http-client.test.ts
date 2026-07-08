import { describe, expect, it } from "vitest";
import { ProviderHttpClient } from "../src/protocols/http.js";

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
});

