import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Ban,
  Clapperboard,
  ExternalLink,
  Film,
  Inbox,
  KeyRound,
  LogOut,
  Mail,
  MessageSquare,
  Power,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Timer,
  UserPlus
} from "lucide-react";
import { ADMIN_KEY_STORAGE, apiRequest, errorMessage } from "./api";
import type { AccountListItem, Mailbox, PanelId, StatusState, VideoTaskStatus, VideoTaskView } from "./types";

const initialMessagesPayload = `{
  "model": "claude.sonnet-4.6",
  "max_tokens": 32,
  "messages": [
    { "role": "user", "content": "只回复 OK，不要解释" }
  ]
}`;

const initialChatPayload = `{
  "model": "openai.gpt-5.5",
  "max_completion_tokens": 32,
  "messages": [
    { "role": "user", "content": "只回复 OK，不要解释" }
  ]
}`;

const defaultVideoPrompt = "原创极简动画短片：一只小型白色机器人在干净的浅灰色桌面上挥手，柔和自然光，镜头稳定，画面清晰，无文字，无水印，无对白。";

const idleStatus: StatusState = { kind: "idle", message: "" };

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

  if (!isAuthenticated) {
    return (
      <AuthGate
        initialKey={apiKey}
        status={authStatus}
        onVerify={verifyKey}
      />
    );
  }

  return (
    <ConsoleShell
      accounts={accounts}
      activePanel={activePanel}
      apiKey={apiKey}
      onPanelChange={setActivePanel}
      onRefreshAccounts={() => loadAccounts()}
      onAccountsChange={setAccounts}
      onSignOut={signOut}
    />
  );
}

function AuthGate({
  initialKey,
  status,
  onVerify
}: {
  initialKey: string;
  status: StatusState;
  onVerify: (apiKey: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialKey);

  useEffect(() => {
    setValue(initialKey);
  }, [initialKey]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void onVerify(value);
  }

  return (
    <main className="gate">
      <section className="gate-panel" aria-labelledby="gate-title">
        <div className="brand-lock">
          <span className="brand-mark"><ShieldCheck size={21} aria-hidden="true" /></span>
          <span>Navos</span>
        </div>
        <h1 id="gate-title">进入 Navos 控制台</h1>
        <form className="gate-form" onSubmit={submit}>
          <label>
            <span>Master API Key</span>
            <input
              autoComplete="off"
              autoFocus
              onChange={(event) => setValue(event.target.value)}
              type="password"
              value={value}
            />
          </label>
          <button className="button primary" disabled={status.kind === "loading"} type="submit">
            <KeyRound size={16} aria-hidden="true" />
            进入控制台
          </button>
          <StatusLine status={status} />
        </form>
      </section>
    </main>
  );
}

function ConsoleShell({
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
          <NavButton active={activePanel === "mail"} icon={<Mail size={17} />} onClick={() => onPanelChange("mail")}>
            YYDS 邮箱
          </NavButton>
          <NavButton active={activePanel === "video"} icon={<Clapperboard size={17} />} onClick={() => onPanelChange("video")}>
            视频生成
          </NavButton>
          <NavButton active={activePanel === "probe"} icon={<MessageSquare size={17} />} onClick={() => onPanelChange("probe")}>
            代理测试
          </NavButton>
        </nav>
        <button className="button ghost sidebar-exit" onClick={onSignOut} type="button">
          <LogOut size={16} aria-hidden="true" />
          退出
        </button>
      </aside>

      <main className="workspace">
        <header className="workspace-head">
          <div>
            <p className="eyebrow">Navos 控制台</p>
            <h1>{panelTitle(activePanel)}</h1>
          </div>
          <button className="button" onClick={() => void onRefreshAccounts()} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            刷新账号
          </button>
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
        {activePanel === "mail" && <MailPanel apiKey={apiKey} />}
        {activePanel === "video" && <VideoPanel apiKey={apiKey} />}
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

function AccountsPanel({
  accounts,
  apiKey,
  onAccountsChange,
  onRefresh
}: {
  accounts: AccountListItem[];
  apiKey: string;
  onAccountsChange: (accounts: AccountListItem[]) => void;
  onRefresh: () => Promise<AccountListItem[]>;
}) {
  const [form, setForm] = useState({ uid: "", token: "", mailboxAddr: "", mailboxToken: "" });
  const [status, setStatus] = useState<StatusState>(idleStatus);

  async function importAccount(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "loading", message: "导入中" });
    try {
      await apiRequest<AccountListItem>(apiKey, "/api/accounts/import", {
        method: "POST",
        body: JSON.stringify({
          uid: form.uid,
          token: form.token,
          mailboxAddr: form.mailboxAddr || undefined,
          mailboxToken: form.mailboxToken || undefined
        })
      });
      setForm((current) => ({ ...current, token: "" }));
      const loaded = await onRefresh();
      onAccountsChange(loaded);
      setStatus({ kind: "ok", message: "已导入" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "导入失败" });
    }
  }

  async function updateAccount(uid: string, action: "enable" | "disable" | "cooldown") {
    setStatus({ kind: "loading", message: "处理中" });
    try {
      await apiRequest<AccountListItem>(apiKey, `/api/accounts/${encodeURIComponent(uid)}/${action}`, {
        method: "POST",
        body: action === "cooldown" ? JSON.stringify({ seconds: 600 }) : undefined
      });
      const loaded = await onRefresh();
      onAccountsChange(loaded);
      setStatus({ kind: "ok", message: "已更新" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "更新失败" });
    }
  }

  return (
    <section className="panel" aria-labelledby="accounts-title">
      <div className="panel-head">
        <div>
          <h2 id="accounts-title">账号池</h2>
          <StatusLine status={status} />
        </div>
        <button className="button" onClick={() => void onRefresh()} type="button">
          <RefreshCw size={16} aria-hidden="true" />
          刷新
        </button>
      </div>

      <form className="import-grid" onSubmit={importAccount}>
        <TextField label="UID" value={form.uid} onChange={(uid) => setForm((current) => ({ ...current, uid }))} />
        <TextField label="Token" type="password" value={form.token} onChange={(token) => setForm((current) => ({ ...current, token }))} />
        <TextField label="邮箱" value={form.mailboxAddr} onChange={(mailboxAddr) => setForm((current) => ({ ...current, mailboxAddr }))} />
        <TextField label="邮箱 Token" value={form.mailboxToken} onChange={(mailboxToken) => setForm((current) => ({ ...current, mailboxToken }))} />
        <button className="button primary import-action" type="submit">
          <UserPlus size={16} aria-hidden="true" />
          导入账号
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>Token</th>
              <th>邮箱</th>
              <th>状态</th>
              <th>最后使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td className="empty" colSpan={6}>暂无账号</td></tr>
            ) : accounts.map((account) => (
              <tr key={account.uid}>
                <td className="mono" title={account.uid}>{shortText(account.uid, 22)}</td>
                <td className="mono">{account.tokenPreview}</td>
                <td>{shortText(account.mailboxAddr, 24)}</td>
                <td><AccountBadge account={account} /></td>
                <td>{formatTime(account.lastUsedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-button" onClick={() => void updateAccount(account.uid, "enable")} title="启用" type="button">
                      <Power size={15} aria-hidden="true" />
                    </button>
                    <button className="icon-button" onClick={() => void updateAccount(account.uid, "disable")} title="停用" type="button">
                      <Ban size={15} aria-hidden="true" />
                    </button>
                    <button className="icon-button" onClick={() => void updateAccount(account.uid, "cooldown")} title="冷却" type="button">
                      <Timer size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MailPanel({ apiKey }: { apiKey: string }) {
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);
  const [result, setResult] = useState<unknown>("等待操作");

  async function createMailbox() {
    setStatus({ kind: "loading", message: "创建中" });
    try {
      const mailbox = await apiRequest<Mailbox>(apiKey, "/api/mail/yyds/accounts", { method: "POST" });
      setAddress(mailbox.address ?? "");
      setToken(mailbox.token ?? "");
      setResult(mailbox);
      setStatus({ kind: "ok", message: "已创建" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "创建失败" });
    }
  }

  async function listMessages() {
    setStatus({ kind: "loading", message: "查询中" });
    try {
      const query = `/api/mail/yyds/messages?address=${encodeURIComponent(address)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
      const messages = await apiRequest<unknown>(apiKey, query);
      setResult(messages);
      setStatus({ kind: "ok", message: "已查询" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "查询失败" });
    }
  }

  async function findCode() {
    setStatus({ kind: "loading", message: "提取中" });
    try {
      const code = await apiRequest<unknown>(apiKey, "/api/mail/yyds/verification-code", {
        method: "POST",
        body: JSON.stringify({ address, token: token || undefined })
      });
      setResult(code);
      setStatus({ kind: "ok", message: "已提取" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "提取失败" });
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="mail-title">
      <div className="panel-head">
        <div>
          <h2 id="mail-title">YYDS 邮箱</h2>
          <StatusLine status={status} />
        </div>
        <button className="button primary" onClick={() => void createMailbox()} type="button">
          <Mail size={16} aria-hidden="true" />
          创建邮箱
        </button>
      </div>
      <div className="form-row two">
        <TextField label="邮箱地址" value={address} onChange={setAddress} />
        <TextField label="邮箱 Token" value={token} onChange={setToken} />
      </div>
      <div className="toolbar">
        <button className="button" onClick={() => void listMessages()} type="button">
          <Search size={16} aria-hidden="true" />
          查邮件
        </button>
        <button className="button" onClick={() => void findCode()} type="button">
          <KeyRound size={16} aria-hidden="true" />
          取验证码
        </button>
      </div>
      <JsonBlock value={result} />
    </section>
  );
}

function VideoPanel({ apiKey }: { apiKey: string }) {
  const [form, setForm] = useState({
    model: "navos/doubao-seedance-2-0-260128",
    prompt: defaultVideoPrompt,
    resolution: "720P",
    aspectRatio: "1:1",
    durationSeconds: 5,
    audio: false
  });
  const [status, setStatus] = useState<StatusState>(idleStatus);
  const [task, setTask] = useState<VideoTaskView | undefined>();
  const [result, setResult] = useState<unknown>("等待创建任务");
  const [events, setEvents] = useState<string[]>([]);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearPolling(), []);

  function clearPolling() {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = undefined;
    }
  }

  function addEvent(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    setEvents((current) => [`${timestamp} ${message}`, ...current].slice(0, 8));
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    clearPolling();
    const prompt = form.prompt.trim();
    if (!prompt) {
      setStatus({ kind: "error", message: "提示词不能为空" });
      return;
    }

    setStatus({ kind: "loading", message: "创建任务中" });
    setTask(undefined);
    setResult("创建任务中");
    setEvents([]);

    try {
      const response = await apiRequest<unknown>(apiKey, "/api/video/generations", {
        method: "POST",
        body: JSON.stringify({
          model: form.model,
          prompt,
          resolution: form.resolution,
          aspectRatio: form.aspectRatio,
          durationSeconds: form.durationSeconds,
          audio: form.audio,
          timeoutMs: 600000
        })
      });
      setResult(response);
      const taskId = readVideoString(response, ["task_id", "taskId", "id"]);
      if (!taskId) {
        throw new Error("上游没有返回 task id");
      }
      const createdTask = normalizeVideoTask(response, taskId);
      setTask(createdTask);
      addEvent(`任务已创建 ${taskId}`);
      setStatus({ kind: "loading", message: "已创建，正在查询状态" });
      await pollTask(taskId);
    } catch (error) {
      const message = errorMessage(error) ?? "创建任务失败";
      setStatus({ kind: "error", message });
      setResult(message);
      addEvent(message);
    }
  }

  async function pollTask(taskId = task?.id) {
    if (!taskId) {
      setStatus({ kind: "error", message: "没有可查询的 task id" });
      return;
    }
    clearPolling();
    setStatus({ kind: "loading", message: "查询任务状态" });

    try {
      const response = await apiRequest<unknown>(apiKey, `/api/video/generations/${encodeURIComponent(taskId)}`, {
        method: "GET"
      });
      const nextTask = normalizeVideoTask(response, taskId);
      setTask(nextTask);
      setResult(response);
      addEvent(`状态 ${nextTask.status}`);

      if (nextTask.status === "succeeded") {
        setStatus({ kind: "ok", message: "视频已生成" });
        return;
      }
      if (nextTask.status === "failed") {
        setStatus({ kind: "error", message: nextTask.error ?? "视频生成失败" });
        return;
      }

      setStatus({ kind: "loading", message: "生成中，稍后自动刷新" });
      pollTimer.current = setTimeout(() => {
        void pollTask(taskId);
      }, 6000);
    } catch (error) {
      const message = errorMessage(error) ?? "查询任务失败";
      setStatus({ kind: "error", message });
      addEvent(message);
    }
  }

  return (
    <section className="panel video-panel" aria-labelledby="video-title">
      <div className="panel-head">
        <div>
          <h2 id="video-title">视频生成</h2>
          <StatusLine status={status} />
        </div>
        <button className="button" disabled={!task?.id || status.kind === "loading"} onClick={() => void pollTask()} type="button">
          <RefreshCw size={16} aria-hidden="true" />
          查询状态
        </button>
      </div>

      <div className="video-grid">
        <form className="video-form" onSubmit={createTask}>
          <TextField label="模型" value={form.model} onChange={(model) => setForm((current) => ({ ...current, model }))} />
          <div className="form-row three compact">
            <SelectField
              label="分辨率"
              value={form.resolution}
              options={["720P", "480P"]}
              onChange={(resolution) => setForm((current) => ({ ...current, resolution }))}
            />
            <SelectField
              label="比例"
              value={form.aspectRatio}
              options={["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "adaptive"]}
              onChange={(aspectRatio) => setForm((current) => ({ ...current, aspectRatio }))}
            />
            <label className="text-field">
              <span>时长</span>
              <input
                max={15}
                min={4}
                type="number"
                value={form.durationSeconds}
                onChange={(event) => setForm((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}
              />
            </label>
          </div>
          <label className="inline-check">
            <input
              checked={form.audio}
              type="checkbox"
              onChange={(event) => setForm((current) => ({ ...current, audio: event.target.checked }))}
            />
            <span>生成音频</span>
          </label>
          <label className="textarea-field video-prompt">
            <span>提示词</span>
            <textarea value={form.prompt} onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))} />
          </label>
          <div className="toolbar flush">
            <button className="button primary" disabled={status.kind === "loading"} type="submit">
              <Clapperboard size={16} aria-hidden="true" />
              创建视频任务
            </button>
          </div>
        </form>

        <div className="video-output">
          <div className="task-strip">
            <div>
              <span>Task ID</span>
              <strong className="mono">{task?.id ?? "-"}</strong>
            </div>
            <div>
              <span>状态</span>
              <strong className={`task-status ${task?.status ?? "unknown"}`}>{task?.status ?? "idle"}</strong>
            </div>
          </div>

          <div className="preview-frame">
            {task?.videoUrl ? (
              <video controls src={task.videoUrl} title="生成视频" />
            ) : (
              <div className="video-empty">
                <Film size={30} aria-hidden="true" />
                <span>等待生成结果</span>
              </div>
            )}
          </div>

          <div className="toolbar flush">
            {task?.videoUrl && (
              <a className="button" href={task.videoUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={16} aria-hidden="true" />
                打开视频
              </a>
            )}
          </div>

          <ol className="event-list" aria-label="视频任务日志">
            {events.length === 0 ? <li>暂无任务日志</li> : events.map((item) => <li key={item}>{item}</li>)}
          </ol>

          <JsonBlock value={result} />
        </div>
      </div>
    </section>
  );
}

function ProbePanel({
  apiKey,
  onAfterProbe
}: {
  apiKey: string;
  onAfterProbe: () => Promise<AccountListItem[]>;
}) {
  const [messagesPayload, setMessagesPayload] = useState(initialMessagesPayload);
  const [chatPayload, setChatPayload] = useState(initialChatPayload);
  const [status, setStatus] = useState<StatusState>(idleStatus);
  const [result, setResult] = useState<unknown>("等待操作");

  async function runProbe(path: "/v1/messages" | "/v1/chat/completions", payloadText: string) {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setStatus({ kind: "error", message: "JSON 格式错误" });
      return;
    }

    setStatus({ kind: "loading", message: "请求中" });
    try {
      const response = await apiRequest<unknown>(apiKey, path, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setResult(response);
      setStatus({ kind: "ok", message: "请求成功" });
      await onAfterProbe();
    } catch (error) {
      setResult(errorMessage(error) ?? "请求失败");
      setStatus({ kind: "error", message: errorMessage(error) ?? "请求失败" });
    }
  }

  return (
    <section className="panel" aria-labelledby="probe-title">
      <div className="panel-head">
        <div>
          <h2 id="probe-title">代理测试</h2>
          <StatusLine status={status} />
        </div>
      </div>
      <div className="probe-grid">
        <label className="textarea-field">
          <span>/v1/messages payload</span>
          <textarea value={messagesPayload} onChange={(event) => setMessagesPayload(event.target.value)} />
        </label>
        <label className="textarea-field">
          <span>/v1/chat/completions payload</span>
          <textarea value={chatPayload} onChange={(event) => setChatPayload(event.target.value)} />
        </label>
      </div>
      <div className="toolbar">
        <button className="button primary" onClick={() => void runProbe("/v1/messages", messagesPayload)} type="button">
          <Send size={16} aria-hidden="true" />
          测试 messages
        </button>
        <button className="button" onClick={() => void runProbe("/v1/chat/completions", chatPayload)} type="button">
          <MessageSquare size={16} aria-hidden="true" />
          测试 chat
        </button>
      </div>
      <JsonBlock value={result} />
    </section>
  );
}

function NavButton({
  active,
  children,
  icon,
  onClick
}: {
  active: boolean;
  children: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button${active ? " active" : ""}`} onClick={onClick} type="button">
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "ok" | "wait" | "bad" }) {
  return (
    <div className={`metric${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TextField({
  label,
  onChange,
  type = "text",
  value
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="text-field">
      <span>{label}</span>
      <input autoComplete="off" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="text-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function StatusLine({ status }: { status: StatusState }) {
  if (!status.message) {
    return null;
  }
  return <p className={`status ${status.kind}`}>{status.message}</p>;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="json-block">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readVideoString(value: unknown, keys: string[]): string | undefined {
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }
    for (const key of keys) {
      const item = current[key];
      if ((typeof item === "string" || typeof item === "number") && String(item).length > 0) {
        return String(item);
      }
    }
    for (const item of Object.values(current)) {
      if (isRecord(item) || Array.isArray(item)) {
        queue.push(item);
      }
    }
  }
  return undefined;
}

function mapVideoStatus(status: string | undefined): VideoTaskStatus {
  const normalized = status?.toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (["queued", "pending", "created"].includes(normalized)) {
    return "queued";
  }
  if (["deducted", "running", "processing", "generating", "in_progress"].includes(normalized)) {
    return "running";
  }
  if (["success", "succeeded", "completed", "done"].includes(normalized)) {
    return "succeeded";
  }
  if (["fail", "failed", "error", "canceled", "cancelled"].includes(normalized)) {
    return "failed";
  }
  return "unknown";
}

function normalizeVideoTask(raw: unknown, fallbackId?: string): VideoTaskView {
  const status = mapVideoStatus(readVideoString(raw, ["status", "state"]));
  return {
    id: readVideoString(raw, ["id", "task_id", "taskId"]) ?? fallbackId,
    status,
    videoUrl: readVideoString(raw, ["videoUrl", "video_url", "url", "output_url"]),
    error: status === "failed" ? readVideoString(raw, ["error", "error_message", "message"]) : undefined,
    raw
  };
}

function AccountBadge({ account }: { account: AccountListItem }) {
  const cooling = account.status === "active" && account.rateLimitedUntil > Date.now();
  const label = cooling ? "cooldown" : account.status;
  const tone = cooling ? "wait" : account.status;
  return <span className={`badge ${tone}`}>{label}</span>;
}

function accountMetrics(accounts: AccountListItem[]) {
  const now = Date.now();
  return {
    total: accounts.length,
    active: accounts.filter((account) => account.status === "active" && account.rateLimitedUntil <= now).length,
    cooldown: accounts.filter((account) => account.status === "active" && account.rateLimitedUntil > now).length,
    blocked: accounts.filter((account) => account.status !== "active").length
  };
}

function panelTitle(panel: PanelId): string {
  if (panel === "mail") {
    return "YYDS 邮箱";
  }
  if (panel === "video") {
    return "视频生成";
  }
  if (panel === "probe") {
    return "代理测试";
  }
  return "账号池";
}

function formatTime(value: number): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function shortText(value: string | undefined, max: number): string {
  if (!value) {
    return "-";
  }
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
