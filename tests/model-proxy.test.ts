import { describe, expect, it } from "vitest";
import { forwardModelRequest } from "../src/protocols/model-proxy.js";
import { ProviderHttpClient } from "../src/protocols/http.js";

describe("model proxy", () => {
  it("forwards allowed v1 paths", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const client = new ProviderHttpClient("https://upstream.test", async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return Response.json({ id: "chatcmpl_1" });
    });

    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/chat/completions",
      body: { model: "example", messages: [] },
      headers: { authorization: "Bearer t" }
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: "chatcmpl_1" });
    expect(capturedUrl).toBe("https://upstream.test/chat/completions");
    expect(capturedInit?.method).toBe("POST");
  });

  it("rejects unsupported proxy paths", async () => {
    const client = new ProviderHttpClient("https://upstream.test", async () => Response.json({}));
    await expect(forwardModelRequest(client, {
      method: "POST",
      path: "/admin",
      body: {},
      headers: {}
    })).rejects.toThrow(/Unsupported proxy path/);
  });
});
