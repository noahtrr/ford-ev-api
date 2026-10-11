// Spricht mit der FordConnect Query API. Die API ist nur lesend:
// Daten abfragen geht, Befehle (sperren, laden starten) gehen nicht.
// Pfade und Anmeldung (Bearer-Token) wie in Fords Postman-Sammlung FordConnect-2.0.postman_collection.json.
import type { Config } from "../config.js";
import type { Store } from "../db.js";
import { getAccessToken } from "./auth.js";

export class FordClient {
  constructor(
    private ford: Config["ford"],
    private store: Store,
  ) {}

  private async get(path: string): Promise<unknown> {
    const token = await getAccessToken(this.ford, this.store);
    const res = await fetch(`${this.ford.apiBase}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      throw new Error("Ford meldet: zu viele Anfragen (429). Später erneut versuchen.");
    }
    if (!res.ok) {
      const message = await errorMessage(res);
      throw new Error(`Ford-API /${path} antwortet mit ${res.status}${message ? `: ${message}` : ""}`);
    }
    return res.json();
  }

  /** Liste deiner Fahrzeuge. */
  garage(): Promise<unknown> {
    return this.get("garage");
  }

  /** Aktuelle Messwerte (Akku, Reichweite, Standort, ...). */
  telemetry(): Promise<unknown> {
    return this.get("telemetry");
  }

  /** Abfahrtszeiten über den offiziellen Endpunkt für Elektroautos. */
  departureTimes(): Promise<unknown> {
    return this.get("electric/departure-times");
  }
}

/**
 * Laut Ford-Doku schickt die API bei Fehlern ein JSON wie
 * { "error": 400, "message": "Bad Request", "traceId": "...", ... }.
 * Bei 401/403 kann es auch eine HTML-Seite sein, dann gibt es keine Meldung.
 */
export async function errorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: unknown; traceId?: unknown };
    if (typeof body?.message !== "string" || body.message === "") return null;
    return typeof body.traceId === "string" ? `${body.message} (traceId ${body.traceId})` : body.message;
  } catch {
    return null;
  }
}
