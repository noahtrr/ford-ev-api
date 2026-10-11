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
    expect(store.latestSnapshots()).toEqual([expect.objectContaining({ vin: "V1", odometerKm: 20, departures: [] })]);
  });

  it("merkt sich die Tokens", () => {
    const store = new Store(":memory:");
    expect(store.loadTokens()).toBeUndefined();
    const tokens = { access_token: "a", refresh_token: "r", expires_in: 1200, obtained_at: 1 };
    store.saveTokens(tokens);
    expect(store.loadTokens()).toEqual(tokens);
  });
});
