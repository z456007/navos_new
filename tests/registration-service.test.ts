import { describe, expect, it, vi, beforeEach } from "vitest";
import { RegistrationService, generateCompanyInfo } from "../src/services/registration-service.js";
import { AccountService } from "../src/services/account-service.js";
import { InMemoryAccountStore } from "../src/store/account-store.js";
import { VipClient } from "../src/protocols/vip-client.js";
import { YydsMailClient } from "../src/protocols/mail/yyds-mail.js";
import type { RegistrationServiceOptions } from "../src/services/registration-service.js";

describe("generateCompanyInfo", () => {
  it("generates randomized Chinese company info", () => {
    const info = generateCompanyInfo();
    expect(info.companyName).toMatch(/Ltd$/);
    expect(info.website).toMatch(/^https:\/\/.+\.com$/);
    expect(info.contactPerson).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(info.contactPhone).toMatch(/^86\d{11}$/);
    expect([
      "ELECTRONICS", "BEAUTY", "FASHION", "LIFESTYLE", "FMCG",
      "TOOL", "FINANCE", "SOCIAL", "SITE_NETWORK", "LIFE_APP"
    ]).toContain(info.industry);
  });
});

/** YYDS mock that returns mailbox on POST /accounts, code-bearing messages on GET /messages */
function mailFetchForCode(mailAddr: string, mailToken: string, code: string) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/accounts") && init?.method === "POST") {
      return Response.json({ success: true, data: { address: mailAddr, token: mailToken } });
    }
    // /messages with ?address=... — return array with a message containing the code
    if (u.includes("/messages")) {
      return Response.json({
        data: [{ id: "msg-1", subject: "验证码", body: `您的验证码是：${code}` }]
      });
    }
    return Response.json({ success: true, data: {} });
  });
}

describe("RegistrationService", () => {
  let accountService: AccountService;
  let store: InMemoryAccountStore;

  beforeEach(() => {
    store = new InMemoryAccountStore();
    accountService = new AccountService(store);
  });

  function vipFetchForPipeline(steps: { failAt?: number; uid?: string; token?: string }) {
    const failAt = steps.failAt ?? 999;
    const uid = steps.uid ?? "uid-1";
    const token = steps.token ?? "tok-1";
    let step = 0;
    return vi.fn(async (_url: string, init?: RequestInit) => {
      step++;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (step === failAt) return Response.json({ error: "fail" }, { status: 400 });

      if (body.template_scene) return Response.json({ resp_common: { ret: 0 } });
      if (body.login_type === 9) return Response.json({ uid, token, resp_common: { ret: 0 } });
      if (body.currency_id) return Response.json({ data: { available_balance: 1000 } });
      if (body.image_base64) return Response.json({ data: { url: "https://cdn.test/lic.jpg" } });
      return Response.json({ resp_common: { ret: 0 } });
    });
  }

  function buildService(
    vipFetch: ReturnType<typeof vi.fn>,
    mailFetch: ReturnType<typeof vi.fn>,
    overrides: Partial<RegistrationServiceOptions> = {}
  ) {
    const vipClient = new VipClient({ baseUrl: "https://vip.test", hmacSecret: "test-secret-32!!", fetchImpl: vipFetch });
    const yydsClient = new YydsMailClient({ baseUrl: "https://mail.test/v1", apiKey: "ac-test", fetchImpl: mailFetch });
    const service = new RegistrationService({
      yydsClient,
      vipClient,
      accountService,
      maxPollAttempts: 2,
      pollIntervalMs: 1,
      mailboxMinIntervalMs: 0,
      ...overrides
    });
    return service;
  }

  it("registers one account through the full pipeline", async () => {
    const vipFetch = vipFetchForPipeline({});
    const mailFetch = mailFetchForCode("test@mail.test", "mail-tok", "123456");

    const service = buildService(vipFetch, mailFetch);
    const result = await service.registerOne();

    expect(result.success).toBe(true);
    expect(result.uid).toBe("uid-1");
    expect(result.token).toBe("tok-1");
    expect(result.email).toBe("test@mail.test");
    expect(result.balance).toBe(2000);
    expect(result.certCredits).toBe(1000);

    const accounts = await accountService.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      uid: "uid-1", tokenPreview: "tok-...",
      balanceRemaining: 2000, balanceTotal: 2000, status: "active"
    });
  });

  it("retries YYDS mailbox creation when bulk registration hits rate limits", async () => {
    let accountCreateAttempts = 0;
    const mailFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/accounts") && init?.method === "POST") {
        accountCreateAttempts += 1;
        if (accountCreateAttempts < 3) {
          return Response.json(
            { success: false, error: "Too many account creation requests. Please try again later." },
            { status: 429 }
          );
        }
        return Response.json({ success: true, data: { address: "retry@mail.test", token: "retry-token" } });
      }
      if (u.includes("/messages")) {
        return Response.json({ data: [{ id: "msg-1", body: "验证码 112233" }] });
      }
      return Response.json({ success: true, data: {} });
    });

    const service = buildService(vipFetchForPipeline({}), mailFetch, {
      maxMailboxCreateAttempts: 3,
      mailboxRetryDelayMs: 1
    });

    const result = await service.registerOne();

    expect(result.success).toBe(true);
    expect(result.email).toBe("retry@mail.test");
    expect(accountCreateAttempts).toBe(3);
  });

  it("returns success without cert credits when enterprise cert fails", async () => {
    const vipFetch = vipFetchForPipeline({ failAt: 4 }); // step 4 = uploadBusinessLicense
    const mailFetch = mailFetchForCode("test2@mail.test", "mt", "654321");

    const service = buildService(vipFetch, mailFetch);
    const result = await service.registerOne();

    expect(result.success).toBe(true);
    expect(result.balance).toBe(1000);
    expect(result.certCredits).toBe(0);
  });

  it("fillPool registers until target is reached", async () => {
    let mailIdx = 0;
    const mailFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/accounts") && init?.method === "POST") {
        mailIdx++;
        return Response.json({ success: true, data: { address: `test-${mailIdx}@mail.test`, token: `mt-${mailIdx}` } });
      }
      if (u.includes("/messages")) {
        return Response.json({ data: [{ id: "msg-1", body: `验证码 111111` }] });
      }
      return Response.json({ success: true, data: {} });
    });

    let step = 0;
    const vipFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      step++;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.template_scene) return Response.json({ resp_common: { ret: 0 } });
      if (body.login_type === 9) return Response.json({ uid: `uid-${step}`, token: `tok-${step}` });
      if (body.currency_id) return Response.json({ data: { available_balance: 1000 } });
      if (body.image_base64) return Response.json({ data: { url: "https://cdn.test/lic.jpg" } });
      return Response.json({ resp_common: { ret: 0 } });
    });

    const service = buildService(vipFetch, mailFetch);

    const fillResult = await service.fillPool(3, 2);

    expect(fillResult.started).toBe(3);
    expect(fillResult.completed).toBe(3);
    expect(fillResult.failed).toBe(0);

    const accounts = await accountService.listAccounts();
    expect(accounts).toHaveLength(3);
    accounts.forEach((a) => expect(a.status).toBe("active"));
  });

  it("getStats returns pool statistics", async () => {
    const service = buildService(
      vi.fn(async () => Response.json({ ok: true })),
      vi.fn(async () => Response.json({ ok: true }))
    );

    await accountService.importAccount({ uid: "a", token: "t", status: "active" });
    await accountService.importAccount({ uid: "b", token: "t", status: "active" });
    await accountService.importAccount({ uid: "c", token: "t", status: "depleted" });
    await accountService.importAccount({ uid: "d", token: "t", status: "disabled" });

    const stats = await service.getStats();
    expect(stats.poolSize).toBe(4);
    expect(stats.activeCount).toBe(2);
    expect(stats.depletedCount).toBe(1);
    expect(stats.disabledCount).toBe(1);
  });

  it("fillPool returns early when pool already at target", async () => {
    const vipFetch = vi.fn();
    const mailFetch = vi.fn();
    const service = buildService(vipFetch, mailFetch);

    await accountService.importAccount({ uid: "a", token: "t", status: "active" });
    await accountService.importAccount({ uid: "b", token: "t", status: "active" });

    const result = await service.fillPool(2, 1);
    expect(result.started).toBe(0);
    expect(result.completed).toBe(0);
    expect(vipFetch).not.toHaveBeenCalled();
  });

  it("returns failure when verification code is never received", async () => {
    const vipFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.template_scene) return Response.json({ resp_common: { ret: 0 } });
      return Response.json({}, { status: 500 });
    });

    // YYDS returns no messages with codes
    const mailFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/accounts") && init?.method === "POST") {
        return Response.json({ success: true, data: { address: "test@mail.test", token: "mt" } });
      }
      if (u.includes("/messages")) {
        return Response.json({ data: [] });
      }
      return Response.json({ success: true, data: {} });
    });

    const service = buildService(vipFetch, mailFetch);
    const result = await service.registerOne();

    expect(result.success).toBe(false);
    expect(result.error).toBe("verification code not received");
    expect(result.email).toBe("test@mail.test");
  });
});
