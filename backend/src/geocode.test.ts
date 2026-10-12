import { afterEach, describe, expect, it, vi } from "vitest";
import { addressQueue, formatAddress, formatPhoton, reverseGeocode } from "./geocode.js";

describe("formatAddress", () => {
  it("baut Straße, Hausnummer, PLZ und Ort zusammen", () => {
    expect(formatAddress({ address: { road: "Hauptstraße", house_number: "5", postcode: "10115", city: "Berlin" } })).toBe(
      "Hauptstraße 5, 10115 Berlin",
    );
  });

  it("nennt eine Ladestation oder einen Laden zuerst", () => {
    expect(formatAddress({ address: { amenity: "IONITY", road: "A9", town: "Hilpoltstein" } })).toBe("IONITY, A9, Hilpoltstein");
  });

  it("nimmt sonst den ganzen Namen", () => {
    expect(formatAddress({ display_name: "Irgendwo" })).toBe("Irgendwo");
  });
});

describe("formatPhoton", () => {
  it("baut aus der Photon-Antwort Straße, PLZ und Ort", () => {
    const data = { features: [{ properties: { street: "Hauptstraße", housenumber: "5", postcode: "10115", city: "Berlin" } }] };
    expect(formatPhoton(data)).toBe("Hauptstraße 5, 10115 Berlin");
  });

  it("nimmt den Namen als Straße, wenn das Ergebnis selbst eine Straße ist", () => {
    expect(formatPhoton({ features: [{ properties: { name: "Alexanderstraße", postcode: "10178", city: "Berlin" } }] })).toBe(
      "Alexanderstraße, 10178 Berlin",
    );
  });

  it("liefert null ohne Ergebnis", () => {
    expect(formatPhoton({ features: [] })).toBeNull();
  });
});

describe("reverseGeocode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fragt Photon, wenn Nominatim nicht antwortet", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("nominatim")) return new Response("blocked", { status: 403 });
      return Response.json({ features: [{ properties: { street: "Hauptstraße", housenumber: "5", postcode: "10115", city: "Berlin" } }] });
    });
    expect(await reverseGeocode(52.5, 13.4)).toBe("Hauptstraße 5, 10115 Berlin");
    expect(urls.map((u) => new URL(u).host)).toEqual(["nominatim.openstreetmap.org", "photon.komoot.io"]);
  });
});

describe("addressQueue", () => {
  it("schlägt jede Adresse nur einmal nach, auch wenn sie mehrfach angefragt wird", async () => {
    const saved: [string, string][] = [];
    let calls = 0;
    const queue = addressQueue(
      async () => `Adresse ${++calls}`,
      (key, address) => saved.push([key, address]),
      () => {},
      0,
    );
    queue("a", 1, 2);
    queue("a", 1, 2);
    queue("b", 3, 4);
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).toEqual([
      ["a", "Adresse 1"],
      ["b", "Adresse 2"],
    ]);
  });
});
