import { describe, expect, it } from "vitest";
import { chargingMonthsTable, chargingSessionsTable, chargingYearOverview, daySessions, detectSessions, summarizeCharging, type ChargingSample } from "./charging.js";
import { tableToCsv, tableToTxt } from "./export.js";

const TZ = "Europe/Berlin";

function sample(ts: string, socPct: number, plugStatus: string, chargeStatus: string, extra: Partial<ChargingSample> = {}): ChargingSample {
  return {
    ts,
    socPct,
    rangeKm: socPct * 4,
    odometerKm: 1000,
    lat: 52.5,
    lon: 13.4,
    plugStatus,
    chargeStatus,
    powerType: null,
    timeToFullMin: null,
    energyRemainingKwh: null,
    capacityKwh: null,
    ...extra,
  };
}

const samples: ChargingSample[] = [
  sample("2026-01-05T16:00:00Z", 40, "DISCONNECTED", "NOT_PLUGGED_IN"),
  sample("2026-01-05T17:00:00Z", 40, "CONNECTED", "SCHEDULED"),
  sample("2026-01-05T22:00:00Z", 41, "CONNECTED", "IN_PROGRESS", { powerType: "AC" }),
  sample("2026-01-06T01:00:00Z", 70, "CONNECTED", "IN_PROGRESS"),
  sample("2026-01-06T03:30:00Z", 80, "CONNECTED", "COMPLETED"),
  sample("2026-01-06T07:00:00Z", 80, "CONNECTED", "COMPLETED"),
  sample("2026-01-06T08:00:00Z", 79, "DISCONNECTED", "NOT_PLUGGED_IN", { odometerKm: 1000 }),
  // Nur eingesteckt, nichts geladen: kein Ladevorgang
  sample("2026-01-07T10:00:00Z", 60, "CONNECTED", "COMPLETED", { odometerKm: 1050 }),
  sample("2026-01-07T11:00:00Z", 60, "DISCONNECTED", "NOT_PLUGGED_IN", { odometerKm: 1050 }),
  // Schnellladen, das noch läuft
  sample("2026-03-02T09:00:00Z", 20, "CONNECTED", "IN_PROGRESS", { odometerKm: 1200, powerType: "DC", capacityKwh: 77, timeToFullMin: 30 }),
  sample("2026-03-02T09:20:00Z", 60, "CONNECTED", "IN_PROGRESS", { odometerKm: 1200, timeToFullMin: 12 }),
];

describe("detectSessions", () => {
  const sessions = detectSessions(samples);

  it("erkennt Ladevorgänge vom Einstecken bis zum Abstecken", () => {
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      id: "2026-01-05T17:00:00Z",
      pluggedIn: "2026-01-05T17:00:00Z",
      pluggedOut: "2026-01-06T07:00:00Z",
      start: "2026-01-05T22:00:00Z",
      end: "2026-01-06T03:30:00Z",
      durationMin: 330,
      startSocPct: 40,
      endSocPct: 80,
      addedSocPct: 40,
      addedRangeKm: 160,
      energyKwh: null,
      powerType: "AC",
      ongoing: false,
      lastStatus: "COMPLETED",
    });
  });

  it("schätzt die Energie aus der Akkukapazität und erkennt laufende Ladevorgänge", () => {
    expect(sessions[1]).toMatchObject({ addedSocPct: 40, energyKwh: 30.8, avgPowerKw: 92.4, powerType: "DC", ongoing: true, timeToFullMin: 12 });
  });

  it("trennt Ladevorgänge, wenn das Auto dazwischen gefahren ist", () => {
    const list = detectSessions([
      sample("2026-01-01T10:00:00Z", 30, "CONNECTED", "IN_PROGRESS"),
      sample("2026-01-01T11:00:00Z", 50, "CONNECTED", "COMPLETED"),
      sample("2026-01-01T15:00:00Z", 40, "CONNECTED", "IN_PROGRESS", { odometerKm: 1040 }),
      sample("2026-01-01T16:00:00Z", 60, "CONNECTED", "COMPLETED", { odometerKm: 1040 }),
    ]);
    expect(list.map((s) => [s.startSocPct, s.endSocPct])).toEqual([
      [30, 50],
      [40, 60],
    ]);
  });
});

describe("Zusammenfassungen", () => {
  const sessions = detectSessions(samples).map((s, i) => ({ ...s, category: i === 0 ? ("business" as const) : null }));

  it("ordnet nach dem Tag, an dem das Laden begann", () => {
    expect(daySessions(sessions, "2026-01-05", TZ)).toHaveLength(1);
    expect(daySessions(sessions, "2026-01-06", TZ)).toHaveLength(0);
    expect(summarizeCharging(sessions, "month", TZ).map((r) => [r.period, r.sessions, r.addedSocPct, r.energyKwh])).toEqual([
      ["2026-03", 1, 40, 30.8],
      ["2026-01", 1, 40, null],
    ]);
  });

  it("Jahresübersicht mit 12 Monaten und Export", () => {
    const o = chargingYearOverview("V1", sessions, 2026, TZ, new Date("2026-04-15T00:00:00Z"));
    expect(o.months).toHaveLength(12);
    expect(o.total).toMatchObject({ sessions: 2, addedSocPct: 80, businessSessions: 1, privateSessions: 0, durationMin: 350 });
    expect(o.months[3].future).toBe(false);
    expect(o.months[4].future).toBe(true);

    const csv = tableToCsv(chargingMonthsTable(o));
    expect(csv.split("\r\n")[1]).toBe("Januar 2026;1;40;;160;5:30 h;0;1;;");
    expect(csv).not.toContain("Mai 2026");
    expect(tableToTxt(chargingSessionsTable("V1", 2026, sessions, TZ))).toContain("lädt noch");
    const rows = chargingSessionsTable("V1", 2026, sessions, TZ).rows;
    expect(rows[0].slice(0, 4)).toEqual(["05.01.2026", "23:00", "04:30", "5:30 h"]);
    expect(rows[0][20]).toBe("Geschäftlich");
  });
});
