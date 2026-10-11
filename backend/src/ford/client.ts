// Spricht mit der FordConnect Query API. Die API ist nur lesend:
// Daten abfragen geht, Befehle (sperren, laden starten) gehen nicht.
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
      throw new Error(`Ford-API /${path} antwortet mit ${res.status}`);
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
}
