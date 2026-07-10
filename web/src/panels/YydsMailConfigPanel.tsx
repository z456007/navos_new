import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button as AntButton } from "antd";
import { KeyRound } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import { YydsDomainPoolPanel } from "./YydsDomainPoolPanel";
import type { StatusState, YydsMailConfig } from "../types";

export function YydsMailConfigPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<YydsMailConfig | undefined>();
  const [mailKey, setMailKey] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setStatus({ kind: "loading", message: "Loading config" });
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
          setStatus({ kind: "error", message: errorMessage(error) ?? "Failed to load YYDS config" });
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
    setStatus({ kind: "loading", message: "Saving" });
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
      setStatus({ kind: "ok", message: "Saved" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "Failed to save YYDS config" });
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="yyds-config-title">
      <div className="panel-head">
        <div>
          <h2 id="yyds-config-title">YYDS config</h2>
          <StatusLine status={status} />
        </div>
        <span className={`badge ${config?.apiKeyConfigured ? "active" : "disabled"}`}>
          {config?.apiKeyConfigured ? "Configured" : "Not configured"}
        </span>
      </div>

      <form className="config-form" onSubmit={saveConfig}>
        <Alert
          showIcon
          type="info"
          title="Save YYDS Mail key"
          description="The key is encrypted in MySQL and never rendered back in plain text."
        />
        <TextField label="YYDS Mail Key" type="password" value={mailKey} onChange={setMailKey} />
        <div className="secret-note">
          <span>Current key: {config?.apiKeyConfigured ? "saved" : "not saved"}</span>
        </div>
        <div className="toolbar flush">
          <AntButton disabled={status.kind === "loading"} htmlType="submit" icon={<KeyRound size={16} />} type="primary">
            Save YYDS config
          </AntButton>
        </div>
      </form>
      <YydsDomainPoolPanel apiKey={apiKey} />
    </section>
  );
}
