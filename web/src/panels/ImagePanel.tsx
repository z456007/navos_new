import { type FormEvent, useState } from "react";
import { Alert, Button as AntButton, Card, Input, InputNumber, Tag, Upload } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { Download, ExternalLink, ImageIcon, Link2, Sparkles, UploadCloud } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { JsonBlock, StatusLine } from "../components/feedback";
import { SelectField, TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import {
  buildImageGenerationRequest,
  parseImageGenerationResults,
  parseImageReferenceUrls,
  type ImageResult
} from "../lib/image-generation";
import type { StatusState } from "../types";

const sizeOptions = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "1152x2048",
  "auto"
];

const qualityOptions = ["auto", "low", "medium", "high"];

export function ImagePanel({ apiKey }: { apiKey: string }) {
  const [form, setForm] = useState({
    model: "gpt-image-2",
    prompt: "",
    size: "1024x1024",
    quality: "auto",
    count: 1
  });
  const [status, setStatus] = useState<StatusState>(idleStatus);
  const [result, setResult] = useState<unknown>("等待图片生成");
  const [images, setImages] = useState<ImageResult[]>([]);
  const [referenceUrls, setReferenceUrls] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<UploadFile[]>([]);
  const referenceCount = Math.min(8, parseImageReferenceUrls(referenceUrls).length + referenceFiles.length);

  async function generateImage(event: FormEvent) {
    event.preventDefault();
    const prompt = form.prompt.trim();
    if (!prompt) {
      setStatus({ kind: "error", message: "请填写图片提示词" });
      return;
    }
    setStatus({ kind: "loading", message: "正在生成图片" });
    setImages([]);
    setResult("正在生成图片");

    try {
      const referenceImages = [
        ...parseImageReferenceUrls(referenceUrls),
        ...await filesToDataUrls(referenceFiles)
      ].slice(0, 8);
      const response = await apiRequest<unknown>(apiKey, "/api/images/generations", {
        method: "POST",
        body: JSON.stringify(buildImageGenerationRequest({ ...form, prompt, referenceImages }))
      });
      const nextImages = parseImageGenerationResults(response);
      setResult(response);
      setImages(nextImages);
      if (nextImages.length === 0) {
        setStatus({ kind: "error", message: "API 未返回图片" });
        return;
      }
      setStatus({ kind: "ok", message: `已生成 ${nextImages.length} 张图片` });
    } catch (error) {
      const message = errorMessage(error) ?? "图片生成失败";
      setStatus({ kind: "error", message });
      setResult(message);
    }
  }

  return (
    <section className="panel image-panel" aria-labelledby="image-title">
      <div className="panel-head image-head">
        <div>
          <div id="image-title" className="panel-title">图片生成</div>
          <StatusLine status={status} />
        </div>
        <Tag color="processing">gpt-image-2</Tag>
      </div>

      <div className="image-workbench">
        <form className="image-form" onSubmit={generateImage}>
          <Alert
            showIcon
            type="info"
            title="图片工作台"
            description="图片请求会直接返回上游 URL 或 b64_json，不执行二次存储步骤。"
          />
          <label className="image-prompt-field">
            <span>图片提示词</span>
            <Input.TextArea
              aria-label="图片提示词"
              autoSize={false}
              placeholder="描述主体、风格、镜头、光线与材质。"
              value={form.prompt}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
            />
          </label>
          <TextField
            label="模型"
            value={form.model}
            onChange={(model) => setForm((current) => ({ ...current, model }))}
          />
          <div className="form-row three compact">
            <SelectField
              label="尺寸"
              options={sizeOptions}
              value={form.size}
              onChange={(size) => setForm((current) => ({ ...current, size }))}
            />
            <SelectField
              label="质量"
              options={qualityOptions}
              value={form.quality}
              onChange={(quality) => setForm((current) => ({ ...current, quality }))}
            />
            <label className="text-field ant-field">
              <span>数量</span>
              <InputNumber
                aria-label="数量"
                max={4}
                min={1}
                value={form.count}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  count: typeof value === "number" && Number.isFinite(value) ? value : 1
                }))}
              />
            </label>
          </div>
          <Card
            className="image-reference-card"
            size="small"
            title={(
              <div className="reference-card-title">
                <span>参考图</span>
                <small>URL 或上传，最多 8 张</small>
              </div>
            )}
            extra={<Tag color={referenceCount > 0 ? "processing" : "default"}>{referenceCount}/8</Tag>}
          >
            <div className="image-reference-shell">
              <div className="reference-url-shell">
                <Link2 size={14} aria-hidden="true" />
                <Input.TextArea
                  aria-label="参考图 URL，每行一个"
                  className="reference-url-input"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="参考图 URL，每行一个。本地上传会转换为协议资产。"
                  value={referenceUrls}
                  onChange={(event) => setReferenceUrls(event.target.value)}
                />
              </div>
              <div className="reference-actions">
                <Upload
                  accept="image/*"
                  beforeUpload={() => false}
                  fileList={referenceFiles}
                  multiple
                  showUploadList={false}
                  onChange={({ fileList }) => setReferenceFiles(fileList.slice(0, 8))}
                >
                  <AntButton htmlType="button" icon={<UploadCloud size={14} />} size="small">
                    上传参考图
                  </AntButton>
                </Upload>
                <div className="reference-file-list" aria-label="已选择的参考图">
                  {referenceFiles.length === 0 ? (
                    <span className="reference-file-empty">暂无本地参考图</span>
                  ) : referenceFiles.map((file) => (
                    <Tag
                      className="reference-file-chip"
                      closable
                      key={file.uid}
                      title={file.name}
                      onClose={() => setReferenceFiles(referenceFiles.filter((item) => item.uid !== file.uid))}
                    >
                      <span className="reference-file-name">{file.name}</span>
                    </Tag>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          <div className="toolbar flush">
            <AntButton
              className="image-generate-button"
              disabled={status.kind === "loading"}
              htmlType="submit"
              icon={<Sparkles size={16} />}
              type="primary"
            >
              开始生成
            </AntButton>
          </div>
        </form>

        <div className="image-output">
          <Card
            className="image-result-card"
            title="生成结果"
            extra={<Tag>{images.length} 张图片</Tag>}
          >
            {status.kind === "loading" ? (
              <div className="image-pending">
                <Sparkles size={28} aria-hidden="true" />
                <strong>正在生成图片</strong>
                <span>等待上游返回 b64_json 或 URL</span>
              </div>
            ) : images.length > 0 ? (
              <div className="image-result-grid">
                {images.map((image, index) => (
                  <figure className="image-result-tile" key={`${image.url}-${index}`}>
                    <img alt={`生成图片 ${index + 1}`} src={image.url} />
                    <figcaption>
                      <span>#{index + 1}</span>
                      <span className="image-result-actions">
                        <AntButton href={image.url} icon={<ExternalLink size={14} />} rel="noreferrer" size="small" target="_blank">
                          打开
                        </AntButton>
                        <AntButton href={image.url} icon={<Download size={14} />} size="small" download>
                          下载
                        </AntButton>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="image-empty">
                <ImageIcon size={34} aria-hidden="true" />
                <strong>等待第一张图片</strong>
                <span>输入提示词后点击开始生成。</span>
              </div>
            )}
          </Card>
          <JsonBlock value={result} />
        </div>
      </div>
    </section>
  );
}

function filesToDataUrls(files: UploadFile[]): Promise<string[]> {
  return Promise.all(files.map((file) => fileToDataUrl(file.originFileObj))).then((items) => items.filter((item): item is string => Boolean(item)));
}

function fileToDataUrl(file: File | undefined): Promise<string | undefined> {
  if (!file) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => reject(reader.error ?? new Error("读取参考图失败"));
    reader.readAsDataURL(file);
  });
}
