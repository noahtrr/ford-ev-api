// Erkennt Ladevorgänge in den gespeicherten Messwerten und fasst sie nach Tagen, Wochen,
// Monaten und Jahren zusammen, plus Jahresübersicht und Export.
// Ford meldet keine fertigen Ladevorgänge. Die App sieht nur alle paar Minuten Ladestand,
// Kabel und Ladestatus und leitet daraus ab, wann geladen wurde.
import type { ExportTable } from "./export.js";
import { MONTH_NAMES, localDate, periodKey, type Period, type TripCategory } from "./odometer.js";

/** Ein gespeicherter Messwert mit allem, was für Ladevorgänge zählt. */
export interface ChargingSample {
  /** Zeitpunkt des gespeicherten Messwerts, dient auch als Kennung. */
  ts: string;
  socPct: number | null;
  rangeKm: number | null;
  odometerKm: number | null;
  lat: number | null;
  lon: number | null;
  /** CONNECTED, DISCONNECTED, ... */
  plugStatus: string | null;
  /** IN_PROGRESS, COMPLETED, NOT_PLUGGED_IN, ... */
  chargeStatus: string | null;
  powerType: string | null;
  timeToFullMin: number | null;
  energyRemainingKwh: number | null;
  capacityKwh: number | null;
  /** Markierung des Ladevorgangs, der mit diesem Messwert beginnt. */
  category?: TripCategory | null;
}

/** Ein erkannter Ladevorgang. */
export interface ChargingSession {
  /** Kennung zum Markieren: Zeitpunkt des ersten Messwerts mit eingestecktem Kabel. */
  id: string;
  /** Erster Messwert mit eingestecktem Kabel. */
  pluggedIn: string;
  /** Letzter Messwert mit eingestecktem Kabel. */
  pluggedOut: string;
  /** Beginn des Ladens (erster Messwert „lädt“, sonst Einstecken). */
  start: string;
  /** Wann der höchste Ladestand erreicht war. */
  end: string;
  durationMin: number;
  startSocPct: number | null;
  endSocPct: number | null;
  addedSocPct: number | null;
  startRangeKm: number | null;
  endRangeKm: number | null;
  addedRangeKm: number | null;
  /** Geladene Energie in kWh. Nur wenn Ford Energie oder Akkukapazität schickt, sonst null. */
  energyKwh: number | null;
  /** Durchschnittliche Ladeleistung in kW, nur mit energyKwh. */
  avgPowerKw: number | null;
  /** AC, DC oder WIRELESS, null = unbekannt. */
  powerType: string | null;
  odometerKm: number | null;
  /** Standort des Ladevorgangs. Einmal gespeichert, bleibt er fest (siehe applySavedLocations). */
  lat: number | null;
  lon: number | null;
  /** Adresse zum Standort, z. B. „Hauptstraße 5, 12345 Berlin“. null = noch nicht nachgeschlagen. */
  address: string | null;
  /** Wann der Standort gespeichert wurde. null = noch nicht gespeichert. */
  locationSavedAt: string | null;
  /** Letzter Ladestatus von Ford (z. B. COMPLETED, STOPPED). */
  lastStatus: string | null;
  /** Lädt gerade noch. */
  ongoing: boolean;
  /** Nur bei ongoing: Minuten bis voll laut Ford. */
  timeToFullMin: number | null;
  /** Wie viele Messwerte zu diesem Ladevorgang gehören. */
  samples: number;
  category: TripCategory | null;
}

const round = (n: number) => Math.round(n * 10) / 10;
const upper = (s: string | null) => s?.toUpperCase() ?? null;

function isCharging(s: ChargingSample): boolean {
  return upper(s.chargeStatus) === "IN_PROGRESS" || upper(s.chargeStatus) === "FAST_CHARGING";
}

/** true = Kabel steckt, false = Kabel nicht drin, null = Ford sagt nichts dazu. */
function isPlugged(s: ChargingSample): boolean | null {
  const plug = upper(s.plugStatus);
  const status = upper(s.chargeStatus);
  if (plug === "CONNECTED" || isCharging(s)) return true;
  if (plug === "DISCONNECTED" || status === "NOT_PLUGGED_IN") return false;
  return null;
}

/** Fasst eine Reihe von Messwerten mit eingestecktem Kabel zu einem Ladevorgang zusammen. */
function toSession(group: ChargingSample[], ongoing: boolean): ChargingSession | null {
  const firstCharging = group.findIndex(isCharging);
  const socs = group.map((s) => s.socPct).filter((v): v is number => v !== null);
  const socRose = socs.length > 1 && Math.max(...socs) - socs[0] >= 1;
  // Nur eingesteckt, aber nichts geladen (z. B. Akku schon voll): kein Ladevorgang.
  if (firstCharging < 0 && !socRose) return null;

  const startIndex = Math.max(0, firstCharging);
  // Ladestand vorher: der niedrigste Wert bis zum Beginn (Vorklimatisieren kann ihn kurz senken).
  const before = group.slice(0, startIndex + 1).filter((s) => s.socPct !== null);
  const startSample = before.length ? before.reduce((a, b) => (b.socPct! < a.socPct! ? b : a)) : group[startIndex];
  // Ende: der erste Messwert mit dem höchsten Ladestand danach.
  const after = group.slice(startIndex);
  let endSample = after[0];
  for (const s of after) {
    if (s.socPct !== null && (endSample.socPct === null || s.socPct > endSample.socPct)) endSample = s;
  }
  const start = group[startIndex].ts;
  const end = endSample.ts < start ? start : endSample.ts;
  const last = group[group.length - 1];

  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : round(Math.max(0, b - a)));
  const addedSocPct = diff(startSample.socPct, endSample.socPct);
  // Energie: am genauesten aus der Restenergie, sonst aus Ladestand × Akkukapazität.
  let energyKwh = diff(startSample.energyRemainingKwh, endSample.energyRemainingKwh);
  const capacity = group.find((s) => s.capacityKwh !== null)?.capacityKwh ?? null;
  if (energyKwh === null && capacity !== null && addedSocPct !== null) energyKwh = round((addedSocPct / 100) * capacity);
  const durationMin = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  // Standort: am liebsten der beim Laden, sonst irgendeiner mit eingestecktem Kabel.
  const hasPosition = (s: ChargingSample) => s.lat !== null && s.lon !== null;
  const position = group.slice(startIndex).find(hasPosition) ?? group.find(hasPosition);

  return {
    id: group[0].ts,
    pluggedIn: group[0].ts,
    pluggedOut: last.ts,
    start,
    end,
    durationMin,
    startSocPct: startSample.socPct,
    endSocPct: endSample.socPct,
    addedSocPct,
    startRangeKm: startSample.rangeKm,
    endRangeKm: endSample.rangeKm,
    addedRangeKm: diff(startSample.rangeKm, endSample.rangeKm),
    energyKwh,
    avgPowerKw: energyKwh !== null && durationMin > 0 ? round(energyKwh / (durationMin / 60)) : null,
    powerType: group.find((s) => s.powerType)?.powerType ?? null,
    odometerKm: group.find((s) => s.odometerKm !== null)?.odometerKm ?? null,
    lat: position?.lat ?? null,
    lon: position?.lon ?? null,
    address: null,
    locationSavedAt: null,
    lastStatus: [...group].reverse().find((s) => s.chargeStatus)?.chargeStatus ?? null,
    ongoing,
    timeToFullMin: ongoing ? last.timeToFullMin : null,
    samples: group.length,
    category: group[0].category ?? null,
  };
}

/**
 * Findet die Ladevorgänge. Ein Ladevorgang dauert vom Einstecken bis zum Abstecken:
 * alle Messwerte dazwischen gehören dazu. Er endet, wenn Ford „Kabel nicht drin“ meldet
 * oder der Kilometerstand steigt (das Auto ist gefahren). Älteste zuerst.
 */
export function detectSessions(samples: ChargingSample[]): ChargingSession[] {
  const sorted = [...samples].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const sessions: ChargingSession[] = [];
  let group: ChargingSample[] = [];
  const close = (ongoing: boolean) => {
    const session = group.length ? toSession(group, ongoing) : null;
    if (session) sessions.push(session);
    group = [];
  };
  for (const s of sorted) {
    const plugged = isPlugged(s);
    const startKm = group.find((g) => g.odometerKm !== null)?.odometerKm ?? null;
    const drove = startKm !== null && s.odometerKm !== null && s.odometerKm > startKm;
    if (plugged === false || drove) close(false);
    if (plugged === true) group.push(s);
  }
  // Steckt das Kabel beim neuesten Messwert noch und lädt das Auto, läuft der Ladevorgang noch.
  close(group.length > 0 && isCharging(group[group.length - 1]));
  return sessions;
}

/** Ein gespeicherter Standort eines Ladevorgangs. */
export interface SavedLocation {
  lat: number;
  lon: number;
  address: string | null;
  savedAt: string;
}

/**
 * Setzt bei jedem Ladevorgang den gespeicherten Standort ein. So bleibt der Ort fest,
 * auch wenn sich die Messwerte später ändern. Gibt die Ladevorgänge zurück, deren Standort
 * noch nicht gespeichert ist (zum Speichern).
 */
export function applySavedLocations(sessions: ChargingSession[], saved: Map<string, SavedLocation>): ChargingSession[] {
  const unsaved: ChargingSession[] = [];
  for (const s of sessions) {
    const loc = saved.get(s.id);
    if (loc) Object.assign(s, { lat: loc.lat, lon: loc.lon, address: loc.address, locationSavedAt: loc.savedAt });
    else if (s.lat !== null && s.lon !== null) unsaved.push(s);
  }
  return unsaved;
}

/** Link zum Standort in Google Maps, wie auf der Übersicht. */
export function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

/** Die Ladevorgänge eines Tages (z. B. "2026-10-11"), älteste zuerst. */
export function daySessions(sessions: ChargingSession[], date: string, timeZone: string): ChargingSession[] {
  return sessions.filter((s) => periodKey(s.start, "day", timeZone) === date);
}

/** Summen einer Liste von Ladevorgängen. */
export interface ChargingTotals {
  sessions: number;
  addedSocPct: number;
  /** null = Ford schickt keine Energie und keine Akkukapazität. */
  energyKwh: number | null;
  addedRangeKm: number;
  durationMin: number;
  privateSessions: number;
  businessSessions: number;
  privateKwh: number | null;
  businessKwh: number | null;
}

export function totals(list: ChargingSession[]): ChargingTotals {
  const sum = (pick: (s: ChargingSession) => number | null) => round(list.reduce((a, s) => a + (pick(s) ?? 0), 0));
  const hasEnergy = list.some((s) => s.energyKwh !== null);
  const kwh = (c: TripCategory) => (hasEnergy ? sum((s) => (s.category === c ? s.energyKwh : 0)) : null);
  return {
    sessions: list.length,
    addedSocPct: sum((s) => s.addedSocPct),
    energyKwh: hasEnergy ? sum((s) => s.energyKwh) : null,
    addedRangeKm: sum((s) => s.addedRangeKm),
    durationMin: Math.round(sum((s) => s.durationMin)),
    privateSessions: list.filter((s) => s.category === "private").length,
    businessSessions: list.filter((s) => s.category === "business").length,
    privateKwh: kwh("private"),
    businessKwh: kwh("business"),
  };
}

export interface ChargingPeriodRow extends ChargingTotals {
  /** 2026-10-11, 2026-W41, 2026-10 oder 2026. */
  period: string;
}

/** Ladevorgänge nach Tagen, Wochen, Monaten oder Jahren. Nur Zeiträume mit Ladevorgängen, neueste zuerst. */
export function summarizeCharging(sessions: ChargingSession[], period: Period, timeZone: string): ChargingPeriodRow[] {
  const groups = new Map<string, ChargingSession[]>();
  for (const s of sessions) {
    const key = periodKey(s.start, period, timeZone);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()].map(([key, list]) => ({ period: key, ...totals(list) })).sort((a, b) => b.period.localeCompare(a.period));
}

export interface ChargingMonthRow extends ChargingTotals {
  month: number;
  /** Monat liegt in der Zukunft. */
  future: boolean;
}

export interface ChargingYearOverview {
  vin: string;
  year: number;
  months: ChargingMonthRow[];
  total: ChargingTotals;
}

/** Jahresübersicht mit allen 12 Monaten. */
export function chargingYearOverview(vin: string, sessions: ChargingSession[], year: number, timeZone: string, now = new Date()): ChargingYearOverview {
  const inYear = sessions.filter((s) => localDate(s.start, timeZone).year === year);
  const today = localDate(now.toISOString(), timeZone);
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    future: year > today.year || (year === today.year && i + 1 > today.month),
    ...totals(inYear.filter((s) => localDate(s.start, timeZone).month === i + 1)),
  }));
  return { vin, year, months, total: totals(inYear) };
}

/** Jahre mit Ladevorgängen plus das aktuelle Jahr, neueste zuerst. */
export function chargingYears(sessions: ChargingSession[], timeZone: string, now = new Date()): number[] {
  const years = new Set([localDate(now.toISOString(), timeZone).year]);
  for (const s of sessions) years.add(localDate(s.start, timeZone).year);
  return [...years].sort((a, b) => b - a);
}

/** Minuten als „3:05 h“. */
export function hours(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;
}

const POWER_TYPES: Record<string, string> = { AC: "AC", DC: "DC (Schnellladen)", WIRELESS: "Induktiv" };
const CATEGORY_NAMES: Record<TripCategory, string> = { private: "Privat", business: "Geschäftlich" };

/** Monatsübersicht eines Jahres für CSV, TXT und Excel. */
export function chargingMonthsTable(o: ChargingYearOverview): ExportTable {
  const row = (label: string, t: ChargingTotals) => [
    label,
    t.sessions,
    t.addedSocPct,
    t.energyKwh,
    t.addedRangeKm,
    hours(t.durationMin),
    t.privateSessions,
    t.businessSessions,
    t.privateKwh,
    t.businessKwh,
  ];
  return {
    title: `Ladevorgänge ${o.year} – Fahrzeug ${o.vin}`,
    sheetName: `Ladevorgänge ${o.year}`,
    header: [
      "Monat",
      "Ladevorgänge",
      "Geladen %",
      "Energie kWh",
      "Reichweite +km",
      "Ladedauer",
      "Davon privat",
      "Davon geschäftlich",
      "Privat kWh",
      "Geschäftlich kWh",
    ],
    rows: o.months.filter((m) => !m.future).map((m) => row(`${MONTH_NAMES[m.month - 1]} ${o.year}`, m)),
    total: row(`Summe ${o.year}`, o.total),
  };
}

/** Jeder einzelne Ladevorgang eines Jahres für CSV, TXT und Excel. */
export function chargingSessionsTable(vin: string, year: number, sessions: ChargingSession[], timeZone: string): ExportTable {
  const date = new Intl.DateTimeFormat("de-DE", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" });
  const time = new Intl.DateTimeFormat("de-DE", { timeZone, hour: "2-digit", minute: "2-digit" });
  const list = sessions.filter((s) => localDate(s.start, timeZone).year === year);
  const t = totals(list);
  return {
    title: `Alle Ladevorgänge ${year} – Fahrzeug ${vin}`,
    sheetName: `Ladevorgänge ${year}`,
    header: [
      "Datum",
      "Beginn",
      "Ende",
      "Ladedauer",
      "Ladestand vorher %",
      "Ladestand nachher %",
      "Geladen %",
      "Energie kWh",
      "Ø Leistung kW",
      "Reichweite vorher km",
      "Reichweite nachher km",
      "Reichweite +km",
      "Ladeart",
      "Kilometerstand",
      "Breitengrad",
      "Längengrad",
      "Adresse",
      "Google Maps",
      "Eingesteckt",
      "Zuletzt eingesteckt",
      "Markierung",
    ],
    rows: list.map((s) => [
      date.format(new Date(s.start)),
      time.format(new Date(s.start)),
      s.ongoing ? "lädt noch" : time.format(new Date(s.end)),
      hours(s.durationMin),
      s.startSocPct,
      s.endSocPct,
      s.addedSocPct,
      s.energyKwh,
      s.avgPowerKw,
      s.startRangeKm,
      s.endRangeKm,
      s.addedRangeKm,
      s.powerType ? (POWER_TYPES[s.powerType] ?? s.powerType) : null,
      s.odometerKm,
      s.lat,
      s.lon,
      s.address,
      s.lat !== null && s.lon !== null ? mapsUrl(s.lat, s.lon) : null,
      `${date.format(new Date(s.pluggedIn))} ${time.format(new Date(s.pluggedIn))}`,
      s.ongoing ? null : `${date.format(new Date(s.pluggedOut))} ${time.format(new Date(s.pluggedOut))}`,
      s.category ? CATEGORY_NAMES[s.category] : null,
    ]),
    total: [`Summe ${year}`, null, null, hours(t.durationMin), null, null, t.addedSocPct, t.energyKwh, null, null, null, t.addedRangeKm, null, null, null, null, null, null, null, null, null],
  };
}
