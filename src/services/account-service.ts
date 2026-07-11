import type {
  AccountImportInput,
  AccountRecord,
  AccountStatus,
  AccountStore
} from "../store/account-store.js";

export const VIDEO_ACCOUNT_REQUIRED_BALANCE = 2000;
export const IMAGE_ACCOUNT_REQUIRED_BALANCE = 100;
export const IMAGE_ACCOUNT_COST = 100;

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

  async listProviderAccounts(): Promise<AccountRecord[]> {
    return this.store.list();
  }

  async pickAccount(): Promise<AccountRecord | undefined> {
    const account = await this.store.pickActive();
    if (account) {
      await this.store.markUsed(account.uid);
    }
    return account;
  }

  async leaseVideoAccount(
    leaseId: string,
    ttlMs: number = 10 * 60 * 1000,
    minimumBalanceRemaining: number = VIDEO_ACCOUNT_REQUIRED_BALANCE
  ): Promise<AccountRecord | undefined> {
    return this.store.leaseActive(leaseId, Date.now() + ttlMs, undefined, minimumBalanceRemaining);
  }

  async leaseImageAccount(
    leaseId: string,
    ttlMs: number = 10 * 60 * 1000,
    minimumBalanceRemaining: number = IMAGE_ACCOUNT_REQUIRED_BALANCE,
    allowVideoReserveFallback: boolean = true
  ): Promise<AccountRecord | undefined> {
    const leaseUntilMs = Date.now() + ttlMs;
    const imageOnlyAccount = await this.store.leaseActive(
      leaseId,
      leaseUntilMs,
      undefined,
      minimumBalanceRemaining,
      VIDEO_ACCOUNT_REQUIRED_BALANCE
    );
    if (imageOnlyAccount) {
      return imageOnlyAccount;
    }
    if (!allowVideoReserveFallback) {
      return undefined;
    }
    return this.store.leaseActive(leaseId, leaseUntilMs, undefined, minimumBalanceRemaining);
  }

  async leaseModelAccount(
    leaseId: string,
    ttlMs: number = 10 * 60 * 1000
  ): Promise<AccountRecord | undefined> {
    return this.store.leaseActive(leaseId, Date.now() + ttlMs, undefined, 0);
  }

  async releaseVideoAccount(uid: string, leaseId?: string): Promise<void> {
    await this.store.releaseLease(uid, leaseId);
  }

  async releaseImageAccount(uid: string, leaseId?: string): Promise<void> {
    await this.store.releaseLease(uid, leaseId);
  }

  async releaseModelAccount(uid: string, leaseId?: string): Promise<void> {
    const account = await this.store.get(uid);
    if (leaseId && account?.leaseId && account.leaseId !== leaseId) {
      return;
    }
    await this.store.markUsed(uid);
  }

  async consumeImageAccount(uid: string, leaseId?: string, cost: number = IMAGE_ACCOUNT_COST): Promise<void> {
    await this.store.consumeLease(uid, leaseId, cost);
  }

  async depleteAccount(uid: string): Promise<void> {
    await this.store.setStatus(uid, "depleted");
    await this.store.setBalance(uid, 0);
  }

  async depleteVideoAccount(uid: string): Promise<void> {
    await this.depleteAccount(uid);
  }

  async updateBalance(
    uid: string,
    balanceRemaining: number,
    balanceTotal?: number
  ): Promise<AccountListItem | undefined> {
    const existing = await this.store.get(uid);
    if (!existing) {
      return undefined;
    }
    await this.store.setBalance(uid, balanceRemaining, balanceTotal);
    if (existing.status !== "disabled") {
      await this.store.setStatus(uid, balanceRemaining > 0 ? "active" : "depleted");
    }
    const account = await this.store.get(uid);
    return account ? toListItem(account) : undefined;
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
