import { type FormEvent, useState } from "react";
import { Alert, Button as AntButton, Card, Input, InputNumber, Tag } from "antd";
import { Download, ImageIcon, Sparkles } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { JsonBlock, StatusLine } from "../components/feedback";
import { SelectField, TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import {
  buildImageGenerationRequest,
  parseImageGenerationResults,
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
  const [result, setResult] = useState<unknown>("等待生成图片");
  const [images, setImages] = useState<ImageResult[]>([]);

  async function generateImage(event: FormEvent) {
    event.preventDefault();
    const prompt = form.prompt.trim();
    if (!prompt) {
      setStatus({ kind: "error", message: "图片提示词不能为空" });
      return;
    }
    setStatus({ kind: "loading", message: "图片生成中" });
    setImages([]);
    setResult("图片生成中");

    try {
      const response = await apiRequest<unknown>(apiKey, "/api/images/generations", {
        method: "POST",
        body: JSON.stringify(buildImageGenerationRequest({ ...form, prompt }))
      });
      const nextImages = parseImageGenerationResults(response);
      setResult(response);
      setImages(nextImages);
      if (nextImages.length === 0) {
        setStatus({ kind: "error", message: "接口没有返回图片" });
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
          <h2 id="image-title">图片生成</h2>
          <StatusLine status={status} />
        </div>
        <Tag color="processing">gpt-image-2</Tag>
      </div>

      <div className="image-workbench">
        <form className="image-form" onSubmit={generateImage}>
          <Alert
            showIcon
            type="info"
            title="纯生图工作台"
            description="只做文字生图，不做画布；生成成功后会在右侧直接展示图片结果。"
          />
          <label className="image-prompt-field">
            <span>图片提示词</span>
            <Input.TextArea
              aria-label="图片提示词"
              autoSize={false}
              placeholder="描述画面主体、风格、镜头、光线、材质；例如：白色机器人站在霓虹雨夜的天桥上。"
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
              <span>张数</span>
              <InputNumber
                aria-label="张数"
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
          <div className="toolbar flush">
            <AntButton
              className="image-generate-button"
              disabled={status.kind === "loading"}
              htmlType="submit"
              icon={<Sparkles size={16} />}
              type="primary"
            >
              生成图片
            </AntButton>
          </div>
        </form>

        <div className="image-output">
          <Card
            className="image-result-card"
            title="生成结果"
            extra={<Tag>{images.length} 张</Tag>}
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
                      <AntButton href={image.url} icon={<Download size={14} />} size="small" download>
                        下载
                      </AntButton>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="image-empty">
                <ImageIcon size={34} aria-hidden="true" />
                <strong>等待第一张图片</strong>
                <span>左侧填写提示词后点击生成。</span>
              </div>
            )}
          </Card>
          <JsonBlock value={result} />
        </div>
      </div>
    </section>
  );
}
