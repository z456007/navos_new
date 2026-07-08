import { describe, expect, it, vi, beforeEach } from "vitest";
import { RegistrationService, generateCompanyInfo } from "../src/services/registration-service.js";
import { AccountService } from "../src/services/account-service.js";
import { InMemoryAccountStore } from "../src/store/account-store.js";
import { VipClient } from "../src/protocols/vip-client.js";
import { YydsMailClient } from "../src/protocols/mail/yyds-mail.js";

function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(async () => Response.json(body, { status }));
}

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

describe("RegistrationService", () => {
  let accountService: AccountService;
  let store: InMemoryAccountStore;
  let yydsClient: YydsMailClient;
  let vipClient: VipClient;
  let service: RegistrationService;

  beforeEach(() => {
    store = new InMemoryAccountStore();
    accountService = new AccountService(store);
  });

  function buildService(vipFetch: ReturnType<typeof mockFetch>, mailFetch: ReturnType<typeof mockFetch>) {
    vipClient = new VipClient({
      baseUrl: "https://vip.test",
      hmacSecret: "test-secret-32-chars-long-enough!!",
      fetchImpl: vipFetch
    });
    yydsClient = new YydsMailClient({
      baseUrl: "https://mail.test/v1",
      apiKey: "ac-test",
      fetchImpl: mailFetch
    });
    service = new RegistrationService({
      yydsClient,
      vipClient,
      accountService,
      maxPollAttempts: 2,
      pollIntervalMs: 1
    });
  }

  it("registers one account through the full pipeline", async () => {
    let step = 0;
    const vipFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      step++;
      const body = init?.body ? JSON.parse(init.body as string) : {};

      if (step === 1) {
        // sendEmailCode
        expect(body.email).toBe("test@mail.test");
        expect(body.template_scene).toBe("login");
        return Response.json({ resp_common: { ret: 0 } });
      }
      if (step === 2) {
        // login
        expect(body.login_type).toBe(9);
        expect(body.email_params.email).toBe("test@mail.test");
        return Response.json({ uid: "uid-1", token: "tok-1", resp_common: { ret: 0 } });
      }
      if (step === 3) {
        // queryBalance
        return Response.json({ data: { available_balance: 1000 } });
      }
      if (step === 4) {
        // uploadBusinessLicense
        return Response.json({ data: { url: "https://cdn.test/lic.jpg" } });
      }
      if (step === 5) {
        // submitEnterpriseCert
        return Response.json({ resp_common: { ret: 0 } });
      }
      return Response.json({}, { status: 500 });
    });

    const mailFetch = vi.fn(async (_url: string) => {
      return Response.json({
        success: true,
        data: {
          address: "test@mail.test",
          token: "mail-tok",
          messages: [{ id: "msg-1", subject: "验证码" }]
        }
      });
    });

    buildService(vipFetch, mailFetch);

    const result = await service.registerOne();

    expect(result.success).toBe(true);
    expect(result.uid).toBe("uid-1");
    expect(result.token).toBe("tok-1");
    expect(result.email).toBe("test@mail.test");
    expect(result.balance).toBe(2000);
    expect(result.certCredits).toBe(1000);

    // Verify account was imported into pool
    const accounts = await accountService.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      uid: "uid-1",
      tokenPreview: "tok-1",
      balanceRemaining: 2000,
      balanceTotal: 2000,
      status: "active"
    });
  });

  it("returns success without cert credits when enterprise cert fails", async () => {
    let step = 0;
    const vipFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      step++;
      if (step === 1) return Response.json({ resp_common: { ret: 0 } });
      if (step === 2) return Response.json({ uid: "uid-2", token: "tok-2" });
      if (step === 3) return Response.json({ data: { available_balance: 1000 } });
      // step 4: enterprise cert upload fails
      return Response.json({ error: "upload failed" }, { status: 400 });
    });

    const mailFetch = vi.fn(async () =>
      Response.json({ success: true, data: { address: "test2@mail.test", token: "mt" } })
    );

    buildService(vipFetch, mailFetch);
    const result = await service.registerOne();

    expect(result.success).toBe(true);
    expect(result.balance).toBe(1000);
    expect(result.certCredits).toBe(0);

    const accounts = await accountService.listAccounts();
    expect(accounts[0].balanceRemaining).toBe(1000);
  });

  it("fillPool registers until target is reached", async () => {
    let calls = 0;
    const vipFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.template_scene) return Response.json({ resp_common: { ret: 0 } });
      if (body.login_type) return Response.json({ uid: `uid-${calls}`, token: `tok-${calls}` });
      if (body.currency_id) return Response.json({ data: { available_balance: 1000 } });
      if (body.image_base64) return Response.json({ data: { url: "https://cdn.test/lic.jpg" } });
      return Response.json({ resp_common: { ret: 0 } });
    });

    const mailFetch = vi.fn(async () =>
      Response.json({ success: true, data: { address: `test@mail.test`, token: "mt" } })
    );

    buildService(vipFetch, mailFetch);

    // need 3 accounts, target = 3
    const fillResult = await service.fillPool(3, 2);

    expect(fillResult.started).toBe(3);
    expect(fillResult.completed).toBe(3);
    expect(fillResult.failed).toBe(0);

    const accounts = await accountService.listAccounts();
    expect(accounts).toHaveLength(3);
    accounts.forEach((a) => expect(a.status).toBe("active"));
  });

  it("getStats returns pool statistics", async () => {
    const vipFetch = vi.fn(async () => Response.json({ ok: true }));
    const mailFetch = vi.fn(async () => Response.json({ ok: true }));
    buildService(vipFetch, mailFetch);

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
    buildService(vipFetch, mailFetch);

    await accountService.importAccount({ uid: "a", token: "t", status: "active" });
    await accountService.importAccount({ uid: "b", token: "t", status: "active" });

    const result = await service.fillPool(2, 1);
    expect(result.started).toBe(0);
    expect(result.completed).toBe(0);
    expect(vipFetch).not.toHaveBeenCalled();
  });
});
