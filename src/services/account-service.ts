import type {
  AccountImportInput,
  AccountRecord,
  AccountStatus,
  AccountStore
} from "../store/account-store.js";

export interface AccountListItem {
  uid: string;
  tokenPreview: string;
  mailboxAddr?: string;
  balanceRemaining: number;
  balanceTotal: number;
  status: AccountStatus;
  createdAt: number;
  lastUsedAt: number;
  lastBalanceAt: number;
  rateLimitedUntil: number;
}

export class AccountService {
  constructor(private readonly store: AccountStore) {}

  async importAccount(input: AccountImportInput): Promise<AccountListItem> {
    const uid = input.uid?.trim();
    const token = input.token?.trim();
    if (!uid) {
      throw new Error("uid is required");
    }
    if (!token) {
      throw new Error("token is required");
    }

    const record = await this.store.upsert({
      ...input,
      uid,
      token,
      mailboxAddr: input.mailboxAddr?.trim() || undefined,
      mailboxToken: input.mailboxToken?.trim() || undefined
    });
    return toListItem(record);
  }

  async listAccounts(): Promise<AccountListItem[]> {
    return (await this.store.list()).map(toListItem);
  }

  async getAccount(uid: string): Promise<AccountListItem | undefined> {
    const account = await this.store.get(uid);
    return account ? toListItem(account) : undefined;
  }

  async getProviderAccount(uid: string): Promise<AccountRecord | undefined> {
    return this.store.get(uid);
  }

  async pickAccount(): Promise<AccountRecord | undefined> {
    const account = await this.store.pickActive();
    if (account) {
      await this.store.markUsed(account.uid);
    }
    return account;
  }

  async leaseVideoAccount(leaseId: string, ttlMs: number = 10 * 60 * 1000): Promise<AccountRecord | undefined> {
    return this.store.leaseActive(leaseId, Date.now() + ttlMs);
  }

  async releaseVideoAccount(uid: string, leaseId?: string): Promise<void> {
    await this.store.releaseLease(uid, leaseId);
  }

  async depleteAccount(uid: string): Promise<void> {
    await this.store.setStatus(uid, "depleted");
    await this.store.setBalance(uid, 0);
  }

  async depleteVideoAccount(uid: string): Promise<void> {
    await this.depleteAccount(uid);
  }

  async enableAccount(uid: string): Promise<AccountListItem | undefined> {
    await this.store.setStatus(uid, "active");
    const account = await this.store.get(uid);
    return account ? toListItem(account) : undefined;
  }

  async disableAccount(uid: string): Promise<AccountListItem | undefined> {
    await this.store.setStatus(uid, "disabled");
    const account = await this.store.get(uid);
    return account ? toListItem(account) : undefined;
  }

  async cooldownAccount(uid: string, seconds: number): Promise<AccountListItem | undefined> {
    const cooldownMs = Math.max(1, seconds) * 1000;
    await this.store.setCooldown(uid, Date.now() + cooldownMs);
    const account = await this.store.get(uid);
    return account ? toListItem(account) : undefined;
  }
}

function tokenPreview(token: string): string {
  return token.length <= 8 ? `${token.slice(0, 4)}...` : `${token.slice(0, 8)}...`;
}

function toListItem(account: AccountRecord): AccountListItem {
  return {
    uid: account.uid,
    tokenPreview: tokenPreview(account.token),
    mailboxAddr: account.mailboxAddr,
    balanceRemaining: account.balanceRemaining,
    balanceTotal: account.balanceTotal,
    status: account.status,
    createdAt: account.createdAt,
    lastUsedAt: account.lastUsedAt,
    lastBalanceAt: account.lastBalanceAt,
    rateLimitedUntil: account.rateLimitedUntil
  };
}
