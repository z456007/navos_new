import { useState } from "react";
import { KeyRound, Mail, Search } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { JsonBlock, StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import type { Mailbox, StatusState } from "../types";

export function MailPanel({ apiKey }: { apiKey: string }) {
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);
  const [result, setResult] = useState<unknown>("等待操作");

  async function createMailbox() {
    setStatus({ kind: "loading", message: "创建中" });
    try {
      const mailbox = await apiRequest<Mailbox>(apiKey, "/api/mail/yyds/accounts", { method: "POST" });
      setAddress(mailbox.address ?? "");
      setToken(mailbox.token ?? "");
      setResult(mailbox);
      setStatus({ kind: "ok", message: "已创建" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "创建失败" });
    }
  }

  async function listMessages() {
    setStatus({ kind: "loading", message: "查询中" });
    try {
      const query = `/api/mail/yyds/messages?address=${encodeURIComponent(address)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
      const messages = await apiRequest<unknown>(apiKey, query);
      setResult(messages);
      setStatus({ kind: "ok", message: "已查询" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "查询失败" });
    }
  }

  async function findCode() {
    setStatus({ kind: "loading", message: "提取中" });
    try {
      const code = await apiRequest<unknown>(apiKey, "/api/mail/yyds/verification-code", {
        method: "POST",
        body: JSON.stringify({ address, token: token || undefined })
      });
      setResult(code);
      setStatus({ kind: "ok", message: "已提取" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "提取失败" });
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="mail-title">
      <div className="panel-head">
        <div>
          <h2 id="mail-title">YYDS 邮箱</h2>
          <StatusLine status={status} />
        </div>
        <button className="button primary" onClick={() => void createMailbox()} type="button">
          <Mail size={16} aria-hidden="true" />
          创建邮箱
        </button>
      </div>
      <div className="form-row two">
        <TextField label="邮箱地址" value={address} onChange={setAddress} />
        <TextField label="邮箱 Token" value={token} onChange={setToken} />
      </div>
      <div className="toolbar">
        <button className="button" onClick={() => void listMessages()} type="button">
          <Search size={16} aria-hidden="true" />
          查邮件
        </button>
        <button className="button" onClick={() => void findCode()} type="button">
          <KeyRound size={16} aria-hidden="true" />
          取验证码
        </button>
      </div>
      <JsonBlock value={result} />
    </section>
  );
}
