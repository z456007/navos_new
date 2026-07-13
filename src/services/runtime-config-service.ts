import type { RuntimeConfigStore } from "../store/runtime-config-store.js";
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfigInput,
  type RuntimeConfigUpdateInput,
  type RuntimeConfigView
} from "./runtime-config-schema.js";

export type { RuntimeConfigUpdateInput, RuntimeConfigView } from "./runtime-config-schema.js";

const LEGACY_IMAGE_MAX_POLL_ATTEMPTS = 30;
const LEGACY_IMAGE_POLL_INTERVAL_MS = 4000;
const LEGACY_IMAGE_SYNC_WAIT_BUDGET_MS = 120000;

export class RuntimeConfigService {
  constructor(
    private readonly store: RuntimeConfigStore,
    private readonly defaults: RuntimeConfigView = DEFAULT_RUNTIME_CONFIG
  ) {}

  async get(): Promise<RuntimeConfigView> {
    const stored = await this.store.get();
    const normalized = normalizeRuntimeConfigInput(stored ?? {}, { ...this.defaults, updatedAt: stored?.updatedAt ?? 0 });
    const migrated = this.migrateLegacyImageSyncDefaults(normalized);
    if (!migrated) {
      return normalized;
    }
    return normalizeRuntimeConfigInput(await this.store.save(migrated), this.defaults);
  }

  async update(input: RuntimeConfigUpdateInput): Promise<RuntimeConfigView> {
    const current = await this.get();
    const next = normalizeRuntimeConfigInput({ ...input, updatedAt: Date.now() }, current);
    return normalizeRuntimeConfigInput(await this.store.save(next), this.defaults);
  }

  async seedDefaultsIfEmpty(): Promise<RuntimeConfigView> {
    const stored = await this.store.get();
    if (stored) return this.get();
    return this.store.save({ ...this.defaults, updatedAt: Date.now() });
  }

  private migrateLegacyImageSyncDefaults(config: RuntimeConfigView): RuntimeConfigView | undefined {
    const defaultIsFiveMinuteImageWait = this.defaults.imageMaxPollAttempts === 75
      && this.defaults.imagePollIntervalMs === 4000
      && this.defaults.imageSyncWaitBudgetMs === 300000;
    if (!defaultIsFiveMinuteImageWait) {
      return undefined;
    }
    const configUsesLegacyImageWaitDefaults = config.imageMaxPollAttempts === LEGACY_IMAGE_MAX_POLL_ATTEMPTS
      && config.imagePollIntervalMs === LEGACY_IMAGE_POLL_INTERVAL_MS
      && config.imageSyncWaitBudgetMs === LEGACY_IMAGE_SYNC_WAIT_BUDGET_MS;
    if (!configUsesLegacyImageWaitDefaults) {
      return undefined;
    }
    return {
      ...config,
      imageMaxPollAttempts: this.defaults.imageMaxPollAttempts,
      imagePollIntervalMs: this.defaults.imagePollIntervalMs,
      imageSyncWaitBudgetMs: this.defaults.imageSyncWaitBudgetMs,
      updatedAt: Date.now()
    };
  }
}
