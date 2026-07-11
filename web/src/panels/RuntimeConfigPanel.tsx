import { useEffect, useState } from "react";
import { Alert, Button as AntButton, Switch } from "antd";
import { Save } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { idleStatus } from "../app/defaults";
import { StatusLine } from "../components/feedback";
import type { RuntimeConfigView, StatusState } from "../types";

const defaultRuntimeConfig: RuntimeConfigView = {
  imageAllowVideoReserveFallback: false,
  updatedAt: 0
};

export function RuntimeConfigPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<RuntimeConfigView>(defaultRuntimeConfig);
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setStatus({ kind: "loading", message: "Loading runtime config" });
      try {
        const loaded = await apiRequest<RuntimeConfigView>(apiKey, "/api/runtime-config", { method: "GET" });
        if (!active) return;
        setConfig({ ...defaultRuntimeConfig, ...loaded });
        setStatus({ kind: "idle", message: "" });
      } catch (error) {
        if (active) {
          setStatus({ kind: "error", message: errorMessage(error) ?? "Failed to load runtime config" });
        }
      }
    }
    void loadConfig();
    return () => {
      active = false;
    };
  }, [apiKey]);

  async function saveConfig() {
    setStatus({ kind: "loading", message: "Saving runtime config" });
    try {
      const saved = await apiRequest<RuntimeConfigView>(apiKey, "/api/runtime-config", {
        method: "PUT",
        body: JSON.stringify({
          imageAllowVideoReserveFallback: config.imageAllowVideoReserveFallback
        })
      });
      setConfig({ ...defaultRuntimeConfig, ...saved });
      setStatus({ kind: "ok", message: "Runtime config saved" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "Failed to save runtime config" });
    }
  }

  return (
    <section className="runtime-config-panel" aria-labelledby="runtime-config-title">
      <div className="panel-head">
        <div>
          <h3 id="runtime-config-title">Runtime config</h3>
          <StatusLine status={status} />
        </div>
        <AntButton disabled={status.kind === "loading"} icon={<Save size={16} />} type="primary" onClick={() => void saveConfig()}>
          Save runtime config
        </AntButton>
      </div>

      <Alert
        showIcon
        type={config.imageAllowVideoReserveFallback ? "warning" : "success"}
        title={config.imageAllowVideoReserveFallback ? "Image jobs may consume video reserve accounts" : "Video reserve accounts are protected"}
        description="Turn this on only when image capacity is more important than preserving 2000-credit Seedance video accounts."
      />

      <div className="runtime-toggle-row">
        <Switch
          aria-label="Allow images to use video reserve accounts"
          checked={config.imageAllowVideoReserveFallback}
          onChange={(checked) => setConfig((current) => ({
            ...current,
            imageAllowVideoReserveFallback: checked
          }))}
        />
        <div>
          <strong>Allow images to use video reserve accounts</strong>
          <p>Off means image jobs only use 100-1999 credit accounts; 2000-credit accounts stay reserved for Seedance.</p>
        </div>
      </div>
    </section>
  );
}
