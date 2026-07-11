import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button as AntButton } from "antd";
import { KeyRound } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import { RuntimeConfigPanel } from "./RuntimeConfigPanel";
import { YydsDomainPoolPanel } from "./YydsDomainPoolPanel";
import type { StatusState, YydsMailConfig } from "../types";

export function YydsMailConfigPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<YydsMailConfig | undefined>();
  const [mailKey, setMailKey] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setStatus({ kind: "loading", message: "正在读取配置" });
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
    setStatus({ kind: "loading", message: "正在保存 YYDS Mail Key" });
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
    <section className="panel narrow config-panel" aria-labelledby="yyds-config-title">
      <div className="panel-head config-hero">
        <div>
          <p className="eyebrow">注册机上游 · 邮箱 · 账号池护栏</p>
          <h2 id="yyds-config-title">YYDS 配置</h2>
          <p className="panel-subtitle">把邮箱、域名和账号消耗策略放在一个地方，部署后也能安全调整。</p>
          <StatusLine status={status} />
        </div>
        <span className={`badge ${config?.apiKeyConfigured ? "active" : "disabled"}`}>
          {config?.apiKeyConfigured ? "密钥已保存" : "未配置密钥"}
        </span>
      </div>

      <form className="config-form key-config-card" onSubmit={saveConfig}>
        <Alert
          showIcon
          type="info"
          title="保存 YYDS Mail Key"
          description="密钥会加密写入 MySQL，页面不会回显明文。留空保存时只更新启用状态，不会覆盖已有密钥。"
        />
        <TextField label="YYDS Mail Key" type="password" value={mailKey} onChange={setMailKey} />
        <div className="secret-note">
          <span>当前密钥：{config?.apiKeyConfigured ? "已保存" : "未保存"}</span>
          <span>用途：批量注册收码</span>
        </div>
        <div className="toolbar flush">
          <AntButton disabled={status.kind === "loading"} htmlType="submit" icon={<KeyRound size={16} />} type="primary">
            保存 YYDS 配置
          </AntButton>
        </div>
      </form>
      <RuntimeConfigPanel apiKey={apiKey} />
      <YydsDomainPoolPanel apiKey={apiKey} />
    </section>
  );
}
