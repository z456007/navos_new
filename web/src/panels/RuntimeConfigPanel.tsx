import { useEffect, useState } from "react";
import { Alert, Button as AntButton, Switch } from "antd";
import { Save, ShieldAlert, ShieldCheck } from "lucide-react";
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
      setStatus({ kind: "loading", message: "正在读取运行配置" });
      try {
        const loaded = await apiRequest<RuntimeConfigView>(apiKey, "/api/runtime-config", { method: "GET" });
        if (!active) return;
        setConfig({ ...defaultRuntimeConfig, ...loaded });
        setStatus({ kind: "idle", message: "" });
      } catch (error) {
        if (active) {
          setStatus({ kind: "error", message: errorMessage(error) ?? "读取运行配置失败" });
        }
      }
    }
    void loadConfig();
    return () => {
      active = false;
    };
  }, [apiKey]);

  async function saveConfig() {
    setStatus({ kind: "loading", message: "正在保存运行配置" });
    try {
      const saved = await apiRequest<RuntimeConfigView>(apiKey, "/api/runtime-config", {
        method: "PUT",
        body: JSON.stringify({
          imageAllowVideoReserveFallback: config.imageAllowVideoReserveFallback
        })
      });
      setConfig({ ...defaultRuntimeConfig, ...saved });
      setStatus({ kind: "ok", message: "运行配置已保存" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "保存运行配置失败" });
    }
  }

  const reserveProtected = !config.imageAllowVideoReserveFallback;
  const ShieldIcon = reserveProtected ? ShieldCheck : ShieldAlert;

  return (
    <section className="runtime-config-panel guard-panel" aria-labelledby="runtime-config-title">
      <div className="panel-head inner-head">
        <div>
          <p className="eyebrow">生产护栏</p>
          <h3 id="runtime-config-title">视频账号保护</h3>
          <StatusLine status={status} />
        </div>
        <AntButton disabled={status.kind === "loading"} icon={<Save size={16} />} type="primary" onClick={() => void saveConfig()}>
          保存运行配置
        </AntButton>
      </div>

      <div className={`reserve-guard ${reserveProtected ? "protected" : "open"}`}>
        <span className="reserve-guard-icon"><ShieldIcon size={22} /></span>
        <div>
          <strong>{reserveProtected ? "视频储备账号已保护" : "图片任务可借用视频账号"}</strong>
          <p>
            {reserveProtected
              ? "图片只会使用 100-1999 分账号；2000 分账号留给 Seedance，防止高并发生图拖死视频。"
              : "图片池耗尽时会使用 2000 分账号。只有在图片吞吐优先于视频稳定性时才建议打开。"}
          </p>
        </div>
      </div>

      <Alert
        showIcon
        type={reserveProtected ? "success" : "warning"}
        title={reserveProtected ? "推荐生产模式：保护 Seedance 视频额度" : "临时扩容模式：图片会消耗视频储备"}
        description="这个开关会立即影响新的图片任务，不需要重启服务。"
      />

      <div className="runtime-toggle-row">
        <Switch
          aria-label="允许图片使用视频储备账号"
          checked={config.imageAllowVideoReserveFallback}
          onChange={(checked) => setConfig((current) => ({
            ...current,
            imageAllowVideoReserveFallback: checked
          }))}
        />
        <div>
          <strong>允许图片使用视频储备账号</strong>
          <p>关闭时图片池不够会等待或返回 503；打开时图片可使用 2000 分视频账号。</p>
        </div>
      </div>
    </section>
  );
}
