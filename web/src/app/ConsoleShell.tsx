import { useMemo } from "react";
import { Button as AntButton } from "antd";
import {
  Activity,
  Clapperboard,
  Cloud,
  Inbox,
  KeyRound,
  LogOut,
  MessageSquare,
  RefreshCw
} from "lucide-react";
import { Metric } from "../components/metric";
import { NavButton } from "../components/nav-button";
import { accountMetrics, panelTitle } from "../lib/accounts";
import { AccountsPanel } from "../panels/AccountsPanel";
import { CosConfigPanel } from "../panels/CosConfigPanel";
import { ProbePanel } from "../panels/ProbePanel";
import { VideoPanel } from "../panels/VideoPanel";
import { YydsMailConfigPanel } from "../panels/YydsMailConfigPanel";
import type { AccountListItem, PanelId } from "../types";

export function ConsoleShell({
  accounts,
  activePanel,
  apiKey,
  onPanelChange,
  onRefreshAccounts,
  onAccountsChange,
  onSignOut
}: {
  accounts: AccountListItem[];
  activePanel: PanelId;
  apiKey: string;
  onPanelChange: (panel: PanelId) => void;
  onRefreshAccounts: () => Promise<AccountListItem[]>;
  onAccountsChange: (accounts: AccountListItem[]) => void;
  onSignOut: () => void;
}) {
  const metrics = useMemo(() => accountMetrics(accounts), [accounts]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark"><Activity size={20} aria-hidden="true" /></span>
          <div>
            <strong>Navos</strong>
            <span>protocol desk</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="管理面板">
          <NavButton active={activePanel === "accounts"} icon={<Inbox size={17} />} onClick={() => onPanelChange("accounts")}>
            账号池
          </NavButton>
          <NavButton active={activePanel === "yydsConfig"} icon={<KeyRound size={17} />} onClick={() => onPanelChange("yydsConfig")}>
            YYDS配置
          </NavButton>
          <NavButton active={activePanel === "video"} icon={<Clapperboard size={17} />} onClick={() => onPanelChange("video")}>
            视频生成
          </NavButton>
          <NavButton active={activePanel === "cos"} icon={<Cloud size={17} />} onClick={() => onPanelChange("cos")}>
            COS配置
          </NavButton>
          <NavButton active={activePanel === "probe"} icon={<MessageSquare size={17} />} onClick={() => onPanelChange("probe")}>
            代理测试
          </NavButton>
        </nav>
        <AntButton className="sidebar-exit" icon={<LogOut size={16} />} onClick={onSignOut}>
          退出
        </AntButton>
      </aside>

      <main className="workspace">
        <header className="workspace-head">
          <div>
            <p className="eyebrow">Navos 控制台</p>
            <h1>{panelTitle(activePanel)}</h1>
          </div>
          <AntButton icon={<RefreshCw size={16} />} onClick={() => void onRefreshAccounts()}>
            刷新账号
          </AntButton>
        </header>

        <section className="metrics" aria-label="账号概览">
          <Metric label="总账号" value={metrics.total} />
          <Metric label="可用" value={metrics.active} tone="ok" />
          <Metric label="冷却" value={metrics.cooldown} tone="wait" />
          <Metric label="停用/耗尽" value={metrics.blocked} tone="bad" />
        </section>

        {activePanel === "accounts" && (
          <AccountsPanel
            accounts={accounts}
            apiKey={apiKey}
            onAccountsChange={onAccountsChange}
            onRefresh={onRefreshAccounts}
          />
        )}
        {activePanel === "yydsConfig" && <YydsMailConfigPanel apiKey={apiKey} />}
        {activePanel === "video" && <VideoPanel apiKey={apiKey} />}
        {activePanel === "cos" && <CosConfigPanel apiKey={apiKey} />}
        {activePanel === "probe" && (
          <ProbePanel
            apiKey={apiKey}
            onAfterProbe={onRefreshAccounts}
          />
        )}
      </main>
    </div>
  );
}
