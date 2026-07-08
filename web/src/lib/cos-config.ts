import type { CosConfig } from "../types";

export type CosConfigForm = {
  enabled: boolean;
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  appId: string;
  publicDomain: string;
  uploadPrefix: string;
};

export const emptyCosConfigForm: CosConfigForm = {
  enabled: true,
  secretId: "",
  secretKey: "",
  bucket: "",
  region: "",
  appId: "",
  publicDomain: "",
  uploadPrefix: "navos/videos"
};

export function configToCosForm(config?: CosConfig): CosConfigForm {
  return {
    enabled: config?.enabled ?? true,
    secretId: "",
    secretKey: "",
    bucket: config?.bucket ?? "",
    region: config?.region ?? "",
    appId: config?.appId ?? "",
    publicDomain: config?.publicDomain ?? "",
    uploadPrefix: config?.uploadPrefix ?? "navos/videos"
  };
}
