// Speichert Login-Tokens und Messwerte in einer SQLite-Datei.
// node:sqlite ist in Node.js eingebaut, es braucht also kein extra Paket.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Tokens } from "./ford/auth.js";
import { parseGarage, type VehicleInfo } from "./ford/garage.js";
import type { OdometerReading } from "./odometer.js";
import { parseBodyStatus, parseDepartureTimes, type VehicleSnapshot } from "./ford/telemetry.js";

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
      CREATE TABLE IF NOT EXISTS garage (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fetched_at TEXT NOT NULL,
        raw TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS departure_times (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fetched_at TEXT NOT NULL,
        raw TEXT NOT NULL
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
        `SELECT vin, ts, soc_pct, range_km, odometer_km, lat, lon, plug_status, charge_status, raw
         FROM snapshots s
         WHERE ts = (SELECT MAX(ts) FROM snapshots WHERE vin = s.vin)`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => {
      const metrics = (JSON.parse(r.raw as string) as { metrics?: unknown }).metrics;
      return {
        vin: r.vin as string,
        ts: r.ts as string,
        socPct: r.soc_pct as number | null,
        rangeKm: r.range_km as number | null,
        odometerKm: r.odometer_km as number | null,
        lat: r.lat as number | null,
        lon: r.lon as number | null,
        plugStatus: r.plug_status as string | null,
        chargeStatus: r.charge_status as string | null,
        // Abfahrtszeiten werden aus der gespeicherten Ford-Antwort gelesen, so gibt es sie
        // auch für Messwerte, die vor dieser Funktion gespeichert wurden.
        departures: parseDepartureTimes(metrics),
        // Türen, Fenster, 12-V-Batterie und Alarm genauso.
        ...parseBodyStatus(metrics),
      };
    });
  }

  /** Alle gespeicherten Kilometerstände eines Autos, älteste zuerst. */
  odometerReadings(vin: string): OdometerReading[] {
    return this.db
      .prepare("SELECT ts, odometer_km AS km FROM snapshots WHERE vin = ? AND odometer_km IS NOT NULL ORDER BY ts")
      .all(vin) as unknown as OdometerReading[];
  }

  /** Die Fahrgestellnummern aller Autos, für die es Messwerte gibt. */
  vins(): string[] {
    return (this.db.prepare("SELECT DISTINCT vin FROM snapshots ORDER BY vin").all() as { vin: string }[]).map((r) => r.vin);
  }

  /**
   * Speichert die Antwort von /electric/departure-times.
   * Gibt false zurück, wenn sie genauso aussieht wie die letzte gespeicherte.
   */
  saveDepartureTimes(raw: unknown, now = new Date()): boolean {
    const json = JSON.stringify(raw);
    const last = this.db.prepare("SELECT raw FROM departure_times ORDER BY id DESC LIMIT 1").get() as
      | { raw: string }
      | undefined;
    if (last?.raw === json) return false;
    this.db.prepare("INSERT INTO departure_times (fetched_at, raw) VALUES (?, ?)").run(now.toISOString(), json);
    return true;
  }

  /** Die zuletzt gespeicherte Antwort von /electric/departure-times, so wie Ford sie geschickt hat. */
  latestDepartureTimes(): { fetchedAt: string; data: unknown } | null {
    const row = this.db.prepare("SELECT fetched_at, raw FROM departure_times ORDER BY id DESC LIMIT 1").get() as
      | { fetched_at: string; raw: string }
      | undefined;
    return row ? { fetchedAt: row.fetched_at, data: JSON.parse(row.raw) } : null;
  }

  /** Speichert die Antwort von /garage (Modell, Baujahr, ...). Es gibt immer nur die neueste. */
  saveGarage(raw: unknown, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO garage (id, fetched_at, raw) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, raw = excluded.raw`,
      )
      .run(now.toISOString(), JSON.stringify(raw));
  }

  /** Wann /garage zuletzt erfolgreich abgefragt wurde, oder null. */
  garageFetchedAt(): string | null {
    const row = this.db.prepare("SELECT fetched_at FROM garage WHERE id = 1").get() as
      | { fetched_at: string }
      | undefined;
    return row?.fetched_at ?? null;
  }

  /** Modell, Baujahr und Bild-Link je Auto aus der gespeicherten /garage-Antwort. null = noch nie abgefragt. */
  vehicleInfo(): { fetchedAt: string; vehicles: VehicleInfo[] } | null {
    const row = this.db.prepare("SELECT fetched_at, raw FROM garage WHERE id = 1").get() as
      | { fetched_at: string; raw: string }
      | undefined;
    return row ? { fetchedAt: row.fetched_at, vehicles: parseGarage(JSON.parse(row.raw)) } : null;
  }
}
