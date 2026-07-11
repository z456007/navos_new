import { useEffect, useState } from "react";
import { Button as AntButton, Input, Table, Tag, type TableColumnsType } from "antd";
import { RefreshCw, Save } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { idleStatus } from "../app/defaults";
import { StatusLine } from "../components/feedback";
import type { StatusState } from "../types";

type YydsDomainPoolMode = "auto" | "whitelist" | "auto-plus-whitelist";

interface YydsDomainPoolConfigView {
  enabled?: boolean;
  mode?: YydsDomainPoolMode;
  whitelist?: string[];
  blacklist?: string[];
  refreshIntervalMinutes?: number;
}

interface YydsDomainCandidateView {
  domain: string;
  status: string;
  weight: number;
  successCount: number;
  failureCount: number;
}

interface YydsDomainPoolResponse {
  config?: YydsDomainPoolConfigView;
  domains?: YydsDomainCandidateView[];
}

const domainColumns: TableColumnsType<YydsDomainCandidateView> = [
  {
    title: "域名",
    dataIndex: "domain",
    render: (domain: string) => <span className="mono">{domain}</span>
  },
  {
    title: "状态",
    dataIndex: "status",
    render: (status: string) => <Tag color={statusColor(status)}>{statusLabel(status)}</Tag>
  },
  {
    title: "权重",
    dataIndex: "weight"
  },
  {
    title: "成功",
    dataIndex: "successCount"
  },
  {
    title: "失败",
    dataIndex: "failureCount"
  }
];

export function YydsDomainPoolPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<YydsDomainPoolConfigView | undefined>();
  const [domains, setDomains] = useState<YydsDomainCandidateView[]>([]);
  const [whitelistText, setWhitelistText] = useState("");
  const [blacklistText, setBlacklistText] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    void loadDomainPool(() => active);
    return () => {
      active = false;
    };
  }, [apiKey]);

  async function loadDomainPool(isActive = () => true) {
    setStatus({ kind: "loading", message: "正在加载域名池" });
    try {
      const loaded = await apiRequest<YydsDomainPoolResponse>(apiKey, "/api/mail/yyds/domains", { method: "GET" });
      if (!isActive()) return;
      applyDomainPoolResponse(loaded);
      setStatus({ kind: "idle", message: "" });
    } catch (error) {
      if (isActive()) {
        setStatus({ kind: "error", message: errorMessage(error) ?? "加载域名池失败" });
      }
    }
  }

  function applyDomainPoolResponse(loaded: YydsDomainPoolResponse) {
    const nextConfig = loaded.config ?? {};
    setConfig(nextConfig);
    setWhitelistText((nextConfig.whitelist ?? []).join("\n"));
    setBlacklistText((nextConfig.blacklist ?? []).join("\n"));
    setDomains(Array.isArray(loaded.domains) ? loaded.domains : []);
  }

  async function saveConfig() {
    setStatus({ kind: "loading", message: "正在保存域名池配置" });
    try {
      const saved = await apiRequest<YydsDomainPoolConfigView>(apiKey, "/api/mail/yyds/domain-pool/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled: config?.enabled ?? true,
          mode: config?.mode ?? "auto-plus-whitelist",
          refreshIntervalMinutes: config?.refreshIntervalMinutes ?? 30,
          whitelist: parseDomainList(whitelistText),
          blacklist: parseDomainList(blacklistText)
        })
      });
      setConfig(saved);
      setWhitelistText((saved.whitelist ?? []).join("\n"));
      setBlacklistText((saved.blacklist ?? []).join("\n"));
      setStatus({ kind: "ok", message: "域名池配置已保存" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "保存域名池配置失败" });
    }
  }

  async function refreshDomains() {
    setStatus({ kind: "loading", message: "正在刷新 YYDS 域名" });
    try {
      await apiRequest<unknown>(apiKey, "/api/mail/yyds/domains/refresh", { method: "POST" });
      await loadDomainPool();
      setStatus({ kind: "ok", message: "YYDS 域名已刷新" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "刷新 YYDS 域名失败" });
    }
  }

  return (
    <section className="domain-pool-panel" aria-labelledby="yyds-domain-pool-title">
      <div className="panel-head inner-head">
        <div>
          <p className="eyebrow">收码域名策略</p>
          <h3 id="yyds-domain-pool-title">YYDS 域名池</h3>
          <p className="panel-subtitle">白名单用于提高注册稳定性，黑名单用于绕开被上游拒收的域名。</p>
          <StatusLine status={status} />
        </div>
        <div className="toolbar flush">
          <AntButton icon={<RefreshCw size={16} />} onClick={() => void refreshDomains()}>
            刷新域名
          </AntButton>
          <AntButton icon={<Save size={16} />} type="primary" onClick={() => void saveConfig()}>
            保存域名池配置
          </AntButton>
        </div>
      </div>

      <div className="form-row two compact domain-list-grid">
        <label className="text-field ant-field">
          <span>白名单域名</span>
          <Input.TextArea
            aria-label="白名单域名"
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="example.com"
            value={whitelistText}
            onChange={(event) => setWhitelistText(event.target.value)}
          />
        </label>
        <label className="text-field ant-field">
          <span>黑名单域名</span>
          <Input.TextArea
            aria-label="黑名单域名"
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="blocked.example.com"
            value={blacklistText}
            onChange={(event) => setBlacklistText(event.target.value)}
          />
        </label>
      </div>

      <Table<YydsDomainCandidateView>
        className="domain-table"
        columns={domainColumns}
        dataSource={domains}
        locale={{ emptyText: "暂无域名，点击“刷新域名”拉取候选池" }}
        pagination={false}
        rowKey="domain"
        scroll={{ x: 700 }}
        size="small"
      />
    </section>
  );
}

function parseDomainList(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

function statusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "active") return "可用";
  if (normalized === "cooldown") return "冷却";
  if (normalized === "blocked" || normalized === "disabled") return "停用";
  return status || "未知";
}

function statusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "active") return "green";
  if (normalized === "cooldown") return "gold";
  if (normalized === "blocked" || normalized === "disabled") return "red";
  return "default";
}
