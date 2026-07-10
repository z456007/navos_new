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
  const [result, setResult] = useState<unknown>("Waiting for image generation");
  const [images, setImages] = useState<ImageResult[]>([]);
  const [referenceUrls, setReferenceUrls] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<UploadFile[]>([]);
  const referenceCount = Math.min(8, parseImageReferenceUrls(referenceUrls).length + referenceFiles.length);

  async function generateImage(event: FormEvent) {
    event.preventDefault();
    const prompt = form.prompt.trim();
    if (!prompt) {
      setStatus({ kind: "error", message: "Image prompt is required" });
      return;
    }
    setStatus({ kind: "loading", message: "Generating image" });
    setImages([]);
    setResult("Generating image");

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
        setStatus({ kind: "error", message: "The API did not return an image" });
        return;
      }
      setStatus({ kind: "ok", message: `Generated ${nextImages.length} image(s)` });
    } catch (error) {
      const message = errorMessage(error) ?? "Image generation failed";
      setStatus({ kind: "error", message });
      setResult(message);
    }
  }

  return (
    <section className="panel image-panel" aria-labelledby="image-title">
      <div className="panel-head image-head">
        <div>
          <h2 id="image-title">Image generation</h2>
          <StatusLine status={status} />
        </div>
        <Tag color="processing">gpt-image-2</Tag>
      </div>

      <div className="image-workbench">
        <form className="image-form" onSubmit={generateImage}>
          <Alert
            showIcon
            type="info"
            title="Image workbench"
            description="Image requests return upstream URL or b64_json directly; no secondary storage step is performed."
          />
          <label className="image-prompt-field">
            <span>Image prompt</span>
            <Input.TextArea
              aria-label="Image prompt"
              autoSize={false}
              placeholder="Describe subject, style, lens, lighting, and materials."
              value={form.prompt}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
            />
          </label>
          <TextField
            label="Model"
            value={form.model}
            onChange={(model) => setForm((current) => ({ ...current, model }))}
          />
          <div className="form-row three compact">
            <SelectField
              label="Size"
              options={sizeOptions}
              value={form.size}
              onChange={(size) => setForm((current) => ({ ...current, size }))}
            />
            <SelectField
              label="Quality"
              options={qualityOptions}
              value={form.quality}
              onChange={(quality) => setForm((current) => ({ ...current, quality }))}
            />
            <label className="text-field ant-field">
              <span>Count</span>
              <InputNumber
                aria-label="Count"
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
                <span>Reference images</span>
                <small>URL or upload; max 8</small>
              </div>
            )}
            extra={<Tag color={referenceCount > 0 ? "processing" : "default"}>{referenceCount}/8</Tag>}
          >
            <div className="image-reference-shell">
              <div className="reference-url-shell">
                <Link2 size={14} aria-hidden="true" />
                <Input.TextArea
                  aria-label="Reference image URLs (one per line)"
                  className="reference-url-input"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="Reference image URLs, one per line. Local uploads are converted to protocol assets."
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
                    Add reference image
                  </AntButton>
                </Upload>
                <div className="reference-file-list" aria-label="Selected reference images">
                  {referenceFiles.length === 0 ? (
                    <span className="reference-file-empty">No local reference images selected</span>
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
              Generate image
            </AntButton>
          </div>
        </form>

        <div className="image-output">
          <Card
            className="image-result-card"
            title="Generated result"
            extra={<Tag>{images.length} image(s)</Tag>}
          >
            {status.kind === "loading" ? (
              <div className="image-pending">
                <Sparkles size={28} aria-hidden="true" />
                <strong>Generating image</strong>
                <span>Waiting for upstream b64_json or URL</span>
              </div>
            ) : images.length > 0 ? (
              <div className="image-result-grid">
                {images.map((image, index) => (
                  <figure className="image-result-tile" key={`${image.url}-${index}`}>
                    <img alt={`Generated image ${index + 1}`} src={image.url} />
                    <figcaption>
                      <span>#{index + 1}</span>
                      <span className="image-result-actions">
                        <AntButton href={image.url} icon={<ExternalLink size={14} />} rel="noreferrer" size="small" target="_blank">
                          Open
                        </AntButton>
                        <AntButton href={image.url} icon={<Download size={14} />} size="small" download>
                          Download
                        </AntButton>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="image-empty">
                <ImageIcon size={34} aria-hidden="true" />
                <strong>Waiting for the first image</strong>
                <span>Enter a prompt and click generate.</span>
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
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read reference image"));
    reader.readAsDataURL(file);
  });
}
