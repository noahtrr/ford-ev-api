import { buildXlsx } from "./xlsx.js";

// Rechnet aus den gespeicherten Kilometerständen Übersichten nach Tagen, Wochen,
// Monaten und Jahren, plus die Jahresübersicht mit 12 Monaten (z. B. für Abrechnungen).
// Ford schickt nur Daten, wenn das Auto wach ist. Deshalb zählt immer der letzte
// bekannte Kilometerstand eines Zeitraums.

/** Ein gespeicherter Kilometerstand mit Zeitpunkt (ISO-Zeit von Ford). */
export interface OdometerReading {
  ts: string;
  km: number;
}

export type Period = "day" | "week" | "month" | "year";
export const PERIODS: Period[] = ["day", "week", "month", "year"];

/** Ein Zeitraum (Tag, Woche, Monat oder Jahr) mit Kilometerständen. */
export interface PeriodRow {
  /** Schlüssel des Zeitraums: 2026-10-11, 2026-W41, 2026-10 oder 2026. */
  period: string;
  /** Kilometerstand am Anfang: letzter Wert davor, sonst der erste in diesem Zeitraum. */
  startKm: number;
  /** Letzter Kilometerstand in diesem Zeitraum. */
  endKm: number;
  /** Gefahrene Kilometer im Zeitraum. */
  distanceKm: number;
  /** Wie viele Messwerte es in diesem Zeitraum gab. */
  readings: number;
}

/** Ein Monat der Jahresübersicht. Werte sind null, wenn es noch keinen Kilometerstand gibt. */
export interface MonthRow {
  /** 1 bis 12 */
  month: number;
  startKm: number | null;
  endKm: number | null;
  distanceKm: number | null;
  readings: number;
  /** Zeitpunkt des letzten Messwerts in diesem Monat, null = kein Messwert (Wert übernommen). */
  lastReading: string | null;
}

export interface YearOverview {
  vin: string;
  year: number;
  months: MonthRow[];
  totalKm: number | null;
}

/** Datum in der eingestellten Zeitzone (z. B. Europe/Berlin), nicht in der Zeitzone des Servers. */
function localDate(ts: string, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(ts),
  );
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Kalenderwoche nach ISO 8601 (Woche beginnt am Montag, so wie in Deutschland üblich). */
function isoWeek(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = (date.getUTCDay() + 6) % 7; // Montag = 0
  // Der Donnerstag dieser Woche bestimmt, zu welchem Jahr die Woche gehört.
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${weekYear}-W${pad(week)}`;
}

function periodKey(ts: string, period: Period, timeZone: string): string {
  const { year, month, day } = localDate(ts, timeZone);
  if (period === "day") return `${year}-${pad(month)}-${pad(day)}`;
  if (period === "week") return isoWeek(year, month, day);
  if (period === "month") return `${year}-${pad(month)}`;
  return String(year);
}

/** Auf eine Nachkommastelle runden, damit keine Werte wie 12.300000001 entstehen. */
const round = (n: number) => Math.round(n * 10) / 10;

/** Nur gültige Werte, zeitlich sortiert. */
function sorted(readings: OdometerReading[]): OdometerReading[] {
  return readings.filter((r) => Number.isFinite(r.km)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/**
 * Fasst die Kilometerstände nach Tagen, Wochen, Monaten oder Jahren zusammen.
 * Nur Zeiträume mit Messwerten kommen vor. Neueste zuerst.
 */
export function summarize(readings: OdometerReading[], period: Period, timeZone: string): PeriodRow[] {
  const rows: PeriodRow[] = [];
  let previousEnd: number | null = null;
  for (const r of sorted(readings)) {
    const key = periodKey(r.ts, period, timeZone);
    const current = rows[rows.length - 1];
    if (current?.period === key) {
      current.endKm = r.km;
      current.readings++;
    } else {
      if (current) previousEnd = current.endKm;
      rows.push({ period: key, startKm: previousEnd ?? r.km, endKm: r.km, distanceKm: 0, readings: 1 });
    }
  }
  for (const row of rows) row.distanceKm = round(Math.max(0, row.endKm - row.startKm));
  return rows.reverse();
}

/**
 * Jahresübersicht mit allen 12 Monaten. Monatsende = letzter Kilometerstand im Monat.
 * Gab es in einem Monat keinen Messwert (Auto stand), wird der letzte bekannte Wert übernommen.
 * Monate in der Zukunft bleiben leer.
 */
export function yearOverview(vin: string, readings: OdometerReading[], year: number, timeZone: string, now = new Date()): YearOverview {
  const byMonth = new Map<number, OdometerReading[]>();
  let before: number | null = null;
  for (const r of sorted(readings)) {
    const d = localDate(r.ts, timeZone);
    if (d.year < year) before = r.km;
    if (d.year !== year) continue;
    const list = byMonth.get(d.month) ?? [];
    list.push(r);
    byMonth.set(d.month, list);
  }

  const today = localDate(now.toISOString(), timeZone);
  const months: MonthRow[] = [];
  let carry = before;
  for (let month = 1; month <= 12; month++) {
    const list = byMonth.get(month) ?? [];
    const future = year > today.year || (year === today.year && month > today.month);
    if (list.length === 0) {
      const value = future ? null : carry;
      months.push({ month, startKm: value, endKm: value, distanceKm: value === null ? null : 0, readings: 0, lastReading: null });
      continue;
    }
    const startKm = carry ?? list[0].km;
    const last = list[list.length - 1];
    months.push({
      month,
      startKm,
      endKm: last.km,
      distanceKm: round(Math.max(0, last.km - startKm)),
      readings: list.length,
      lastReading: last.ts,
    });
    carry = last.km;
  }

  const known = months.filter((m) => m.distanceKm !== null);
  const totalKm = known.length ? round(known.reduce((sum, m) => sum + (m.distanceKm ?? 0), 0)) : null;
  return { vin, year, months, totalKm };
}

export const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const COLUMNS = ["Monat", "Kilometerstand Monatsanfang", "Kilometerstand Monatsende", "Gefahrene km", "Messwerte", "Letzter Messwert"];

/** Die Tabelle der Jahresübersicht als Zeilen, so wie sie in CSV, TXT und Excel landet. */
export function overviewTable(o: YearOverview, timeZone: string): { header: string[]; rows: (string | number | null)[][]; total: (string | number | null)[] } {
  const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone, dateStyle: "medium", timeStyle: "short" });
  const rows = o.months.map((m) => [
    `${MONTH_NAMES[m.month - 1]} ${o.year}`,
    m.startKm,
    m.endKm,
    m.distanceKm,
    m.readings,
    m.lastReading ? dateTime.format(new Date(m.lastReading)) : null,
  ]);
  return { header: COLUMNS, rows, total: [`Summe ${o.year}`, null, null, o.totalKm, o.months.reduce((s, m) => s + m.readings, 0), null] };
}

/** Zahl im deutschen Format mit Komma, ohne Tausenderpunkt (lässt sich in Excel weiterrechnen). */
function germanNumber(v: string | number | null): string {
  if (v === null) return "";
  return typeof v === "number" ? String(v).replace(".", ",") : v;
}

/** CSV mit Semikolon, so öffnet deutsches Excel die Datei direkt in Spalten. */
export function toCsv(o: YearOverview, timeZone: string): string {
  const { header, rows, total } = overviewTable(o, timeZone);
  const quote = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [header, ...rows, total].map((line) => line.map((v) => quote(germanNumber(v))).join(";"));
  // Das BOM am Anfang sorgt dafür, dass Excel Umlaute richtig anzeigt.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Gut lesbare Texttabelle mit festen Spaltenbreiten. */
export function toTxt(o: YearOverview, timeZone: string): string {
  const { header, rows, total } = overviewTable(o, timeZone);
  const format = (v: string | number | null) =>
    v === null ? "–" : typeof v === "number" ? v.toLocaleString("de-DE", { maximumFractionDigits: 1 }) : v;
  const table = [header, ...rows.map((r) => r.map(format)), total.map((v) => (v === null ? "" : format(v)))];
  const widths = header.map((_, i) => Math.max(...table.map((r) => String(r[i]).length)));
  const line = (r: (string | number)[]) =>
    r.map((v, i) => (i === 0 || i === r.length - 1 ? String(v).padEnd(widths[i]) : String(v).padStart(widths[i]))).join("  ").trimEnd();
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  return [
    `Kilometerstand ${o.year} – Fahrzeug ${o.vin}`,
    "",
    line(table[0]),
    separator,
    ...table.slice(1, -1).map(line),
    separator,
    line(table[table.length - 1]),
    "",
  ].join("\r\n");
}

/** Excel-Datei: Überschrift und Summe fett, Zahlen als echte Zahlen zum Weiterrechnen. */
export function toXlsx(o: YearOverview, timeZone: string): Buffer {
  const { header, rows, total } = overviewTable(o, timeZone);
  return buildXlsx(`Kilometerstand ${o.year}`, [header, ...rows, total], [0, rows.length + 1]);
}
