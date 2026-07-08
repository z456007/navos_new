import { createHmac } from "node:crypto";
import type { FetchLike } from "./http.js";

export interface VipClientOptions {
  baseUrl: string;
  hmacSecret: string;
  fetchImpl?: FetchLike;
}

export interface VipResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T;
  error?: string;
}

export class VipClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "VipClientError";
  }
}

interface VipCommon {
  token: string;
  uid: string;
  open_id: string;
  app_id: string;
  device_id: string;
  platform: string;
  lang: string;
  version: string;
  channel: string;
  tryno: string;
  oemid: string;
}

const DEFAULT_COMMON: Omit<VipCommon, "token" | "uid" | "open_id"> = {
  app_id: "1000",
  device_id: "",
  platform: "web",
  lang: "zhCN",
  version: "0",
  channel: "1600",
  tryno: "1600",
  oemid: ""
};

export class VipClient {
  private readonly baseUrl: string;
  private readonly hmacSecret: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: VipClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.hmacSecret = options.hmacSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Send verification code to email. uid/token optional (pass "0"/"" before registration). */
  async sendEmailCode(email: string): Promise<void> {
    const result = await this.request<{ resp_common?: { ret?: number; msg?: string } }>(
      "/api/user/email/send_email_code",
      { email, template_scene: "login" },
      "0",
      ""
    );
    if (!result.ok) {
      throw new VipClientError(
        result.error ?? "sendEmailCode failed",
        result.status,
        result.body
      );
    }
    const ret = result.body.resp_common?.ret;
    if (ret !== undefined && ret !== 0 && ret !== 200) {
      throw new VipClientError(
        result.body.resp_common?.msg ?? `sendEmailCode returned ret=${ret}`,
        result.status,
        result.body
      );
    }
  }

  /** Login/register with email + verification code. login_type=9 is email-based. */
  async login(
    email: string,
    code: string
  ): Promise<{ uid: string; token: string }> {
    const body: Record<string, unknown> = {
      login_type: 9,
      email_params: { email, email_verify_code: code },
      user_attributes: { register_time_zone: "Asia/Shanghai" }
    };
    const result = await this.request<{
      resp_common?: { ret?: number; msg?: string };
      uid?: string;
      token?: string;
    }>("/api/user/login", body, "0", "");

    if (!result.ok) {
      throw new VipClientError(
        result.error ?? "login failed",
        result.status,
        result.body
      );
    }

    const uid = result.body.uid;
    const token = result.body.token;
    if (!uid || !token) {
      const msg = result.body.resp_common?.msg ?? "login did not return uid/token";
      throw new VipClientError(msg, result.status, result.body);
    }

    return { uid, token };
  }

  /** Query available balance for an account. */
  async queryBalance(uid: string, token: string): Promise<number> {
    const result = await this.request<{
      data?: { available_balance?: number };
      resp_common?: { ret?: number };
    }>(
      "/api/v1/balancebatch/query/balance",
      { currency_id: 1, uid },
      uid,
      token
    );

    if (!result.ok) {
      return 0;
    }
    return result.body.data?.available_balance ?? 0;
  }

  /**
   * Upload a business license image (base64-encoded JPEG).
   * Returns the URL of the uploaded image for use in certification submission.
   */
  async uploadBusinessLicense(
    uid: string,
    token: string,
    imageBase64: string,
    fileName: string = "lic.jpg"
  ): Promise<string> {
    const result = await this.request<{
      data?: { url?: string };
      resp_common?: { ret?: number; msg?: string };
    }>(
      "/api/v1/enterprise/certification/upload/business-license",
      { image_base64: imageBase64, file_name: fileName, mime_type: "image/jpeg" },
      uid,
      token
    );

    if (!result.ok) {
      throw new VipClientError(
        result.error ?? "uploadBusinessLicense failed",
        result.status,
        result.body
      );
    }

    const url = result.body.data?.url;
    if (!url) {
      throw new VipClientError(
        result.body.resp_common?.msg ?? "uploadBusinessLicense did not return a URL",
        result.status,
        result.body
      );
    }

    return url;
  }

  /** Submit enterprise certification. Returns the number of credits awarded (typically 1000). */
  async submitEnterpriseCert(
    uid: string,
    token: string,
    params: {
      businessLicenseUrl: string;
      companyName: string;
      website: string;
      contactPerson: string;
      contactPhone: string;
      industry: string;
    }
  ): Promise<number> {
    const result = await this.request<{
      resp_common?: { ret?: number; msg?: string };
    }>(
      "/api/v1/enterprise/certification/submit",
      {
        business_license: params.businessLicenseUrl,
        company_name: params.companyName,
        website: params.website,
        contact_person: params.contactPerson,
        contact_phone: params.contactPhone,
        industry: params.industry
      },
      uid,
      token
    );

    if (!result.ok) {
      throw new VipClientError(
        result.error ?? "submitEnterpriseCert failed",
        result.status,
        result.body
      );
    }

    const ret = result.body.resp_common?.ret;
    if (ret !== undefined && ret !== 0 && ret !== 200) {
      throw new VipClientError(
        result.body.resp_common?.msg ?? `submitEnterpriseCert returned ret=${ret}`,
        result.status,
        result.body
      );
    }

    return 1000;
  }

  /**
   * Core request method. Signs the full JSON body with HMAC-MD5.
   * The `common` block is appended LAST to match the expected key order.
   */
  private async request<T>(
    path: string,
    businessFields: Record<string, unknown>,
    uid: string,
    token: string
  ): Promise<VipResult<T>> {
    const common: VipCommon = {
      ...DEFAULT_COMMON,
      token,
      uid,
      open_id: uid
    };

    // Build body with business fields first, then common last.
    // Object key insertion order is preserved (ES2015+).
    const body: Record<string, unknown> = { ...businessFields };
    body.common = common;

    const raw = JSON.stringify(body);

    const signature = createHmac("md5", this.hmacSecret)
      .update(raw)
      .digest("hex");

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: signature,
          "user-agent": "NavosProtocolAdapter/0.1"
        },
        body: raw
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        body: null as T,
        error: err instanceof Error ? err.message : "fetch failed"
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    let parsed: unknown;
    if (contentType.includes("application/json")) {
      parsed = await response.json();
    } else {
      parsed = await response.text();
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body: parsed as T,
        error: `VIP API returned ${response.status}`
      };
    }

    return { ok: true, status: response.status, body: parsed as T };
  }
}
