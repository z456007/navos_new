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
});