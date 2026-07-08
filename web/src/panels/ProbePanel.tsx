import { useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { JsonBlock, StatusLine } from "../components/feedback";
import { idleStatus, initialChatPayload, initialMessagesPayload } from "../app/defaults";
import type { AccountListItem, StatusState } from "../types";

export function ProbePanel({
  apiKey,
  onAfterProbe
}: {
  apiKey: string;
  onAfterProbe: () => Promise<AccountListItem[]>;
}) {
  const [messagesPayload, setMessagesPayload] = useState(initialMessagesPayload);
  const [chatPayload, setChatPayload] = useState(initialChatPayload);
  const [status, setStatus] = useState<StatusState>(idleStatus);
  const [result, setResult] = useState<unknown>("等待操作");

  async function runProbe(path: "/v1/messages" | "/v1/chat/completions", payloadText: string) {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setStatus({ kind: "error", message: "JSON 格式错误" });
      return;
    }

    setStatus({ kind: "loading", message: "请求中" });
    try {
      const response = await apiRequest<unknown>(apiKey, path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setResult(response);
      setStatus({ kind: "ok", message: "请求成功" });
      await onAfterProbe();
    } catch (error) {
      setResult(errorMessage(error) ?? "请求失败");
      setStatus({ kind: "error", message: errorMessage(error) ?? "请求失败" });
    }
  }

  return (
    <section className="panel" aria-labelledby="probe-title">
      <div className="panel-head">
        <div>
          <h2 id="probe-title">代理测试</h2>
          <StatusLine status={status} />
        </div>
      </div>
      <div className="probe-grid">
        <label className="textarea-field">
          <span>/v1/messages payload</span>
          <textarea value={messagesPayload} onChange={(event) => setMessagesPayload(event.target.value)} />
        </label>
        <label className="textarea-field">
          <span>/v1/chat/completions payload</span>
          <textarea value={chatPayload} onChange={(event) => setChatPayload(event.target.value)} />
        </label>
      </div>
      <div className="toolbar">
        <button className="button primary" onClick={() => void runProbe("/v1/messages", messagesPayload)} type="button">
          <Send size={16} aria-hidden="true" />
          测试 messages
        </button>
        <button className="button" onClick={() => void runProbe("/v1/chat/completions", chatPayload)} type="button">
          <MessageSquare size={16} aria-hidden="true" />
          测试 chat
        </button>
      </div>
      <JsonBlock value={result} />
    </section>
  );
}
