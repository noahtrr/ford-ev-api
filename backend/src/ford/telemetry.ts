// Macht aus der verschachtelten Ford-Antwort ein einfaches Objekt.
// Nicht jedes Modell liefert jeden Wert, deshalb ist alles optional (null).

export interface VehicleSnapshot {
  vin: string;
  ts: string;
  socPct: number | null;
  rangeKm: number | null;
  odometerKm: number | null;
  lat: number | null;
  lon: number | null;
  plugStatus: string | null;
  chargeStatus: string | null;
  raw: unknown;
}

type Metric = { value?: unknown; updateTime?: string };
type Metrics = Record<string, Metric | Metric[] | undefined>;

function value(metrics: Metrics, key: string): unknown {
  const entry = metrics[key];
  if (Array.isArray(entry)) return entry[0]?.value ?? null;
  return entry?.value ?? null;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Neuester Zeitstempel aller Messwerte, damit doppelte Daten erkennbar sind. */
function latestUpdate(metrics: Metrics): string | null {
  let latest: string | null = null;
  for (const entry of Object.values(metrics)) {
    for (const item of Array.isArray(entry) ? entry : [entry]) {
      const t = item?.updateTime;
      if (t && (!latest || Date.parse(t) > Date.parse(latest))) latest = t;
    }
  }
  return latest;
}

export function parseTelemetry(data: unknown, now = new Date()): VehicleSnapshot[] {
  const items = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  const snapshots: VehicleSnapshot[] = [];
  for (const item of items) {
    const vin = str(item?.vin) ?? str(item?.vehicleId);
    const metrics = item?.metrics as Metrics | undefined;
    if (!vin || !metrics) continue;

    const position = value(metrics, "position") as { location?: { lat?: number; lon?: number } } | null;
    snapshots.push({
      vin,
      ts: latestUpdate(metrics) ?? now.toISOString(),
      socPct: num(value(metrics, "xevBatteryStateOfCharge") ?? value(metrics, "xevBatteryActualStateOfCharge")),
      rangeKm: num(value(metrics, "xevBatteryRange")),
      odometerKm: num(value(metrics, "odometer")),
      lat: num(position?.location?.lat),
      lon: num(position?.location?.lon),
      plugStatus: str(value(metrics, "xevPlugChargerStatus")),
      chargeStatus: str(value(metrics, "xevBatteryChargeDisplayStatus")),
      raw: item,
    });
  }
  return snapshots;
}
