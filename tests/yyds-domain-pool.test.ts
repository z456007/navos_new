import { describe, expect, it, vi } from "vitest";
import { YydsDomainPool } from "../src/services/yyds-domain-pool.js";
import { InMemoryYydsDomainPoolStore } from "../src/store/yyds-domain-pool-store.js";

function domain(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    isPublic: true,
    isVerified: true,
    isMxValid: true,
    dnsRecords: { status: "healthy", receivingReady: true },
    ...overrides
  };
}

describe("YydsDomainPool", () => {
  it("filters public YYDS domains to healthy receiving domains", async () => {
    const pool = new YydsDomainPool({
      store: new InMemoryYydsDomainPoolStore(),
      fetchDomains: vi.fn(async () => [
        domain("healthy.test"),
        domain("degraded.test", { dnsRecords: { status: "degraded", receivingReady: true } }),
        domain("private.test", { isPublic: false })
      ]),
      now: () => 1000
    });

    const refreshed = await pool.refresh();
    const picked = await pool.pickDomain();

    expect(refreshed.eligible.map((item) => item.domain)).toEqual(["healthy.test"]);
    expect(picked?.domain).toBe("healthy.test");
  });

  it("honors whitelist, blacklist, and cooldown", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    await store.saveConfig({
      enabled: true,
      mode: "auto-plus-whitelist",
      whitelist: ["boost.test"],
      blacklist: ["blocked.test"],
      refreshIntervalMinutes: 30
    });
    const pool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("boost.test"), domain("blocked.test"), domain("normal.test")]),
      now: () => 1000
    });

    await pool.refresh();
    await pool.recordFailure("boost.test", "verification_timeout", "verification code not received");
    await pool.recordFailure("boost.test", "verification_timeout", "verification code not received");

    const candidates = await pool.listCandidates();
    expect(candidates.find((item) => item.domain === "blocked.test")).toBeUndefined();
    expect(candidates.find((item) => item.domain === "boost.test")?.status).toBe("cooldown");
    expect((await pool.pickDomain())?.domain).toBe("normal.test");
  });

  it("excludes stale auto domains after refresh no longer reports them healthy", async () => {
    const fetchDomains = vi
      .fn()
      .mockResolvedValueOnce([domain("stale.test")])
      .mockResolvedValueOnce([
        domain("stale.test", { dnsRecords: { status: "degraded", receivingReady: true } }),
        domain("normal.test")
      ]);
    const pool = new YydsDomainPool({
      store: new InMemoryYydsDomainPoolStore(),
      fetchDomains,
      now: () => 1000
    });

    await pool.refresh();
    expect((await pool.pickDomain())?.domain).toBe("stale.test");

    await pool.recordSuccess("stale.test");
    await pool.refresh();

    expect((await pool.pickDomain())?.domain).toBe("normal.test");
  });

  it("clears removed persisted auto sources so new pool instances do not revive them", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    const fetchDomains = vi
      .fn()
      .mockResolvedValueOnce([domain("stale.test")])
      .mockResolvedValueOnce([domain("normal.test")]);
    const firstPool = new YydsDomainPool({
      store,
      fetchDomains,
      now: () => 1000
    });

    await firstPool.refresh();
    expect((await firstPool.listCandidates()).map((item) => item.domain)).toEqual(["stale.test"]);

    await firstPool.refresh();
    expect((await firstPool.listCandidates()).map((item) => item.domain)).toEqual(["normal.test"]);

    const secondPool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => []),
      now: () => 1001
    });

    expect((await secondPool.listCandidates()).map((item) => item.domain)).toEqual(["normal.test"]);
    expect((await secondPool.pickDomain())?.domain).toBe("normal.test");
  });

  it("lists recently refreshed persisted auto domains in a new pool instance", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    const firstPool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("persisted.test")]),
      now: () => 1000
    });
    await firstPool.refresh();

    const secondPool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => []),
      now: () => 1000 + 1
    });

    const candidates = await secondPool.listCandidates();
    expect(candidates.map((item) => item.domain)).toEqual(["persisted.test"]);
    expect((await secondPool.pickDomain())?.domain).toBe("persisted.test");
  });

  it("excludes stale persisted auto health after the refresh interval", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    const firstPool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("stale-persisted.test")]),
      now: () => 1000
    });
    await firstPool.refresh();

    const secondPool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => []),
      now: () => 1000 + 30 * 60 * 1000 + 1
    });

    expect(await secondPool.listCandidates()).toEqual([]);
    expect(await secondPool.pickDomain()).toBeUndefined();
  });

  it("expires same-process auto snapshot domains after the refresh interval", async () => {
    let now = 1000;
    const pool = new YydsDomainPool({
      store: new InMemoryYydsDomainPoolStore(),
      fetchDomains: vi.fn(async () => [domain("stale.test")]),
      now: () => now
    });

    await pool.refresh();
    expect((await pool.listCandidates()).map((item) => item.domain)).toEqual(["stale.test"]);

    now += 30 * 60 * 1000 + 1;

    expect(await pool.listCandidates()).toEqual([]);
    expect(await pool.pickDomain()).toBeUndefined();
  });

  it("does not expose phantom auto candidates when refresh persistence fails", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    vi.spyOn(store, "saveHealth").mockRejectedValue(new Error("database write failed"));
    const pool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("phantom.test")]),
      now: () => 1000
    });

    await expect(pool.refresh()).rejects.toThrow(/database write failed/);
    expect(await pool.listCandidates()).toEqual([]);
    expect(await pool.pickDomain()).toBeUndefined();
  });

  it("does not treat manually updated whitelist health as a persisted auto source", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    await store.saveConfig({
      enabled: true,
      mode: "whitelist",
      whitelist: ["manual.test"],
      blacklist: [],
      refreshIntervalMinutes: 30
    });
    const firstPool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => []),
      now: () => 1000
    });

    await firstPool.recordSuccess("manual.test");
    await store.saveConfig({
      enabled: true,
      mode: "auto",
      whitelist: [],
      blacklist: [],
      refreshIntervalMinutes: 30
    });

    const secondPool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => []),
      now: () => 1001
    });

    expect(await secondPool.listCandidates()).toEqual([]);
    expect(await secondPool.pickDomain()).toBeUndefined();
  });

  it("keeps disabled domains disabled after recordSuccess and does not pick them", async () => {
    const store = new InMemoryYydsDomainPoolStore();
    await store.saveConfig({
      enabled: true,
      mode: "auto-plus-whitelist",
      whitelist: ["disabled.test"],
      blacklist: [],
      refreshIntervalMinutes: 30
    });
    await store.saveHealth({
      domain: "disabled.test",
      status: "disabled",
      successCount: 0,
      failureCount: 0,
      verificationTimeoutCount: 0,
      mailboxRateLimitCount: 0,
      quotaExhaustedCount: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 1234,
      weight: 200,
      lastCheckedAt: 1000
    });
    const pool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("normal.test")]),
      now: () => 2000
    });

    await pool.refresh();
    await pool.recordSuccess("disabled.test");

    const disabled = (await pool.listCandidates()).find((item) => item.domain === "disabled.test");
    expect(disabled?.status).toBe("disabled");
    expect((await pool.pickDomain())?.domain).toBe("normal.test");
  });

  it("keeps disabled domains disabled after verification timeout failures and cooldown expiry", async () => {
    let now = 1000;
    const store = new InMemoryYydsDomainPoolStore();
    await store.saveConfig({
      enabled: true,
      mode: "auto-plus-whitelist",
      whitelist: ["disabled.test"],
      blacklist: [],
      refreshIntervalMinutes: 30
    });
    await store.saveHealth({
      domain: "disabled.test",
      status: "disabled",
      successCount: 0,
      failureCount: 0,
      verificationTimeoutCount: 0,
      mailboxRateLimitCount: 0,
      quotaExhaustedCount: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      weight: 200,
      lastCheckedAt: 1000
    });
    const pool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("normal.test")]),
      now: () => now
    });

    await pool.refresh();
    await pool.recordFailure("disabled.test", "verification_timeout", "verification code not received");
    await pool.recordFailure("disabled.test", "verification_timeout", "verification code not received");
    now += 10 * 60 * 1000 + 1;

    const disabled = (await pool.listCandidates()).find((item) => item.domain === "disabled.test");
    expect(disabled?.status).toBe("disabled");
    expect((await pool.pickDomain())?.domain).toBe("normal.test");
  });

  it("normalizes whitelist and blacklist in the service layer", async () => {
    const health = new Map<string, Awaited<ReturnType<InMemoryYydsDomainPoolStore["listHealth"]>>[number]>();
    const store = {
      async getConfig() {
        return {
          enabled: true,
          mode: "auto-plus-whitelist" as const,
          whitelist: [" Boost.Test "],
          blacklist: [" BLOCKED.TEST "],
          refreshIntervalMinutes: 30
        };
      },
      async saveConfig() {},
      async listHealth() {
        return Array.from(health.values());
      },
      async getHealth(domainName: string) {
        return health.get(domainName);
      },
      async saveHealth(record: Awaited<ReturnType<InMemoryYydsDomainPoolStore["listHealth"]>>[number]) {
        health.set(record.domain, record);
      }
    };
    const pool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("boost.test"), domain("blocked.test")]),
      now: () => 1000
    });

    await pool.refresh();

    const candidates = await pool.listCandidates();
    expect(candidates.find((item) => item.domain === "blocked.test")).toBeUndefined();
    const boostCandidates = candidates.filter((item) => item.domain === "boost.test");
    expect(boostCandidates).toHaveLength(1);
    expect(boostCandidates[0]?.weight).toBe(110);
  });

  it("normalizes persisted health domains before matching whitelist candidates", async () => {
    const persistedHealth: Awaited<ReturnType<InMemoryYydsDomainPoolStore["listHealth"]>>[number] = {
      domain: " Disabled.Test ",
      status: "disabled",
      successCount: 0,
      failureCount: 0,
      verificationTimeoutCount: 0,
      mailboxRateLimitCount: 0,
      quotaExhaustedCount: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      weight: 200,
      lastCheckedAt: 1000
    };
    const health = new Map([[persistedHealth.domain, persistedHealth]]);
    const store = {
      async getConfig() {
        return {
          enabled: true,
          mode: "auto-plus-whitelist" as const,
          whitelist: ["disabled.test"],
          blacklist: [],
          refreshIntervalMinutes: 30
        };
      },
      async saveConfig() {},
      async listHealth() {
        return Array.from(health.values());
      },
      async getHealth(domainName: string) {
        return health.get(domainName);
      },
      async saveHealth(record: Awaited<ReturnType<InMemoryYydsDomainPoolStore["listHealth"]>>[number]) {
        health.set(record.domain, record);
      }
    };
    const pool = new YydsDomainPool({
      store,
      fetchDomains: vi.fn(async () => [domain("normal.test")]),
      now: () => 1000
    });

    await pool.refresh();

    const disabled = (await pool.listCandidates()).find((item) => item.domain === "disabled.test");
    expect(disabled?.status).toBe("disabled");
    expect((await pool.pickDomain())?.domain).toBe("normal.test");
  });

  it("uses normalized lookup for persisted disabled health mutations", async () => {
    function createExactKeyStore() {
      const persistedHealth: Awaited<ReturnType<InMemoryYydsDomainPoolStore["listHealth"]>>[number] = {
        domain: " Disabled.Test ",
        status: "disabled",
        successCount: 0,
        failureCount: 0,
        verificationTimeoutCount: 0,
        mailboxRateLimitCount: 0,
        quotaExhaustedCount: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
        cooldownUntil: 0,
        weight: 200,
        lastCheckedAt: 1000
      };
      const health = new Map([[persistedHealth.domain, persistedHealth]]);
      return {
        store: {
          async getConfig() {
            return {
              enabled: true,
              mode: "auto-plus-whitelist" as const,
              whitelist: ["disabled.test"],
              blacklist: [],
              refreshIntervalMinutes: 30
            };
          },
          async saveConfig() {},
          async listHealth() {
            return Array.from(health.values());
          },
          async getHealth(domainName: string) {
            return health.get(domainName);
          },
          async saveHealth(record: Awaited<ReturnType<InMemoryYydsDomainPoolStore["listHealth"]>>[number]) {
            health.set(record.domain, record);
          }
        },
        health
      };
    }
    const assertDisabledOnly = async (pool: YydsDomainPool) => {
      const candidates = await pool.listCandidates();
      const disabledCandidates = candidates.filter((item) => item.domain === "disabled.test");
      expect(disabledCandidates).toHaveLength(1);
      expect(disabledCandidates[0]?.status).toBe("disabled");
      expect((await pool.pickDomain())?.domain).toBe("normal.test");
    };

    const successCase = createExactKeyStore();
    const successPool = new YydsDomainPool({
      store: successCase.store,
      fetchDomains: vi.fn(async () => [domain("normal.test")]),
      now: () => 1000
    });
    await successPool.refresh();
    await successPool.recordSuccess("disabled.test");
    await assertDisabledOnly(successPool);
    expect(successCase.health.has("disabled.test")).toBe(true);

    let now = 1000;
    const failureCase = createExactKeyStore();
    const failurePool = new YydsDomainPool({
      store: failureCase.store,
      fetchDomains: vi.fn(async () => [domain("normal.test")]),
      now: () => now
    });
    await failurePool.refresh();
    await failurePool.recordFailure("disabled.test", "verification_timeout", "verification code not received");
    await failurePool.recordFailure("disabled.test", "verification_timeout", "verification code not received");
    now += 10 * 60 * 1000 + 1;
    await assertDisabledOnly(failurePool);

    const refreshCase = createExactKeyStore();
    const refreshPool = new YydsDomainPool({
      store: refreshCase.store,
      fetchDomains: vi.fn(async () => [domain("disabled.test"), domain("normal.test")]),
      now: () => 1000
    });
    await refreshPool.refresh();
    await assertDisabledOnly(refreshPool);
  });
});
