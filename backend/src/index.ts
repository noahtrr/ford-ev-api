// Startpunkt der App.
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { FordClient } from "./ford/client.js";
import { startPoller } from "./poller.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const store = new Store(config.dataDir);
const client = new FordClient(config.ford, store);
const publicDir = process.env.PUBLIC_DIR ?? fileURLToPath(new URL("../../frontend/dist", import.meta.url));

const app = buildServer(config, store, client, publicDir);
startPoller(client, store, app.log, config.pollIntervalMinutes);
await app.listen({ port: config.port, host: "0.0.0.0" });
