import { loadConfig } from "./config/env.js";
import { createApp } from "./server/app.js";

const config = loadConfig();
const app = createApp(config);

await app.listen({ host: "0.0.0.0", port: config.listenPort });
console.log(`navos protocol adapter listening on :${config.listenPort}`);

