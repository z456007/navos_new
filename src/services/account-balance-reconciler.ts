import type { VipBalanceClient } from "../protocols/vip-client.js";
import type { AccountRecord } from "../store/account-store.js";
import type { AccountService } from "./account-service.js";
import type { AccountBalanceReconcileScope } from "./runtime-config-schema.js";

export interface AccountBalanceReconcileOptions {
  accountService: AccountService;
  vipClient: VipBalanceClient;
  scope?: AccountBalanceReconcileScope;
  limit?: number;
  concurrency?: number;
  reactivatePositive?: boolean;
}

export interface AccountBalanceReconcileFailure {
  uid: string;
  message: string;
}

export interface AccountBalanceReconcileResult {
  checked: number;
  restored: number;
  stillDepleted: number;
  updatedActive: number;
  disabledUpdated: number;
  failed: number;
  failures: AccountBalanceReconcileFailure[];
}

export async function reconcileAccountBalances(
  options: AccountBalanceReconcileOptions
): Promise<AccountBalanceReconcileResult> {
  const limit = normalizePositiveInt(options.limit, 1000);
  const concurrency = Math.min(normalizePositiveInt(options.concurrency, 5), 50);
  const scope = options.scope ?? "depleted";
  const candidates = (await options.accountService.listProviderAccounts())
    .filter((account) => matchesScope(account, scope))
    .sort((a, b) => a.lastBalanceAt - b.lastBalanceAt || a.createdAt - b.createdAt)
    .slice(0, limit);

  const result: AccountBalanceReconcileResult = {
    checked: 0,
    restored: 0,
    stillDepleted: 0,
    updatedActive: 0,
    disabledUpdated: 0,
    failed: 0,
    failures: []
  };

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < candidates.length) {
      const account = candidates[nextIndex];
      nextIndex += 1;
      if (!account) {
        continue;
      }
      await reconcileOne(account, options, result);
    }
  }));

  return result;
}

export async function reconcileDepletedAccountBalances(
  options: AccountBalanceReconcileOptions
): Promise<AccountBalanceReconcileResult> {
  return reconcileAccountBalances({
    ...options,
    scope: "depleted",
    reactivatePositive: true
  });
}

async function reconcileOne(
  account: AccountRecord,
  options: AccountBalanceReconcileOptions,
  result: AccountBalanceReconcileResult
): Promise<void> {
  try {
    const balance = await options.vipClient.queryBalance(account.uid, account.token);
    if (account.status === "depleted" && balance.availableBalance > 0 && options.reactivatePositive === false) {
      await options.accountService.updateBalanceKeepingStatus(account.uid, balance.availableBalance, balance.totalBalance);
      result.checked += 1;
      result.stillDepleted += 1;
      return;
    }
    await options.accountService.updateBalance(account.uid, balance.availableBalance, balance.totalBalance);
    result.checked += 1;
    if (account.status === "disabled") {
      result.disabledUpdated += 1;
      return;
    }
    if (account.status === "depleted" && balance.availableBalance > 0) {
      result.restored += 1;
      return;
    }
    if (account.status === "active" && balance.availableBalance <= 0) {
      result.updatedActive += 1;
      return;
    }
    if (account.status === "depleted") {
      result.stillDepleted += 1;
    }
  } catch (error) {
    result.failed += 1;
    result.failures.push({
      uid: account.uid,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function matchesScope(account: AccountRecord, scope: AccountBalanceReconcileScope): boolean {
  if (scope === "all") {
    return true;
  }
  if (scope === "non_disabled") {
    return account.status !== "disabled";
  }
  if (scope === "active") {
    return account.status === "active";
  }
  return account.status === "depleted";
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return fallback;
  }
  return value;
}
