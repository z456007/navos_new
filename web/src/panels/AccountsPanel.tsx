import { type FormEvent, useState } from "react";
import { Ban, Power, RefreshCw, Timer, UserPlus } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { AccountBadge } from "../components/account-badge";
import { StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import { formatTime, shortText } from "../lib/accounts";
import type { AccountListItem, StatusState } from "../types";

export function AccountsPanel({
  accounts,
  apiKey,
  onAccountsChange,
  onRefresh
}: {
  accounts: AccountListItem[];
  apiKey: string;
  onAccountsChange: (accounts: AccountListItem[]) => void;
  onRefresh: () => Promise<AccountListItem[]>;
}) {
  const [form, setForm] = useState({ uid: "", token: "", mailboxAddr: "", mailboxToken: "" });
  const [status, setStatus] = useState<StatusState>(idleStatus);

  async function importAccount(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "loading", message: "导入中" });
    try {
      await apiRequest<AccountListItem>(apiKey, "/api/accounts/import", {
        method: "POST",
        body: JSON.stringify({
          uid: form.uid,
          token: form.token,
          mailboxAddr: form.mailboxAddr || undefined,
          mailboxToken: form.mailboxToken || undefined
        })
      });
      setForm((current) => ({ ...current, token: "" }));
      const loaded = await onRefresh();
      onAccountsChange(loaded);
      setStatus({ kind: "ok", message: "已导入" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "导入失败" });
    }
  }

  async function updateAccount(uid: string, action: "enable" | "disable" | "cooldown") {
    setStatus({ kind: "loading", message: "处理中" });
    try {
      await apiRequest<AccountListItem>(apiKey, `/api/accounts/${encodeURIComponent(uid)}/${action}`, {
        method: "POST",
        body: action === "cooldown" ? JSON.stringify({ seconds: 600 }) : undefined
      });
      const loaded = await onRefresh();
      onAccountsChange(loaded);
      setStatus({ kind: "ok", message: "已更新" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "更新失败" });
    }
  }

  return (
    <section className="panel" aria-labelledby="accounts-title">
      <div className="panel-head">
        <div>
          <h2 id="accounts-title">账号池</h2>
          <StatusLine status={status} />
        </div>
        <button className="button" onClick={() => void onRefresh()} type="button">
          <RefreshCw size={16} aria-hidden="true" />
          刷新
        </button>
      </div>

      <form className="import-grid" onSubmit={importAccount}>
        <TextField label="UID" value={form.uid} onChange={(uid) => setForm((current) => ({ ...current, uid }))} />
        <TextField label="Token" type="password" value={form.token} onChange={(token) => setForm((current) => ({ ...current, token }))} />
        <TextField label="邮箱" value={form.mailboxAddr} onChange={(mailboxAddr) => setForm((current) => ({ ...current, mailboxAddr }))} />
        <TextField label="邮箱 Token" value={form.mailboxToken} onChange={(mailboxToken) => setForm((current) => ({ ...current, mailboxToken }))} />
        <button className="button primary import-action" type="submit">
          <UserPlus size={16} aria-hidden="true" />
          导入账号
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>Token</th>
              <th>邮箱</th>
              <th>状态</th>
              <th>最后使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td className="empty" colSpan={6}>暂无账号</td></tr>
            ) : accounts.map((account) => (
              <tr key={account.uid}>
                <td className="mono" title={account.uid}>{shortText(account.uid, 22)}</td>
                <td className="mono">{account.tokenPreview}</td>
                <td>{shortText(account.mailboxAddr, 24)}</td>
                <td><AccountBadge account={account} /></td>
                <td>{formatTime(account.lastUsedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-button" onClick={() => void updateAccount(account.uid, "enable")} title="启用" type="button">
                      <Power size={15} aria-hidden="true" />
                    </button>
                    <button className="icon-button" onClick={() => void updateAccount(account.uid, "disable")} title="停用" type="button">
                      <Ban size={15} aria-hidden="true" />
                    </button>
                    <button className="icon-button" onClick={() => void updateAccount(account.uid, "cooldown")} title="冷却" type="button">
                      <Timer size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
