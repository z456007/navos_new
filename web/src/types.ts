export type AccountStatus = "active" | "disabled" | "depleted";

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

export interface Mailbox {
  address?: string;
  id?: string;
  token?: string;
}

export type PanelId = "accounts" | "mail" | "probe";

export type StatusKind = "idle" | "loading" | "ok" | "error";

export interface StatusState {
  kind: StatusKind;
  message: string;
}
