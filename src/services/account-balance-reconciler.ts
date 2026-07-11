import type { VipBalanceClient } from "../protocols/vip-client.js";
import type { AccountRecord } from "../store/account-store.js";
import type { AccountService } from "./account-service.js";

export interface AccountBalanceReconcileOptions {
  accountService: AccountService;
  vipClient: VipBalanceClient;
  limit?: number;
  concurrency?: number;
}

export interface AccountBalanceReconcileFailure {
  uid: string;
  message: string;
}

export interface AccountBalanceReconcileResult {
  checked: number;
  restored: number;
  stillDepleted: number;
  failed: number;
  failures: AccountBalanceReconcileFailure[];
}

export async function reconcileDepletedAccountBalances(
  options: AccountBalanceReconcileOptions
): Promise<AccountBalanceReconcileResult> {
  const limit = normalizePositiveInt(options.limit, 1000);
  const concurrency = Math.min(normalizePositiveInt(options.concurrency, 5), 20);
  const candidates = (await options.accountService.listProviderAccounts())
    .filter((account) => account.status === "depleted")
    .sort((a, b) => a.lastBalanceAt - b.lastBalanceAt || a.createdAt - b.createdAt)
    .slice(0, limit);

  const result: AccountBalanceReconcileResult = {
    checked: 0,
    restored: 0,
    stillDepleted: 0,
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

async function reconcileOne(
  account: AccountRecord,
  options: AccountBalanceReconcileOptions,
  result: AccountBalanceReconcileResult
): Promise<void> {
  try {
    const balance = await options.vipClient.queryBalance(account.uid, account.token);
    await options.accountService.updateBalance(account.uid, balance.availableBalance, balance.totalBalance);
    result.checked += 1;
    if (balance.availableBalance > 0) {
      result.restored += 1;
      return;
    }
    result.stillDepleted += 1;
  } catch (error) {
    result.failed += 1;
    result.failures.push({
      uid: account.uid,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return fallback;
  }
  return value;
}
