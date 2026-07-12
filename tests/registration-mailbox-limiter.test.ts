import { describe, expect, it } from "vitest";
import { RedisRegistrationMailboxLimiter } from "../src/services/registration-mailbox-limiter.js";

class FakeRedis {
  values = new Map<string, string>();
  ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, mode?: string, expiryMode?: string, ttlMs?: number): Promise<"OK" | null> {
    if (mode === "NX" && this.values.has(key)) return null;
    this.values.set(key, value);
    if (expiryMode === "PX" && ttlMs) this.ttls.set(key, ttlMs);
    return "OK";
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  async decr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? "0") - 1;
    this.values.set(key, String(next));
    return next;
  }

  async expire(): Promise<number> {
    return 1;
  }

  async pttl(key: string): Promise<number> {
    return this.ttls.get(key) ?? -1;
  }
}

describe("RedisRegistrationMailboxLimiter", () => {
  it("blocks mailbox create while quota fuse is active", async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRegistrationMailboxLimiter({
      redis,
      keyPrefix: "navos",
      concurrency: 2,
      perSecond: 2,
      sleep: async () => undefined
    });

    await limiter.blockQuota(30);
    await expect(limiter.run(() => Promise.resolve("ok"))).rejects.toThrow("YYDS mailbox quota exhausted");
  });

  it("runs work and releases slot", async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRegistrationMailboxLimiter({
      redis,
      keyPrefix: "navos",
      concurrency: 1,
      perSecond: 100,
      sleep: async () => undefined
    });

    await expect(limiter.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(redis.values.get("navos:registration:mailbox:create:inflight")).toBe("0");
  });
});
