import { SecretBox } from "../security/secretbox.js";
import type { YydsMailConfigRaw, YydsMailConfigStore } from "../store/yyds-mail-config-store.js";

export interface YydsMailConfigInput {
  enabled?: unknown;
  apiKey?: unknown;
}

export interface YydsMailConfigDto {
  id: number;
  enabled: boolean;
  apiKeyConfigured: boolean;
  createdAt: number;
  updatedAt: number;
}

export class YydsMailConfigService {
  constructor(
    private readonly store: YydsMailConfigStore,
    private readonly box: SecretBox
  ) {}

  async get(): Promise<YydsMailConfigDto | undefined> {
    const raw = await this.store.getRaw();
    return raw ? toDto(raw) : undefined;
  }

  async save(input: YydsMailConfigInput): Promise<YydsMailConfigDto> {
    const existing = await this.store.getRaw();
    const apiKey = normalizeString(input.apiKey);
    const apiKeyEnc = apiKey ? this.box.encrypt(apiKey) : existing?.apiKeyEnc;
    if (!apiKeyEnc) {
      throw new Error("apiKey is required");
    }

    const saved = await this.store.saveRaw({
      enabled: input.enabled !== false,
      apiKeyEnc
    });
    return toDto(saved);
  }

  async enabledApiKey(): Promise<string | undefined> {
    const raw = await this.store.getRaw();
    if (raw) {
      return raw.enabled ? this.box.decrypt(raw.apiKeyEnc) : undefined;
    }
    return undefined;
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toDto(raw: YydsMailConfigRaw): YydsMailConfigDto {
  return {
    id: raw.id,
    enabled: raw.enabled,
    apiKeyConfigured: Boolean(raw.apiKeyEnc),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}
