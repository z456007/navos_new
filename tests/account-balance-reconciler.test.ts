import { describe, expect, it, vi } from "vitest";
import {
  reconcileAccountBalances,
  reconcileDepletedAccountBalances
} from "../src/services/account-balance-reconciler.js";
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
      updatedActive: 0,
      disabledUpdated: 0,
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

  it("checks non-disabled accounts and demotes active zero-balance accounts", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "active-empty", token: "token-active-empty", balanceRemaining: 500, balanceTotal: 2000, status: "active" });
    await accountService.importAccount({ uid: "depleted-full", token: "token-depleted-full", balanceRemaining: 0, balanceTotal: 2000, status: "depleted" });
    await accountService.importAccount({ uid: "disabled-full", token: "token-disabled-full", balanceRemaining: 0, balanceTotal: 2000, status: "disabled" });
    const vipClient = {
      queryBalance: vi.fn(async (uid: string) => {
        if (uid === "active-empty") return { availableBalance: 0, totalBalance: 2000 };
        if (uid === "depleted-full") return { availableBalance: 1200, totalBalance: 2000 };
        if (uid === "disabled-full") return { availableBalance: 1900, totalBalance: 2000 };
        throw new Error(`unexpected uid ${uid}`);
      })
    };

    const result = await reconcileAccountBalances({
      accountService,
      vipClient,
      scope: "non_disabled",
      limit: 10,
      concurrency: 2
    });

    expect(result).toMatchObject({
      checked: 2,
      restored: 1,
      updatedActive: 1,
      stillDepleted: 0,
      failed: 0
    });
    expect(await store.get("active-empty")).toMatchObject({ status: "depleted", balanceRemaining: 0, balanceTotal: 2000 });
    expect(await store.get("depleted-full")).toMatchObject({ status: "active", balanceRemaining: 1200, balanceTotal: 2000 });
    expect(await store.get("disabled-full")).toMatchObject({ status: "disabled", balanceRemaining: 0, balanceTotal: 2000 });
  });

  it("scope all updates disabled balances without enabling disabled accounts", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({ uid: "disabled", token: "token-disabled", balanceRemaining: 0, balanceTotal: 2000, status: "disabled" });
    const vipClient = {
      queryBalance: vi.fn(async () => ({ availableBalance: 888, totalBalance: 999 }))
    };

    const result = await reconcileAccountBalances({
      accountService,
      vipClient,
      scope: "all",
      limit: 10,
      concurrency: 1
    });

    expect(result).toMatchObject({
      checked: 1,
      disabledUpdated: 1,
      restored: 0,
      failed: 0
    });
    expect(await store.get("disabled")).toMatchObject({ status: "disabled", balanceRemaining: 888, balanceTotal: 999 });
  });
  it("updates depleted positive balances without reactivating when requested", async () => {
    const store = new InMemoryAccountStore();
    const accountService = new AccountService(store);
    await accountService.importAccount({
      uid: "depleted-positive-no-reactivate",
      token: "token-depleted-positive-no-reactivate",
      balanceRemaining: 0,
      balanceTotal: 2000,
      status: "depleted"
    });
    const vipClient = {
      queryBalance: vi.fn(async () => ({ availableBalance: 777, totalBalance: 2000 }))
    };

    const result = await reconcileAccountBalances({
      accountService,
      vipClient,
      scope: "depleted",
      limit: 10,
      concurrency: 1,
      reactivatePositive: false
    });

    expect(result).toMatchObject({
      checked: 1,
      restored: 0,
      stillDepleted: 1,
      failed: 0
    });
    expect(await store.get("depleted-positive-no-reactivate")).toMatchObject({
      status: "depleted",
      balanceRemaining: 777,
      balanceTotal: 2000
    });
  });
});

