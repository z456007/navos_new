import type { RuntimeConfigStore } from "../store/runtime-config-store.js";

export interface RuntimeConfigView {
  imageAllowVideoReserveFallback: boolean;
  updatedAt: number;
}

export interface RuntimeConfigDefaults {
  imageAllowVideoReserveFallback: boolean;
}

export interface RuntimeConfigUpdateInput {
  imageAllowVideoReserveFallback?: unknown;
}

export class RuntimeConfigService {
  constructor(
    private readonly store: RuntimeConfigStore,
    private readonly defaults: RuntimeConfigDefaults
  ) {}

  async get(): Promise<RuntimeConfigView> {
    const stored = await this.store.get();
    return normalizeRuntimeConfig({
      imageAllowVideoReserveFallback: stored?.imageAllowVideoReserveFallback ?? this.defaults.imageAllowVideoReserveFallback,
      updatedAt: stored?.updatedAt ?? 0
    });
  }

  async update(input: RuntimeConfigUpdateInput): Promise<RuntimeConfigView> {
    const current = await this.get();
    const next: RuntimeConfigView = {
      ...current,
      updatedAt: Date.now()
    };
    if (input.imageAllowVideoReserveFallback !== undefined) {
      if (typeof input.imageAllowVideoReserveFallback !== "boolean") {
        throw new Error("imageAllowVideoReserveFallback must be a boolean");
      }
      next.imageAllowVideoReserveFallback = input.imageAllowVideoReserveFallback;
    }
    return normalizeRuntimeConfig(await this.store.save(next));
  }
}

function normalizeRuntimeConfig(input: RuntimeConfigView): RuntimeConfigView {
  return {
    imageAllowVideoReserveFallback: Boolean(input.imageAllowVideoReserveFallback),
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : 0
  };
}
