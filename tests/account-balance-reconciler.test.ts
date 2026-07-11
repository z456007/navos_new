import { describe, expect, it, vi } from "vitest";
import { reconcileDepletedAccountBalances } from "../src/services/account-balance-reconciler.js";
import { AccountService } from "../src/services/account-service.js";
import { InMemoryAccountStore } from "../src/store/account-store.js";

describe("account balance reconciler", () => {
  it("reactivates depleted accounts whose live VIP balance is positive", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "depleted", token: "token-depleted", balanceRemaining: 0, balanceTotal: 2000, status: "depleted" });
    await accountService.importAccount({ uid: "active", token: "token-active", balanceRemaining: 1000, balanceTotal: 2000, status: "active" });
    await accountService.importAccount({ uid: "disabled", token: "token-disabled", balanceRemaining: 0, balanceTotal: 2000, status: "disabled" });
    const vipClient = {
      queryBalance: vi.fn(async () => ({ availableBalance: 2000, totalBalance: 2000 }))
    };

    const result = await reconcileDepletedAccountBalances({
      accountService,
      vipClient,
      limit: 10,
      concurrency: 2
    });

    expect(result).toEqual({
      checked: 1,
      restored: 1,
      stillDepleted: 0,
      failed: 0,
      failures: []
    });
    expect(vipClient.queryBalance).toHaveBeenCalledOnce();
    expect(vipClient.queryBalance).toHaveBeenCalledWith("depleted", "token-depleted");
    expect(await store.get("depleted")).toMatchObject({ status: "active", balanceRemaining: 2000, balanceTotal: 2000 });
    expect(await store.get("active")).toMatchObject({ status: "active", balanceRemaining: 1000 });
    expect(await store.get("disabled")).toMatchObject({ status: "disabled", balanceRemaining: 0 });
  });

  it("keeps depleted accounts depleted when live VIP balance is still zero", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "empty", token: "token-empty", balanceRemaining: 0, balanceTotal: 2000, status: "depleted" });
    const vipClient = {
      queryBalance: vi.fn(async () => ({ availableBalance: 0, totalBalance: 2000 }))
    };

    const result = await reconcileDepletedAccountBalances({
      accountService,
      vipClient,
      limit: 10,
      concurrency: 1
    });

    expect(result).toMatchObject({ checked: 1, restored: 0, stillDepleted: 1, failed: 0 });
    expect(await store.get("empty")).toMatchObject({ status: "depleted", balanceRemaining: 0, balanceTotal: 2000 });
  });
});
