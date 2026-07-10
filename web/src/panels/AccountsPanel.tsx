import { useEffect, useRef, useState } from "react";
import { Button as AntButton, InputNumber, Table, type TableColumnsType } from "antd";
import { Ban, Play, Power, RefreshCw, Square, Timer } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { AccountBadge } from "../components/account-badge";
import { JsonBlock, StatusLine } from "../components/feedback";
import { idleStatus } from "../app/defaults";
import { formatTime, shortText } from "../lib/accounts";
import { nextPollingDelay } from "../lib/polling";
import { normalizeRegistrationJob, registrationJobIsTerminal } from "../lib/registration-job";
import type { AccountListItem, RegistrationJobMode, RegistrationJobView, StatusState } from "../types";

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
  const [status, setStatus] = useState<StatusState>(idleStatus);
  const [job, setJob] = useState<RegistrationJobView | undefined>();
  const [fillTarget, setFillTarget] = useState(100);
  const [createCount, setCreateCount] = useState(10);
  const [jobConcurrency, setJobConcurrency] = useState(6);
  const [refreshingBalanceUid, setRefreshingBalanceUid] = useState<string | undefined>();
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
        const recentJob = recentJobs.find((item) => !registrationJobIsTerminal(item));
        if (!recentJob) return;
        setJob(recentJob);
        if (!registrationJobIsTerminal(recentJob)) {
          pollTimer.current = setTimeout(() => {
            void pollRegistrationJob(recentJob.id);
          }, nextPollingDelay(0));
        }
      } catch (error) {
        if (!active || !mounted.current || hydrationVersion !== jobInteractionVersion.current) return;
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

  function clampJobNumber(value: number | null, min: number, max: number) {
    const next = Number(value);
    if (!Number.isFinite(next)) return min;
    return Math.min(max, Math.max(min, Math.trunc(next)));
  }

  async function startRegistrationJob(mode: RegistrationJobMode) {
    const requestVersion = markJobInteraction();
    clearPolling();
    pollFailures.current = 0;
    refreshedTerminalJobId.current = undefined;
    setStatus({ kind: "loading", message: "创建注册任务中" });
    const payload = mode === "fill"
      ? { mode: "fill" as const, target: fillTarget, concurrency: jobConcurrency }
      : mode === "create"
        ? { mode: "create" as const, count: createCount, concurrency: jobConcurrency }
        : { mode: "single" as const };
    const total = mode === "fill" ? fillTarget : mode === "create" ? createCount : 1;

    try {
      const response = await apiRequest<unknown>(apiKey, "/api/registration/jobs", {
        method: "POST",
        body: JSON.stringify(payload)
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
        target: mode === "fill" ? fillTarget : undefined,
        count: mode === "create" ? createCount : undefined,
        concurrency: mode === "single" ? undefined : jobConcurrency,
        progress: { started: 0, completed: 0, failed: 0, total },
        logs: []
      }));
      await pollRegistrationJob(jobId);
    } catch (error) {
      if (!mounted.current || requestVersion !== jobInteractionVersion.current) return;
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
    const requestVersion = markJobInteraction();
    clearPolling();
    setStatus({ kind: "loading", message: "取消注册任务中" });
    try {
      await apiRequest<unknown>(apiKey, `/api/registration/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST"
      });
      if (!mounted.current || requestVersion !== jobInteractionVersion.current) return;
      await pollRegistrationJob(jobId);
    } catch (error) {
      if (!mounted.current || requestVersion !== jobInteractionVersion.current) return;
      const failureCount = pollFailures.current + 1;
      pollFailures.current = failureCount;
      setStatus({ kind: "error", message: errorMessage(error) ?? "取消注册任务失败" });
      pollTimer.current = setTimeout(() => {
        void pollRegistrationJob(jobId);
      }, nextPollingDelay(failureCount));
    }
  }

  function closeRegistrationJobResult() {
    markJobInteraction();
    clearPolling();
    pollFailures.current = 0;
    refreshedTerminalJobId.current = undefined;
    setJob(undefined);
    setStatus(idleStatus);
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

  async function refreshAccountBalance(uid: string) {
    setRefreshingBalanceUid(uid);
    setStatus({ kind: "loading", message: "刷新余额中" });
    try {
      const refreshed = await apiRequest<AccountListItem>(
        apiKey,
        `/api/accounts/${encodeURIComponent(uid)}/balance/refresh`,
        { method: "POST" }
      );
      onAccountsChange(accounts.map((account) => account.uid === uid ? refreshed : account));
      setStatus({ kind: "ok", message: "余额已刷新" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "刷新余额失败" });
    } finally {
      setRefreshingBalanceUid((current) => current === uid ? undefined : current);
    }
  }

  const accountColumns: TableColumnsType<AccountListItem> = [
    {
      title: "UID",
      dataIndex: "uid",
      render: (uid: string) => <span className="mono" title={uid}>{shortText(uid, 22)}</span>
    },
    {
      title: "Token",
      dataIndex: "tokenPreview",
      render: (tokenPreview: string) => <span className="mono">{tokenPreview}</span>
    },
    {
      title: "邮箱",
      dataIndex: "mailboxAddr",
      render: (mailboxAddr?: string) => shortText(mailboxAddr, 24)
    },
    {
      title: "剩余额度",
      key: "balance",
      render: (_, account) => <span className="mono">{account.balanceRemaining} / {account.balanceTotal}</span>
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (_, account) => <AccountBadge account={account} />
    },
    {
      title: "最后使用",
      dataIndex: "lastUsedAt",
      render: (lastUsedAt: number) => formatTime(lastUsedAt)
    },
    {
      title: "操作",
      key: "actions",
      render: (_, account) => (
        <div className="row-actions">
          <AntButton
            aria-label={`刷新 ${account.uid} 余额`}
            disabled={refreshingBalanceUid === account.uid}
            icon={<RefreshCw size={15} />}
            title="刷新余额"
            type="text"
            onClick={() => void refreshAccountBalance(account.uid)}
          />
          <AntButton
            aria-label="启用"
            icon={<Power size={15} />}
            title="启用"
            type="text"
            onClick={() => void updateAccount(account.uid, "enable")}
          />
          <AntButton
            aria-label="停用"
            icon={<Ban size={15} />}
            title="停用"
            type="text"
            onClick={() => void updateAccount(account.uid, "disable")}
          />
          <AntButton
            aria-label="冷却"
            icon={<Timer size={15} />}
            title="冷却"
            type="text"
            onClick={() => void updateAccount(account.uid, "cooldown")}
          />
        </div>
      )
    }
  ];

  return (
    <section className="panel" aria-labelledby="accounts-title">
      <div className="panel-head">
        <div>
          <h2 id="accounts-title">账号池</h2>
          <StatusLine status={status} />
        </div>
        <AntButton icon={<RefreshCw size={16} />} onClick={() => void onRefresh()}>
          刷新
        </AntButton>
      </div>

      <div className="registration-ops" aria-label="注册任务">
        <div className="form-row three compact">
          <label className="text-field ant-field">
            <span>补齐到 active 数量</span>
            <InputNumber
              aria-label="补齐到 active 数量"
              max={500}
              min={1}
              value={fillTarget}
              onChange={(value) => setFillTarget(clampJobNumber(value, 1, 500))}
            />
          </label>
          <label className="text-field ant-field">
            <span>新增数量</span>
            <InputNumber
              aria-label="新增数量"
              max={500}
              min={1}
              value={createCount}
              onChange={(value) => setCreateCount(clampJobNumber(value, 1, 500))}
            />
          </label>
          <label className="text-field ant-field">
            <span>任务并发</span>
            <InputNumber
              aria-label="任务并发"
              max={20}
              min={1}
              value={jobConcurrency}
              onChange={(value) => setJobConcurrency(clampJobNumber(value, 1, 20))}
            />
          </label>
        </div>
        <div className="toolbar flush">
          <AntButton icon={<Play size={16} />} type="primary" onClick={() => void startRegistrationJob("single")}>
            启动单个注册
          </AntButton>
          <AntButton icon={<Play size={16} />} onClick={() => void startRegistrationJob("fill")}>
            补齐账号池
          </AntButton>
          <AntButton icon={<Play size={16} />} onClick={() => void startRegistrationJob("create")}>
            新增注册
          </AntButton>
          {job && !registrationJobIsTerminal(job) && (
            <AntButton icon={<Square size={16} />} onClick={() => void cancelRegistrationJob()}>
              取消任务
            </AntButton>
          )}
          {job && registrationJobIsTerminal(job) && (
            <AntButton onClick={closeRegistrationJobResult}>
              关闭任务结果
            </AntButton>
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

      <Table<AccountListItem>
        className="accounts-table"
        columns={accountColumns}
        dataSource={accounts}
        locale={{ emptyText: "暂无账号" }}
        pagination={false}
        rowKey="uid"
        scroll={{ x: 900 }}
        size="middle"
      />
    </section>
  );
}

function readJobId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.jobId === "string" ? record.jobId : typeof record.id === "string" ? record.id : undefined;
}
