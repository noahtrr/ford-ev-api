import { describe, expect, it } from "vitest";
import { parseDepartureTimes, parseTelemetry } from "./telemetry.js";

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

// So schickt Ford die Abfahrtszeiten mit (gekürzt).
const withDepartures = {
  configurations: {
    xevDepartureSchedulesSetting: {
      updateTime: "2026-10-11T11:00:00Z",
      value: {
        departureScheduleFeatureStatus: "ON",
        departureLocations: [
          {
            locationId: 0,
            departureSchedules: [
              {
                scheduleId: 2,
                scheduleStatus: "OFF",
                schedule: { timeZone: "LOCAL_TIME", weeklySchedule: { dayOfWeek: "TUESDAY", timeOfDay: "8:15" } },
              },
              {
                scheduleId: 1,
                scheduleStatus: "ON",
                schedule: { timeZone: "LOCAL_TIME", weeklySchedule: { dayOfWeek: "MONDAY", timeOfDay: "07:30" } },
                oemData: { chrg_go_t_prcond_d_stat: { stringValue: "ON" } },
              },
              { scheduleId: 3, scheduleStatus: "ON", schedule: {} },
            ],
          },
        ],
      },
    },
  },
};

describe("parseDepartureTimes", () => {
  it("liest die Abfahrtszeiten sortiert nach Wochentag aus", () => {
    expect(parseDepartureTimes(withDepartures)).toEqual([
      { day: "MONDAY", time: "07:30", enabled: true, preconditioning: true },
      { day: "TUESDAY", time: "08:15", enabled: false, preconditioning: null },
    ]);
  });

  it("schaltet alle Zeiten aus, wenn die Funktion im Auto aus ist", () => {
    const off = structuredClone(withDepartures);
    off.configurations.xevDepartureSchedulesSetting.value.departureScheduleFeatureStatus = "OFF";
    expect(parseDepartureTimes(off)?.every((d) => !d.enabled)).toBe(true);
  });

  it("liefert null, wenn Ford keine Abfahrtszeiten schickt", () => {
    expect(parseDepartureTimes({ odometer: { value: 1 } })).toBeNull();
    expect(parseDepartureTimes(undefined)).toBeNull();
  });

  it("liefert eine leere Liste, wenn keine Abfahrtszeit eingestellt ist", () => {
    const empty = { configurations: { xevDepartureSchedulesSetting: { value: { departureLocations: [] } } } };
    expect(parseDepartureTimes(empty)).toEqual([]);
  });

  it("zählt eine geänderte Abfahrtszeit als neuen Messwert", () => {
    const [s] = parseTelemetry({ vin: "X", metrics: { odometer: { value: 1, updateTime: "2026-10-11T10:00:00Z" }, ...withDepartures } });
    expect(s.ts).toBe("2026-10-11T11:00:00Z");
    expect(s.departures).toHaveLength(2);
  });
});
