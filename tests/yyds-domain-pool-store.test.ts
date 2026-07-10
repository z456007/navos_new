import { beforeEach, describe, expect, it, vi } from "vitest";

const mysqlMocks = vi.hoisted(() => {
  const pool = {
    query: vi.fn(),
    execute: vi.fn()
  };
  const createPool = vi.fn(() => pool);
  return { createPool, pool };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: mysqlMocks.createPool
  },
  createPool: mysqlMocks.createPool
}));

import { MysqlYydsDomainPoolStore } from "../src/store/yyds-domain-pool-store.js";

const mysqlConfig = {
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "secret",
  database: "navos_test"
};

describe("MysqlYydsDomainPoolStore", () => {
  beforeEach(() => {
    mysqlMocks.createPool.mockClear();
    mysqlMocks.pool.query.mockReset();
    mysqlMocks.pool.execute.mockReset();
  });

  function createStore() {
    return new MysqlYydsDomainPoolStore(mysqlConfig);
  }

  it("creates a named-placeholder mysql pool and ensures both schema tables", async () => {
    const store = createStore();
    mysqlMocks.pool.query.mockResolvedValue([[], undefined]);

    await store.ensureSchema();

    expect(mysqlMocks.createPool).toHaveBeenCalledWith({
      ...mysqlConfig,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true
    });
    expect(mysqlMocks.pool.query).toHaveBeenCalledTimes(2);
    expect(mysqlMocks.pool.query.mock.calls[0]?.[0]).toContain("CREATE TABLE IF NOT EXISTS yyds_domain_pool_config");
    expect(mysqlMocks.pool.query.mock.calls[1]?.[0]).toContain("CREATE TABLE IF NOT EXISTS yyds_domain_health");
  });

  it("returns default config when no config row exists", async () => {
    const store = createStore();
    mysqlMocks.pool.execute.mockResolvedValue([[]]);

    await expect(store.getConfig()).resolves.toEqual({
      enabled: true,
      mode: "auto-plus-whitelist",
      whitelist: [],
      blacklist: [],
      refreshIntervalMinutes: 30
    });
  });

  it("maps config rows with string, Buffer, and array JSON values and falls back invalid modes", async () => {
    const store = createStore();
    mysqlMocks.pool.execute
      .mockResolvedValueOnce([
        [{
          enabled: 0,
          mode: "bad-mode",
          whitelist_json: "[\" Example.COM \",\"\",123,\"boost.test\"]",
          blacklist_json: Buffer.from("[\" BLOCKED.Test \"]"),
          refresh_interval_minutes: 15
        }]
      ])
      .mockResolvedValueOnce([
        [{
          enabled: 1,
          mode: "whitelist",
          whitelist_json: [" Array.TEST ", "second.test"],
          blacklist_json: [],
          refresh_interval_minutes: 0
        }]
      ]);

    await expect(store.getConfig()).resolves.toEqual({
      enabled: false,
      mode: "auto-plus-whitelist",
      whitelist: ["example.com", "boost.test"],
      blacklist: ["blocked.test"],
      refreshIntervalMinutes: 15
    });
    await expect(store.getConfig()).resolves.toEqual({
      enabled: true,
      mode: "whitelist",
      whitelist: ["array.test", "second.test"],
      blacklist: [],
      refreshIntervalMinutes: 30
    });
  });

  it("normalizes and validates saved config before upsert", async () => {
    const store = createStore();
    mysqlMocks.pool.execute.mockResolvedValue([{}, undefined]);

    await store.saveConfig({
      enabled: true,
      mode: "invalid-mode",
      whitelist: [" Example.COM ", "", "BOOST.test"],
      blacklist: [" BLOCKED.Test ", " "],
      refreshIntervalMinutes: 0
    } as never);

    const params = mysqlMocks.pool.execute.mock.calls[0]?.[1];
    expect(params).toMatchObject({
      enabled: 1,
      mode: "auto-plus-whitelist",
      whitelistJson: JSON.stringify(["example.com", "boost.test"]),
      blacklistJson: JSON.stringify(["blocked.test"]),
      refreshIntervalMinutes: 30
    });
  });

  it("normalizes saved health before upsert and rejects empty domains", async () => {
    const store = createStore();
    mysqlMocks.pool.execute.mockResolvedValue([{}, undefined]);

    await store.saveHealth({
      domain: " Example.COM ",
      status: "unknown",
      successCount: 1,
      failureCount: 2,
      verificationTimeoutCount: 3,
      mailboxRateLimitCount: 4,
      quotaExhaustedCount: 5,
      lastSuccessAt: 6,
      lastFailureAt: 7,
      cooldownUntil: 8,
      weight: 9,
      lastCheckedAt: 10
    } as never);

    expect(mysqlMocks.pool.execute.mock.calls[0]?.[0]).toContain("ON DUPLICATE KEY UPDATE");
    expect(mysqlMocks.pool.execute.mock.calls[0]?.[1]).toMatchObject({
      domain: "example.com",
      status: "active",
      successCount: 1,
      failureCount: 2,
      verificationTimeoutCount: 3,
      mailboxRateLimitCount: 4,
      quotaExhaustedCount: 5,
      lastSuccessAt: 6,
      lastFailureAt: 7,
      cooldownUntil: 8,
      weight: 9,
      lastCheckedAt: 10,
      lastError: null
    });
    await expect(store.saveHealth({ domain: " ", status: "active" } as never)).rejects.toThrow(/domain/i);
  });

  it("maps getHealth and listHealth rows with counters, status, and lastError", async () => {
    const store = createStore();
    const row = {
      domain: " Example.COM ",
      status: "cooldown",
      success_count: 11,
      failure_count: 12,
      verification_timeout_count: 13,
      mailbox_rate_limit_count: 14,
      quota_exhausted_count: 15,
      last_success_at: 16,
      last_failure_at: 17,
      cooldown_until: 18,
      weight: 19,
      last_checked_at: 20,
      last_error: "timeout"
    };
    mysqlMocks.pool.execute.mockResolvedValueOnce([[row]]);
    mysqlMocks.pool.query.mockResolvedValueOnce([[{ ...row, status: "bad-status", last_error: null }]]);

    await expect(store.getHealth(" Example.COM ")).resolves.toEqual({
      domain: "example.com",
      status: "cooldown",
      successCount: 11,
      failureCount: 12,
      verificationTimeoutCount: 13,
      mailboxRateLimitCount: 14,
      quotaExhaustedCount: 15,
      lastSuccessAt: 16,
      lastFailureAt: 17,
      cooldownUntil: 18,
      weight: 19,
      lastCheckedAt: 20,
      lastError: "timeout"
    });
    expect(mysqlMocks.pool.execute.mock.calls[0]?.[1]).toEqual({ domain: "example.com" });
    await expect(store.listHealth()).resolves.toEqual([{
      domain: "example.com",
      status: "active",
      successCount: 11,
      failureCount: 12,
      verificationTimeoutCount: 13,
      mailboxRateLimitCount: 14,
      quotaExhaustedCount: 15,
      lastSuccessAt: 16,
      lastFailureAt: 17,
      cooldownUntil: 18,
      weight: 19,
      lastCheckedAt: 20
    }]);
  });
});
