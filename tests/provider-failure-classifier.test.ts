import { describe, expect, it } from "vitest";
import {
  classifyProviderException,
  classifyProviderResult,
  classifyProviderSseEvent,
  providerFailureIsAccountRetryable
} from "../src/services/provider-failure-classifier.js";

function decisionFor(status: number, body: unknown, headers: HeadersInit = {}): ReturnType<typeof classifyProviderResult> {
  return classifyProviderResult({ status, body, headers: new Headers(headers) });
}

describe("provider failure classifier", () => {
  it("maps structured insufficient balance or quota responses to account depletion", () => {
    expect(decisionFor(400, { error: { message: "INSUFFICIENT_BALANCE" } })).toMatchObject({
      kind: "quota_exhausted",
      accountAction: "deplete",
      externalStatus: 503
    });

    expect(decisionFor(403, { data: { result: { error: { message: "额度不足，请充值" } } } })).toMatchObject({
      kind: "quota_exhausted",
      accountAction: "deplete",
      externalStatus: 503
    });

    expect(decisionFor(400, { error: { message: "quota exceeded" } })).toMatchObject({
      kind: "quota_exhausted",
      accountAction: "deplete",
      externalStatus: 503
    });
  });

  it("maps invalid token, credential, unauthorized, and disabled account failures to disable", () => {
    for (const message of [
      "invalid token",
      "credential revoked",
      "unauthorized",
      "authentication failed",
      "account disabled"
    ]) {
      expect(decisionFor(401, { error: { message } })).toMatchObject({
        kind: "invalid_account",
        accountAction: "disable",
        externalStatus: 503
      });
    }
  });

  it("maps rate limit and temporarily unavailable failures to cooldown with retry-after seconds", () => {
    expect(decisionFor(429, { error: { message: "rate limit exceeded" } }, { "retry-after": "17" })).toMatchObject({
      kind: "rate_limited",
      accountAction: "cooldown",
      externalStatus: 429,
      retryAfterSeconds: 17
    });

    expect(decisionFor(503, { error: { message: "temporarily unavailable, try again later" } })).toMatchObject({
      kind: "rate_limited",
      accountAction: "cooldown",
      externalStatus: 429
    });

    expect(decisionFor(500, { error: { message: "请求频率超过限制" } })).toMatchObject({
      kind: "rate_limited",
      accountAction: "cooldown",
      externalStatus: 429
    });
  });

  it("maps user prompt parameter content policy image_url bad request failures to release with original 4xx", () => {
    for (const [status, message] of [
      [400, "bad request: invalid parameter"],
      [422, "unsupported image_url"],
      [400, "content policy violation"],
      [400, "prompt 参数无效"]
    ] as const) {
      expect(decisionFor(status, { error: { message } })).toMatchObject({
        kind: "user_error",
        accountAction: "release",
        externalStatus: status
      });
    }
  });

  it("maps 5xx and unknown provider exceptions to temporary cooldown failures", () => {
    expect(decisionFor(500, { error: { message: "internal server error" } })).toMatchObject({
      kind: "temporary",
      accountAction: "cooldown",
      externalStatus: 502
    });

    expect(classifyProviderException(new Error("socket hang up"))).toMatchObject({
      kind: "temporary",
      accountAction: "cooldown",
      externalStatus: 502,
      message: "socket hang up"
    });
  });

  it("does not misclassify successful 2xx bodies without error context", () => {
    expect(decisionFor(200, {
      id: "chatcmpl_1",
      choices: [{ message: { content: "The text insufficient_balance appears in docs." } }]
    })).toEqual({
      kind: "none",
      accountAction: "none",
      externalStatus: 200,
      message: "success"
    });

    expect(decisionFor(200, {
      id: "resp_1",
      object: "response",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }]
    })).toEqual({
      kind: "none",
      accountAction: "none",
      externalStatus: 200,
      message: "success"
    });
  });

  it("detects only SSE error event contexts and ignores DONE or ordinary deltas", () => {
    expect(classifyProviderSseEvent('event: error\ndata: {"error":{"message":"INSUFFICIENT_BALANCE"}}\n\n')).toMatchObject({
      kind: "quota_exhausted",
      accountAction: "deplete",
      externalStatus: 503
    });

    expect(classifyProviderSseEvent('data: {"error":{"message":"rate limit exceeded"}}\n\n')).toBeUndefined();
    expect(classifyProviderSseEvent("data: [DONE]\n\n")).toBeUndefined();
    expect(classifyProviderSseEvent('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')).toBeUndefined();
  });

  it("collects structured error text from nested error data result fields including Chinese quota text", () => {
    expect(decisionFor(400, {
      data: {
        result: {
          error: {
            code: "quota_exhausted",
            msg: "中文余额不足"
          }
        }
      }
    })).toMatchObject({
      kind: "quota_exhausted",
      accountAction: "deplete",
      externalStatus: 503
    });
  });

  it("marks only account-rotation failure decisions as account retryable", () => {
    expect(providerFailureIsAccountRetryable(decisionFor(400, { error: { message: "quota exceeded" } }))).toBe(true);
    expect(providerFailureIsAccountRetryable(decisionFor(401, { error: { message: "invalid token" } }))).toBe(true);
    expect(providerFailureIsAccountRetryable(decisionFor(429, { error: { message: "rate limit exceeded" } }))).toBe(true);
    expect(providerFailureIsAccountRetryable(decisionFor(400, { error: { message: "invalid image_url" } }))).toBe(false);
    expect(providerFailureIsAccountRetryable(decisionFor(200, { output_text: "ok" }))).toBe(false);
  });
});
