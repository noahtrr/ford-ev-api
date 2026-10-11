import { describe, expect, it } from "vitest";
import { parseTelemetry } from "./telemetry.js";

const sample = {
  vin: "WF0TEST123",
  metrics: {
    xevBatteryStateOfCharge: { value: 81.5, updateTime: "2026-10-11T10:00:00Z" },
    xevBatteryRange: { value: 312, updateTime: "2026-10-11T10:05:00Z" },
    odometer: { value: 12045, updateTime: "2026-10-11T09:00:00Z" },
    position: { value: { location: { lat: 52.52, lon: 13.4 } } },
    xevPlugChargerStatus: { value: "DISCONNECTED" },
    tirePressure: [{ value: 250, vehicleWheel: "FRONT_LEFT" }],
  },
};

describe("parseTelemetry", () => {
  it("liest die wichtigsten Werte aus", () => {
    const [s] = parseTelemetry(sample);
    expect(s).toMatchObject({
      vin: "WF0TEST123",
      ts: "2026-10-11T10:05:00Z",
      socPct: 81.5,
      rangeKm: 312,
      odometerKm: 12045,
      lat: 52.52,
      lon: 13.4,
      plugStatus: "DISCONNECTED",
      chargeStatus: null,
    });
  });

  it("überspringt Einträge ohne VIN oder Messwerte", () => {
    expect(parseTelemetry([{ metrics: {} }, { vin: "X" }])).toEqual([]);
  });

  it("nimmt die aktuelle Zeit, wenn Ford keinen Zeitstempel liefert", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const [s] = parseTelemetry({ vin: "X", metrics: { odometer: { value: 1 } } }, now);
    expect(s.ts).toBe(now.toISOString());
  });
});
