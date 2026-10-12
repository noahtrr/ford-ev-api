import { describe, expect, it } from "vitest";
import { addressQueue, formatAddress } from "./geocode.js";

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
