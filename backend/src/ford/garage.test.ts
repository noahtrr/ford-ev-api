import { describe, expect, it } from "vitest";
import { parseGarage } from "./garage.js";

describe("parseGarage", () => {
  it("liest Modell und Baujahr aus einer Liste", () => {
    expect(parseGarage([{ vin: "V1", modelName: "Mustang Mach-E", modelYear: 2024 }])).toEqual([
      { vin: "V1", model: "Mustang Mach-E", year: 2024, imageUrl: null },
    ]);
  });

  it("findet Fahrzeuge auch unter { vehicles: [...] }", () => {
    const [v] = parseGarage({ vehicles: [{ vehicleId: "V2", vehicleType: "Explorer" }] });
    expect(v).toMatchObject({ vin: "V2", model: "Explorer", year: null });
  });

  it("übernimmt einen Bild-Link, wenn Ford einen mitschickt", () => {
    const [v] = parseGarage([{ vin: "V1", media: { vehicleImageUrl: "https://example.test/car.png" } }]);
    expect(v.imageUrl).toBe("https://example.test/car.png");
  });

  it("nimmt keine beliebigen Links als Bild", () => {
    const [v] = parseGarage([{ vin: "V1", manualUrl: "https://example.test/manual.pdf" }]);
    expect(v.imageUrl).toBeNull();
  });

  it("ignoriert Unsinn", () => {
    expect(parseGarage(null)).toEqual([]);
    expect(parseGarage({ error: "x" })).toEqual([]);
  });
});
