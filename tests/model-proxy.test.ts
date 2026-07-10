import { describe, expect, it } from "vitest";
import { forwardModelRequest } from "../src/protocols/model-proxy.js";
import { ProviderHttpClient } from "../src/protocols/http.js";

describe("model proxy", () => {
  it("routes Claude chat completions through Anthropic messages and wraps the response", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const client = new ProviderHttpClient("https://upstream.test", async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({
        id: "msg_1",
        model: "claude.opus-4.8",
        content: [{ type: "text", text: "OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 }
      });
    });

    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        model: "ospu-4.8",
        messages: [{ role: "user", content: "Reply OK only." }],
        max_completion_tokens: 1024,
        stream: false
      },
      headers: { authorization: "Bearer t" }
    });

    expect(result.status).toBe(200);
    expect(capturedUrl).toBe("https://upstream.test/v1/messages");
    expect(capturedBody).toMatchObject({
      model: "claude.opus-4.8",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Reply OK only." }]
    });
    expect(capturedBody.system).toContain("Claude Opus 4.8");
    expect(result.body).toMatchObject({
      object: "chat.completion",
      model: "claude.opus-4.8",
      choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
    });
  });

  it("routes Codex chat completions through the backend OpenAI responses path", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const client = new ProviderHttpClient("https://upstream.test", async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({
        id: "resp_1",
        model: "gpt-5.3-codex",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "OK" }]
        }],
        usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 }
      });
    });

    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        model: "codex",
        system: "Be terse.",
        messages: [{ role: "user", content: "Reply OK only." }],
        max_tokens: 8,
        stream: false
      },
      headers: { authorization: "Bearer t" }
    });

    expect(capturedUrl).toBe("https://upstream.test/responses");
    expect(capturedBody.model).toBe("openai.gpt-5.3-codex");
    expect(capturedBody.max_output_tokens).toBe(16);
    expect(capturedBody.instructions).toBe("Be terse.");
    expect(capturedBody.input).toEqual([{ role: "user", content: "Reply OK only." }]);
    expect(capturedBody).not.toHaveProperty("max_tokens");
    expect(result.body).toMatchObject({
      object: "chat.completion",
      model: "gpt-5.3-codex",
      choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
    });
  });

  it("routes GPT-5.5 chat completions through the backend OpenAI chat path", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const client = new ProviderHttpClient("https://upstream.test", async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({
        id: "chatcmpl_1",
        object: "chat.completion",
        model: "gpt-5.5",
        choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
      });
    });

    const result = await forwardModelRequest(client, {
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        model: "gpt-5.5",
        messages: [{ role: "user", content: "Reply OK only." }],
        max_tokens: 16,
        stream: false
      },
      headers: { authorization: "Bearer t" }
    });

    expect(capturedUrl).toBe("https://upstream.test/chat/completions");
    expect(capturedBody.model).toBe("openai.gpt-5.5");
    expect(capturedBody.max_completion_tokens).toBe(16);
    expect(capturedBody).not.toHaveProperty("max_tokens");
    expect(result.body).toMatchObject({
      object: "chat.completion",
      model: "gpt-5.5",
      choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }]
    });
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
