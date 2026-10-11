import { describe, expect, it } from "vitest";
import { parseBodyStatus, parseDepartureTimes, parseTelemetry } from "./telemetry.js";

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

// So schicken Ford-Autos Türen, Fenster, Schloss, 12-V-Batterie und Alarm (gekürzt).
const body = {
  doorStatus: [
    { value: "CLOSED", vehicleDoor: "UNSPECIFIED_FRONT", vehicleSide: "DRIVER" },
    { value: "AJAR", vehicleDoor: "UNSPECIFIED_FRONT", vehicleSide: "PASSENGER" },
    { value: "CLOSED", vehicleDoor: "REAR_LEFT" },
    { value: "INVALID", vehicleDoor: "TAILGATE" },
  ],
  hoodStatus: { value: "CLOSED" },
  windowStatus: [
    { value: { doubleRange: { lowerBound: 0, upperBound: 0 } }, vehicleWindow: "UNSPECIFIED_FRONT", vehicleSide: "DRIVER" },
    { value: { doubleRange: { lowerBound: 0, upperBound: 25 } }, vehicleWindow: "UNSPECIFIED_REAR", vehicleSide: "PASSENGER" },
    { value: "FULLY_CLOSED", vehicleWindow: "FRONT_RIGHT" },
  ],
  doorLockStatus: [
    { value: "LOCKED", vehicleDoor: "ALL_DOORS" },
    { value: "DOUBLE_LOCKED", vehicleDoor: "FRONT_LEFT" },
  ],
  batteryStateOfCharge: { value: 87, vehicleBattery: "PRIMARY_BATTERY" },
  batteryVoltage: { value: 12.6 },
  alarmStatus: { value: "ARMED" },
};

describe("parseBodyStatus", () => {
  it("liest Türen, Fenster, Schloss, 12-V-Batterie und Alarm aus", () => {
    expect(parseBodyStatus(body)).toEqual({
      locked: true,
      doors: [
        { name: "Fahrertür", open: false },
        { name: "Beifahrertür", open: true },
        { name: "Hinten links", open: false },
        { name: "Heckklappe", open: null },
        { name: "Motorhaube", open: false },
      ],
      windows: [
        { name: "Fahrerfenster", open: false },
        { name: "Hinten Beifahrerseite", open: true },
        { name: "Vorne rechts", open: false },
      ],
      battery12v: { socPct: 87, voltage: 12.6 },
      alarm: "ARMED",
    });
  });

  it("meldet unverriegelt, sobald eine Tür offen ist", () => {
    const status = parseBodyStatus({ doorLockStatus: [{ value: "LOCKED" }, { value: "UNLOCKED" }] });
    expect(status.locked).toBe(false);
  });

  it("nimmt keine Werte vom Fahrakku als 12-V-Batterie", () => {
    const status = parseBodyStatus({ batteryStateOfCharge: { value: 55, vehicleBattery: "TRACTION_BATTERY" } });
    expect(status.battery12v).toBeNull();
  });

  it("liefert überall null, wenn Ford nichts davon schickt", () => {
    expect(parseBodyStatus({ odometer: { value: 1 } })).toEqual({
      locked: null,
      doors: null,
      windows: null,
      battery12v: null,
      alarm: null,
    });
  });

  it("steckt im Messwert aus parseTelemetry", () => {
    const [s] = parseTelemetry({ vin: "X", metrics: body });
    expect(s.alarm).toBe("ARMED");
    expect(s.doors).toHaveLength(5);
  });
});
