import type { AccountListItem, PanelId } from "../types";

export function accountMetrics(accounts: AccountListItem[]) {
  const now = Date.now();
  return {
    total: accounts.length,
    active: accounts.filter((account) => account.status === "active" && account.rateLimitedUntil <= now).length,
    cooldown: accounts.filter((account) => account.status === "active" && account.rateLimitedUntil > now).length,
    blocked: accounts.filter((account) => account.status !== "active").length
  };
}

export function panelTitle(panel: PanelId): string {
  if (panel === "chat") {
    return "聊天";
  }
  if (panel === "image") {
    return "图片生成";
  }
  if (panel === "yydsConfig") {
    return "YYDS配置";
  }
  if (panel === "video") {
    return "视频生成";
  }
  if (panel === "probe") {
    return "代理测试";
  }
  return "账号池";
}

export function formatTime(value: number): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function shortText(value: string | undefined, max: number): string {
  if (!value) {
    return "-";
  }
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
