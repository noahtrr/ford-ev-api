import { describe, expect, it } from "vitest";
import { Store } from "./db.js";
import { parseTelemetry } from "./ford/telemetry.js";

describe("Store", () => {
  it("speichert gleiche Messwerte nur einmal und liefert den neuesten", () => {
    const store = new Store(":memory:");
    const older = parseTelemetry({ vin: "V1", metrics: { odometer: { value: 10, updateTime: "2026-10-11T08:00:00Z" } } })[0];
    const newer = parseTelemetry({ vin: "V1", metrics: { odometer: { value: 20, updateTime: "2026-10-11T09:00:00Z" } } })[0];

    expect(store.saveSnapshot(older)).toBe(true);
    expect(store.saveSnapshot(older)).toBe(false);
    expect(store.saveSnapshot(newer)).toBe(true);
    expect(store.latestSnapshots()).toEqual([expect.objectContaining({ vin: "V1", odometerKm: 20, departures: null })]);
  });

  it("merkt sich die Tokens", () => {
    const store = new Store(":memory:");
    expect(store.loadTokens()).toBeUndefined();
    const tokens = { access_token: "a", refresh_token: "r", expires_in: 1200, obtained_at: 1 };
    store.saveTokens(tokens);
    expect(store.loadTokens()).toEqual(tokens);
  });

  it("speichert die Abfahrtszeiten nur, wenn sie sich geändert haben", () => {
    const store = new Store(":memory:");
    expect(store.latestDepartureTimes()).toBeNull();
    const first = { departureTimes: { vin: "V1", isDepartureTimesEnabled: true } };
    expect(store.saveDepartureTimes(first, new Date("2026-10-11T10:00:00Z"))).toBe(true);
    expect(store.saveDepartureTimes(first)).toBe(false);
    const second = { departureTimes: { vin: "V1", isDepartureTimesEnabled: false } };
    expect(store.saveDepartureTimes(second, new Date("2026-10-11T10:30:00Z"))).toBe(true);
    expect(store.latestDepartureTimes()).toEqual({ fetchedAt: "2026-10-11T10:30:00.000Z", data: second });
  });

  it("liest Modell und Bild aus der gespeicherten Garage-Antwort", () => {
    const store = new Store(":memory:");
    expect(store.vehicleInfo()).toBeNull();
    expect(store.garageFetchedAt()).toBeNull();
    store.saveGarage([{ vin: "V1", modelName: "Explorer", modelYear: "2025" }], new Date("2026-10-11T10:00:00Z"));
    expect(store.vehicleInfo()).toEqual({
      fetchedAt: "2026-10-11T10:00:00.000Z",
      vehicles: [{ vin: "V1", model: "Explorer", year: 2025, imageUrl: null }],
    });
  });
});
