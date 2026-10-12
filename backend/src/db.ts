// Speichert Login-Tokens und Messwerte in einer SQLite-Datei.
// node:sqlite ist in Node.js eingebaut, es braucht also kein extra Paket.
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Tokens } from "./ford/auth.js";
import { parseGarage, type VehicleInfo } from "./ford/garage.js";
import type { OdometerReading, TripCategory } from "./odometer.js";
import { parseBodyStatus, parseDepartureTimes, type VehicleSnapshot } from "./ford/telemetry.js";

export interface Account {
  webauthnUserId: string;
  displayName: string | null;
  passwordHash: string | null;
  passwordChangedAt: string | null;
}

export interface Passkey {
  /** Kennung des Passkeys (base64url), so wie der Browser sie schickt. */
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface Session {
  id: string;
  method: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

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
      -- Markierung privat/geschäftlich für die Strecke bis zu einem Messwert (vin + ts wie in snapshots).
      CREATE TABLE IF NOT EXISTS trip_categories (
        vin TEXT NOT NULL,
        ts TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('private', 'business')),
        PRIMARY KEY (vin, ts)
      );
      -- Das eine Konto für die Weboberfläche. Benutzername kommt aus LOGIN_USER.
      CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        webauthn_user_id TEXT NOT NULL,
        display_name TEXT,
        password_hash TEXT,
        password_changed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS passkeys (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL,
        transports TEXT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      -- Angemeldete Browser. Gespeichert wird nur ein Hash des Cookies.
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        method TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
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

  /**
   * Alle Kilometerstände eines Autos mit Markierung privat/geschäftlich, älteste zuerst.
   * Ein Messwert wird gespeichert, sobald sich irgendein Wert ändert (z. B. Akku beim Laden).
   * Der Kilometerstand darin kann dann noch der alte sein. Deshalb zählt hier nur, wann Ford
   * den Kilometerstand selbst geliefert hat (odometer.updateTime), jeder Zeitpunkt nur einmal.
   */
  odometerReadings(vin: string): OdometerReading[] {
    const rows = this.db
      .prepare(
        `SELECT s.ts AS id, COALESCE(json_extract(s.raw, '$.metrics.odometer.updateTime'), s.ts) AS ts,
                s.odometer_km AS km, c.category
         FROM snapshots s LEFT JOIN trip_categories c ON c.vin = s.vin AND c.ts = s.ts
         WHERE s.vin = ? AND s.odometer_km IS NOT NULL ORDER BY s.ts`,
      )
      .all(vin) as unknown as Required<OdometerReading>[];
    const byTime = new Map<string, Required<OdometerReading>>();
    for (const r of rows) {
      const first = byTime.get(r.ts);
      if (!first) byTime.set(r.ts, r);
      // Markierungen hängen am ersten Messwert; ältere an späteren Kopien gehen nicht verloren.
      else if (!first.category && r.category) first.category = r.category;
    }
    return [...byTime.values()];
  }

  /**
   * Markiert die Strecke bis zu den Messwerten mit den Zeitpunkten ts als privat oder geschäftlich.
   * null entfernt die Markierung. Gibt zurück, wie viele Messwerte es davon wirklich gibt.
   */
  setTripCategory(vin: string, ts: string[], category: TripCategory | null): number {
    const odometerTime = "COALESCE(json_extract(raw, '$.metrics.odometer.updateTime'), ts)";
    const find = this.db.prepare(`SELECT ${odometerTime} AS t FROM snapshots WHERE vin = ? AND ts = ? AND odometer_km IS NOT NULL`);
    const upsert = this.db.prepare(
      "INSERT INTO trip_categories (vin, ts, category) VALUES (?, ?, ?) ON CONFLICT(vin, ts) DO UPDATE SET category = excluded.category",
    );
    // Alte Markierungen an Kopien mit demselben Kilometerstand-Zeitpunkt entfernen (siehe odometerReadings).
    const removeCopies = this.db.prepare(
      `DELETE FROM trip_categories WHERE vin = ? AND ts IN (SELECT ts FROM snapshots WHERE vin = ? AND ${odometerTime} = ?)`,
    );
    let count = 0;
    this.db.exec("BEGIN");
    try {
      for (const t of ts) {
        const row = find.get(vin, t) as { t: string } | undefined;
        if (!row) continue;
        removeCopies.run(vin, vin, row.t);
        if (category) upsert.run(vin, t, category);
        count++;
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return count;
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

  // ---- Konto, Passkeys und Sitzungen für den Login (src/auth/) ----

  /** Das Konto. Wird beim ersten Aufruf angelegt. */
  account(): Account {
    const read = () =>
      this.db.prepare("SELECT webauthn_user_id, display_name, password_hash, password_changed_at FROM account WHERE id = 1").get() as
        | Record<string, string | null>
        | undefined;
    let row = read();
    if (!row) {
      // Zufällige Kennung, mit der Passkeys das Konto wiedererkennen (enthält nichts Persönliches).
      this.db.prepare("INSERT INTO account (id, webauthn_user_id) VALUES (1, ?)").run(randomBytes(32).toString("base64url"));
      row = read()!;
    }
    return {
      webauthnUserId: row.webauthn_user_id!,
      displayName: row.display_name,
      passwordHash: row.password_hash,
      passwordChangedAt: row.password_changed_at,
    };
  }

  setDisplayName(name: string | null): void {
    this.account();
    this.db.prepare("UPDATE account SET display_name = ? WHERE id = 1").run(name);
  }

  /** Speichert ein in der App geändertes Passwort. null = wieder das Passwort aus der Server-Einrichtung. */
  setPasswordHash(hash: string | null, now = new Date()): void {
    this.account();
    this.db
      .prepare("UPDATE account SET password_hash = ?, password_changed_at = ? WHERE id = 1")
      .run(hash, hash ? now.toISOString() : null);
  }

  passkeys(): Passkey[] {
    const rows = this.db.prepare("SELECT * FROM passkeys ORDER BY created_at").all() as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: r.id as string,
      publicKey: new Uint8Array(Buffer.from(r.public_key as string, "base64url")),
      counter: r.counter as number,
      transports: r.transports ? (JSON.parse(r.transports as string) as string[]) : [],
      name: r.name as string,
      createdAt: r.created_at as string,
      lastUsedAt: r.last_used_at as string | null,
    }));
  }

  passkey(id: string): Passkey | undefined {
    return this.passkeys().find((p) => p.id === id);
  }

  addPasskey(p: Omit<Passkey, "createdAt" | "lastUsedAt">, now = new Date()): void {
    this.db
      .prepare("INSERT INTO passkeys (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(p.id, Buffer.from(p.publicKey).toString("base64url"), p.counter, JSON.stringify(p.transports), p.name, now.toISOString());
  }

  /** Nach einem Login mit Passkey: Zähler und „zuletzt benutzt“ aktualisieren. */
  passkeyUsed(id: string, counter: number, now = new Date()): void {
    this.db.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").run(counter, now.toISOString(), id);
  }

  renamePasskey(id: string, name: string): boolean {
    return this.db.prepare("UPDATE passkeys SET name = ? WHERE id = ?").run(name, id).changes > 0;
  }

  deletePasskey(id: string): boolean {
    return this.db.prepare("DELETE FROM passkeys WHERE id = ?").run(id).changes > 0;
  }

  createSession(s: Session & { tokenHash: string }): void {
    this.db
      .prepare(
        "INSERT INTO sessions (id, token_hash, method, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(s.id, s.tokenHash, s.method, s.userAgent, s.createdAt, s.lastSeenAt, s.expiresAt);
  }

  /** Die gültige Sitzung zu einem Cookie-Hash, oder undefined. */
  sessionByTokenHash(tokenHash: string, now = new Date()): Session | undefined {
    const row = this.db
      .prepare("SELECT id, method, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash, now.toISOString()) as Record<string, string | null> | undefined;
    return row ? toSession(row) : undefined;
  }

  touchSession(id: string, now = new Date()): void {
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now.toISOString(), id);
  }

  sessions(now = new Date()): Session[] {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
    const rows = this.db
      .prepare("SELECT id, method, user_agent, created_at, last_seen_at, expires_at FROM sessions ORDER BY last_seen_at DESC")
      .all() as Record<string, string | null>[];
    return rows.map(toSession);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  /** Meldet alle Browser ab, außer dem mit der Sitzung keepId. */
  deleteOtherSessions(keepId: string | null): number {
    return Number(this.db.prepare("DELETE FROM sessions WHERE id IS NOT ?").run(keepId).changes);
  }
}

function toSession(r: Record<string, string | null>): Session {
  return {
    id: r.id!,
    method: r.method!,
    userAgent: r.user_agent,
    createdAt: r.created_at!,
    lastSeenAt: r.last_seen_at!,
    expiresAt: r.expires_at!,
  };
}
