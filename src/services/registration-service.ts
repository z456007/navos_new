import {
  YydsMailError,
  type YydsFailureKind,
  type YydsMailClient,
  type YydsMailbox
} from "../protocols/mail/yyds-mail.js";
import type { VipBalance, VipClient } from "../protocols/vip-client.js";
import type { AccountService } from "./account-service.js";

export interface RegistrationDomainPick {
  domain: string;
}

export interface RegistrationDomainRecorder {
  recordSuccess(domain: string): Promise<void>;
  recordFailure(domain: string, kind: YydsFailureKind, error: string): Promise<void>;
}

export interface RegistrationServiceOptions {
  yydsClient?: YydsMailClient;
  yydsClientProvider?: () => Promise<YydsMailClient | undefined> | YydsMailClient | undefined;
  vipClient: VipClient;
  accountService: AccountService;
  domainPicker?: () => Promise<RegistrationDomainPick | undefined> | RegistrationDomainPick | undefined;
  domainRecorder?: RegistrationDomainRecorder;
  /** Max poll attempts for verification code. Default 20. */
  maxPollAttempts?: number;
  /** Poll interval in milliseconds. Default 4000. */
  pollIntervalMs?: number;
  /** Max YYDS mailbox creation attempts when the provider rate-limits. Default 5. */
  maxMailboxCreateAttempts?: number;
  /** Base delay before retrying YYDS mailbox creation. Default 5000. */
  mailboxRetryDelayMs?: number;
  /** Minimum spacing between YYDS mailbox creation requests in this process. Default 1200. */
  mailboxMinIntervalMs?: number;
}

export interface RegistrationResult {
  success: boolean;
  uid?: string;
  token?: string;
  email?: string;
  mailboxToken?: string;
  balance?: number;
  certCredits?: number;
  error?: string;
  domain?: string;
  failureKind?: YydsFailureKind;
  elapsedMs?: number;
  retryCount?: number;
}

export interface FillResult {
  target: number;
  started: number;
  completed: number;
  failed: number;
  elapsedMs: number;
  results: RegistrationResult[];
}

export interface RegistrationStats {
  poolSize: number;
  activeCount: number;
  depletedCount: number;
  disabledCount: number;
}

// 1x1 white pixel JPEG, embedded so no PIL dependency needed
const MINI_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
  0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
  0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
  0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0xf7, 0xfa, 0x28, 0xa2,
  0x80, 0x3f, 0xff, 0xd9
]);

function miniJpegBase64(): string {
  return Buffer.from(MINI_JPEG_BYTES).toString("base64");
}

// Chinese random company info generators
const COMPANY_PREFIXES = [
  "星辰", "远航", "鼎新", "锐进", "博创", "智联",
  "华宇", "腾飞", "启明", "汇通", "鑫源", "蓝图",
  "恒达", "万通", "丰源"
];

const COMPANY_SUFFIXES = [
  "科技", "信息技术", "网络", "数字", "智能",
  "云计算", "大数据", "物联网"
];

const INDUSTRIES = [
  "ELECTRONICS", "BEAUTY", "FASHION", "LIFESTYLE", "FMCG",
  "TOOL", "FINANCE", "SOCIAL", "SITE_NETWORK", "LIFE_APP"
];

const SURNAMES = [
  "Zhang", "Wang", "Li", "Liu", "Chen", "Yang",
  "Huang", "Zhao", "Wu", "Zhou", "Xu", "Sun", "Ma", "Zhu", "Hu"
];

const GIVENS = [
  "Wei", "Jie", "Ming", "Lei", "Fang", "Hong",
  "Qiang", "Juan", "Na", "Tao", "Lin", "Yu", "Rui", "Hao", "Kai"
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randLetter(): string {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

export function generateCompanyInfo(): {
  companyName: string;
  website: string;
  contactPerson: string;
  contactPhone: string;
  industry: string;
} {
  const prefix = pick(COMPANY_PREFIXES);
  const suffix = pick(COMPANY_SUFFIXES);
  const letter = randLetter();
  const companyName = `${prefix}${suffix}(${letter}) Ltd`;

  const domainLen = 5 + Math.floor(Math.random() * 6);
  let domain = "";
  for (let i = 0; i < domainLen; i++) {
    domain += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
  const website = `https://${domain}.com`;

  const contactPerson = `${pick(SURNAMES)} ${pick(GIVENS)}`;

  const phoneBase = 13800000000 + Math.floor(Math.random() * 200000000);
  const contactPhone = `86${phoneBase}`;

  const industry = pick(INDUSTRIES);

  return { companyName, website, contactPerson, contactPhone, industry };
}

export class RegistrationService {
  private readonly yydsClient?: YydsMailClient;
  private readonly yydsClientProvider?: () => Promise<YydsMailClient | undefined> | YydsMailClient | undefined;
  private readonly vipClient: VipClient;
  private readonly accountService: AccountService;
  private readonly domainPicker?: () => Promise<RegistrationDomainPick | undefined> | RegistrationDomainPick | undefined;
  private readonly domainRecorder?: RegistrationDomainRecorder;
  private readonly maxPollAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly maxMailboxCreateAttempts: number;
  private readonly mailboxRetryDelayMs: number;
  private readonly mailboxMinIntervalMs: number;
  private mailboxCreateGate: Promise<void> = Promise.resolve();
  private lastMailboxCreateStartedAt = 0;

  constructor(options: RegistrationServiceOptions) {
    this.yydsClient = options.yydsClient;
    this.yydsClientProvider = options.yydsClientProvider;
    this.vipClient = options.vipClient;
    this.accountService = options.accountService;
    this.domainPicker = options.domainPicker;
    this.domainRecorder = options.domainRecorder;
    this.maxPollAttempts = options.maxPollAttempts ?? 20;
    this.pollIntervalMs = options.pollIntervalMs ?? 4000;
    this.maxMailboxCreateAttempts = Math.max(1, options.maxMailboxCreateAttempts ?? 5);
    this.mailboxRetryDelayMs = Math.max(0, options.mailboxRetryDelayMs ?? 5000);
    this.mailboxMinIntervalMs = Math.max(0, options.mailboxMinIntervalMs ?? 1200);
  }

  /** Full registration pipeline for a single account. */
  async registerOne(): Promise<RegistrationResult> {
    const startedAt = Date.now();
    let pickedDomain: string | undefined;
    let resultDomain: string | undefined;
    let email: string | undefined;
    let retryCount: number | undefined;
    let phase: "pick_domain" | "mailbox_create" | "send_code" | "poll" | "login" | "import" = "pick_domain";

    try {
      // 1. Create temp mailbox via YYDS
      pickedDomain = (await this.domainPicker?.())?.domain;
      phase = "mailbox_create";
      const mailboxResult = await this.createMailboxWithRetry(pickedDomain);
      const mailbox = mailboxResult.mailbox;
      retryCount = mailboxResult.retryCount;
      email = mailbox.address;
      const mailboxToken = mailbox.token;
      resultDomain = domainFromEmail(email) ?? mailbox.domain ?? pickedDomain;

      // 2. Send verification code via VIP API
      phase = "send_code";
      await this.vipClient.sendEmailCode(email);

      // 3. Poll YYDS mailbox for verification code
      phase = "poll";
      const pollResult = await this.pollVerificationCode(email, mailboxToken);
      if (pollResult.failure) {
        return {
          success: false,
          email,
          error: pollResult.failure.message,
          domain: resultDomain,
          failureKind: pollResult.failure.failureKind,
          elapsedMs: Date.now() - startedAt,
          retryCount
        };
      }
      if (!pollResult.code) {
        const error = "verification code not received";
        await this.recordDomainFailureBestEffort(this.recordableDomain(pickedDomain, resultDomain), "verification_timeout", error);
        return {
          success: false,
          email,
          error,
          domain: resultDomain,
          failureKind: "verification_timeout",
          elapsedMs: Date.now() - startedAt,
          retryCount
        };
      }

      // 4. Login/register via VIP API
      phase = "login";
      const { uid, token } = await this.vipClient.login(email, pollResult.code);

      // 5. Query initial balance (should be 1000 from registration)
      const balReg = await this.queryBalanceOrZero(uid, token);

      // 6. Enterprise certification (+1000 credits)
      let certCredits = 0;
      try {
        const licenseB64 = miniJpegBase64();
        const licenseUrl = await this.vipClient.uploadBusinessLicense(uid, token, licenseB64);
        const company = generateCompanyInfo();
        certCredits = await this.vipClient.submitEnterpriseCert(uid, token, {
          businessLicenseUrl: licenseUrl,
          ...company
        });
      } catch {
        // Enterprise cert failed, but account is still usable (1000 credits)
        certCredits = 0;
      }

      const balanceRemaining = balReg.availableBalance + certCredits;
      const balanceTotal = balReg.totalBalance + certCredits;

      // 7. Import into account pool
      phase = "import";
      await this.accountService.importAccount({
        uid,
        token,
        mailboxAddr: email,
        mailboxToken,
        balanceRemaining,
        balanceTotal,
        status: "active"
      });

      await this.recordDomainSuccessBestEffort(this.recordableDomain(pickedDomain, resultDomain));

      return {
        success: true,
        uid,
        token,
        email,
        mailboxToken,
        balance: balanceRemaining,
        certCredits,
        domain: resultDomain,
        elapsedMs: Date.now() - startedAt,
        retryCount
      };
    } catch (error) {
      retryCount ??= mailboxCreateAttempts(error);
      const message = error instanceof Error ? error.message : "registration failed";
      const failureKind: YydsFailureKind = error instanceof YydsMailError ? error.failureKind : "unknown";
      const domain = resultDomain ?? pickedDomain ?? domainFromEmail(email);
      if (phase === "mailbox_create" && isDomainAttributableMailboxCreateError(error)) {
        await this.recordDomainFailureBestEffort(this.recordableDomain(pickedDomain, domain), failureKind, message);
      }
      return {
        success: false,
        error: message,
        domain,
        failureKind,
        elapsedMs: Date.now() - startedAt,
        retryCount
      };
    }
  }

  /** Fill the pool up to `target` active accounts. */
  async fillPool(target: number, concurrency: number = 5): Promise<FillResult> {
    const accounts = await this.accountService.listAccounts();
    const active = accounts.filter((a) => a.status === "active").length;
    const need = Math.max(0, target - active);

    if (need <= 0) {
      return {
        target,
        started: 0,
        completed: 0,
        failed: 0,
        elapsedMs: 0,
        results: []
      };
    }

    const startedAt = Date.now();
    const results: RegistrationResult[] = [];

    // Process in batches with concurrency limit
    for (let i = 0; i < need; i += concurrency) {
      const batchSize = Math.min(concurrency, need - i);
      const batch = Array.from({ length: batchSize }, () => this.registerOne());
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);

      const completed = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      console.log(
        `[registration] batch ${Math.floor(i / concurrency) + 1}: ` +
        `${completed} ok, ${failed} fail (${completed + failed}/${need})`
      );
    }

    return {
      target,
      started: need,
      completed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      elapsedMs: Date.now() - startedAt,
      results
    };
  }

  /** Get current pool statistics. */
  async getStats(): Promise<RegistrationStats> {
    const accounts = await this.accountService.listAccounts();
    return {
      poolSize: accounts.length,
      activeCount: accounts.filter((a) => a.status === "active").length,
      depletedCount: accounts.filter((a) => a.status === "depleted").length,
      disabledCount: accounts.filter((a) => a.status === "disabled").length
    };
  }

  private async pollVerificationCode(
    email: string,
    mailboxToken?: string
  ): Promise<{ code?: string; failure?: { message: string; failureKind: YydsFailureKind } }> {
    const auth = { address: email, token: mailboxToken };
    const yydsClient = await this.resolveYydsClient();
    let lastPollFailure: { message: string; failureKind: YydsFailureKind } | undefined;

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      if (attempt > 0) {
        await sleep(this.pollIntervalMs);
      }

      try {
        const result = await yydsClient.findVerificationCode(auth);
        if (result.code) {
          return { code: result.code };
        }
      } catch (error) {
        if (error instanceof YydsMailError) {
          lastPollFailure = {
            message: error.message,
            failureKind: "message_poll_failed"
          };
        } else {
          lastPollFailure = {
            message: error instanceof Error && error.message ? error.message : "YYDS message polling failed",
            failureKind: "message_poll_failed"
          };
        }
        // Continue polling on transient errors
      }
    }

    if (lastPollFailure) {
      return { failure: lastPollFailure };
    }
    return {};
  }

  private async queryBalanceOrZero(uid: string, token: string): Promise<VipBalance> {
    try {
      return await this.vipClient.queryBalance(uid, token);
    } catch {
      return { availableBalance: 0, totalBalance: 0 };
    }
  }

  private async createMailboxWithRetry(domain?: string): Promise<{ mailbox: YydsMailbox; retryCount: number }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxMailboxCreateAttempts; attempt++) {
      try {
        return {
          mailbox: await this.createMailboxInThrottledSlot(domain),
          retryCount: attempt - 1
        };
      } catch (error) {
        lastError = error;
        if (!isMailboxRateLimitError(error) || attempt >= this.maxMailboxCreateAttempts) {
          throw withMailboxCreateAttempts(error, attempt - 1);
        }
        await sleep(this.mailboxRetryDelayMs * attempt);
      }
    }
    throw withMailboxCreateAttempts(
      lastError instanceof Error ? lastError : new Error("YYDS mailbox creation failed"),
      this.maxMailboxCreateAttempts - 1
    );
  }

  private async createMailboxInThrottledSlot(domain?: string): Promise<YydsMailbox> {
    const previousGate = this.mailboxCreateGate;
    let releaseGate!: () => void;
    this.mailboxCreateGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    await previousGate;
    try {
      const elapsed = Date.now() - this.lastMailboxCreateStartedAt;
      const waitMs = this.lastMailboxCreateStartedAt > 0
        ? Math.max(0, this.mailboxMinIntervalMs - elapsed)
        : 0;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.lastMailboxCreateStartedAt = Date.now();
      return await (await this.resolveYydsClient()).createMailbox(domain ? { domain } : undefined);
    } finally {
      releaseGate();
    }
  }

  private async recordDomainSuccessBestEffort(domain: string | undefined): Promise<void> {
    if (!domain || !this.domainRecorder) {
      return;
    }
    try {
      await this.domainRecorder.recordSuccess(domain);
    } catch {
      // Domain health recording is best effort and should not fail registration.
    }
  }

  private async recordDomainFailureBestEffort(
    domain: string | undefined,
    kind: YydsFailureKind,
    error: string
  ): Promise<void> {
    if (!domain || !this.domainRecorder) {
      return;
    }
    try {
      await this.domainRecorder.recordFailure(domain, kind, error);
    } catch {
      // Domain health recording is best effort and should not mask registration failure.
    }
  }

  private recordableDomain(pickedDomain: string | undefined, domain: string | undefined): string | undefined {
    if (!pickedDomain || !domain) {
      return undefined;
    }
    return normalizeComparableDomain(pickedDomain) === normalizeComparableDomain(domain) ? domain : undefined;
  }

  private async resolveYydsClient(): Promise<YydsMailClient> {
    const client = this.yydsClientProvider
      ? await this.yydsClientProvider()
      : this.yydsClient;
    if (!client) {
      throw new Error("YYDS Mail API key is not configured");
    }
    return client;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function domainFromEmail(email: string | undefined): string | undefined {
  const domain = email?.split("@").at(-1);
  return domain && domain !== email ? domain : undefined;
}

function normalizeComparableDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function isMailboxRateLimitError(error: unknown): boolean {
  if (error instanceof YydsMailError && error.status === 429) {
    return true;
  }
  return error instanceof Error
    && /too many account creation requests|rate.?limit|429/i.test(error.message);
}

function isDomainAttributableMailboxCreateError(error: unknown): error is YydsMailError {
  return error instanceof YydsMailError && error.failureKind === "domain_rejected";
}

function withMailboxCreateAttempts(error: unknown, attempts: number): unknown {
  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, "mailboxCreateAttempts", {
        value: attempts,
        configurable: true
      });
    } catch {
      // Fall through and throw the original error unchanged if it cannot be annotated.
    }
  }
  return error;
}

function mailboxCreateAttempts(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const attempts = (error as { mailboxCreateAttempts?: unknown }).mailboxCreateAttempts;
  return typeof attempts === "number" && Number.isFinite(attempts) ? attempts : undefined;
}
