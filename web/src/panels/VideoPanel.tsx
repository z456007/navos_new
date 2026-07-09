import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert, Button as AntButton, Progress, Space, Tag } from "antd";
import { Clapperboard, ExternalLink, Film, RefreshCw } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { JsonBlock, StatusLine } from "../components/feedback";
import { SelectField, TextField } from "../components/fields";
import { defaultVideoPrompt, idleStatus } from "../app/defaults";
import {
  archiveTone,
  normalizeVideoTask,
  readVideoString,
  videoDurationLimit,
  videoDurationLimits
} from "../lib/video-task";
import type { StatusState, VideoTaskView } from "../types";

export function VideoPanel({ apiKey }: { apiKey: string }) {
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
  const previewUrl = task?.cosUrl ?? task?.videoUrl;
  const durationLimit = videoDurationLimit(form.resolution);

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
    if (form.durationSeconds > durationLimit) {
      setStatus({ kind: "error", message: `${form.resolution} 最长只能生成 ${durationLimit} 秒` });
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
        <AntButton disabled={!task?.id || status.kind === "loading"} icon={<RefreshCw size={16} />} onClick={() => void pollTask()}>
          查询状态
        </AntButton>
      </div>

      <div className="video-rule-band" aria-label="视频账号规则">
        <div>
          <strong>一次性视频账号</strong>
          <span>每个账号只跑一次任务；账号池没有可用账号时会自动注册，创建成功后标记耗尽。</span>
        </div>
        <Space size={8} wrap>
          {Object.entries(videoDurationLimits).map(([resolution, seconds]) => (
            <Tag className={`rule-tag${resolution === form.resolution ? " active" : ""}`} key={resolution}>
              {resolution} / {seconds}秒
            </Tag>
          ))}
          <Tag color="processing">并发租约</Tag>
        </Space>
      </div>

      <div className="video-budget-meter">
        <span>{form.resolution}</span>
        <Progress
          percent={Math.round((form.durationSeconds / durationLimit) * 100)}
          showInfo={false}
          strokeColor={form.durationSeconds >= durationLimit ? "#a15c07" : "#2557d6"}
        />
        <strong>{form.durationSeconds}s / {durationLimit}s</strong>
      </div>

      <div className="video-grid">
        <form className="video-form" onSubmit={createTask}>
          <Alert
            showIcon
            type="info"
            title="生成前会自动准备一个一次性账号"
            description="账号池没有可用账号时会自动注册；每个账号只用于一个视频任务。"
          />
          <TextField label="模型" value={form.model} onChange={(model) => setForm((current) => ({ ...current, model }))} />
          <div className="form-row three compact">
            <SelectField
              label="分辨率"
              value={form.resolution}
              options={["480P", "720P", "1080P"]}
              onChange={(resolution) => setForm((current) => {
                const nextLimit = videoDurationLimit(resolution);
                return {
                  ...current,
                  resolution,
                  durationSeconds: Math.min(current.durationSeconds, nextLimit)
                };
              })}
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
                max={durationLimit}
                min={4}
                type="number"
                value={form.durationSeconds}
                onChange={(event) => setForm((current) => {
                  const nextDuration = Number(event.target.value);
                  return {
                    ...current,
                    durationSeconds: Math.min(nextDuration, videoDurationLimit(current.resolution))
                  };
                })}
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
            <AntButton className="create-video-button" disabled={status.kind === "loading"} htmlType="submit" icon={<Clapperboard size={16} />} type="primary">
              创建视频任务
            </AntButton>
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
            <div>
              <span>归档</span>
              <strong className={`archive-status ${archiveTone(task?.archiveStatus)}`}>{task?.archiveStatus ?? "-"}</strong>
            </div>
          </div>

          <div className="preview-frame">
            {previewUrl ? (
              <video controls src={previewUrl} title="生成视频" />
            ) : (
              <div className="video-empty">
                <Film size={30} aria-hidden="true" />
                <span>等待生成结果</span>
              </div>
            )}
          </div>

          <div className="toolbar flush">
            {previewUrl && (
              <a className="button" href={previewUrl} rel="noreferrer" target="_blank">
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
