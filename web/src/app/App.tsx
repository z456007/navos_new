import { useEffect, useState } from "react";
import { ConfigProvider } from "antd";
import { ADMIN_KEY_STORAGE, apiRequest, errorMessage } from "../api";
import { navosTheme } from "../theme";
import { AuthGate } from "./AuthGate";
import { ConsoleShell } from "./ConsoleShell";
import { idleStatus } from "./defaults";
import type { AccountListItem, PanelId, StatusState } from "../types";

export function App() {
  const [apiKey, setApiKey] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [authStatus, setAuthStatus] = useState<StatusState>(idleStatus);
  const [activePanel, setActivePanel] = useState<PanelId>("accounts");

  async function loadAccounts(candidateKey = apiKey): Promise<AccountListItem[]> {
    const loaded = await apiRequest<AccountListItem[]>(candidateKey, "/api/accounts", { method: "GET" });
    setAccounts(Array.isArray(loaded) ? loaded : []);
    return Array.isArray(loaded) ? loaded : [];
  }

  async function verifyKey(candidateKey: string): Promise<void> {
    const trimmed = candidateKey.trim();
    if (!trimmed) {
      setAuthStatus({ kind: "error", message: "请输入 Master API Key" });
      return;
    }
    setAuthStatus({ kind: "loading", message: "验证中" });
    try {
      await loadAccounts(trimmed);
      localStorage.setItem(ADMIN_KEY_STORAGE, trimmed);
      setApiKey(trimmed);
      setIsAuthenticated(true);
      setAuthStatus({ kind: "ok", message: "已进入" });
    } catch (error) {
      localStorage.removeItem(ADMIN_KEY_STORAGE);
      setIsAuthenticated(false);
      setAuthStatus({ kind: "error", message: errorMessage(error) ?? "Master API Key 无效" });
    }
  }

  useEffect(() => {
    const savedKey = localStorage.getItem(ADMIN_KEY_STORAGE);
    if (savedKey) {
      setApiKey(savedKey);
      void verifyKey(savedKey);
    }
  }, []);

  function signOut() {
    localStorage.removeItem(ADMIN_KEY_STORAGE);
    setApiKey("");
    setAccounts([]);
    setIsAuthenticated(false);
    setAuthStatus(idleStatus);
  }

  return (
    <ConfigProvider theme={navosTheme}>
      {!isAuthenticated ? (
        <AuthGate
          initialKey={apiKey}
          status={authStatus}
          onVerify={verifyKey}
        />
      ) : (
        <ConsoleShell
          accounts={accounts}
          activePanel={activePanel}
          apiKey={apiKey}
          onPanelChange={setActivePanel}
          onRefreshAccounts={() => loadAccounts()}
          onAccountsChange={setAccounts}
          onSignOut={signOut}
        />
      )}
    </ConfigProvider>
  );
}
