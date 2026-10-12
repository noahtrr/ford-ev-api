// Startpunkt der App.
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { FordClient } from "./ford/client.js";
import { reverseGeocode } from "./geocode.js";
import { startPoller } from "./poller.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const store = new Store(config.dataDir);
const client = new FordClient(config.ford, store);
const publicDir = process.env.PUBLIC_DIR ?? fileURLToPath(new URL("../../frontend/dist", import.meta.url));

// REVERSE_GEOCODING=off schaltet das Nachschlagen der Adressen zu Ladeorten aus.
const lookupAddress = process.env.REVERSE_GEOCODING === "off" ? undefined : reverseGeocode;
const app = buildServer(config, store, client, publicDir, lookupAddress);
startPoller(client, store, app.log, config.pollIntervalMinutes);
await app.listen({ port: config.port, host: "0.0.0.0" });
