import { describe, expect, it } from "vitest";
import { AccountService } from "../src/services/account-service.js";
import { InMemoryAccountStore } from "../src/store/account-store.js";

describe("AccountService", () => {
  it("imports accounts and masks tokens when listing", async () => {
    const service = new AccountService(new InMemoryAccountStore());

    await service.importAccount({
      uid: "u1",
      token: "token-abcdef",
      mailboxAddr: "a@mail.test",
      mailboxToken: "mail-token"
    });

    expect(await service.listAccounts()).toEqual([
      expect.objectContaining({
        uid: "u1",
        tokenPreview: "token-ab...",
        mailboxAddr: "a@mail.test",
        status: "active"
      })
    ]);
  });

  it("picks the least recently used active account and marks it used", async () => {
    const store = new InMemoryAccountStore();
    const service = new AccountService(store);
    await service.importAccount({ uid: "u1", token: "t1" });
    await service.importAccount({ uid: "u2", token: "t2" });

    const first = await service.pickAccount();
    const second = await service.pickAccount();

    expect(first?.uid).toBe("u1");
    expect(second?.uid).toBe("u2");
  });

  it("leases different accounts for concurrent video jobs", async () => {
    const store = new InMemoryAccountStore();
    const service = new AccountService(store);
    await service.importAccount({ uid: "u1", token: "t1", balanceRemaining: 2000, balanceTotal: 2000 });
    await service.importAccount({ uid: "u2", token: "t2", balanceRemaining: 2000, balanceTotal: 2000 });

    const [first, second, third] = await Promise.all([
      service.leaseVideoAccount("job_1"),
      service.leaseVideoAccount("job_2"),
      service.leaseVideoAccount("job_3")
    ]);

    expect([first?.uid, second?.uid].sort()).toEqual(["u1", "u2"]);
    expect(third).toBeUndefined();
  });

  it("leases only video accounts with at least 2000 remaining balance", async () => {
    const store = new InMemoryAccountStore();
    const service = new AccountService(store);
    await service.importAccount({ uid: "low", token: "t1", balanceRemaining: 1000, balanceTotal: 2000 });
    await service.importAccount({ uid: "enough", token: "t2", balanceRemaining: 2000, balanceTotal: 2000 });

    const leased = await service.leaseVideoAccount("video-job");
    const second = await service.leaseVideoAccount("video-job-2");

    expect(leased?.uid).toBe("enough");
    expect(second).toBeUndefined();
    expect((await store.get("low"))?.leaseId).toBeUndefined();
  });

  it("consumes an image account lease only once", async () => {
    const store = new InMemoryAccountStore();
    const service = new AccountService(store);
    await service.importAccount({ uid: "u1", token: "t1", balanceRemaining: 300, balanceTotal: 300 });

    const leased = await service.leaseImageAccount("image-job-1");
    expect(leased?.uid).toBe("u1");

    await service.consumeImageAccount("u1", "image-job-1", 100);
    await service.consumeImageAccount("u1", "image-job-1", 100);

    expect(await store.get("u1")).toMatchObject({ balanceRemaining: 200, leaseUntil: 0 });
  });

  it("leases model accounts without requiring image or video balance", async () => {
    const store = new InMemoryAccountStore();
    const service = new AccountService(store);
    await service.importAccount({ uid: "u1", token: "t1", balanceRemaining: 0, balanceTotal: 0 });
    await service.importAccount({ uid: "u2", token: "t2", balanceRemaining: 0, balanceTotal: 0 });

    const [first, second, third] = await Promise.all([
      service.leaseModelAccount("model-job-1"),
      service.leaseModelAccount("model-job-2"),
      service.leaseModelAccount("model-job-3")
    ]);

    expect([first?.uid, second?.uid].sort()).toEqual(["u1", "u2"]);
    expect(third).toBeUndefined();
    await service.releaseModelAccount(first?.uid ?? "", "model-job-1");
    expect((await store.get(first?.uid ?? ""))?.leaseUntil).toBe(0);
  });

  it("skips disabled and cooling-down accounts", async () => {
    const service = new AccountService(new InMemoryAccountStore());
    await service.importAccount({ uid: "disabled", token: "t1" });
    await service.importAccount({ uid: "cooldown", token: "t2" });
    await service.importAccount({ uid: "active", token: "t3" });
    await service.disableAccount("disabled");
    await service.cooldownAccount("cooldown", 120);

    const picked = await service.pickAccount();

    expect(picked?.uid).toBe("active");
  });

  it("marks depleted accounts with zero remaining balance", async () => {
    const store = new InMemoryAccountStore();
    const service = new AccountService(store);
    await service.importAccount({
      uid: "u1",
      token: "t1",
      balanceRemaining: 2000,
      balanceTotal: 2000
    });

    await service.depleteAccount("u1");

    const account = await store.get("u1");
    expect(account?.status).toBe("depleted");
    expect(account?.balanceRemaining).toBe(0);
    expect(account?.balanceTotal).toBe(2000);
    expect(account?.lastBalanceAt).toBeGreaterThan(0);
  });

  it("rejects invalid imports", async () => {
    const service = new AccountService(new InMemoryAccountStore());
    await expect(service.importAccount({ uid: "", token: "t1" })).rejects.toThrow(/uid/);
    await expect(service.importAccount({ uid: "u1", token: "" })).rejects.toThrow(/token/);
  });
});
