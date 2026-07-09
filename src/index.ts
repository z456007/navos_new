import { createHash } from "node:crypto";
import { loadConfig } from "./config/env.js";
import { YydsMailClient } from "./protocols/mail/yyds-mail.js";
import { VipClient } from "./protocols/vip-client.js";
import { createApp } from "./server/app.js";
import { AccountService } from "./services/account-service.js";
import { BullmqRegistrationQueue } from "./services/bullmq-registration-queue.js";
import { RegistrationJobService } from "./services/registration-job-service.js";
import { RegistrationService } from "./services/registration-service.js";
import { createRegistrationWorker } from "./services/registration-worker.js";
import { YydsMailConfigService } from "./services/yyds-mail-config-service.js";
import { SecretBox } from "./security/secretbox.js";
import { MysqlAccountStore } from "./store/mysql-account-store.js";
import { MysqlCosConfigStore } from "./store/cos-config-store.js";
import { MysqlYydsMailConfigStore } from "./store/yyds-mail-config-store.js";
import { MysqlVideoTaskStore } from "./store/video-task-store.js";

const DEFAULT_YYDS_MAIL_BASE_URL = "https://maliapi.215.im/v1";

function normalizeSecretRoot(value: string): string {
  return value.length >= 32 ? value : createHash("sha256").update(value).digest("hex");
}

const config = loadConfig();
await MysqlAccountStore.createDatabaseIfMissing(config.mysql);
const accountStore = new MysqlAccountStore(config.mysql);
const cosConfigStore = new MysqlCosConfigStore(config.mysql);
const yydsMailConfigStore = new MysqlYydsMailConfigStore(config.mysql);
const videoTaskStore = new MysqlVideoTaskStore(config.mysql);
await accountStore.ensureSchema();
await cosConfigStore.ensureSchema();
await yydsMailConfigStore.ensureSchema();
await videoTaskStore.ensureSchema();

if (config.defaultAccount) {
  await accountStore.upsert(config.defaultAccount);
}

const accountService = new AccountService(accountStore);
const yydsMailConfigService = new YydsMailConfigService(
  yydsMailConfigStore,
  new SecretBox(
    normalizeSecretRoot(config.cosConfigSecret ?? config.masterApiKey),
    "navos:yyds_mail_config:v1"
  )
);
const vipClient = new VipClient({
  baseUrl: config.vipBaseUrl,
  hmacSecret: config.vipHmacSecret,
  fetchImpl: undefined
});

const registrationService = new RegistrationService({
  yydsClientProvider: async () => {
    const apiKey = await yydsMailConfigService.enabledApiKey();
    return apiKey
      ? new YydsMailClient({
        baseUrl: DEFAULT_YYDS_MAIL_BASE_URL,
        apiKey
      })
      : undefined;
  },
  vipClient,
  accountService
});

const registrationQueue = new BullmqRegistrationQueue({
  redisUrl: config.redisUrl,
  queuePrefix: config.queuePrefix,
  removeOnComplete: config.registrationJobRemoveOnComplete,
  removeOnFail: config.registrationJobRemoveOnFail
});

const registrationJobService = new RegistrationJobService(registrationQueue, {
  defaultTarget: config.poolTargetSize > 0 ? config.poolTargetSize : 10,
  defaultConcurrency: config.registrationConcurrency
});

const registrationWorker = createRegistrationWorker({
  redisUrl: config.redisUrl,
  queuePrefix: config.queuePrefix,
  concurrency: config.registrationJobConcurrency,
  registrationService,
  isCancelRequested: (jobId) => registrationQueue.isCancelRequested(jobId),
  clearCancelRequest: (jobId) => registrationQueue.clearCancelRequest(jobId)
});

registrationWorker.on("error", () => {
  console.error("Registration worker infrastructure error");
});

const app = createApp({
  ...config,
  accountService,
  cosConfigSecret: config.cosConfigSecret,
  cosConfigStore,
  yydsMailConfigSecret: config.cosConfigSecret,
  yydsMailConfigStore,
  videoTaskStore,
  vipClient,
  registrationService,
  registrationJobService
});

app.addHook("onClose", async () => {
  try {
    await registrationWorker.close();
  } finally {
    await registrationQueue.close();
  }
});

await app.listen({ host: "0.0.0.0", port: config.listenPort });
console.log(`navos protocol adapter listening on :${config.listenPort}`);
