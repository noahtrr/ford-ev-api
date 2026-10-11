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

/** Eine Tür, Klappe oder ein Fenster mit deutschem Namen. */
export interface Opening {
  /** z. B. "Fahrertür", "Heckklappe", "Hinten rechts". */
  name: string;
  /** true = offen, false = zu, null = Ford weiß es nicht. */
  open: boolean | null;
}

/** Zustand von Türen, Fenstern, 12-V-Batterie und Alarmanlage. null = Ford schickt den Wert nicht. */
export interface BodyStatus {
  /** true = verriegelt, false = offen. */
  locked: boolean | null;
  doors: Opening[] | null;
  windows: Opening[] | null;
  battery12v: { socPct: number | null; voltage: number | null } | null;
  /** So wie Ford ihn schickt, z. B. "ARMED" oder "DISARMED". */
  alarm: string | null;
}

export interface VehicleSnapshot extends BodyStatus {
  vin: string;
  ts: string;
  socPct: number | null;
  rangeKm: number | null;
  odometerKm: number | null;
  lat: number | null;
  lon: number | null;
  plugStatus: string | null;
  chargeStatus: string | null;
  /** null = Ford schickt für dieses Auto keine Abfahrtszeiten mit. */
  departures: DepartureTime[] | null;
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
 * Sortiert nach Wochentag und Uhrzeit. Gibt null zurück, wenn Ford gar keine Abfahrtszeiten
 * mitschickt (nicht jedes Modell liefert sie), und eine leere Liste, wenn keine eingestellt ist.
 */
export function parseDepartureTimes(metrics: unknown): DepartureTime[] | null {
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
  if (!setting || !Array.isArray(setting.departureLocations)) return null;

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

type Item = Record<string, unknown> & { value?: unknown };

/** Alle Einträge zu einem Schlüssel als Liste (Ford schickt mal einen, mal mehrere). */
function entries(metrics: Metrics, key: string): Item[] {
  const entry = metrics[key];
  if (!entry) return [];
  return (Array.isArray(entry) ? entry : [entry]).filter((e) => e && typeof e === "object") as Item[];
}

const POSITIONS: Record<string, string> = {
  FRONT_LEFT: "Vorne links",
  FRONT_RIGHT: "Vorne rechts",
  REAR_LEFT: "Hinten links",
  REAR_RIGHT: "Hinten rechts",
  TAILGATE: "Heckklappe",
  REAR_TAILGATE: "Heckklappe",
  INNER_TAILGATE: "Innere Heckklappe",
  HATCH: "Heckklappe",
  TRUNK: "Kofferraum",
  FRUNK: "Frunk",
  ROOF: "Schiebedach",
  SUNROOF: "Schiebedach",
  ALL_DOORS: "Alle Türen",
};

/**
 * Deutscher Name für eine Tür oder ein Fenster. Manche Modelle (z. B. Mustang Mach-E) schicken
 * statt FRONT_LEFT die Kombination UNSPECIFIED_FRONT + Fahrer- oder Beifahrerseite.
 */
function positionName(position: string, side: string | null, kind: "Tür" | "Fenster"): string {
  const p = position.toUpperCase();
  const s = side?.toUpperCase();
  const sideName = s === "DRIVER" ? "Fahrer" : s === "PASSENGER" ? "Beifahrer" : null;
  if (p === "UNSPECIFIED_FRONT" && sideName) return kind === "Tür" ? `${sideName}tür` : `${sideName}fenster`;
  if (p === "UNSPECIFIED_REAR" && sideName) return `Hinten ${sideName}seite`;
  return POSITIONS[p] ?? position;
}

/** Türen und Motorhaube. OPEN/AJAR = offen, CLOSED = zu, alles andere unbekannt. */
function parseDoors(metrics: Metrics): Opening[] | null {
  const doors: Opening[] = [];
  for (const d of entries(metrics, "doorStatus")) {
    const position = str(d.vehicleDoor);
    const v = str(d.value)?.toUpperCase();
    if (!position || !v) continue;
    doors.push({
      name: positionName(position, str(d.vehicleSide), "Tür"),
      open: v === "CLOSED" ? false : v === "OPEN" || v === "AJAR" ? true : null,
    });
  }
  const hood = str(value(metrics, "hoodStatus"))?.toUpperCase();
  if (hood) doors.push({ name: "Motorhaube", open: hood === "CLOSED" ? false : hood === "OPEN" ? true : null });
  return doors.length > 0 ? doors : null;
}

/**
 * Fenster. Ford schickt meist einen Bereich (doubleRange), wie weit das Fenster offen ist:
 * 0 bis 0 heißt geschlossen. Manche Modelle schicken stattdessen Text wie "FULLY_CLOSED".
 */
function parseWindows(metrics: Metrics): Opening[] | null {
  const windows: Opening[] = [];
  for (const w of entries(metrics, "windowStatus")) {
    const position = str(w.vehicleWindow);
    if (!position) continue;
    let open: boolean | null = null;
    const range = (w.value as { doubleRange?: { lowerBound?: unknown; upperBound?: unknown } } | null)?.doubleRange;
    const text = str(w.value)?.toUpperCase();
    if (range) {
      const lower = num(range.lowerBound) ?? 0;
      const upper = num(range.upperBound) ?? 0;
      open = lower > 0 || upper > 0;
    } else if (text) {
      open = text.includes("CLOSED") ? false : text.includes("OPEN") || text.includes("VENT") ? true : null;
    }
    windows.push({ name: positionName(position, str(w.vehicleSide), "Fenster"), open });
  }
  return windows.length > 0 ? windows : null;
}

/** Verriegelt nur, wenn Ford für alle gemeldeten Türen LOCKED oder DOUBLE_LOCKED schickt. */
function parseLock(metrics: Metrics): boolean | null {
  const values = entries(metrics, "doorLockStatus")
    .map((e) => str(e.value)?.toUpperCase())
    .filter((v): v is string => v === "LOCKED" || v === "DOUBLE_LOCKED" || v === "UNLOCKED");
  if (values.length === 0) return null;
  return values.every((v) => v !== "UNLOCKED");
}

/**
 * Die kleine 12-V-Batterie. Ford nennt sie PRIMARY_BATTERY. Einträge zu einer anderen
 * Batterie werden ignoriert, damit nicht aus Versehen der Fahrakku angezeigt wird.
 */
function parseBattery12v(metrics: Metrics): BodyStatus["battery12v"] {
  const pick = (key: string) => {
    const e = entries(metrics, key).find((x) => {
      const battery = str(x.vehicleBattery)?.toUpperCase();
      return !battery || battery === "PRIMARY_BATTERY";
    });
    return num(e?.value);
  };
  const socPct = pick("batteryStateOfCharge");
  const voltage = pick("batteryVoltage");
  return socPct === null && voltage === null ? null : { socPct, voltage };
}

/** Liest Türen, Fenster, Schloss, 12-V-Batterie und Alarm aus den Messwerten. */
export function parseBodyStatus(metrics: unknown): BodyStatus {
  const m = (metrics ?? {}) as Metrics;
  return {
    locked: parseLock(m),
    doors: parseDoors(m),
    windows: parseWindows(m),
    battery12v: parseBattery12v(m),
    alarm: str(value(m, "alarmStatus")),
  };
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
      ...parseBodyStatus(metrics),
      raw: item,
    });
  }
  return snapshots;
}
