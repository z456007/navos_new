import type { StatusState } from "../types";

export const initialMessagesPayload = `{
  "model": "claude.sonnet-4.6",
  "max_tokens": 32,
  "messages": [
    { "role": "user", "content": "只回复 OK，不要解释" }
  ]
}`;

export const initialChatPayload = `{
  "model": "openai.gpt-5.5",
  "max_completion_tokens": 32,
  "messages": [
    { "role": "user", "content": "只回复 OK，不要解释" }
  ]
}`;

export const defaultVideoPrompt =
  "原创极简动画短片：一只小型白色机器人在干净的浅灰色桌面上挥手，柔和自然光，镜头稳定，画面清晰，无文字，无水印，无对白。";

export const idleStatus: StatusState = { kind: "idle", message: "" };
