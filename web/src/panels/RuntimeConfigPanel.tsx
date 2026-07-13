import { useEffect, useState } from "react";
import { Alert, Button as AntButton, Card, InputNumber, Select, Switch } from "antd";
import { Save, ShieldAlert, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { idleStatus } from "../app/defaults";
import { StatusLine } from "../components/feedback";
import type { AccountBalanceReconcileScope, RuntimeConfigView, StatusState } from "../types";

const zh = {
  eyebrow: "生产运行参数",
  title: "运行配置",
  subtitle: "运行参数都在这里动态调整；.env 只管启动必需项。普通使用点一键方案即可。",
  save: "保存运行配置",
  loading: "正在读取运行配置",
  saving: "正在保存运行配置",
  saved: "运行配置已保存",
  loadFailed: "读取运行配置失败",
  saveFailed: "保存运行配置失败",
  presets: "一键套用方案",
  imageVideo: "图片/视频任务",
  balance: "余额检查",
  registration: "注册吞吐",
  mysql: "数据库连接",
  restartTitle: "数据库连接池保存后需要重启 NavOS 才会完整生效",
  restartDesc: "连接池是启动期资源；页面会先写入运行配置，下次重启时按这里的值启动。",
  reserveProtected: "视频储备账号已保护",
  reserveOpen: "图片任务可借用视频账号",
  reserveProtectedDesc: "图片优先使用中低额度账号，2000 分账号留给 Seedance。",
  reserveOpenDesc: "图片池耗尽时可以吃视频储备账号，适合临时扩容，但会影响视频产能。",
  allowVideoReserve: "允许图片使用视频储备账号"
};

const defaultRuntimeConfig: RuntimeConfigView = {
  imageAllowVideoReserveFallback: false,
  imageAccountWaitMs: 120000,
  imageMaxPollAttempts: 75,
  imagePollIntervalMs: 4000,
  imageSyncWaitBudgetMs: 300000,
  videoCreateTimeoutMs: 30000,
  videoPollTimeoutMs: 30000,
  modelAccountWaitMs: 30000,
  accountLeaseTtlMs: 600000,
  accountBalanceReconcileEnabled: true,
  accountBalanceReconcileIntervalMinutes: 30,
  accountBalanceReconcileBatchSize: 1000,
  accountBalanceReconcileConcurrency: 10,
  accountBalanceReconcileScope: "depleted",
  registrationConcurrency: 20,
  registrationMaxInFlight: 10000,
  registrationMailboxCreateConcurrency: 20,
  registrationMailboxCreatePerSecond: 50,
  registrationVipSendConcurrency: 100,
  registrationPollConcurrency: 500,
  registrationLoginConcurrency: 100,
  registrationCertConcurrency: 100,
  registrationYydsQuotaBlockSeconds: 300,
  mysqlConnectionLimit: 100,
  mysqlQueueLimit: 0,
  restartRequiredKeys: ["mysqlConnectionLimit", "mysqlQueueLimit"],
  updatedAt: 0
};

type RuntimePreset = {
  name: string;
  audience: string;
  effect: string;
  note?: string;
  recommended?: boolean;
  patch: Partial<RuntimeConfigView>;
};

const runtimePresets: RuntimePreset[] = [
  {
    name: "日常稳妥运行",
    audience: "适合：平时小流量、账号维护、少量图片/视频任务。",
    effect: "会调整：降低注册和检查强度，优先保护账号与上游稳定。",
    patch: {
      imageAccountWaitMs: 120000,
      imageMaxPollAttempts: 75,
      imagePollIntervalMs: 4000,
      imageSyncWaitBudgetMs: 300000,
      accountBalanceReconcileScope: "depleted",
      accountBalanceReconcileBatchSize: 1000,
      accountBalanceReconcileConcurrency: 10,
      registrationConcurrency: 20,
      registrationMaxInFlight: 10000,
      registrationMailboxCreateConcurrency: 20,
      registrationMailboxCreatePerSecond: 50,
      registrationVipSendConcurrency: 100,
      registrationPollConcurrency: 500,
      registrationLoginConcurrency: 100,
      registrationCertConcurrency: 100
    }
  },
  {
    name: "100 并发压测",
    audience: "适合：本地 Sub2Api 全链路 100 并发。",
    effect: "会调整：模型排队等待、图片等待、余额检查和注册吞吐。",
    note: "推荐先用这档验证 Codex、Claude、图片、视频链路。",
    recommended: true,
    patch: {
      modelAccountWaitMs: 60000,
      imageAccountWaitMs: 180000,
      imageSyncWaitBudgetMs: 180000,
      accountBalanceReconcileScope: "non_disabled",
      accountBalanceReconcileBatchSize: 1000,
      accountBalanceReconcileConcurrency: 20,
      registrationConcurrency: 100,
      registrationMaxInFlight: 20000,
      registrationMailboxCreateConcurrency: 100,
      registrationMailboxCreatePerSecond: 200,
      registrationVipSendConcurrency: 300,
      registrationPollConcurrency: 1000,
      registrationLoginConcurrency: 300,
      registrationCertConcurrency: 300,
      mysqlConnectionLimit: 100,
      mysqlQueueLimit: 0
    }
  },
  {
    name: "千级账号池维护",
    audience: "适合：批量导入、刷新、修复上千个账号。",
    effect: "会调整：注册吞吐、余额检查批量、认证/轮询并发。",
    note: "不是直接发起上千压测，只是让账号池维护更积极。",
    patch: {
      accountBalanceReconcileScope: "non_disabled",
      accountBalanceReconcileBatchSize: 2000,
      accountBalanceReconcileConcurrency: 30,
      registrationConcurrency: 300,
      registrationMaxInFlight: 100000,
      registrationMailboxCreateConcurrency: 300,
      registrationMailboxCreatePerSecond: 800,
      registrationVipSendConcurrency: 1000,
      registrationPollConcurrency: 3000,
      registrationLoginConcurrency: 1000,
      registrationCertConcurrency: 1000,
      mysqlConnectionLimit: 160,
      mysqlQueueLimit: 0
    }
  },
  {
    name: "长对话压测",
    audience: "适合：GPT/Claude 长上下文、长耗时任务。",
    effect: "会调整：模型拿号等待、账号租约、图片/视频长任务窗口。",
    note: "减少 30 秒内拿不到账号就失败的情况。",
    patch: {
      modelAccountWaitMs: 120000,
      accountLeaseTtlMs: 1200000,
      imageAccountWaitMs: 240000,
      imageSyncWaitBudgetMs: 240000,
      videoCreateTimeoutMs: 60000,
      videoPollTimeoutMs: 60000
    }
  }
];

const registrationThroughputPresets: Array<{ name: string; desc: string; patch: Partial<RuntimeConfigView> }> = [
  {
    name: "稳定填池",
    desc: "适合日常补号，吞吐高于旧版但更平滑。",
    patch: {
      registrationConcurrency: 20,
      registrationMaxInFlight: 10000,
      registrationMailboxCreateConcurrency: 20,
      registrationMailboxCreatePerSecond: 50,
      registrationVipSendConcurrency: 100,
      registrationPollConcurrency: 500,
      registrationLoginConcurrency: 100,
      registrationCertConcurrency: 100
    }
  },
  {
    name: "强力注册",
    desc: "推荐：准备 100 并发全链路压测时使用。",
    patch: {
      registrationConcurrency: 100,
      registrationMaxInFlight: 20000,
      registrationMailboxCreateConcurrency: 100,
      registrationMailboxCreatePerSecond: 200,
      registrationVipSendConcurrency: 300,
      registrationPollConcurrency: 1000,
      registrationLoginConcurrency: 300,
      registrationCertConcurrency: 300
    }
  },
  {
    name: "暴力填池",
    desc: "账号池大批量补齐，失败就记录失败，不在 UI 里保守拦截。",
    patch: {
      registrationConcurrency: 300,
      registrationMaxInFlight: 100000,
      registrationMailboxCreateConcurrency: 300,
      registrationMailboxCreatePerSecond: 800,
      registrationVipSendConcurrency: 1000,
      registrationPollConcurrency: 3000,
      registrationLoginConcurrency: 1000,
      registrationCertConcurrency: 1000
    }
  }
];

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

      <Card className="runtime-card runtime-preset-card" title={<span className="runtime-card-title"><SlidersHorizontal size={16} />{zh.presets}</span>}>
        <p className="runtime-preset-help">不知道选哪个：先点「100 并发压测」，保存后再跑测试。</p>
        <div className="runtime-preset-grid">
          {runtimePresets.map((preset) => (
            <AntButton
              aria-label={`${preset.name}。${preset.audience}${preset.effect}${preset.note ? preset.note : ""}`}
              className={`runtime-preset ${preset.recommended ? "recommended" : ""}`}
              key={preset.name}
              onClick={() => patchConfig(preset.patch)}
            >
              <span className="runtime-preset-head">
                <strong>{preset.name}</strong>
                {preset.recommended ? <em>推荐</em> : null}
              </span>
              <span className="runtime-preset-desc">{preset.audience}</span>
              <span className="runtime-preset-impact">{preset.effect}</span>
              {preset.note ? <small>{preset.note}</small> : null}
            </AntButton>
          ))}
        </div>
      </Card>

      <div className={`reserve-guard ${reserveProtected ? "protected" : "open"}`}>
        <span className="reserve-guard-icon"><ShieldIcon size={22} /></span>
        <div>
          <strong>{reserveProtected ? zh.reserveProtected : zh.reserveOpen}</strong>
          <p>{reserveProtected ? zh.reserveProtectedDesc : zh.reserveOpenDesc}</p>
        </div>
      </div>

      <Card title={zh.imageVideo} className="runtime-card runtime-media-card">
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
        <div className="runtime-grid compact-runtime-grid">
          <NumberControl label="图片账号等待" help="账号池忙时等待可用图片账号的最长时间。" value={config.imageAccountWaitMs} onChange={(value) => numberPatch("imageAccountWaitMs", value)} />
          <NumberControl label="图片轮询次数" help="异步图片任务最多查询多少次。" value={config.imageMaxPollAttempts} onChange={(value) => numberPatch("imageMaxPollAttempts", value)} />
          <NumberControl label="图片轮询间隔" help="两次查询任务状态之间的毫秒数。" value={config.imagePollIntervalMs} onChange={(value) => numberPatch("imagePollIntervalMs", value)} />
          <NumberControl label="图片同步等待" help="公共接口最多等待图片完成多久。" value={config.imageSyncWaitBudgetMs} onChange={(value) => numberPatch("imageSyncWaitBudgetMs", value)} />
          <NumberControl label="视频创建超时" help="发起 Seedance 任务的超时时间。" value={config.videoCreateTimeoutMs} onChange={(value) => numberPatch("videoCreateTimeoutMs", value)} />
          <NumberControl label="视频轮询超时" help="单次查询视频任务状态的超时时间。" value={config.videoPollTimeoutMs} onChange={(value) => numberPatch("videoPollTimeoutMs", value)} />
        </div>
      </Card>

      <Card title={zh.balance} className="runtime-card runtime-balance-card">
        <div className="runtime-toggle-row">
          <Switch aria-label="启用余额自动检查" checked={config.accountBalanceReconcileEnabled} onChange={(checked) => patchConfig({ accountBalanceReconcileEnabled: checked })} />
          <div><strong>启用余额自动检查</strong><p>定时检查账号余额，耗尽账号恢复后可自动拉回可用池。</p></div>
        </div>
        <div className="runtime-grid compact-runtime-grid">
          <label className="runtime-field">
            <span>检查范围</span>
            <Select<AccountBalanceReconcileScope>
              aria-label="余额检查范围"
              value={config.accountBalanceReconcileScope}
              onChange={(value) => patchConfig({ accountBalanceReconcileScope: value })}
              options={[
                { value: "depleted", label: "只查耗尽账号" },
                { value: "active", label: "只查可用账号" },
                { value: "non_disabled", label: "查非停用账号" },
                { value: "all", label: "查全部账号" }
              ]}
            />
          </label>
          <NumberControl label="检查间隔" help="自动余额检查的分钟间隔。" value={config.accountBalanceReconcileIntervalMinutes} onChange={(value) => numberPatch("accountBalanceReconcileIntervalMinutes", value)} />
          <NumberControl label="每批数量" help="每批最多检查多少账号。" value={config.accountBalanceReconcileBatchSize} onChange={(value) => numberPatch("accountBalanceReconcileBatchSize", value)} />
          <NumberControl label="检查并发" help="余额接口同时并发数量。" value={config.accountBalanceReconcileConcurrency} onChange={(value) => numberPatch("accountBalanceReconcileConcurrency", value)} />
        </div>
      </Card>

      <Card title={zh.registration} className="runtime-card runtime-registration-card">
        <div className="runtime-toggle-row">
          <div>
            <strong>当前注册强度：{config.registrationConcurrency} 并发 / {config.registrationMaxInFlight} 待处理</strong>
            <p>选择一个档位即可同步调整邮箱、发码、轮询、登录和认证吞吐；失败会进入失败结果，不再用 500 这种小上限挡住新增。</p>
          </div>
        </div>
        <div className="runtime-preset-grid">
          {registrationThroughputPresets.map((preset) => (
            <AntButton className="runtime-preset" key={preset.name} onClick={() => patchConfig(preset.patch)}>
              <strong>{preset.name}</strong>
              <span>{preset.desc}</span>
            </AntButton>
          ))}
        </div>
        <div className="runtime-grid compact-runtime-grid">
          <NumberControl label="注册并发" help="只调这个就够了；其他注册链路会由预设同步。" value={config.registrationConcurrency} onChange={(value) => numberPatch("registrationConcurrency", value)} />
          <NumberControl label="YYDS 熔断秒数" help="YYDS quota 用尽后暂停邮箱创建多久。" value={config.registrationYydsQuotaBlockSeconds} onChange={(value) => numberPatch("registrationYydsQuotaBlockSeconds", value)} />
        </div>
      </Card>

      <Card title={zh.mysql} className="runtime-card runtime-mysql-card">
        <Alert showIcon type="warning" title={zh.restartTitle} description={zh.restartDesc} />
        <div className="runtime-grid compact-runtime-grid">
          <NumberControl label="MySQL 最大连接" value={config.mysqlConnectionLimit} onChange={(value) => numberPatch("mysqlConnectionLimit", value)} />
          <NumberControl label="MySQL 排队上限" help="0 表示不限制队列；修改后重启生效。" value={config.mysqlQueueLimit} onChange={(value) => numberPatch("mysqlQueueLimit", value)} />
        </div>
      </Card>
    </section>
  );
}

type NumericRuntimeKey = {
  [K in keyof RuntimeConfigView]: RuntimeConfigView[K] extends number | undefined ? K : never
}[keyof RuntimeConfigView] & string;

function NumberControl({ label, help, value, onChange }: { label: string; help?: string; value: number; onChange: (value: number | null) => void }) {
  return (
    <label className="runtime-field">
      <span>{label}</span>
      <InputNumber min={0} value={value} onChange={onChange} />
      {help ? <small>{help}</small> : null}
    </label>
  );
}
