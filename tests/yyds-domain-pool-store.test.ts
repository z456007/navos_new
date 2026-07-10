import { beforeEach, describe, expect, it, vi } from "vitest";

const mysqlMocks = vi.hoisted(() => {
  const connection = {
    execute: vi.fn(),
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn()
  };
  const pool = {
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(async () => connection)
  };
  const createPool = vi.fn(() => pool);
  return { connection, createPool, pool };
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
    mysqlMocks.pool.getConnection.mockClear();
    mysqlMocks.connection.query.mockReset();
    mysqlMocks.connection.execute.mockReset();
    mysqlMocks.connection.beginTransaction.mockReset();
    mysqlMocks.connection.commit.mockReset();
    mysqlMocks.connection.rollback.mockReset();
    mysqlMocks.connection.release.mockReset();
  });

  function createStore() {
    return new MysqlYydsDomainPoolStore(mysqlConfig);
  }

  it("creates a named-placeholder mysql pool and ensures domain pool schema tables", async () => {
    const store = createStore();
    mysqlMocks.pool.query.mockResolvedValue([[], undefined]);
    mysqlMocks.pool.execute.mockResolvedValue([[]]);

    await store.ensureSchema();

    expect(mysqlMocks.createPool).toHaveBeenCalledWith({
      ...mysqlConfig,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true
    });
    expect(mysqlMocks.pool.query).toHaveBeenCalledTimes(3);
    expect(mysqlMocks.pool.query.mock.calls[0]?.[0]).toContain("CREATE TABLE IF NOT EXISTS yyds_domain_pool_config");
    expect(mysqlMocks.pool.query.mock.calls[1]?.[0]).toContain("CREATE TABLE IF NOT EXISTS yyds_domain_health");
    expect(mysqlMocks.pool.query.mock.calls[1]?.[0]).toContain("last_auto_checked_at");
    expect(mysqlMocks.pool.execute.mock.calls[0]?.[0]).toContain("INFORMATION_SCHEMA.COLUMNS");
    expect(mysqlMocks.pool.execute.mock.calls[0]?.[1]).toEqual({ column: "last_auto_checked_at" });
    expect(mysqlMocks.pool.query.mock.calls[2]?.[0]).toContain("ADD COLUMN last_auto_checked_at");
    expect(mysqlMocks.pool.query.mock.calls[2]?.[0]).not.toContain("IF NOT EXISTS");
  });

  it("does not alter yyds domain health when last_auto_checked_at already exists", async () => {
    const store = createStore();
    mysqlMocks.pool.query.mockResolvedValue([[], undefined]);
    mysqlMocks.pool.execute.mockResolvedValue([[{ COLUMN_NAME: "last_auto_checked_at" }]]);

    await store.ensureSchema();

    expect(mysqlMocks.pool.execute.mock.calls[0]?.[0]).toContain("INFORMATION_SCHEMA.COLUMNS");
    expect(mysqlMocks.pool.execute.mock.calls[0]?.[1]).toEqual({ column: "last_auto_checked_at" });
    expect(mysqlMocks.pool.query).toHaveBeenCalledTimes(2);
    expect(mysqlMocks.pool.query.mock.calls.some((call) => String(call[0]).includes("ALTER TABLE"))).toBe(false);
  });

  it("ignores duplicate-column races while adding last_auto_checked_at", async () => {
    const store = createStore();
    const duplicateColumnError = Object.assign(new Error("Duplicate column name 'last_auto_checked_at'"), {
      code: "ER_DUP_FIELDNAME",
      errno: 1060
    });
    mysqlMocks.pool.query
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([[], undefined])
      .mockRejectedValueOnce(duplicateColumnError);
    mysqlMocks.pool.execute.mockResolvedValue([[]]);

    await expect(store.ensureSchema()).resolves.toBeUndefined();

    expect(mysqlMocks.pool.query).toHaveBeenCalledTimes(3);
    expect(mysqlMocks.pool.query.mock.calls[2]?.[0]).toContain("ADD COLUMN last_auto_checked_at");
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

  it("checks whether a domain pool config row exists for bootstrap", async () => {
    const store = createStore();
    mysqlMocks.pool.execute
      .mockResolvedValueOnce([[{ config_exists: 0 }]])
      .mockResolvedValueOnce([[{ config_exists: 1 }]]);

    await expect(store.hasConfig()).resolves.toBe(false);
    await expect(store.hasConfig()).resolves.toBe(true);
    expect(mysqlMocks.pool.execute.mock.calls[0]?.[0]).toContain("COUNT(*)");
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
      lastCheckedAt: 10,
      lastAutoCheckedAt: 11
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
      lastAutoCheckedAt: 11,
      lastError: null
    });
    await expect(store.saveHealth({ domain: " ", status: "active" } as never)).rejects.toThrow(/domain/i);
  });

  it("normalizes invalid saved health numeric metrics before upsert", async () => {
    const store = createStore();
    mysqlMocks.pool.execute.mockResolvedValue([{}, undefined]);

    await store.saveHealth({
      domain: " Metrics.Test ",
      status: "active",
      successCount: -1,
      failureCount: Number.NaN,
      verificationTimeoutCount: 1.5,
      mailboxRateLimitCount: Number.POSITIVE_INFINITY,
      quotaExhaustedCount: 0,
      lastSuccessAt: -100,
      lastFailureAt: Number.NaN,
      cooldownUntil: 3.14,
      weight: 0,
      lastCheckedAt: Number.NEGATIVE_INFINITY,
      lastAutoCheckedAt: Number.NaN
    });

    expect(mysqlMocks.pool.execute.mock.calls[0]?.[1]).toMatchObject({
      domain: "metrics.test",
      successCount: 0,
      failureCount: 0,
      verificationTimeoutCount: 0,
      mailboxRateLimitCount: 0,
      quotaExhaustedCount: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      weight: 10,
      lastCheckedAt: 0,
      lastAutoCheckedAt: 0
    });
  });

  it("replaces the persisted auto snapshot in a mysql transaction", async () => {
    const store = createStore();
    mysqlMocks.connection.beginTransaction.mockResolvedValue(undefined);
    mysqlMocks.connection.execute.mockResolvedValue([{}, undefined]);
    mysqlMocks.connection.commit.mockResolvedValue(undefined);
    mysqlMocks.connection.rollback.mockResolvedValue(undefined);

    await store.replaceAutoSnapshot([{
      domain: " New.Test ",
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
      lastAutoCheckedAt: 10
    }]);

    expect(mysqlMocks.pool.getConnection).toHaveBeenCalledOnce();
    expect(mysqlMocks.connection.beginTransaction).toHaveBeenCalledOnce();
    expect(mysqlMocks.connection.execute.mock.calls[0]?.[0]).toContain("UPDATE yyds_domain_health");
    expect(mysqlMocks.connection.execute.mock.calls[0]?.[0]).toContain("last_auto_checked_at = 0");
    expect(mysqlMocks.connection.execute.mock.calls[0]?.[0]).toContain("domain NOT IN");
    expect(mysqlMocks.connection.execute.mock.calls[0]?.[1]).toEqual(["new.test"]);
    expect(mysqlMocks.connection.execute.mock.calls[1]?.[0]).toContain("ON DUPLICATE KEY UPDATE");
    expect(mysqlMocks.connection.execute.mock.calls[1]?.[1]).toMatchObject({
      domain: "new.test",
      lastCheckedAt: 10,
      lastAutoCheckedAt: 10
    });
    expect(mysqlMocks.connection.commit).toHaveBeenCalledOnce();
    expect(mysqlMocks.connection.rollback).not.toHaveBeenCalled();
    expect(mysqlMocks.connection.release).toHaveBeenCalledOnce();
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
      last_auto_checked_at: 21,
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
      lastAutoCheckedAt: 21,
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
      lastCheckedAt: 20,
      lastAutoCheckedAt: 21
    }]);
  });

  it("normalizes invalid health row numeric metrics when reading getHealth and listHealth", async () => {
    const store = createStore();
    const invalidRow = {
      domain: " Invalid-Metrics.Test ",
      status: "bad-status",
      success_count: -1,
      failure_count: Number.NaN,
      verification_timeout_count: 2.5,
      mailbox_rate_limit_count: Number.POSITIVE_INFINITY,
      quota_exhausted_count: "bad",
      last_success_at: -10,
      last_failure_at: Number.NaN,
      cooldown_until: 4.2,
      weight: 0,
      last_checked_at: Number.NEGATIVE_INFINITY,
      last_auto_checked_at: Number.NaN,
      last_error: null
    };
    mysqlMocks.pool.execute.mockResolvedValueOnce([[invalidRow]]);
    mysqlMocks.pool.query.mockResolvedValueOnce([[{ ...invalidRow, weight: Number.NaN }]]);

    const expected = {
      domain: "invalid-metrics.test",
      status: "active",
      successCount: 0,
      failureCount: 0,
      verificationTimeoutCount: 0,
      mailboxRateLimitCount: 0,
      quotaExhaustedCount: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      weight: 10,
      lastCheckedAt: 0,
      lastAutoCheckedAt: 0
    };
    await expect(store.getHealth("invalid-metrics.test")).resolves.toEqual(expected);
    await expect(store.listHealth()).resolves.toEqual([expected]);
  });
});
