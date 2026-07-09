import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert, Button as AntButton, Card, InputNumber, Progress, Select, Space, Switch, Tag, Upload } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { Clapperboard, ExternalLink, Film, RefreshCw } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { JsonBlock, StatusLine } from "../components/feedback";
import { SelectField, TextAreaField, TextField } from "../components/fields";
import { defaultVideoPrompt, idleStatus } from "../app/defaults";
import {
  buildVideoGenerationPayload,
  parseReferenceUrls,
  type VideoReferenceValue
} from "../lib/video-payload";
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
  const [referenceText, setReferenceText] = useState("");
  const [referenceUrls, setReferenceUrls] = useState({ images: "", videos: "", audios: "" });
  const [referenceRoles, setReferenceRoles] = useState({
    image: "reference_image",
    video: "reference_video",
    audio: "reference_audio"
  });
  const [imageFiles, setImageFiles] = useState<UploadFile[]>([]);
  const [videoFiles, setVideoFiles] = useState<UploadFile[]>([]);
  const [audioFiles, setAudioFiles] = useState<UploadFile[]>([]);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewUrl = task?.cosUrl ?? task?.videoUrl;
  const durationLimit = videoDurationLimit(form.resolution);
  const imageRefCount = Math.min(9, countUrlLines(referenceUrls.images) + imageFiles.length);
  const videoRefCount = Math.min(3, countUrlLines(referenceUrls.videos) + videoFiles.length);
  const audioRefCount = Math.min(3, countUrlLines(referenceUrls.audios) + audioFiles.length);

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
        body: JSON.stringify(buildVideoGenerationPayload(
          { ...form, prompt },
          await collectVideoReferences()
        ))
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

  async function collectVideoReferences() {
    const images = [
      ...parseReferenceUrls(referenceUrls.images, referenceRoles.image),
      ...await filesToReferences(imageFiles, referenceRoles.image)
    ].slice(0, 9);
    const videos = [
      ...parseReferenceUrls(referenceUrls.videos, referenceRoles.video),
      ...await filesToReferences(videoFiles, referenceRoles.video)
    ].slice(0, 3);
    const audios = [
      ...parseReferenceUrls(referenceUrls.audios, referenceRoles.audio),
      ...await filesToReferences(audioFiles, referenceRoles.audio)
    ].slice(0, 3);

    return {
      referenceText,
      images,
      videos,
      audios
    };
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
            <label className="text-field ant-field">
              <span>时长</span>
              <InputNumber
                aria-label="时长"
                max={durationLimit}
                min={4}
                value={form.durationSeconds}
                onChange={(value) => setForm((current) => {
                  const nextDuration = typeof value === "number" && Number.isFinite(value) ? value : 4;
                  return {
                    ...current,
                    durationSeconds: Math.min(nextDuration, videoDurationLimit(current.resolution))
                  };
                })}
              />
            </label>
          </div>
          <label className="inline-check ant-switch-row">
            <Switch
              aria-label="生成音频"
              checked={form.audio}
              onChange={(checked) => setForm((current) => ({ ...current, audio: checked }))}
            />
            <span>生成音频</span>
          </label>
          <TextAreaField
            className="video-prompt"
            label="提示词"
            value={form.prompt}
            onChange={(prompt) => setForm((current) => ({ ...current, prompt }))}
          />
          <Card
            className="video-reference-card"
            size="small"
            title="全能参考素材"
            extra={<Tag color="processing">自动上传</Tag>}
          >
            <TextAreaField
              className="video-reference-text"
              label="文字参考"
              value={referenceText}
              onChange={setReferenceText}
            />
            <div className="reference-grid">
              <ReferenceColumn
                accept="image/*"
                count={`${imageRefCount}/9`}
                fileList={imageFiles}
                label="图片参考"
                role={referenceRoles.image}
                roleOptions={["reference_image", "first_frame", "last_frame"]}
                urlsLabel="图片参考 URL（每行一个）"
                urlsValue={referenceUrls.images}
                onFilesChange={(files) => setImageFiles(files.slice(0, 9))}
                onRoleChange={(image) => setReferenceRoles((current) => ({ ...current, image }))}
                onUrlsChange={(images) => setReferenceUrls((current) => ({ ...current, images }))}
              />
              <ReferenceColumn
                accept="video/*"
                count={`${videoRefCount}/3`}
                fileList={videoFiles}
                label="视频参考"
                role={referenceRoles.video}
                roleOptions={["reference_video"]}
                urlsLabel="视频参考 URL（每行一个）"
                urlsValue={referenceUrls.videos}
                onFilesChange={(files) => setVideoFiles(files.slice(0, 3))}
                onRoleChange={(video) => setReferenceRoles((current) => ({ ...current, video }))}
                onUrlsChange={(videos) => setReferenceUrls((current) => ({ ...current, videos }))}
              />
              <ReferenceColumn
                accept="audio/*"
                count={`${audioRefCount}/3`}
                fileList={audioFiles}
                label="音频参考"
                role={referenceRoles.audio}
                roleOptions={["reference_audio"]}
                urlsLabel="音频参考 URL（每行一个）"
                urlsValue={referenceUrls.audios}
                onFilesChange={(files) => setAudioFiles(files.slice(0, 3))}
                onRoleChange={(audio) => setReferenceRoles((current) => ({ ...current, audio }))}
                onUrlsChange={(audios) => setReferenceUrls((current) => ({ ...current, audios }))}
              />
            </div>
          </Card>
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
              <AntButton href={previewUrl} icon={<ExternalLink size={16} />} rel="noreferrer" target="_blank">
                打开视频
              </AntButton>
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

function ReferenceColumn({
  accept,
  count,
  fileList,
  label,
  onFilesChange,
  onRoleChange,
  onUrlsChange,
  role,
  roleOptions,
  urlsLabel,
  urlsValue
}: {
  accept: string;
  count: string;
  fileList: UploadFile[];
  label: string;
  onFilesChange: (files: UploadFile[]) => void;
  onRoleChange: (role: string) => void;
  onUrlsChange: (value: string) => void;
  role: string;
  roleOptions: string[];
  urlsLabel: string;
  urlsValue: string;
}) {
  return (
    <div className="reference-column">
      <div className="reference-column-head">
        <strong>{label}</strong>
        <Tag>{count}</Tag>
      </div>
      <label className="text-field ant-field">
        <span>{label}角色</span>
        <Select
          aria-label={`${label}角色`}
          options={roleOptions.map((option) => ({ label: option, value: option }))}
          popupMatchSelectWidth={false}
          value={role}
          onChange={onRoleChange}
        />
      </label>
      <TextAreaField
        className="reference-url-field"
        label={urlsLabel}
        value={urlsValue}
        onChange={onUrlsChange}
      />
      <Upload
        accept={accept}
        beforeUpload={() => false}
        fileList={fileList}
        multiple
        onChange={({ fileList: nextFiles }) => onFilesChange(nextFiles)}
      >
        <AntButton htmlType="button">选择{label}文件</AntButton>
      </Upload>
    </div>
  );
}

async function filesToReferences(files: UploadFile[], role: string): Promise<VideoReferenceValue[]> {
  const references: Array<VideoReferenceValue | undefined> = await Promise.all(files.map(async (file) => {
    const source = await fileToDataUrl(file);
    return source ? { source, role } : undefined;
  }));
  return references.filter((reference): reference is VideoReferenceValue => reference !== undefined);
}

function fileToDataUrl(file: UploadFile): Promise<string | undefined> {
  const original = file.originFileObj;
  if (!original) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.readAsDataURL(original);
  });
}

function countUrlLines(value: string): number {
  return value.split(/\r?\n/).filter((line) => line.trim()).length;
}
