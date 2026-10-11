// Macht aus der verschachtelten Ford-Antwort ein einfaches Objekt.
// Nicht jedes Modell liefert jeden Wert, deshalb ist alles optional (null).

/** Eine Abfahrtszeit, wie sie in der FordPass-App eingestellt ist. */
export interface DepartureTime {
  /** Wochentag auf Englisch, wie Ford ihn schickt: MONDAY ... SUNDAY. */
  day: string;
  /** Uhrzeit im Format HH:MM (Ortszeit des Autos). */
  time: string;
  /** Ist diese Abfahrtszeit eingeschaltet? */
  enabled: boolean;
  /** Soll der Innenraum bis dahin vorklimatisiert werden? null = unbekannt. */
  preconditioning: boolean | null;
}

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
  departures: DepartureTime[];
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
  // Einstellungen (z. B. Abfahrtszeiten) liegen eine Ebene tiefer unter "configurations".
  // Sie zählen mit, damit eine geänderte Abfahrtszeit als neuer Messwert gespeichert wird.
  const configurations = Object.values((metrics.configurations ?? {}) as Metrics);
  for (const entry of [...Object.values(metrics), ...configurations]) {
    for (const item of Array.isArray(entry) ? entry : [entry]) {
      const t = item?.updateTime;
      if (t && (!latest || Date.parse(t) > Date.parse(latest))) latest = t;
    }
  }
  return latest;
}

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/**
 * Liest die Abfahrtszeiten aus der Telemetrie. Ford schickt sie unter
 * metrics.configurations.xevDepartureSchedulesSetting mit, eine extra Abfrage ist nicht nötig.
 * Sortiert nach Wochentag und Uhrzeit.
 */
export function parseDepartureTimes(metrics: unknown): DepartureTime[] {
  type Schedule = {
    scheduleStatus?: string;
    schedule?: { weeklySchedule?: { dayOfWeek?: string; timeOfDay?: string } };
    oemData?: { chrg_go_t_prcond_d_stat?: { stringValue?: string } };
  };
  type Setting = {
    departureScheduleFeatureStatus?: string;
    departureLocations?: { departureSchedules?: Schedule[] }[];
  };
  const configurations = (metrics as Metrics | undefined)?.configurations as Metrics | undefined;
  const setting = value(configurations ?? {}, "xevDepartureSchedulesSetting") as Setting | null;
  if (!setting || !Array.isArray(setting.departureLocations)) return [];

  // Ist die Funktion im Auto ganz ausgeschaltet, gilt keine einzelne Zeit.
  const featureOn = str(setting.departureScheduleFeatureStatus)?.toUpperCase() !== "OFF";
  const departures: DepartureTime[] = [];
  for (const location of setting.departureLocations) {
    for (const entry of location?.departureSchedules ?? []) {
      const day = str(entry?.schedule?.weeklySchedule?.dayOfWeek)?.toUpperCase();
      const time = str(entry?.schedule?.weeklySchedule?.timeOfDay);
      if (!day || !DAYS.includes(day) || !time || !/^\d{1,2}:\d{2}$/.test(time)) continue;
      const precondition = str(entry.oemData?.chrg_go_t_prcond_d_stat?.stringValue)?.toUpperCase();
      departures.push({
        day,
        time: time.padStart(5, "0"),
        enabled: featureOn && str(entry.scheduleStatus)?.toUpperCase() === "ON",
        preconditioning: precondition === undefined ? null : precondition === "ON",
      });
    }
  }
  return departures.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time.localeCompare(b.time));
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
      departures: parseDepartureTimes(metrics),
      raw: item,
    });
  }
  return snapshots;
}
