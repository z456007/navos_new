import { type FormEvent, useEffect, useState } from "react";
import { Button as AntButton, Switch } from "antd";
import { Cloud } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import { configToCosForm, emptyCosConfigForm, type CosConfigForm } from "../lib/cos-config";
import type { CosConfig, StatusState } from "../types";

export function CosConfigPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<CosConfig | undefined>();
  const [form, setForm] = useState<CosConfigForm>(emptyCosConfigForm);
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setStatus({ kind: "loading", message: "读取配置中" });
      try {
        const loaded = await apiRequest<CosConfig>(apiKey, "/api/cos/config", { method: "GET" });
        if (!active) {
          return;
        }
        setConfig(loaded);
        setForm(configToCosForm(loaded));
        setStatus({ kind: "idle", message: "" });
      } catch (error) {
        if (active) {
          setStatus({ kind: "error", message: errorMessage(error) ?? "读取 COS 配置失败" });
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
      const saved = await apiRequest<CosConfig>(apiKey, "/api/cos/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled,
          secretId: form.secretId || undefined,
          secretKey: form.secretKey || undefined,
          bucket: form.bucket,
          region: form.region,
          appId: form.appId || undefined,
          publicDomain: form.publicDomain || undefined,
          uploadPrefix: form.uploadPrefix || undefined
        })
      });
      setConfig(saved);
      setForm({ ...configToCosForm(saved), secretId: "", secretKey: "" });
      setStatus({ kind: "ok", message: "已保存" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "保存 COS 配置失败" });
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="cos-title">
      <div className="panel-head">
        <div>
          <h2 id="cos-title">COS配置</h2>
          <StatusLine status={status} />
        </div>
        <span className={`badge ${config?.enabled === false ? "disabled" : "active"}`}>
          {config?.configured || config?.secretIdConfigured || config?.secretKeyConfigured ? "已配置" : "未配置"}
        </span>
      </div>

      <form className="cos-form" onSubmit={saveConfig}>
        <label className="inline-check ant-switch-row cos-enabled">
          <Switch
            aria-label="启用视频归档"
            checked={form.enabled}
            onChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
          />
          <span>启用视频归档</span>
        </label>

        <div className="form-row two compact">
          <TextField label="SecretId" type="password" value={form.secretId} onChange={(secretId) => setForm((current) => ({ ...current, secretId }))} />
          <TextField label="SecretKey" type="password" value={form.secretKey} onChange={(secretKey) => setForm((current) => ({ ...current, secretKey }))} />
        </div>

        <div className="form-row two compact">
          <TextField label="Bucket" value={form.bucket} onChange={(bucket) => setForm((current) => ({ ...current, bucket }))} />
          <TextField label="Region" value={form.region} onChange={(region) => setForm((current) => ({ ...current, region }))} />
        </div>

        <div className="form-row three compact">
          <TextField label="AppID" value={form.appId} onChange={(appId) => setForm((current) => ({ ...current, appId }))} />
          <TextField label="Public Domain" value={form.publicDomain} onChange={(publicDomain) => setForm((current) => ({ ...current, publicDomain }))} />
          <TextField label="Upload Prefix" value={form.uploadPrefix} onChange={(uploadPrefix) => setForm((current) => ({ ...current, uploadPrefix }))} />
        </div>

        <div className="secret-note">
          <span>密钥保存后只会加密入库，页面不会再回显。</span>
          <span>当前 SecretId: {config?.secretIdConfigured ? "已保存" : "未保存"}</span>
          <span>当前 SecretKey: {config?.secretKeyConfigured ? "已保存" : "未保存"}</span>
        </div>

        <div className="toolbar flush">
          <AntButton disabled={status.kind === "loading"} htmlType="submit" icon={<Cloud size={16} />} type="primary">
            保存COS配置
          </AntButton>
        </div>
      </form>
    </section>
  );
}
