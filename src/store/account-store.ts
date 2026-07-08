import type { AccountIdentity } from "../protocols/auth.js";

export type AccountStatus = "active" | "disabled" | "depleted";

export interface AccountRecord extends AccountIdentity {
  mailboxAddr?: string;
  mailboxToken?: string;
  balanceRemaining: number;
  balanceTotal: number;
  status: AccountStatus;
  createdAt: number;
  lastUsedAt: number;
  lastBalanceAt: number;
  rateLimitedUntil: number;
}

export interface AccountImportInput extends AccountIdentity {
  mailboxAddr?: string;
  mailboxToken?: string;
  balanceRemaining?: number;
  balanceTotal?: number;
  status?: AccountStatus;
}

export interface AccountStore {
  upsert(account: AccountImportInput): Promise<AccountRecord>;
  list(): Promise<AccountRecord[]>;
  get(uid: string): Promise<AccountRecord | undefined>;
  pickActive(nowMs?: number): Promise<AccountRecord | undefined>;
  markUsed(uid: string, usedAtMs?: number): Promise<void>;
  setStatus(uid: string, status: AccountStatus): Promise<void>;
  setCooldown(uid: string, untilMs: number): Promise<void>;
}

function now(): number {
  return Date.now();
}

function toRecord(account: AccountImportInput, existing?: AccountRecord): AccountRecord {
  const timestamp = now();
  return {
    uid: account.uid,
    token: account.token,
    mailboxAddr: account.mailboxAddr ?? existing?.mailboxAddr,
    mailboxToken: account.mailboxToken ?? existing?.mailboxToken,
    balanceRemaining: account.balanceRemaining ?? existing?.balanceRemaining ?? 0,
    balanceTotal: account.balanceTotal ?? existing?.balanceTotal ?? 0,
    status: account.status ?? existing?.status ?? "active",
    createdAt: existing?.createdAt ?? timestamp,
    lastUsedAt: existing?.lastUsedAt ?? 0,
    lastBalanceAt: existing?.lastBalanceAt ?? 0,
    rateLimitedUntil: existing?.rateLimitedUntil ?? 0
  };
}

export class InMemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<string, AccountRecord>();

  constructor(defaultAccount?: AccountIdentity) {
    if (defaultAccount) {
      const record = toRecord(defaultAccount);
      this.accounts.set(record.uid, record);
    }
  }

  async upsert(account: AccountImportInput): Promise<AccountRecord> {
    const record = toRecord(account, this.accounts.get(account.uid));
    this.accounts.set(account.uid, record);
    return { ...record };
  }

  async list(): Promise<AccountRecord[]> {
    return Array.from(this.accounts.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((account) => ({ ...account }));
  }

  async get(uid: string): Promise<AccountRecord | undefined> {
    const account = this.accounts.get(uid);
    return account ? { ...account } : undefined;
  }

  async pickActive(nowMs: number = now()): Promise<AccountRecord | undefined> {
    const candidates = Array.from(this.accounts.values())
      .filter((account) => account.status === "active" && account.rateLimitedUntil <= nowMs)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.createdAt - b.createdAt);
    return candidates[0] ? { ...candidates[0] } : undefined;
  }

  async markUsed(uid: string, usedAtMs: number = now()): Promise<void> {
    const account = this.accounts.get(uid);
    if (account) {
      account.lastUsedAt = usedAtMs;
    }
  }

  async setStatus(uid: string, status: AccountStatus): Promise<void> {
    const account = this.accounts.get(uid);
    if (account) {
      account.status = status;
    }
  }

  async setCooldown(uid: string, untilMs: number): Promise<void> {
    const account = this.accounts.get(uid);
    if (account) {
      account.rateLimitedUntil = untilMs;
    }
  }
}
