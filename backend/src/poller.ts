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

/** Holt die Abfahrtszeiten vom offiziellen Endpunkt und speichert die Antwort. */
export async function pollDepartureTimes(client: FordClient, store: Store, log: FastifyBaseLogger): Promise<void> {
  try {
    const changed = store.saveDepartureTimes(await client.departureTimes());
    log.info({ changed }, "Abfahrtszeiten abgefragt");
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      log.warn(err.message);
    } else if (err instanceof Error && err.message.includes(" 403")) {
      // Ford gibt den Endpunkt nicht für jedes Auto frei. Kein Absturz, nur ein Hinweis.
      log.warn(`Ford gibt die Abfahrtszeiten für dieses Auto nicht frei (${err.message})`);
    } else {
      log.error(err, "Abfrage der Abfahrtszeiten fehlgeschlagen");
    }
  }
}

const GARAGE_MAX_AGE_MS = 24 * 60 * 60_000;
const GARAGE_INTERVAL_MINUTES = 30;
// Zwei Minuten Abstand zur Telemetrie und eine zu den Abfahrtszeiten (Limit: etwa eine Anfrage pro Minute).
const GARAGE_OFFSET_MS = 2 * 60_000;

/**
 * Holt einmal am Tag Modell und Baujahr (/garage) für das Fahrzeugbild oben auf der Seite.
 * Wird alle 30 Minuten aufgerufen, fragt Ford aber nur, wenn die gespeicherten Daten fehlen
 * oder älter als einen Tag sind. So klappt es auch, wenn man sich erst später anmeldet.
 */
export async function pollGarage(client: FordClient, store: Store, log: FastifyBaseLogger, now = new Date()) {
  const last = store.garageFetchedAt();
  if (last && now.getTime() - Date.parse(last) < GARAGE_MAX_AGE_MS) return;
  try {
    store.saveGarage(await client.garage(), now);
    log.info("Fahrzeugdaten (Garage) abgefragt");
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      log.warn(err.message);
    } else {
      log.error(err, "Abfrage der Fahrzeugdaten fehlgeschlagen");
    }
  }
}

// Abfahrtszeiten ändern sich selten, daher nur alle 30 Minuten.
const DEPARTURE_INTERVAL_MINUTES = 30;
// Eine Minute Abstand zur Telemetrie-Abfrage, damit nicht zwei Anfragen in derselben Minute
// bei Ford ankommen (Limit: etwa eine Anfrage pro Minute).
const DEPARTURE_OFFSET_MS = 60_000;

export function startPoller(
  client: FordClient,
  store: Store,
  log: FastifyBaseLogger,
  intervalMinutes: number,
): () => void {
  void pollOnce(client, store, log);
  const timer = setInterval(() => void pollOnce(client, store, log), intervalMinutes * 60_000);

  let departureTimer: NodeJS.Timeout | undefined;
  const departureStart = setTimeout(() => {
    void pollDepartureTimes(client, store, log);
    departureTimer = setInterval(
      () => void pollDepartureTimes(client, store, log),
      DEPARTURE_INTERVAL_MINUTES * 60_000,
    );
  }, DEPARTURE_OFFSET_MS);

  let garageTimer: NodeJS.Timeout | undefined;
  const garageStart = setTimeout(() => {
    void pollGarage(client, store, log);
    garageTimer = setInterval(() => void pollGarage(client, store, log), GARAGE_INTERVAL_MINUTES * 60_000);
  }, GARAGE_OFFSET_MS);

  return () => {
    clearInterval(timer);
    clearTimeout(departureStart);
    clearInterval(departureTimer);
    clearTimeout(garageStart);
    clearInterval(garageTimer);
  };
}
