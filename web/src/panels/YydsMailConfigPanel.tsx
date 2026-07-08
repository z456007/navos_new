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
      setStatus({ kind: "loading", message: "读取配置中" });
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
          setStatus({ kind: "error", message: errorMessage(error) ?? "读取 YYDS 配置失败" });
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
    setStatus({ kind: "loading", message: "保存中" });
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
      setStatus({ kind: "ok", message: "已保存" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "保存 YYDS 配置失败" });
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="yyds-config-title">
      <div className="panel-head">
        <div>
          <h2 id="yyds-config-title">YYDS配置</h2>
          <StatusLine status={status} />
        </div>
        <span className={`badge ${config?.apiKeyConfigured ? "active" : "disabled"}`}>
          {config?.apiKeyConfigured ? "已配置" : "未配置"}
        </span>
      </div>

      <form className="cos-form" onSubmit={saveConfig}>
        <Alert
          showIcon
          type="info"
          title="保存 YYDS Mail Key"
          description="Key 会加密写入 MySQL，保存后页面不会回显明文。"
        />
        <TextField label="YYDS Mail Key" type="password" value={mailKey} onChange={setMailKey} />
        <div className="secret-note">
          <span>当前 Key: {config?.apiKeyConfigured ? "已保存" : "未保存"}</span>
        </div>
        <div className="toolbar flush">
          <AntButton disabled={status.kind === "loading"} htmlType="submit" icon={<KeyRound size={16} />} type="primary">
            保存YYDS配置
          </AntButton>
        </div>
      </form>
    </section>
  );
}
