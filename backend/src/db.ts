// Speichert Login-Tokens und Messwerte in einer SQLite-Datei.
// node:sqlite ist in Node.js eingebaut, es braucht also kein extra Paket.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Tokens } from "./ford/auth.js";
import type { VehicleSnapshot } from "./ford/telemetry.js";

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(dataDir === ":memory:" ? ":memory:" : join(dataDir, "ford.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vin TEXT NOT NULL,
        ts TEXT NOT NULL,
        soc_pct REAL,
        range_km REAL,
        odometer_km REAL,
        lat REAL,
        lon REAL,
        plug_status TEXT,
        charge_status TEXT,
        raw TEXT NOT NULL,
        UNIQUE (vin, ts)
      );
    `);
  }

  loadTokens(): Tokens | undefined {
    const row = this.db.prepare("SELECT data FROM tokens WHERE id = 1").get() as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as Tokens) : undefined;
  }

  saveTokens(tokens: Tokens): void {
    this.db
      .prepare("INSERT INTO tokens (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(JSON.stringify(tokens));
  }

  /** Speichert einen Messwert. Gibt false zurück, wenn es ihn schon gab (Auto schläft, gleiche Daten). */
  saveSnapshot(s: VehicleSnapshot): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO snapshots
         (vin, ts, soc_pct, range_km, odometer_km, lat, lon, plug_status, charge_status, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.vin,
        s.ts,
        s.socPct,
        s.rangeKm,
        s.odometerKm,
        s.lat,
        s.lon,
        s.plugStatus,
        s.chargeStatus,
        JSON.stringify(s.raw),
      );
    return result.changes > 0;
  }

  latestSnapshots(): Omit<VehicleSnapshot, "raw">[] {
    const rows = this.db
      .prepare(
        `SELECT vin, ts, soc_pct, range_km, odometer_km, lat, lon, plug_status, charge_status
         FROM snapshots s
         WHERE ts = (SELECT MAX(ts) FROM snapshots WHERE vin = s.vin)`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      vin: r.vin as string,
      ts: r.ts as string,
      socPct: r.soc_pct as number | null,
      rangeKm: r.range_km as number | null,
      odometerKm: r.odometer_km as number | null,
      lat: r.lat as number | null,
      lon: r.lon as number | null,
      plugStatus: r.plug_status as string | null,
      chargeStatus: r.charge_status as string | null,
    }));
  }
}
