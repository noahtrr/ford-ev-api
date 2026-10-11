import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { summarize, toCsv, toTxt, toXlsx, yearOverview, type OdometerReading } from "./odometer.js";

const TZ = "Europe/Berlin";
const readings: OdometerReading[] = [
  { ts: "2025-12-30T10:00:00Z", km: 9_900 },
  { ts: "2026-01-05T08:00:00Z", km: 10_000 },
  { ts: "2026-01-05T18:00:00Z", km: 10_050.5 },
  // 23:30 UTC ist in Berlin schon der 7. Januar
  { ts: "2026-01-06T23:30:00Z", km: 10_120 },
  { ts: "2026-03-02T09:00:00Z", km: 11_000 },
];

describe("summarize", () => {
  it("fasst nach Tagen in deutscher Zeit zusammen, neueste zuerst", () => {
    expect(summarize(readings, "day", TZ)).toEqual([
      { period: "2026-03-02", startKm: 10_120, endKm: 11_000, distanceKm: 880, readings: 1 },
      { period: "2026-01-07", startKm: 10_050.5, endKm: 10_120, distanceKm: 69.5, readings: 1 },
      { period: "2026-01-05", startKm: 9_900, endKm: 10_050.5, distanceKm: 150.5, readings: 2 },
      { period: "2025-12-30", startKm: 9_900, endKm: 9_900, distanceKm: 0, readings: 1 },
    ]);
  });

  it("zählt Kalenderwochen nach ISO (30.12.2025 gehört zu KW 1 2026)", () => {
    expect(summarize(readings, "week", TZ).map((r) => r.period)).toEqual(["2026-W10", "2026-W02", "2026-W01"]);
  });

  it("fasst nach Monaten und Jahren zusammen", () => {
    expect(summarize(readings, "month", TZ).map((r) => [r.period, r.distanceKm])).toEqual([
      ["2026-03", 880],
      ["2026-01", 220],
      ["2025-12", 0],
    ]);
    expect(summarize(readings, "year", TZ).map((r) => [r.period, r.distanceKm])).toEqual([
      ["2026", 1_100],
      ["2025", 0],
    ]);
  });
});

describe("yearOverview", () => {
  const overview = yearOverview("V1", readings, 2026, TZ, new Date("2026-04-15T12:00:00Z"));

  it("liefert 12 Monate, übernimmt den Stand in Monaten ohne Messwert und lässt die Zukunft leer", () => {
    expect(overview.months).toHaveLength(12);
    expect(overview.months[0]).toMatchObject({ month: 1, startKm: 9_900, endKm: 10_120, distanceKm: 220, readings: 3 });
    expect(overview.months[1]).toMatchObject({ month: 2, startKm: 10_120, endKm: 10_120, distanceKm: 0, readings: 0, lastReading: null });
    expect(overview.months[2]).toMatchObject({ month: 3, startKm: 10_120, endKm: 11_000, distanceKm: 880 });
    expect(overview.months[3]).toMatchObject({ month: 4, endKm: 11_000, distanceKm: 0 });
    expect(overview.months[4]).toMatchObject({ month: 5, startKm: null, endKm: null, distanceKm: null });
    expect(overview.totalKm).toBe(1_100);
  });

  it("exportiert als CSV mit Semikolon und Dezimalkomma", () => {
    const lines = toCsv(overview, TZ).split("\r\n");
    expect(lines[0]).toBe("\uFEFFMonat;Kilometerstand Monatsanfang;Kilometerstand Monatsende;Gefahrene km;Messwerte;Letzter Messwert");
    expect(lines[1]).toMatch(/^Januar 2026;9900;10120;220;3;/);
    expect(lines[5]).toBe("Mai 2026;;;;0;");
    expect(lines[13]).toBe("Summe 2026;;;1100;4;");
  });

  it("exportiert als Texttabelle", () => {
    const txt = toTxt(overview, TZ);
    expect(txt).toContain("Kilometerstand 2026 – Fahrzeug V1");
    expect(txt).toMatch(/Januar 2026\s+9\.900\s+10\.120\s+220\s+3/);
  });

  it("exportiert als Excel-Datei (ZIP mit Tabellenblatt)", () => {
    const file = toXlsx(overview, TZ);
    expect(file.subarray(0, 2).toString()).toBe("PK");
    // Tabellenblatt aus dem ZIP lesen: es ist der letzte Eintrag.
    const name = "xl/worksheets/sheet1.xml";
    const start = file.indexOf(name) + name.length;
    const size = file.readUInt32LE(file.indexOf(name) - 30 + 18);
    const sheet = inflateRawSync(file.subarray(start, start + size)).toString();
    expect(sheet).toContain("<t>Januar 2026</t>");
    expect(sheet).toContain("<v>10120</v>");
  });
});
