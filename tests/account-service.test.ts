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

  it("rejects invalid imports", async () => {
    const service = new AccountService(new InMemoryAccountStore());
    await expect(service.importAccount({ uid: "", token: "t1" })).rejects.toThrow(/uid/);
    await expect(service.importAccount({ uid: "u1", token: "" })).rejects.toThrow(/token/);
  });
});

