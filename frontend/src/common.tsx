// Bausteine, die Kilometerstand und Ladevorgänge gemeinsam nutzen.

export type Period = "day" | "week" | "month" | "year";
export type Category = "private" | "business";

export const CATEGORY_LABELS: Record<Category, string> = { private: "Privat", business: "Geschäftlich" };

export const PERIOD_TABS: { id: Period; label: string }[] = [
  { id: "day", label: "Tage" },
  { id: "week", label: "Wochen" },
  { id: "month", label: "Monate" },
  { id: "year", label: "Jahre" },
];

export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Zahl im deutschen Format mit Einheit, "–" wenn es keinen Wert gibt. */
/** Link zum Standort in Google Maps (Übersicht und Ladevorgänge). */
export function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

/** Kartenausschnitt wie ein Foto: nicht verschiebbar, ein Tipp öffnet Google Maps (Übersicht und Ladevorgänge). */
export function MapFrame({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  return (
    <a className="map-frame" href={mapsUrl(lat, lon)} target="_blank" rel="noopener noreferrer" aria-label={`${label} in Google Maps öffnen`}>
      <iframe title={`Kartenausschnitt: ${label}`} src={`https://maps.google.com/maps?q=${lat},${lon}&z=16&output=embed`} loading="lazy" tabIndex={-1} />
    </a>
  );
}

export function num(value: number | null | undefined, unit: string): string {
  return value === null || value === undefined ? "–" : `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${unit}`;
}

export function km(value: number | null): string {
  return num(value, "km");
}

/** Minuten als „3:05 h“. */
export function hours(min: number | null): string {
  if (min === null) return "–";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;
}

/** Macht aus "2026-10-11", "2026-W41", "2026-10" oder "2026" einen lesbaren Text. */
export function periodLabel(period: string, type: Period): string {
  if (type === "day") {
    const [y, m, d] = period.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  }
  if (type === "week") {
    const [y, w] = period.split("-W");
    return `KW ${Number(w)} / ${y}`;
  }
  if (type === "month") {
    const [y, m] = period.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return period;
}

/** Auswahl, wenn es mehr als ein Auto gibt. */
export function VinSelect({ vins, vin, onChange }: { vins: string[]; vin: string | null; onChange: (vin: string) => void }) {
  if (vins.length < 2) return null;
  return (
    <label className="field">
      Fahrzeug{" "}
      <select value={vin ?? ""} onChange={(e) => onChange(e.target.value)}>
        {vins.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}

/** Umschalter Tage/Wochen/Monate/Jahre. */
export function PeriodTabs({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="tabs" role="tablist">
      {PERIOD_TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={period === t.id} className={period === t.id ? "active" : undefined} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Die Reiter oben auf einer Seite (z. B. Anzeige und Export). Jeder Reiter hat eine eigene Adresse
 * (#/kilometerstand und #/kilometerstand/export), so bleibt er beim Neuladen offen.
 */
export function PageTabs({ base, tabs, active }: { base: string; tabs: { id: string; label: string }[]; active: string }) {
  return (
    <nav className="page-tabs" aria-label="Bereiche der Seite">
      {tabs.map((t) => (
        <a key={t.id} href={t.id ? `${base}/${t.id}` : base} className={t.id === active ? "active" : undefined} aria-current={t.id === active ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

/** Export-Knöpfe CSV, Excel und TXT. */
export function ExportButtons({ label, url }: { label: string; url: (format: string) => string }) {
  return (
    <div className="export">
      <span>{label}</span>
      <a className="button small" href={url("csv")} download>
        CSV
      </a>
      <a className="button small" href={url("xlsx")} download>
        Excel
      </a>
      <a className="button small" href={url("txt")} download>
        TXT
      </a>
    </div>
  );
}
