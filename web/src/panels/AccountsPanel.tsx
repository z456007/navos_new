import { type FormEvent, useEffect, useRef, useState } from "react";
import { Ban, Play, Power, RefreshCw, Square, Timer, UserPlus } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { AccountBadge } from "../components/account-badge";
import { JsonBlock, StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import { formatTime, shortText } from "../lib/accounts";
import { nextPollingDelay } from "../lib/polling";
import { normalizeRegistrationJob, registrationJobIsTerminal } from "../lib/registration-job";
import type { AccountListItem, RegistrationJobView, StatusState } from "../types";

export function AccountsPanel({
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
  const [job, setJob] = useState<RegistrationJobView | undefined>();
  const [jobTarget, setJobTarget] = useState(10);
  const [jobConcurrency, setJobConcurrency] = useState(2);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollFailures = useRef(0);
  const mounted = useRef(false);
  const refreshedTerminalJobId = useRef<string | undefined>(undefined);
  const jobInteractionVersion = useRef(0);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const hydrationVersion = jobInteractionVersion.current;

    async function loadRecentJobs() {
      try {
        const response = await apiRequest<unknown>(apiKey, "/api/registration/jobs", { method: "GET" });
        if (!active || !mounted.current || hydrationVersion !== jobInteractionVersion.current) return;
        const recentJobs = Array.isArray(response) ? response.map(normalizeRegistrationJob) : [];
        const recentJob = recentJobs[0];
        if (!recentJob) return;
        setJob(recentJob);
        if (!registrationJobIsTerminal(recentJob)) {
          pollTimer.current = setTimeout(() => {
            void pollRegistrationJob(recentJob.id);
          }, nextPollingDelay(0));
        }
      } catch (error) {
        if (!active || !mounted.current) return;
        setStatus({ kind: "error", message: errorMessage(error) ?? "加载注册任务失败" });
      }
    }

    void loadRecentJobs();

    return () => {
      active = false;
      mounted.current = false;
      clearPolling();
    };
  }, [apiKey]);

  function markJobInteraction() {
    jobInteractionVersion.current += 1;
    return jobInteractionVersion.current;
  }

  function clearPolling() {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = undefined;
    }
  }

  function clampJobNumber(value: string, min: number, max: number) {
    const next = Number(value);
    if (!Number.isFinite(next)) return min;
    return Math.min(max, Math.max(min, Math.trunc(next)));
  }

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

  async function startRegistrationJob(mode: "single" | "fill") {
    const requestVersion = markJobInteraction();
    clearPolling();
    pollFailures.current = 0;
    refreshedTerminalJobId.current = undefined;
    setStatus({ kind: "loading", message: "创建注册任务中" });

    try {
      const response = await apiRequest<unknown>(apiKey, "/api/registration/jobs", {
        method: "POST",
        body: JSON.stringify(mode === "single"
          ? { mode: "single" }
          : { mode: "fill", target: jobTarget, concurrency: jobConcurrency })
      });
      const jobId = readJobId(response);
      if (!jobId) {
        throw new Error("注册任务没有返回 job id");
      }
      if (requestVersion !== jobInteractionVersion.current) return;
      setJob(normalizeRegistrationJob({
        id: jobId,
        mode,
        state: "queued",
        target: mode === "fill" ? jobTarget : undefined,
        concurrency: mode === "fill" ? jobConcurrency : undefined,
        progress: { started: 0, completed: 0, failed: 0, total: mode === "fill" ? jobTarget : 1 },
        logs: []
      }));
      await pollRegistrationJob(jobId);
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "创建注册任务失败" });
    }
  }

  async function pollRegistrationJob(jobId = job?.id) {
    if (!jobId) {
      setStatus({ kind: "error", message: "没有可查询的注册任务" });
      return;
    }

    const requestVersion = markJobInteraction();
    clearPolling();
    setStatus({ kind: "loading", message: "查询注册任务状态" });

    try {
      const response = await apiRequest<unknown>(apiKey, `/api/registration/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET"
      });
      if (!mounted.current || requestVersion !== jobInteractionVersion.current) return;
      const normalizedJob = normalizeRegistrationJob(response);
      const nextJob = { ...normalizedJob, id: normalizedJob.id || jobId };
      setJob(nextJob);
      pollFailures.current = 0;

      if (registrationJobIsTerminal(nextJob)) {
        setStatus({
          kind: nextJob.state === "succeeded" ? "ok" : "error",
          message: nextJob.state === "succeeded" ? "注册任务已完成" : nextJob.error ?? "注册任务已结束"
        });
        if (refreshedTerminalJobId.current !== nextJob.id) {
          refreshedTerminalJobId.current = nextJob.id;
          const loaded = await onRefresh();
          if (!mounted.current) return;
          onAccountsChange(loaded);
        }
        return;
      }

      setStatus({ kind: "loading", message: "注册任务运行中，稍后自动刷新" });
      pollTimer.current = setTimeout(() => {
        void pollRegistrationJob(jobId);
      }, nextPollingDelay(0));
    } catch (error) {
      if (!mounted.current || requestVersion !== jobInteractionVersion.current) return;
      const failureCount = pollFailures.current + 1;
      pollFailures.current = failureCount;
      setStatus({ kind: "error", message: errorMessage(error) ?? "查询注册任务失败" });
      pollTimer.current = setTimeout(() => {
        void pollRegistrationJob(jobId);
      }, nextPollingDelay(failureCount));
    }
  }

  async function cancelRegistrationJob() {
    if (!job?.id) return;
    const jobId = job.id;
    markJobInteraction();
    clearPolling();
    setStatus({ kind: "loading", message: "取消注册任务中" });
    try {
      await apiRequest<unknown>(apiKey, `/api/registration/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST"
      });
      await pollRegistrationJob(jobId);
    } catch (error) {
      if (!mounted.current) return;
      const failureCount = pollFailures.current + 1;
      pollFailures.current = failureCount;
      setStatus({ kind: "error", message: errorMessage(error) ?? "取消注册任务失败" });
      pollTimer.current = setTimeout(() => {
        void pollRegistrationJob(jobId);
      }, nextPollingDelay(failureCount));
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

      <div className="registration-ops" aria-label="注册任务">
        <div className="form-row two compact">
          <label className="text-field">
            <span>目标数量</span>
            <input
              max={500}
              min={1}
              type="number"
              value={jobTarget}
              onChange={(event) => setJobTarget(clampJobNumber(event.target.value, 1, 500))}
            />
          </label>
          <label className="text-field">
            <span>并发数</span>
            <input
              max={20}
              min={1}
              type="number"
              value={jobConcurrency}
              onChange={(event) => setJobConcurrency(clampJobNumber(event.target.value, 1, 20))}
            />
          </label>
        </div>
        <div className="toolbar flush">
          <button className="button primary" onClick={() => void startRegistrationJob("single")} type="button">
            <Play size={16} aria-hidden="true" />
            启动单个注册
          </button>
          <button className="button" onClick={() => void startRegistrationJob("fill")} type="button">
            <Play size={16} aria-hidden="true" />
            补齐账号池
          </button>
          {job && !registrationJobIsTerminal(job) && (
            <button className="button ghost" onClick={() => void cancelRegistrationJob()} type="button">
              <Square size={16} aria-hidden="true" />
              取消任务
            </button>
          )}
        </div>

        {job ? (
          <>
            <div className="job-strip">
              <div>
                <span>Job ID</span>
                <strong className="mono">{job.id || "-"}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong className={`task-status ${job.state}`}>{job.state}</strong>
              </div>
              <div>
                <span>进度</span>
                <strong>{job.progress.completed}/{job.progress.total}</strong>
              </div>
              <div>
                <span>失败</span>
                <strong>{job.progress.failed}</strong>
              </div>
            </div>
            <ol className="event-list" aria-label="注册任务日志">
              {job.logs.length === 0
                ? <li>暂无注册任务日志</li>
                : job.logs.slice(-6).map((item, index) => (
                  <li key={`${item.at}-${index}`}>
                    <span className={`task-status ${item.level === "error" ? "failed" : item.level === "warn" ? "running" : "succeeded"}`}>
                      {item.level}
                    </span>{" "}
                    {formatTime(item.at)} {item.message}
                  </li>
                ))}
            </ol>
            {job.results !== undefined && (
              <div className="job-result">
                <JsonBlock value={job.results} />
              </div>
            )}
          </>
        ) : (
          <p className="status">暂无注册任务</p>
        )}
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

function readJobId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.jobId === "string" ? record.jobId : typeof record.id === "string" ? record.id : undefined;
}
