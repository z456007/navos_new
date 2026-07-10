import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button as AntButton } from "antd";
import { KeyRound } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import type { StatusState, YydsMailConfig } from "../types";

export function YydsMailConfigPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<YydsMailConfig | undefined>();
  const [mailKey, setMailKey] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setStatus({ kind: "loading", message: "璇诲彇閰嶇疆涓? });
      try {
        const loaded = await apiRequest<YydsMailConfig>(apiKey, "/api/mail/yyds/config", { method: "GET" });
        if (!active) {
          return;
        }
        setConfig(loaded);
        setMailKey("");
        setStatus({ kind: "idle", message: "" });
      } catch (error) {
        if (active) {
          setStatus({ kind: "error", message: errorMessage(error) ?? "璇诲彇 YYDS 閰嶇疆澶辫触" });
        }
      }
    }

    void loadConfig();
    return () => {
      active = false;
    };
  }, [apiKey]);

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "loading", message: "淇濆瓨涓? });
    try {
      const saved = await apiRequest<YydsMailConfig>(apiKey, "/api/mail/yyds/config", {
        method: "PUT",
        body: JSON.stringify({
          apiKey: mailKey || undefined,
          enabled: true
        })
      });
      setConfig(saved);
      setMailKey("");
      setStatus({ kind: "ok", message: "宸蹭繚瀛? });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "淇濆瓨 YYDS 閰嶇疆澶辫触" });
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="yyds-config-title">
      <div className="panel-head">
        <div>
          <h2 id="yyds-config-title">YYDS閰嶇疆</h2>
          <StatusLine status={status} />
        </div>
        <span className={`badge ${config?.apiKeyConfigured ? "active" : "disabled"}`}>
          {config?.apiKeyConfigured ? "宸查厤缃? : "鏈厤缃?}
        </span>
      </div>

      <form className="config-form" onSubmit={saveConfig}>
        <Alert
          showIcon
          type="info"
          title="淇濆瓨 YYDS Mail Key"
          description="Key 浼氬姞瀵嗗啓鍏?MySQL锛屼繚瀛樺悗椤甸潰涓嶄細鍥炴樉鏄庢枃銆?
        />
        <TextField label="YYDS Mail Key" type="password" value={mailKey} onChange={setMailKey} />
        <div className="secret-note">
          <span>褰撳墠 Key: {config?.apiKeyConfigured ? "宸蹭繚瀛? : "鏈繚瀛?}</span>
        </div>
        <div className="toolbar flush">
          <AntButton disabled={status.kind === "loading"} htmlType="submit" icon={<KeyRound size={16} />} type="primary">
            淇濆瓨YYDS閰嶇疆
          </AntButton>
        </div>
      </form>
    </section>
  );
}

