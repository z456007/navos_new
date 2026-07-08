import type { AccountListItem } from "../types";

export function AccountBadge({ account }: { account: AccountListItem }) {
  const cooling = account.status === "active" && account.rateLimitedUntil > Date.now();
  const label = cooling ? "cooldown" : account.status;
  const tone = cooling ? "wait" : account.status;
  return <span className={`badge ${tone}`}>{label}</span>;
}
