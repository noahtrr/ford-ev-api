// Liest aus Fords /garage-Antwort, welches Auto es ist (Modell, Baujahr) und ob Ford ein Bild mitschickt.
// Laut Ford-Doku enthält die Antwort u. a. vin, nickName, modelName, modelYear und engineType.
// Fords Postman-Sammlung kennt keinen Endpunkt für Fahrzeugbilder. Falls Ford in der
// Garage-Antwort einen Bild-Link mitschickt, wird er hier gefunden, sonst bleibt imageUrl null.

export interface VehicleInfo {
  vin: string;
  /** z. B. "Mustang Mach-E" oder "Explorer". */
  model: string | null;
  year: number | null;
  /** Link zu einem Bild des Autos, wenn Ford einen mitschickt. */
  imageUrl: string | null;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Sucht (auch verschachtelt) nach einem Bild-Link, z. B. unter "imageUrl" oder "vehicleImage". */
function findImageUrl(v: unknown, key = "", depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof v === "string") {
    return /^https:\/\//.test(v) && /image|img|picture|photo|thumbnail/i.test(key) ? v : null;
  }
  const children = Array.isArray(v) ? v.map((x) => [key, x] as const) : isObj(v) ? Object.entries(v) : [];
  for (const [k, child] of children) {
    const found = findImageUrl(child, k, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Alle Fahrzeuge in der Antwort. Ford schickt je nach Version eine Liste oder { vehicles: [...] }. */
function vehicleObjects(data: unknown): Obj[] {
  if (Array.isArray(data)) return data.filter(isObj);
  if (!isObj(data)) return [];
  if (str(data.vin) ?? str(data.vehicleId)) return [data];
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.some(isObj)) return v.filter(isObj);
  }
  return [];
}

export function parseGarage(data: unknown): VehicleInfo[] {
  const vehicles: VehicleInfo[] = [];
  for (const v of vehicleObjects(data)) {
    const vin = str(v.vin) ?? str(v.vehicleId);
    if (!vin) continue;
    const year = Number(v.modelYear);
    vehicles.push({
      vin,
      model: str(v.modelName) ?? str(v.vehicleType) ?? str(v.model),
      year: Number.isInteger(year) && year > 1900 ? year : null,
      imageUrl: findImageUrl(v),
    });
  }
  return vehicles;
}
