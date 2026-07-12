import { useEffect, useState } from "react";
import { Alert, Button as AntButton, Card, InputNumber, Select, Switch } from "antd";
import { Save, ShieldAlert, ShieldCheck } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { idleStatus } from "../app/defaults";
import { StatusLine } from "../components/feedback";
import type { AccountBalanceReconcileScope, RuntimeConfigView, StatusState } from "../types";

const zh = {
  eyebrow: "\u751f\u4ea7\u8fd0\u884c\u53c2\u6570",
  title: "\u8fd0\u884c\u914d\u7f6e",
  subtitle: "\u628a\u56fe\u7247\u3001\u89c6\u9891\u3001\u4f59\u989d\u68c0\u67e5\u548c\u6ce8\u518c\u5e76\u53d1\u653e\u5230\u9875\u9762\u4e0a\u64cd\u63a7\uff0c\u4e0d\u518d\u9760 SSH \u6539 .env\u3002",
  save: "\u4fdd\u5b58\u8fd0\u884c\u914d\u7f6e",
  loading: "\u6b63\u5728\u8bfb\u53d6\u8fd0\u884c\u914d\u7f6e",
  saving: "\u6b63\u5728\u4fdd\u5b58\u8fd0\u884c\u914d\u7f6e",
  saved: "\u8fd0\u884c\u914d\u7f6e\u5df2\u4fdd\u5b58",
  loadFailed: "\u8bfb\u53d6\u8fd0\u884c\u914d\u7f6e\u5931\u8d25",
  saveFailed: "\u4fdd\u5b58\u8fd0\u884c\u914d\u7f6e\u5931\u8d25",
  imageVideo: "\u56fe\u7247/\u89c6\u9891\u4efb\u52a1",
  balance: "\u4f59\u989d\u68c0\u67e5",
  registration: "\u6ce8\u518c\u4e0e YYDS \u9650\u901f",
  mysql: "MySQL \u8fde\u63a5\u6c60",
  restartTitle: "\u8fd9\u4e24\u9879\u4fdd\u5b58\u540e\u9700\u91cd\u542f NavOS \u624d\u5b8c\u6574\u751f\u6548",
  restartDesc: "\u8fde\u63a5\u6c60\u662f\u542f\u52a8\u671f\u8d44\u6e90\uff0c\u9875\u9762\u4f1a\u5148\u5199\u5165 runtime_config\uff0c\u4e0b\u6b21\u91cd\u542f\u65f6\u6309\u8fd9\u91cc\u7684\u503c\u542f\u52a8\u3002",
  reserveProtected: "\u89c6\u9891\u50a8\u5907\u8d26\u53f7\u5df2\u4fdd\u62a4",
  reserveOpen: "\u56fe\u7247\u4efb\u52a1\u53ef\u501f\u7528\u89c6\u9891\u8d26\u53f7",
  reserveProtectedDesc: "\u56fe\u7247\u4f18\u5148\u4f7f\u7528\u4e2d\u4f4e\u989d\u5ea6\u8d26\u53f7\uff0c2000 \u5206\u8d26\u53f7\u7559\u7ed9 Seedance\u3002",
  reserveOpenDesc: "\u56fe\u7247\u6c60\u8017\u5c3d\u65f6\u53ef\u4ee5\u5403\u89c6\u9891\u50a8\u5907\u8d26\u53f7\uff0c\u9002\u5408\u4e34\u65f6\u6269\u5bb9\u3002",
  allowVideoReserve: "\u5141\u8bb8\u56fe\u7247\u4f7f\u7528\u89c6\u9891\u50a8\u5907\u8d26\u53f7"
};

const defaultRuntimeConfig: RuntimeConfigView = {
  imageAllowVideoReserveFallback: false,
  imageAccountWaitMs: 120000,
  imageMaxPollAttempts: 30,
  imagePollIntervalMs: 4000,
  imageSyncWaitBudgetMs: 120000,
  videoCreateTimeoutMs: 30000,
  videoPollTimeoutMs: 30000,
  modelAccountWaitMs: 30000,
  accountLeaseTtlMs: 600000,
  accountBalanceReconcileEnabled: true,
  accountBalanceReconcileIntervalMinutes: 30,
  accountBalanceReconcileBatchSize: 1000,
  accountBalanceReconcileConcurrency: 10,
  accountBalanceReconcileScope: "depleted",
  registrationConcurrency: 2,
  registrationMaxInFlight: 20,
  registrationMailboxCreateConcurrency: 2,
  registrationMailboxCreatePerSecond: 2,
  registrationVipSendConcurrency: 6,
  registrationPollConcurrency: 50,
  registrationLoginConcurrency: 6,
  registrationCertConcurrency: 6,
  registrationYydsQuotaBlockSeconds: 300,
  mysqlConnectionLimit: 100,
  mysqlQueueLimit: 0,
  restartRequiredKeys: ["mysqlConnectionLimit", "mysqlQueueLimit"],
  updatedAt: 0
};

export function RuntimeConfigPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<RuntimeConfigView>(defaultRuntimeConfig);
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setStatus({ kind: "loading", message: zh.loading });
      try {
        const loaded = await apiRequest<RuntimeConfigView>(apiKey, "/api/runtime-config", { method: "GET" });
        if (!active) return;
        setConfig({ ...defaultRuntimeConfig, ...loaded });
        setStatus({ kind: "idle", message: "" });
      } catch (error) {
        if (active) setStatus({ kind: "error", message: errorMessage(error) ?? zh.loadFailed });
      }
    }
    void loadConfig();
    return () => {
      active = false;
    };
  }, [apiKey]);

  function patchConfig(patch: Partial<RuntimeConfigView>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function numberPatch(key: NumericRuntimeKey, value: unknown) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    patchConfig({ [key]: Math.trunc(next) } as Partial<RuntimeConfigView>);
  }

  async function saveConfig() {
    setStatus({ kind: "loading", message: zh.saving });
    try {
      const saved = await apiRequest<RuntimeConfigView>(apiKey, "/api/runtime-config", {
        method: "PUT",
        body: JSON.stringify(config)
      });
      setConfig({ ...defaultRuntimeConfig, ...saved });
      setStatus({ kind: "ok", message: zh.saved });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? zh.saveFailed });
    }
  }

  const reserveProtected = !config.imageAllowVideoReserveFallback;
  const ShieldIcon = reserveProtected ? ShieldCheck : ShieldAlert;

  return (
    <section className="runtime-config-panel guard-panel" aria-labelledby="runtime-config-title">
      <div className="panel-head inner-head">
        <div>
          <p className="eyebrow">{zh.eyebrow}</p>
          <h2 id="runtime-config-title">{zh.title}</h2>
          <p className="panel-subtitle">{zh.subtitle}</p>
          <StatusLine status={status} />
        </div>
        <AntButton disabled={status.kind === "loading"} icon={<Save size={16} />} type="primary" onClick={() => void saveConfig()}>
          {zh.save}
        </AntButton>
      </div>

      <div className={`reserve-guard ${reserveProtected ? "protected" : "open"}`}>
        <span className="reserve-guard-icon"><ShieldIcon size={22} /></span>
        <div>
          <strong>{reserveProtected ? zh.reserveProtected : zh.reserveOpen}</strong>
          <p>{reserveProtected ? zh.reserveProtectedDesc : zh.reserveOpenDesc}</p>
        </div>
      </div>

      <Card title={zh.imageVideo} className="runtime-card">
        <div className="runtime-toggle-row">
          <Switch
            aria-label={zh.allowVideoReserve}
            checked={config.imageAllowVideoReserveFallback}
            onChange={(checked) => patchConfig({ imageAllowVideoReserveFallback: checked })}
          />
          <div>
            <strong>{zh.allowVideoReserve}</strong>
            <p>{reserveProtected ? zh.reserveProtectedDesc : zh.reserveOpenDesc}</p>
          </div>
        </div>
        <div className="runtime-grid">
          <NumberControl label="IMAGE_ACCOUNT_WAIT_MS" value={config.imageAccountWaitMs} onChange={(value) => numberPatch("imageAccountWaitMs", value)} />
          <NumberControl label="IMAGE_MAX_POLL_ATTEMPTS" value={config.imageMaxPollAttempts} onChange={(value) => numberPatch("imageMaxPollAttempts", value)} />
          <NumberControl label="IMAGE_POLL_INTERVAL_MS" value={config.imagePollIntervalMs} onChange={(value) => numberPatch("imagePollIntervalMs", value)} />
          <NumberControl label="IMAGE_SYNC_WAIT_BUDGET_MS" value={config.imageSyncWaitBudgetMs} onChange={(value) => numberPatch("imageSyncWaitBudgetMs", value)} />
          <NumberControl label="VIDEO_CREATE_TIMEOUT_MS" value={config.videoCreateTimeoutMs} onChange={(value) => numberPatch("videoCreateTimeoutMs", value)} />
          <NumberControl label="VIDEO_POLL_TIMEOUT_MS" value={config.videoPollTimeoutMs} onChange={(value) => numberPatch("videoPollTimeoutMs", value)} />
        </div>
      </Card>

      <Card title={zh.balance} className="runtime-card">
        <div className="runtime-toggle-row">
          <Switch checked={config.accountBalanceReconcileEnabled} onChange={(checked) => patchConfig({ accountBalanceReconcileEnabled: checked })} />
          <div><strong>ACCOUNT_BALANCE_RECONCILE_ENABLED</strong><p>depleted \u8d26\u53f7\u53ef\u4ee5\u5b9a\u65f6\u68c0\u67e5\u5e76\u6062\u590d\u3002</p></div>
        </div>
        <div className="runtime-grid">
          <label className="field"><span>ACCOUNT_BALANCE_RECONCILE_SCOPE</span><Select<AccountBalanceReconcileScope> value={config.accountBalanceReconcileScope} onChange={(value) => patchConfig({ accountBalanceReconcileScope: value })} options={[{ value: "depleted", label: "depleted" }, { value: "active", label: "active" }, { value: "non_disabled", label: "non_disabled" }, { value: "all", label: "all" }]} /></label>
          <NumberControl label="ACCOUNT_BALANCE_RECONCILE_INTERVAL_MINUTES" value={config.accountBalanceReconcileIntervalMinutes} onChange={(value) => numberPatch("accountBalanceReconcileIntervalMinutes", value)} />
          <NumberControl label="ACCOUNT_BALANCE_RECONCILE_BATCH_SIZE" value={config.accountBalanceReconcileBatchSize} onChange={(value) => numberPatch("accountBalanceReconcileBatchSize", value)} />
          <NumberControl label="ACCOUNT_BALANCE_RECONCILE_CONCURRENCY" value={config.accountBalanceReconcileConcurrency} onChange={(value) => numberPatch("accountBalanceReconcileConcurrency", value)} />
        </div>
      </Card>

      <Card title={zh.registration} className="runtime-card">
        <div className="runtime-grid">
          <NumberControl label="REGISTRATION_CONCURRENCY" value={config.registrationConcurrency} onChange={(value) => numberPatch("registrationConcurrency", value)} />
          <NumberControl label="REGISTRATION_MAX_IN_FLIGHT" value={config.registrationMaxInFlight} onChange={(value) => numberPatch("registrationMaxInFlight", value)} />
          <NumberControl label="REGISTRATION_MAILBOX_CREATE_CONCURRENCY" value={config.registrationMailboxCreateConcurrency} onChange={(value) => numberPatch("registrationMailboxCreateConcurrency", value)} />
          <NumberControl label="REGISTRATION_MAILBOX_CREATE_PER_SECOND" value={config.registrationMailboxCreatePerSecond} onChange={(value) => numberPatch("registrationMailboxCreatePerSecond", value)} />
          <NumberControl label="REGISTRATION_VIP_SEND_CONCURRENCY" value={config.registrationVipSendConcurrency} onChange={(value) => numberPatch("registrationVipSendConcurrency", value)} />
          <NumberControl label="REGISTRATION_POLL_CONCURRENCY" value={config.registrationPollConcurrency} onChange={(value) => numberPatch("registrationPollConcurrency", value)} />
          <NumberControl label="REGISTRATION_LOGIN_CONCURRENCY" value={config.registrationLoginConcurrency} onChange={(value) => numberPatch("registrationLoginConcurrency", value)} />
          <NumberControl label="REGISTRATION_CERT_CONCURRENCY" value={config.registrationCertConcurrency} onChange={(value) => numberPatch("registrationCertConcurrency", value)} />
          <NumberControl label="REGISTRATION_YYDS_QUOTA_BLOCK_SECONDS" value={config.registrationYydsQuotaBlockSeconds} onChange={(value) => numberPatch("registrationYydsQuotaBlockSeconds", value)} />
        </div>
      </Card>

      <Card title={zh.mysql} className="runtime-card">
        <Alert showIcon type="warning" title={zh.restartTitle} description={zh.restartDesc} />
        <div className="runtime-grid">
          <NumberControl label="MYSQL_CONNECTION_LIMIT" value={config.mysqlConnectionLimit} onChange={(value) => numberPatch("mysqlConnectionLimit", value)} />
          <NumberControl label="MYSQL_QUEUE_LIMIT" value={config.mysqlQueueLimit} onChange={(value) => numberPatch("mysqlQueueLimit", value)} />
        </div>
      </Card>
    </section>
  );
}

type NumericRuntimeKey = {
  [K in keyof RuntimeConfigView]: RuntimeConfigView[K] extends number | undefined ? K : never
}[keyof RuntimeConfigView] & string;

function NumberControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number | null) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <InputNumber min={0} value={value} onChange={onChange} />
    </label>
  );
}
