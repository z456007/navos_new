import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { RuntimeConfigService } from "../src/services/runtime-config-service.js";
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfigInput,
  runtimeConfigDefaultsFromAppConfig
} from "../src/services/runtime-config-schema.js";
import { InMemoryRuntimeConfigStore } from "../src/store/runtime-config-store.js";

describe("loadConfig", () => {
  it("loads required settings and defaults", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      PROVIDER_ACCOUNT_UID: "u1",
      PROVIDER_ACCOUNT_TOKEN: "t1",
      MYSQL_HOST: "127.0.0.1",
      MYSQL_PORT: "3307",
      MYSQL_USER: "root",
      MYSQL_PASSWORD: "root",
      MYSQL_DATABASE: "navos_test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      REDIS_URL: "redis://127.0.0.1:6380",
      QUEUE_PREFIX: "navos-test",
      REGISTRATION_JOB_CONCURRENCY: "3",
      REGISTRATION_JOB_REMOVE_ON_COMPLETE: "25",
      REGISTRATION_JOB_REMOVE_ON_FAIL: "75",
      IMAGE_ACCOUNT_WAIT_MS: "45000",
      IMAGE_MAX_POLL_ATTEMPTS: "90",
      IMAGE_POLL_INTERVAL_MS: "2000",
      IMAGE_ALLOW_VIDEO_RESERVE_FALLBACK: "true",
      PUBLIC_PROXY_API_KEYS: " sk-public-1,sk-public-2 ,, "
    });

    expect(config.masterApiKey).toBe("sk-test");
    expect(config.providerBaseUrl).toBe("https://upstream.test");
    expect(config.providerAuthMode).toBe("uid-token");
    expect(config.listenPort).toBe(18888);
    expect(config.vipBaseUrl).toBe("https://navos-mind-server-vip.tec-do.com");
    expect(config.vipHmacSecret).toBe("test-secret-32-chars-long-key!!");
    expect(config.poolTargetSize).toBe(0);
    expect(config.registrationConcurrency).toBe(20);
    expect(config.redisUrl).toBe("redis://127.0.0.1:6380");
    expect(config.queuePrefix).toBe("navos-test");
    expect(config.registrationJobConcurrency).toBe(3);
    expect(config.registrationJobRemoveOnComplete).toBe(25);
    expect(config.registrationJobRemoveOnFail).toBe(75);
    expect(config.imageAccountWaitMs).toBe(45000);
    expect(config.imageMaxPollAttempts).toBe(90);
    expect(config.imagePollIntervalMs).toBe(2000);
    expect(config.imageAllowVideoReserveFallback).toBe(true);
    expect(config.publicProxyApiKeys).toEqual(["sk-public-1", "sk-public-2"]);
    expect(config.mysql).toEqual({
      host: "127.0.0.1",
      port: 3307,
      user: "root",
      password: "root",
      database: "navos_test",
      connectionLimit: 100,
      queueLimit: 0
    });
  });

  it("rejects missing required settings", () => {
    expect(() => loadConfig({ PROVIDER_BASE_URL: "https://upstream.test", VIP_HMAC_SECRET: "x" })).toThrow(/MASTER_API_KEY/);
    expect(() => loadConfig({ MASTER_API_KEY: "sk-test", VIP_HMAC_SECRET: "x" })).toThrow(/PROVIDER_BASE_URL/);
    expect(() => loadConfig({ MASTER_API_KEY: "sk-test", PROVIDER_BASE_URL: "https://upstream.test" })).toThrow(/VIP_HMAC_SECRET/);
  });

  it("rejects public proxy keys that overlap the master key", () => {
    expect(() => loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      PUBLIC_PROXY_API_KEYS: " sk-public, sk-test "
    })).toThrow(/PUBLIC_PROXY_API_KEYS.*MASTER_API_KEY/);
  });

  it("uses default registration queue settings", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
    });

    expect(config.redisUrl).toBe("redis://127.0.0.1:6379");
    expect(config.queuePrefix).toBe("navos");
    expect(config.registrationJobConcurrency).toBe(20);
    expect(config.registrationJobRemoveOnComplete).toBe(50);
    expect(config.registrationJobRemoveOnFail).toBe(100);
    expect(config.imageAccountWaitMs).toBe(120000);
    expect(config.imageMaxPollAttempts).toBe(75);
    expect(config.imagePollIntervalMs).toBe(4000);
    expect(config.imageAllowVideoReserveFallback).toBe(false);
    expect(config.accountBalanceReconcileEnabled).toBe(true);
    expect(config.accountBalanceReconcileIntervalMinutes).toBe(30);
    expect(config.accountBalanceReconcileBatchSize).toBe(1000);
    expect(config.accountBalanceReconcileConcurrency).toBe(50);
    expect(config.accountBalanceReconcileScope).toBe("depleted");
  });

  it("loads account balance reconcile settings", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      ACCOUNT_BALANCE_RECONCILE_ENABLED: "false",
      ACCOUNT_BALANCE_RECONCILE_INTERVAL_MINUTES: "15",
      ACCOUNT_BALANCE_RECONCILE_BATCH_SIZE: "5000",
      ACCOUNT_BALANCE_RECONCILE_CONCURRENCY: "80",
      ACCOUNT_BALANCE_RECONCILE_SCOPE: "all",
      REGISTRATION_YYDS_QUOTA_BLOCK_SECONDS: "800"
    });

    expect(config.accountBalanceReconcileEnabled).toBe(false);
    expect(config.accountBalanceReconcileIntervalMinutes).toBe(15);
    expect(config.accountBalanceReconcileBatchSize).toBe(5000);
    expect(config.accountBalanceReconcileConcurrency).toBe(80);
    expect(config.accountBalanceReconcileScope).toBe("all");
    expect(config.registrationYydsQuotaBlockSeconds).toBe(800);
  });

  it("loads registration scheduler and YYDS domain pool defaults", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
    });

    expect(config.registrationMaxInFlight).toBe(10000);
    expect(config.registrationMailboxCreateConcurrency).toBe(20);
    expect(config.registrationMailboxCreatePerSecond).toBe(50);
    expect(config.registrationVipSendConcurrency).toBe(100);
    expect(config.registrationPollConcurrency).toBe(500);
    expect(config.registrationLoginConcurrency).toBe(100);
    expect(config.registrationCertConcurrency).toBe(100);
    expect(config.registrationVerificationTimeoutMs).toBe(90000);
    expect(config.registrationYydsQuotaBlockSeconds).toBe(300);
    expect(config.yydsDomainPool).toMatchObject({
      enabled: true,
      mode: "auto-plus-whitelist",
      whitelist: [],
      blacklist: [],
      refreshIntervalMinutes: 30
    });
  });

  it("rejects invalid YYDS domain pool enabled booleans", () => {
    const baseEnv = {
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
    };

    for (const invalidValue of ["flase", "maybe"]) {
      expect(() => loadConfig({
        ...baseEnv,
        YYDS_DOMAIN_POOL_ENABLED: invalidValue
      })).toThrow(/YYDS_DOMAIN_POOL_ENABLED/);
    }
  });

  it("loads high registration scheduler values and normalizes YYDS domain CSV lists", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      REGISTRATION_MAX_IN_FLIGHT: "200",
      REGISTRATION_MAILBOX_CREATE_CONCURRENCY: "50",
      REGISTRATION_MAILBOX_CREATE_PER_SECOND: "30",
      REGISTRATION_VIP_SEND_CONCURRENCY: "80",
      REGISTRATION_POLL_CONCURRENCY: "200",
      REGISTRATION_LOGIN_CONCURRENCY: "40",
      REGISTRATION_CERT_CONCURRENCY: "60",
      REGISTRATION_VERIFICATION_TIMEOUT_MS: "0",
      YYDS_DOMAIN_POOL_ENABLED: "0",
      YYDS_DOMAIN_POOL_MODE: " WhItEList ",
      YYDS_DOMAIN_WHITELIST: " Example.COM, Boost.Test ,, ",
      YYDS_DOMAIN_BLACKLIST: " BLOCKED.Test "
    });

    expect(config.registrationMaxInFlight).toBe(200);
    expect(config.registrationMailboxCreateConcurrency).toBe(50);
    expect(config.registrationMailboxCreatePerSecond).toBe(30);
    expect(config.registrationVipSendConcurrency).toBe(80);
    expect(config.registrationPollConcurrency).toBe(200);
    expect(config.registrationLoginConcurrency).toBe(40);
    expect(config.registrationCertConcurrency).toBe(60);
    expect(config.registrationVerificationTimeoutMs).toBe(90000);
    expect(config.registrationYydsQuotaBlockSeconds).toBe(300);
    expect(config.yydsDomainPool).toMatchObject({
      enabled: false,
      mode: "whitelist",
      whitelist: ["example.com", "boost.test"],
      blacklist: ["blocked.test"]
    });
  });

  it("ignores legacy YYDS env values because mail config is dynamic", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      YYDS_MAIL_API_KEY: "legacy-env-key",
      YYDS_MAIL_BASE_URL: "https://legacy-mail.test/v1"
    });

    expect("yydsMailApiKey" in config).toBe(false);
    expect("yydsMailBaseUrl" in config).toBe(false);
  });

  it("does not cap registration fill concurrency to the old YYDS-safe value", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      REGISTRATION_CONCURRENCY: "10"
    });

    expect(config.registrationConcurrency).toBe(10);
  });

  it("does not cap registration worker concurrency to one job on small servers", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      REGISTRATION_JOB_CONCURRENCY: "8"
    });

    expect(config.registrationJobConcurrency).toBe(8);
  });

  it("rejects invalid YYDS domain pool env domains", () => {
    const baseEnv = {
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
    };

    for (const invalidDomain of [
      "http://example.com",
      "bad domain.test",
      `${"a".repeat(64)}.test`,
      "example.com/path"
    ]) {
      expect(() => loadConfig({
        ...baseEnv,
        YYDS_DOMAIN_WHITELIST: invalidDomain
      })).toThrow(/invalid domain/i);
      expect(() => loadConfig({
        ...baseEnv,
        YYDS_DOMAIN_BLACKLIST: invalidDomain
      })).toThrow(/invalid domain/i);
    }
  });

  it("rejects oversized YYDS domain pool env lists and refresh intervals", () => {
    const baseEnv = {
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
    };

    expect(() => loadConfig({
      ...baseEnv,
      YYDS_DOMAIN_WHITELIST: Array.from({ length: 501 }, (_, index) => `d${index}.example.com`).join(",")
    })).toThrow(/no more than 500/i);

    expect(() => loadConfig({
      ...baseEnv,
      YYDS_DOMAIN_REFRESH_MINUTES: "1441"
    })).toThrow(/refreshIntervalMinutes/i);
  });

  it("normalizes visual runtime config input with safe caps", () => {
    const normalized = normalizeRuntimeConfigInput({
      imageAllowVideoReserveFallback: true,
      imageAccountWaitMs: 999999999,
      imageMaxPollAttempts: 0,
      imagePollIntervalMs: 250,
      accountBalanceReconcileEnabled: true,
      accountBalanceReconcileScope: "non_disabled",
      accountBalanceReconcileConcurrency: 999,
      registrationConcurrency: 9999,
      registrationMaxInFlight: 999999,
      registrationMailboxCreateConcurrency: 8,
      registrationMailboxCreatePerSecond: 20,
      registrationPollConcurrency: 9999,
      registrationYydsQuotaBlockSeconds: 600,
      mysqlConnectionLimit: 200,
      mysqlQueueLimit: 1000
    });

    expect(normalized.imageAllowVideoReserveFallback).toBe(true);
    expect(normalized.imageAccountWaitMs).toBe(300000);
    expect(normalized.imageMaxPollAttempts).toBe(1);
    expect(normalized.imagePollIntervalMs).toBe(1000);
    expect(normalized.accountBalanceReconcileScope).toBe("non_disabled");
    expect(normalized.accountBalanceReconcileConcurrency).toBe(500);
    expect(normalized.registrationConcurrency).toBe(5000);
    expect(normalized.registrationMaxInFlight).toBe(100000);
    expect(normalized.registrationMailboxCreateConcurrency).toBe(8);
    expect(normalized.registrationMailboxCreatePerSecond).toBe(20);
    expect(normalized.registrationPollConcurrency).toBe(5000);
    expect(normalized.registrationYydsQuotaBlockSeconds).toBe(600);
    expect(normalized.mysqlConnectionLimit).toBe(200);
    expect(normalized.mysqlQueueLimit).toBe(1000);
  });

  it("builds runtime config defaults from bootstrap env config", () => {
    const config = loadConfig({
      MASTER_API_KEY: "master",
      PUBLIC_PROXY_API_KEYS: "public",
      PROVIDER_BASE_URL: "https://provider.test",
      VIP_HMAC_SECRET: "secret",
      IMAGE_ACCOUNT_WAIT_MS: "90000",
      IMAGE_MAX_POLL_ATTEMPTS: "12",
      IMAGE_POLL_INTERVAL_MS: "3000",
      ACCOUNT_BALANCE_RECONCILE_SCOPE: "active",
      REGISTRATION_MAILBOX_CREATE_CONCURRENCY: "3",
      REGISTRATION_MAILBOX_CREATE_PER_SECOND: "4",
      REGISTRATION_YYDS_QUOTA_BLOCK_SECONDS: "120",
      MYSQL_CONNECTION_LIMIT: "150",
      MYSQL_QUEUE_LIMIT: "0"
    });

    const defaults = runtimeConfigDefaultsFromAppConfig(config);
    expect(defaults.imageAccountWaitMs).toBe(90000);
    expect(defaults.imageMaxPollAttempts).toBe(12);
    expect(defaults.imagePollIntervalMs).toBe(3000);
    expect(defaults.imageSyncWaitBudgetMs).toBe(36000);
    expect(defaults.accountBalanceReconcileScope).toBe("active");
    expect(defaults.registrationMailboxCreateConcurrency).toBe(3);
    expect(defaults.registrationMailboxCreatePerSecond).toBe(4);
    expect(defaults.registrationYydsQuotaBlockSeconds).toBe(120);
    expect(defaults.mysqlConnectionLimit).toBe(150);
    expect(defaults.restartRequiredKeys).toContain("mysqlConnectionLimit");
  });

  it("defaults image synchronous wait budget to five minutes", () => {
    const config = loadConfig({
      MASTER_API_KEY: "master",
      PROVIDER_BASE_URL: "https://provider.test",
      VIP_HMAC_SECRET: "secret"
    });

    const defaults = runtimeConfigDefaultsFromAppConfig(config);
    expect(defaults.imageMaxPollAttempts * defaults.imagePollIntervalMs).toBe(300000);
    expect(defaults.imageSyncWaitBudgetMs).toBe(300000);
  });

  it("migrates persisted legacy image wait defaults to the five-minute budget", async () => {
    const store = new InMemoryRuntimeConfigStore();
    await store.save({
      ...DEFAULT_RUNTIME_CONFIG,
      imageMaxPollAttempts: 30,
      imagePollIntervalMs: 4000,
      imageSyncWaitBudgetMs: 120000,
      updatedAt: 1
    });
    const service = new RuntimeConfigService(store, DEFAULT_RUNTIME_CONFIG);

    const migrated = await service.seedDefaultsIfEmpty();

    expect(migrated.imageMaxPollAttempts).toBe(75);
    expect(migrated.imagePollIntervalMs).toBe(4000);
    expect(migrated.imageSyncWaitBudgetMs).toBe(300000);
    await expect(store.get()).resolves.toMatchObject({
      imageMaxPollAttempts: 75,
      imageSyncWaitBudgetMs: 300000
    });
  });

  it("keeps customized persisted image wait budgets", async () => {
    const store = new InMemoryRuntimeConfigStore();
    await store.save({
      ...DEFAULT_RUNTIME_CONFIG,
      imageMaxPollAttempts: 45,
      imagePollIntervalMs: 4000,
      imageSyncWaitBudgetMs: 180000,
      updatedAt: 1
    });
    const service = new RuntimeConfigService(store, DEFAULT_RUNTIME_CONFIG);

    const loaded = await service.seedDefaultsIfEmpty();

    expect(loaded.imageMaxPollAttempts).toBe(45);
    expect(loaded.imageSyncWaitBudgetMs).toBe(180000);
  });

  it("loads MySQL pool limits as first-run env seed", () => {
    const config = loadConfig({
      MASTER_API_KEY: "master",
      PUBLIC_PROXY_API_KEYS: "public",
      PROVIDER_BASE_URL: "https://provider.test",
      VIP_HMAC_SECRET: "secret",
      MYSQL_CONNECTION_LIMIT: "100",
      MYSQL_QUEUE_LIMIT: "500"
    });

    expect(config.mysql.connectionLimit).toBe(100);
    expect(config.mysql.queueLimit).toBe(500);
  });

  it("keeps visual runtime knobs out of .env.example", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(".env.example", "utf8"));
    for (const key of [
      "IMAGE_ACCOUNT_WAIT_MS",
      "IMAGE_MAX_POLL_ATTEMPTS",
      "ACCOUNT_BALANCE_RECONCILE_ENABLED",
      "REGISTRATION_MAX_IN_FLIGHT",
      "REGISTRATION_MAILBOX_CREATE_CONCURRENCY",
      "REGISTRATION_POLL_CONCURRENCY"
    ]) {
      expect(source).not.toContain(key);
    }
    expect(source).toContain("# 运行参数在 Web 控制台调整");
  });

});
