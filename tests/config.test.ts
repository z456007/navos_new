import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("loads required settings and defaults", () => {
    const config = loadConfig({
      MASTER_API_KEY: "sk-test",
      PROVIDER_BASE_URL: "https://upstream.test",
      PROVIDER_ACCOUNT_UID: "u1",
      PROVIDER_ACCOUNT_TOKEN: "t1",
      YYDS_MAIL_API_KEY: "ac-test",
      YYDS_MAIL_BASE_URL: "https://mail.test/v1",
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
      PUBLIC_PROXY_API_KEYS: " sk-public-1,sk-public-2 ,, "
    });

    expect(config.masterApiKey).toBe("sk-test");
    expect(config.providerBaseUrl).toBe("https://upstream.test");
    expect(config.providerAuthMode).toBe("uid-token");
    expect(config.listenPort).toBe(18888);
    expect(config.yydsMailApiKey).toBe("ac-test");
    expect(config.yydsMailBaseUrl).toBe("https://mail.test/v1");
    expect(config.vipBaseUrl).toBe("https://navos-mind-server-vip.tec-do.com");
    expect(config.vipHmacSecret).toBe("test-secret-32-chars-long-key!!");
    expect(config.poolTargetSize).toBe(0);
    expect(config.registrationConcurrency).toBe(2);
    expect(config.redisUrl).toBe("redis://127.0.0.1:6380");
    expect(config.queuePrefix).toBe("navos-test");
    expect(config.registrationJobConcurrency).toBe(3);
    expect(config.registrationJobRemoveOnComplete).toBe(25);
    expect(config.registrationJobRemoveOnFail).toBe(75);
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
    expect(config.registrationJobConcurrency).toBe(2);
    expect(config.registrationJobRemoveOnComplete).toBe(50);
    expect(config.registrationJobRemoveOnFail).toBe(100);
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
});
