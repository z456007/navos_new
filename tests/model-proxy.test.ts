import { describe, expect, it } from "vitest";
import { forwardModelRequest } from "../src/protocols/model-proxy.js";
import { ProviderHttpClient } from "../src/protocols/http.js";

describe("model proxy", () => {
  it("forwards chat completions to the upstream v1 path unchanged", async () => {
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
    expect(capturedUrl).toBe("https://upstream.test/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
  });

  it("normalizes legacy UI chat payload aliases before forwarding", async () => {
    let capturedBody: Record<string, unknown> = {};
    const client = new ProviderHttpClient("https://upstream.test", async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({ id: "chatcmpl_1" });
    });

    await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        model: "claude.opus-4.8",
        messages: [{ role: "user", content: "你是什么模型？" }],
        max_completion_tokens: 1024,
        stream: false
      },
      headers: { authorization: "Bearer t" }
    });

    expect(capturedBody.model).toBe("ospu-4.8");
    expect(capturedBody.max_tokens).toBe(1024);
    expect(capturedBody).not.toHaveProperty("max_completion_tokens");
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
