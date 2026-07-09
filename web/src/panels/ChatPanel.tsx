import { useEffect, useMemo, useState } from "react";
import { Button as AntButton, Input, Select } from "antd";
import { Bot, Send, Sparkles } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { StatusLine } from "../components/feedback";
import { idleStatus } from "../app/defaults";
import type { StatusState } from "../types";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const FALLBACK_MODELS = [
  "gpt-5.5",
  "openai.gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "ospu-4.8",
  "ospu-4.6",
  "sonnet-4.6",
  "sonnet-4.5",
  "haiku-4.5",
  "gpt-image-2",
  "doubao-seedance-2-0-260128"
];

export function ChatPanel({ apiKey }: { apiKey: string }) {
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [model, setModel] = useState(FALLBACK_MODELS[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;

    async function loadModels() {
      try {
        const response = await apiRequest<unknown>(apiKey, "/v1/models", { method: "GET" });
        if (!active) return;
        const loadedModels = modelIdsFromResponse(response);
        if (loadedModels.length > 0) {
          setModels(loadedModels);
          setModel((current) => loadedModels.includes(current) ? current : loadedModels[0]);
        }
      } catch (error) {
        if (!active) return;
        setStatus({ kind: "error", message: errorMessage(error) ?? "模型列表获取失败，使用内置列表" });
      }
    }

    void loadModels();
    return () => {
      active = false;
    };
  }, [apiKey]);

  const modelOptions = useMemo(
    () => models.map((item) => ({ label: item, value: item })),
    [models]
  );

  async function sendMessage() {
    const content = input.trim();
    if (!content) {
      setStatus({ kind: "error", message: "先输入要发送的内容" });
      return;
    }

    const outgoing: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(outgoing);
    setInput("");
    setStatus({ kind: "loading", message: "AI 回复中" });

    try {
      const response = await apiRequest<unknown>(apiKey, "/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: outgoing.map((message) => ({
            role: message.role,
            content: message.content
          })),
          max_completion_tokens: 1024,
          stream: false
        })
      });
      const assistantText = extractAssistantText(response);
      setMessages([...outgoing, { role: "assistant", content: assistantText }]);
      setStatus({ kind: "ok", message: "已回复" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "发送失败" });
    }
  }

  return (
    <section className="panel chat-panel" aria-labelledby="chat-panel-title">
      <div className="panel-head chat-head">
        <div>
          <h2 id="chat-panel-title">AI 对话</h2>
          <StatusLine status={status} />
        </div>
        <label className="text-field ant-field chat-model-field">
          <span>模型</span>
          <Select
            aria-label="模型"
            className="navos-select"
            options={modelOptions}
            popupMatchSelectWidth={false}
            value={model}
            onChange={setModel}
          />
        </label>
      </div>

      <div className="chat-log" aria-label="聊天记录">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <Sparkles size={18} aria-hidden="true" />
            <span>选择模型，直接开始对话。</span>
          </div>
        ) : messages.map((message, index) => (
          <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
            <span className="chat-avatar" aria-hidden="true">
              {message.role === "assistant" ? <Bot size={16} /> : "你"}
            </span>
            <div>
              <strong>{message.role === "assistant" ? "AI" : "你"}</strong>
              <p>{message.content}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="chat-compose">
        <Input.TextArea
          aria-label="输入消息"
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="输入你要问 AI 的内容"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <AntButton
          disabled={status.kind === "loading"}
          icon={<Send size={16} />}
          type="primary"
          onClick={() => void sendMessage()}
        >
          发送
        </AntButton>
      </div>
    </section>
  );
}

function modelIdsFromResponse(value: unknown): string[] {
  const source = readContainerArray(value);
  const ids = source
    .map((item) => typeof item === "string" ? item : readString(item, ["id", "model", "name"]))
    .filter((item): item is string => Boolean(item));
  return [...new Set(ids)];
}

function readContainerArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  for (const key of ["data", "models", "items", "list"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    const nested = readContainerArray(candidate);
    if (nested.length > 0) {
      return nested;
    }
  }
  return [];
}

function extractAssistantText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return typeof value === "string" && value ? value : "（没有返回文本）";
  }
  const record = value as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0];
  if (firstChoice && typeof firstChoice === "object") {
    const choice = firstChoice as Record<string, unknown>;
    const fromMessage = collectContent((choice.message as Record<string, unknown> | undefined)?.content);
    if (fromMessage) return fromMessage;
    const fromText = collectContent(choice.text);
    if (fromText) return fromText;
  }

  const fromContent = collectContent(record.content);
  if (fromContent) return fromContent;
  const fromOutputText = collectContent(record.output_text);
  if (fromOutputText) return fromOutputText;

  return JSON.stringify(value, null, 2);
}

function collectContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(collectContent).filter(Boolean).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return collectContent(record.text ?? record.content);
  }
  return "";
}

function readString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return undefined;
}
