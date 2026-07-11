import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

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
      PUBLIC_PROXY_API_KEYS: " sk-public-1,sk-public-2 ,, "
    });

    expect(config.masterApiKey).toBe("sk-test");
    expect(config.providerBaseUrl).toBe("https://upstream.test");
    expect(config.providerAuthMode).toBe("uid-token");
    expect(config.listenPort).toBe(18888);
    expect(config.vipBaseUrl).toBe("https://navos-mind-server-vip.tec-do.com");
    expect(config.vipHmacSecret).toBe("test-secret-32-chars-long-key!!");
    expect(config.poolTargetSize).toBe(0);
    expect(config.registrationConcurrency).toBe(2);
    expect(config.redisUrl).toBe("redis://127.0.0.1:6380");
    expect(config.queuePrefix).toBe("navos-test");
    expect(config.registrationJobConcurrency).toBe(1);
    expect(config.registrationJobRemoveOnComplete).toBe(25);
    expect(config.registrationJobRemoveOnFail).toBe(75);
    expect(config.imageAccountWaitMs).toBe(45000);
    expect(config.imageMaxPollAttempts).toBe(90);
    expect(config.imagePollIntervalMs).toBe(2000);
    expect(config.publicProxyApiKeys).toEqual(["sk-public-1", "sk-public-2"]);
    expect(config.mysql).toEqual({
      host: "127.0.0.1",
      port: 3307,
      user: "root",
      password: "root",
      database: "navos_test"
    });
  });

  it("rejects missing required settings", () => {
    expect(() => loadConfig({ PROVIDER_BASE_URL: "https://upstream.test", VIP_HMAC_SECRET: "x" })).toThrow(/MASTER_API_KEY/);
    expect(() => loadConfig({ MASTER_API_KEY: "sk-test", VIP_HMAC_SECRET: "x" })).toThrow(/PROVIDER_BASE_URL/);
    expect(() => loadConfig({ MASTER_API_KEY: "sk-test", PROVIDER_BASE_URL: "https://upstream.test" })).toThrow(/VIP_HMAC_SECRET/);
  });

  it("uses default registration queue settings", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
    });

    expect(config.redisUrl).toBe("redis://127.0.0.1:6379");
    expect(config.queuePrefix).toBe("navos");
    expect(config.registrationJobConcurrency).toBe(1);
    expect(config.registrationJobRemoveOnComplete).toBe(50);
    expect(config.registrationJobRemoveOnFail).toBe(100);
    expect(config.imageAccountWaitMs).toBe(120000);
    expect(config.imageMaxPollAttempts).toBe(30);
    expect(config.imagePollIntervalMs).toBe(4000);
    expect(config.accountBalanceReconcileEnabled).toBe(true);
    expect(config.accountBalanceReconcileIntervalMinutes).toBe(30);
    expect(config.accountBalanceReconcileBatchSize).toBe(1000);
    expect(config.accountBalanceReconcileConcurrency).toBe(5);
  });

  it("loads account balance reconcile settings", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      ACCOUNT_BALANCE_RECONCILE_ENABLED: "false",
      ACCOUNT_BALANCE_RECONCILE_INTERVAL_MINUTES: "15",
      ACCOUNT_BALANCE_RECONCILE_BATCH_SIZE: "5000",
      ACCOUNT_BALANCE_RECONCILE_CONCURRENCY: "80"
    });

    expect(config.accountBalanceReconcileEnabled).toBe(false);
    expect(config.accountBalanceReconcileIntervalMinutes).toBe(15);
    expect(config.accountBalanceReconcileBatchSize).toBe(5000);
    expect(config.accountBalanceReconcileConcurrency).toBe(20);
  });

  it("loads registration scheduler and YYDS domain pool defaults", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!"
    });

    expect(config.registrationMaxInFlight).toBe(6);
    expect(config.registrationMailboxCreateConcurrency).toBe(2);
    expect(config.registrationMailboxCreatePerSecond).toBe(2);
    expect(config.registrationVipSendConcurrency).toBe(6);
    expect(config.registrationPollConcurrency).toBe(30);
    expect(config.registrationLoginConcurrency).toBe(6);
    expect(config.registrationCertConcurrency).toBe(4);
    expect(config.registrationVerificationTimeoutMs).toBe(90000);
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

  it("caps registration scheduler values and normalizes YYDS domain CSV lists", () => {
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

    expect(config.registrationMaxInFlight).toBe(20);
    expect(config.registrationMailboxCreateConcurrency).toBe(5);
    expect(config.registrationMailboxCreatePerSecond).toBe(10);
    expect(config.registrationVipSendConcurrency).toBe(20);
    expect(config.registrationPollConcurrency).toBe(100);
    expect(config.registrationLoginConcurrency).toBe(20);
    expect(config.registrationCertConcurrency).toBe(20);
    expect(config.registrationVerificationTimeoutMs).toBe(90000);
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

  it("caps registration fill concurrency to the YYDS-safe value", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      REGISTRATION_CONCURRENCY: "10"
    });

    expect(config.registrationConcurrency).toBe(2);
  });

  it("caps registration worker concurrency to one job on small servers", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      VIP_HMAC_SECRET: "test-secret-32-chars-long-key!!",
      REGISTRATION_JOB_CONCURRENCY: "8"
    });

    expect(config.registrationJobConcurrency).toBe(1);
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
});
