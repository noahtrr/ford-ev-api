import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { FordClient } from "./ford/client.js";
import { parseTelemetry } from "./ford/telemetry.js";
import { buildServer } from "./server.js";

const config: Config = {
  port: 0,
  dataDir: ":memory:",
  pollIntervalMinutes: 5,
  frontendUrl: "/",
  timeZone: "Europe/Berlin",
  // Ohne Login, wie beim Entwickeln am eigenen Rechner. Der Login wird in auth/routes.test.ts getestet.
  auth: { username: null, passwordHash: null, domain: null, lockWithoutLogin: false },
  ford: {
    clientId: "id",
    clientSecret: "secret",
    redirectUri: "http://localhost:8080/callback",
    authUrl: "https://example.test/auth",
    tokenUrl: "https://example.test/token",
    apiBase: "https://example.test/api",
  },
};

function setup(fill?: (store: Store) => void) {
  const store = new Store(":memory:");
  fill?.(store);
  return buildServer(config, store, new FordClient(config.ford, store));
}

/** Speichert einen Kilometerstand für Auto V1. */
function odometer(store: Store, ts: string, km: number) {
  store.saveSnapshot(parseTelemetry({ vin: "V1", metrics: { odometer: { value: km, updateTime: ts } } })[0]);
}

describe("server", () => {
  it("meldet, dass noch niemand eingeloggt ist", async () => {
    const res = await setup().inject("/api/status");
    expect(res.json()).toEqual({ loggedIn: false });
  });

  it("leitet /login zu Ford weiter", async () => {
    const res = await setup().inject("/login");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/example\.test\/auth\?/);
  });

  it("lehnt einen Rücksprung ohne passenden state ab", async () => {
    const res = await setup().inject("/callback?code=x&state=falsch");
    expect(res.statusCode).toBe(400);
  });

  it("liefert null, solange keine Abfahrtszeiten abgefragt wurden", async () => {
    const res = await setup().inject("/api/departure-times");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("null");
  });

  it("liefert null, solange keine Fahrzeugdaten abgefragt wurden", async () => {
    const res = await setup().inject("/api/vehicle-info");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("null");
  });

  it("beschreibt die eigenen Endpunkte als OpenAPI", async () => {
    const res = await setup().inject("/api/docs/json");
    expect(res.statusCode).toBe(200);
    const paths = Object.keys(res.json().paths);
    expect(paths).toEqual(
      expect.arrayContaining(["/api/status", "/api/snapshots/latest", "/api/vehicle-info", "/api/departure-times", "/login"]),
    );
    expect(paths).not.toContain("/api/docs/json");
  });

  it("zeigt die Swagger-Oberfläche unter /api/docs", async () => {
    const res = await setup().inject("/api/docs/");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
  });

  it("liefert den Kilometerstand nach Monaten und die Jahresübersicht", async () => {
    const app = setup((store) => {
      odometer(store, "2026-01-10T10:00:00Z", 1000);
      odometer(store, "2026-02-10T10:00:00Z", 1500);
    });
    const months = await app.inject("/api/odometer?period=month");
    expect(months.json()).toMatchObject({ vin: "V1", period: "month", rows: [{ period: "2026-02", distanceKm: 500 }, { period: "2026-01" }] });

    const year = await app.inject("/api/odometer/year?year=2026");
    expect(year.json()).toMatchObject({ vin: "V1", year: 2026, totalKm: 500, years: expect.arrayContaining([2026]) });
    expect(year.json().months).toHaveLength(12);
  });

  it("lädt die Jahresübersicht als CSV, TXT und Excel herunter", async () => {
    const app = setup((store) => odometer(store, "2026-01-10T10:00:00Z", 1000));
    const csv = await app.inject("/api/odometer/year/export?year=2026&format=csv");
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="kilometerstand-2026.csv"');
    expect(csv.body).toContain("Januar 2026;1000;1000;0;0;0;1;");
    const txt = await app.inject("/api/odometer/year/export?year=2026&format=txt");
    expect(txt.body).toContain("Kilometerstand 2026");
    const xlsx = await app.inject("/api/odometer/year/export?year=2026&format=xlsx");
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const bad = await app.inject("/api/odometer/year/export?format=pdf");
    expect(bad.statusCode).toBe(400);
  });

  it("zeigt die Messwerte eines Tages und speichert die Markierung privat/geschäftlich", async () => {
    const app = setup((store) => {
      odometer(store, "2026-01-10T08:00:00Z", 1000);
      odometer(store, "2026-01-10T09:00:00Z", 1030);
      odometer(store, "2026-01-10T17:00:00Z", 1050);
    });
    const day = await app.inject("/api/odometer/day?date=2026-01-10");
    expect(day.json().readings.map((r: { distanceKm: number }) => r.distanceKm)).toEqual([30, 20]);

    const put = await app.inject({
      method: "PUT",
      url: "/api/odometer/category",
      payload: { ts: ["2026-01-10T09:00:00Z", "2026-01-10T17:00:00Z", "2020-01-01T00:00:00Z"], category: "business" },
    });
    expect(put.json()).toEqual({ updated: 2 });
    await app.inject({ method: "PUT", url: "/api/odometer/category", payload: { ts: ["2026-01-10T17:00:00Z"], category: "private" } });

    const after = await app.inject("/api/odometer/day?date=2026-01-10");
    expect(after.json().readings.map((r: { category: string | null }) => r.category)).toEqual(["business", "private"]);
    const days = await app.inject("/api/odometer?period=day");
    expect(days.json().rows[0]).toMatchObject({ distanceKm: 50, businessKm: 30, privateKm: 20 });

    await app.inject({ method: "PUT", url: "/api/odometer/category", payload: { ts: ["2026-01-10T17:00:00Z"], category: null } });
    const cleared = await app.inject("/api/odometer/day?date=2026-01-10");
    expect(cleared.json().readings[1].category).toBeNull();

    const bad = await app.inject({ method: "PUT", url: "/api/odometer/category", payload: { ts: ["x"], category: "urlaub" } });
    expect(bad.statusCode).toBe(400);
  });

  it("zeigt nur Zeitpunkte, zu denen Ford neue Kilometer geliefert hat", async () => {
    const app = setup((store) => {
      odometer(store, "2026-01-10T08:00:00Z", 1000);
      // Beim Laden ändert sich nur der Akku, der Kilometerstand bleibt der von 08:00.
      for (const ts of ["2026-01-10T12:00:00Z", "2026-01-10T13:00:00Z"]) {
        const metrics = { odometer: { value: 1000, updateTime: "2026-01-10T08:00:00Z" }, xevBatteryStateOfCharge: { value: 50, updateTime: ts } };
        store.saveSnapshot(parseTelemetry({ vin: "V1", metrics })[0]);
      }
      odometer(store, "2026-01-10T17:00:00Z", 1040);
    });
    const day = await app.inject("/api/odometer/day?date=2026-01-10");
    const readings = day.json().readings as { id: string; ts: string }[];
    // 08:00 ist der allererste Messwert (0 km) und fällt deshalb auch weg.
    expect(readings.map((r) => r.ts)).toEqual(["2026-01-10T17:00:00Z"]);

    await app.inject({ method: "PUT", url: "/api/odometer/category", payload: { ts: [readings[0].id], category: "private" } });
    const days = await app.inject("/api/odometer?period=day");
    expect(days.json().rows[0]).toMatchObject({ distanceKm: 40, privateKm: 40, readings: 2 });
  });

  it("meldet 404 für die Jahresübersicht, solange es keine Kilometerstände gibt", async () => {
    const res = await setup().inject("/api/odometer/year");
    expect(res.statusCode).toBe(404);
  });

  it("leitet Ladevorgänge aus den Messwerten ab, markiert und exportiert sie", async () => {
    const app = setup((store) => {
      const charge = (ts: string, soc: number, plug: string, status: string) =>
        store.saveSnapshot(
          parseTelemetry({
            vin: "V1",
            metrics: {
              xevBatteryStateOfCharge: { value: soc, updateTime: ts },
              xevPlugChargerStatus: { value: plug, updateTime: ts },
              xevBatteryChargeDisplayStatus: { value: status, updateTime: ts, xevChargerPowerType: "AC" },
              xevBatteryCapacity: { value: 70, updateTime: ts },
            },
          })[0],
        );
      charge("2026-01-10T16:00:00Z", 30, "CONNECTED", "IN_PROGRESS");
      charge("2026-01-10T18:00:00Z", 60, "CONNECTED", "IN_PROGRESS");
      charge("2026-01-10T19:00:00Z", 80, "CONNECTED", "COMPLETED");
      charge("2026-01-10T20:00:00Z", 80, "DISCONNECTED", "NOT_PLUGGED_IN");
    });
    const day = await app.inject("/api/charging/day?date=2026-01-10");
    const sessions = day.json().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ startSocPct: 30, endSocPct: 80, energyKwh: 35, powerType: "AC", durationMin: 180, category: null });

    const put = await app.inject({ method: "PUT", url: "/api/charging/category", payload: { ids: [sessions[0].id], category: "business" } });
    expect(put.json()).toEqual({ updated: 1 });
    const months = await app.inject("/api/charging?period=month");
    expect(months.json().rows[0]).toMatchObject({ period: "2026-01", sessions: 1, businessSessions: 1, businessKwh: 35 });

    const year = await app.inject("/api/charging/year?year=2026");
    expect(year.json().total).toMatchObject({ sessions: 1, energyKwh: 35 });

    const csv = await app.inject("/api/charging/year/export?year=2026&format=csv&type=sessions");
    expect(csv.headers["content-disposition"]).toContain("ladevorgaenge-einzeln-2026.csv");
    expect(csv.body).toContain("10.01.2026;17:00;20:00;3:00 h;30;80;50;35;11,7");
    const xlsx = await app.inject("/api/charging/year/export?year=2026&format=xlsx");
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });
});
