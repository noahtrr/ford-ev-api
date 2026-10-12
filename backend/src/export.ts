import { buildXlsx } from "./xlsx.js";

// Macht aus einer Tabelle (Überschrift, Zeilen, Summenzeile) eine CSV-, TXT- oder Excel-Datei.
// Wird vom Kilometerstand und von den Ladevorgängen benutzt.

export type ExportCell = string | number | null;

export interface ExportTable {
  /** Steht in der TXT-Datei oben. */
  title: string;
  /** Name des Excel-Blatts (höchstens 31 Zeichen). */
  sheetName: string;
  header: string[];
  rows: ExportCell[][];
  /** Summenzeile am Ende, fehlt sie, gibt es keine. */
  total?: ExportCell[];
}

/** Zahl im deutschen Format mit Komma, ohne Tausenderpunkt (lässt sich in Excel weiterrechnen). */
function germanNumber(v: ExportCell): string {
  if (v === null) return "";
  return typeof v === "number" ? String(v).replace(".", ",") : v;
}

const allRows = (t: ExportTable) => (t.total ? [...t.rows, t.total] : t.rows);

/** CSV mit Semikolon, so öffnet deutsches Excel die Datei direkt in Spalten. */
export function tableToCsv(t: ExportTable): string {
  const quote = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [t.header, ...allRows(t)].map((line) => line.map((v) => quote(germanNumber(v))).join(";"));
  // Das BOM am Anfang sorgt dafür, dass Excel Umlaute richtig anzeigt.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Gut lesbare Texttabelle mit festen Spaltenbreiten. Spalten mit Zahlen stehen rechtsbündig. */
export function tableToTxt(t: ExportTable): string {
  const format = (v: ExportCell) =>
    v === null ? "–" : typeof v === "number" ? v.toLocaleString("de-DE", { maximumFractionDigits: 6 }) : v;
  const numeric = t.header.map((_, i) => allRows(t).some((r) => typeof r[i] === "number"));
  const body = t.rows.map((r) => r.map(format));
  const total = t.total?.map((v) => (v === null ? "" : format(v)));
  const table = [t.header, ...body, ...(total ? [total] : [])];
  const widths = t.header.map((_, i) => Math.max(...table.map((r) => String(r[i]).length)));
  const line = (r: string[]) => r.map((v, i) => (numeric[i] ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join("  ").trimEnd();
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  return [
    t.title,
    "",
    line(t.header),
    separator,
    ...body.map(line),
    ...(total ? [separator, line(total)] : []),
    "",
  ].join("\r\n");
}

/** Excel-Datei: Überschrift und Summe fett, Zahlen als echte Zahlen zum Weiterrechnen. */
export function tableToXlsx(t: ExportTable): Buffer {
  const bold = t.total ? [0, t.rows.length + 1] : [0];
  return buildXlsx(t.sheetName, [t.header, ...allRows(t)], bold);
}

export const EXPORT_FORMATS = {
  csv: { type: "text/csv; charset=utf-8", build: tableToCsv },
  txt: { type: "text/plain; charset=utf-8", build: tableToTxt },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", build: tableToXlsx },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;
