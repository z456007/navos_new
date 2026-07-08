import { loadConfig } from "./config/env.js";
import { createApp } from "./server/app.js";
import { AccountService } from "./services/account-service.js";
import { MysqlAccountStore } from "./store/mysql-account-store.js";
import { MysqlCosConfigStore } from "./store/cos-config-store.js";
import { MysqlVideoTaskStore } from "./store/video-task-store.js";

const config = loadConfig();
await MysqlAccountStore.createDatabaseIfMissing(config.mysql);
const accountStore = new MysqlAccountStore(config.mysql);
const cosConfigStore = new MysqlCosConfigStore(config.mysql);
const videoTaskStore = new MysqlVideoTaskStore(config.mysql);
await accountStore.ensureSchema();
await cosConfigStore.ensureSchema();
await videoTaskStore.ensureSchema();

if (config.defaultAccount) {
  await accountStore.upsert(config.defaultAccount);
}

const app = createApp({
  ...config,
  accountService: new AccountService(accountStore),
  cosConfigSecret: config.cosConfigSecret,
  cosConfigStore,
  videoTaskStore
});

await app.listen({ host: "0.0.0.0", port: config.listenPort });
console.log(`navos protocol adapter listening on :${config.listenPort}`);
