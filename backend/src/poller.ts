// Fragt in regelmäßigen Abständen die Ford-API ab und speichert neue Messwerte.
import type { FastifyBaseLogger } from "fastify";
import type { Store } from "./db.js";
import { NotLoggedInError } from "./ford/auth.js";
import type { FordClient } from "./ford/client.js";
import { parseTelemetry } from "./ford/telemetry.js";

export async function pollOnce(client: FordClient, store: Store, log: FastifyBaseLogger): Promise<void> {
  try {
    const snapshots = parseTelemetry(await client.telemetry());
    const saved = snapshots.filter((s) => store.saveSnapshot(s)).length;
    log.info({ received: snapshots.length, saved }, "Ford-Daten abgefragt");
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      log.warn(err.message);
    } else {
      log.error(err, "Abfrage bei Ford fehlgeschlagen");
    }
  }
}

export function startPoller(
  client: FordClient,
  store: Store,
  log: FastifyBaseLogger,
  intervalMinutes: number,
): () => void {
  void pollOnce(client, store, log);
  const timer = setInterval(() => void pollOnce(client, store, log), intervalMinutes * 60_000);
  return () => clearInterval(timer);
}
