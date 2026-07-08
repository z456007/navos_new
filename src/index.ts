import { loadConfig } from "./config/env.js";
import { YydsMailClient } from "./protocols/mail/yyds-mail.js";
import { VipClient } from "./protocols/vip-client.js";
import { createApp } from "./server/app.js";
import { AccountService } from "./services/account-service.js";
import { RegistrationService } from "./services/registration-service.js";
import { MysqlAccountStore } from "./store/mysql-account-store.js";
import { MysqlCosConfigStore } from "./store/cos-config-store.js";
import { MysqlYydsMailConfigStore } from "./store/yyds-mail-config-store.js";
import { MysqlVideoTaskStore } from "./store/video-task-store.js";

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
const vipClient = new VipClient({
  baseUrl: config.vipBaseUrl,
  hmacSecret: config.vipHmacSecret,
  fetchImpl: undefined
});

const yydsMailApiKey = config.yydsMailApiKey;
const yydsClient = new YydsMailClient({
  baseUrl: config.yydsMailBaseUrl,
  apiKey: yydsMailApiKey ?? ""
});

const registrationService = new RegistrationService({
  yydsClient,
  vipClient,
  accountService
});

const app = createApp({
  ...config,
  accountService,
  cosConfigSecret: config.cosConfigSecret,
  cosConfigStore,
  yydsMailConfigSecret: config.cosConfigSecret,
  yydsMailConfigStore,
  videoTaskStore,
  registrationService
});

await app.listen({ host: "0.0.0.0", port: config.listenPort });
console.log(`navos protocol adapter listening on :${config.listenPort}`);
