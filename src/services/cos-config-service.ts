import { SecretBox } from "../security/secretbox.js";
import type { CosConfigRaw, CosConfigStore } from "../store/cos-config-store.js";

export interface CosConfigInput {
  name?: unknown;
  enabled?: unknown;
  secretId?: unknown;
  secretKey?: unknown;
  bucket?: unknown;
  region?: unknown;
  appId?: unknown;
  publicDomain?: unknown;
  uploadPrefix?: unknown;
}

export interface CosConfigDto {
  id: number;
  name: string;
  enabled: boolean;
  secretIdConfigured: boolean;
  secretKeyConfigured: boolean;
  bucket: string;
  region: string;
  appId?: string;
  publicDomain?: string;
  uploadPrefix: string;
  createdAt: number;
  updatedAt: number;
}

export interface EnabledCosConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  appId?: string;
  publicDomain?: string;
  uploadPrefix: string;
}

export class CosConfigService {
  constructor(
    private readonly store: CosConfigStore,
    private readonly box: SecretBox
  ) {}

  async get(): Promise<CosConfigDto | undefined> {
    const raw = await this.store.getRaw();
    return raw ? toDto(raw) : undefined;
  }

  async save(input: CosConfigInput): Promise<CosConfigDto> {
    const existing = await this.store.getRaw();
    const normalized = normalizeInput(input);
    if (!normalized.name || !normalized.bucket || !normalized.region) {
      throw new Error("name, bucket and region are required");
    }

    const secretIdEnc = normalized.secretId
      ? this.box.encrypt(normalized.secretId)
      : existing?.secretIdEnc;
    const secretKeyEnc = normalized.secretKey
      ? this.box.encrypt(normalized.secretKey)
      : existing?.secretKeyEnc;

    if (!secretIdEnc || !secretKeyEnc) {
      throw new Error("secretId and secretKey are required");
    }

    const saved = await this.store.saveRaw({
      name: normalized.name,
      enabled: normalized.enabled,
      secretIdEnc,
      secretKeyEnc,
      bucket: normalized.bucket,
      region: normalized.region,
      appId: normalized.appId,
      publicDomain: normalized.publicDomain,
      uploadPrefix: normalized.uploadPrefix
    });
    return toDto(saved);
  }

  async enabledConfig(): Promise<EnabledCosConfig | undefined> {
    const raw = await this.store.getEnabledRaw();
    if (!raw) {
      return undefined;
    }
    return {
      secretId: this.box.decrypt(raw.secretIdEnc),
      secretKey: this.box.decrypt(raw.secretKeyEnc),
      bucket: raw.bucket,
      region: raw.region,
      appId: raw.appId,
      publicDomain: raw.publicDomain,
      uploadPrefix: raw.uploadPrefix
    };
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePrefix(value: unknown): string {
  const prefix = normalizeString(value).replace(/^\/+|\/+$/g, "");
  return prefix || "navos/videos";
}

function normalizeDomain(value: unknown): string | undefined {
  const domain = normalizeString(value).replace(/\/+$/g, "");
  return domain || undefined;
}

function normalizeInput(input: CosConfigInput): Required<Pick<EnabledCosConfig, "bucket" | "region" | "uploadPrefix">> & {
  name: string;
  enabled: boolean;
  secretId?: string;
  secretKey?: string;
  appId?: string;
  publicDomain?: string;
} {
  return {
    name: normalizeString(input.name) || "main",
    enabled: input.enabled !== false,
    secretId: normalizeString(input.secretId) || undefined,
    secretKey: normalizeString(input.secretKey) || undefined,
    bucket: normalizeString(input.bucket),
    region: normalizeString(input.region),
    appId: normalizeString(input.appId) || undefined,
    publicDomain: normalizeDomain(input.publicDomain),
    uploadPrefix: normalizePrefix(input.uploadPrefix)
  };
}

function toDto(raw: CosConfigRaw): CosConfigDto {
  return {
    id: raw.id,
    name: raw.name,
    enabled: raw.enabled,
    secretIdConfigured: Boolean(raw.secretIdEnc),
    secretKeyConfigured: Boolean(raw.secretKeyEnc),
    bucket: raw.bucket,
    region: raw.region,
    appId: raw.appId,
    publicDomain: raw.publicDomain,
    uploadPrefix: raw.uploadPrefix,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}
