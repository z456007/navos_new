import type { RuntimeConfigStore } from "../store/runtime-config-store.js";
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfigInput,
  type RuntimeConfigUpdateInput,
  type RuntimeConfigView
} from "./runtime-config-schema.js";

export type { RuntimeConfigUpdateInput, RuntimeConfigView } from "./runtime-config-schema.js";

export class RuntimeConfigService {
  constructor(
    private readonly store: RuntimeConfigStore,
    private readonly defaults: RuntimeConfigView = DEFAULT_RUNTIME_CONFIG
  ) {}

  async get(): Promise<RuntimeConfigView> {
    const stored = await this.store.get();
    return normalizeRuntimeConfigInput(stored ?? {}, { ...this.defaults, updatedAt: stored?.updatedAt ?? 0 });
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
}
