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

/** Ein gezeichneter Ford Explorer von der Seite. Beim Laden steht er an einer Ladesäule und Strom fließt ins Auto. */
export function CarDrawing({ charging }: { charging: boolean }) {
  return (
    <svg viewBox="0 0 352 124" className={`car-drawing${charging ? " charging" : ""}`} aria-hidden="true">
      <defs>
        <linearGradient id="explorer-paint" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c2d9ec" />
          <stop offset="1" stopColor="#7c9fbe" />
        </linearGradient>
        {/* Felge: heller Ring mit schwarzem Stern, wie am Explorer */}
        <g id="explorer-wheel">
          {/* Farben direkt hier, weil CSS nicht in <use>-Kopien greift */}
          <circle r="22" fill="#0b0f17" />
          <circle r="16" fill="#c9d3e3" />
          <polygon
            points="0,-15 4.1,-5.7 14.3,-4.6 6.7,2.2 8.8,12.1 0,7 -8.8,12.1 -6.7,2.2 -14.3,-4.6 -4.1,-5.7"
            fill="#1b2230"
          />
          <circle r="3.5" fill="#56677f" />
        </g>
      </defs>
      <ellipse cx="200" cy="118" rx="150" ry="4" className="shadow" />
      {/* Karosserie, Front rechts: kurze hohe Haube, steile Scheibe, flaches Dach mit Spoiler, steiles Heck */}
      <path
        fill="url(#explorer-paint)"
        d="M56 100 L54 70 C54 58 57 50 62 44 L66 31 C68 27 74 26 84 25 L226 24 C236 25 242 30 250 38 L276 56 L326 64 C336 66 342 72 343 80 L344 100 Z"
      />
      <path className="glass" d="M70 54 L76 35 C78 31 82 29 88 29 L222 28 C230 29 236 33 242 40 L260 54 Z" />
      <path className="pane" d="M124 33 L186 31 L186 51 L124 51 Z M194 31 L222 32 C229 33 234 36 239 41 L251 51 L194 51 Z" />
      {/* Lamellen an der C-Säule */}
      <path className="louvre" d="M86 36 L118 35 M84 40 L118 39.5 M82 44 L118 44 M80 48 L118 48" />
      <path className="glass" d="M246 47 L256 44 L259 50 L249 52 Z" />
      <path className="crease" d="M62 58 Q200 54 330 66" />
      <path className="seam" d="M120 55 L120 92 M190 55 L191 92 M260 55 C264 70 264 84 262 92" />
      <path className="handle" d="M138 61 L148 61 M206 61 L216 61" />
      <path className="headlight" d="M326 67 L340 71" />
      <rect x="58" y="50" width="8" height="22" rx="3" className="glass" />
      <path className="taillight" d="M61 53 L61 69 M63.5 53 L63.5 65" />
      {/* Schwarze Verkleidung unten und um die Radhäuser */}
      <path className="clad" d="M58 92 L342 92 L344 100 Q344 104 340 104 L60 104 Q56 104 56 100 Z" />
      <circle cx="85" cy="96" r="27" className="clad" />
      <circle cx="292" cy="96" r="27" className="clad" />
      <g transform="translate(85 96)">
        <use href="#explorer-wheel" className="wheel" />
      </g>
      <g transform="translate(292 96)">
        <use href="#explorer-wheel" className="wheel" />
      </g>
      {/* Ladeklappe hinten an der Seite */}
      <rect x="72" y="57" width="11" height="10" rx="3" className="port" />
      {charging && (
        <g className="charger">
          <rect x="6" y="40" width="24" height="78" rx="4" className="post" />
          <rect x="10" y="46" width="16" height="16" rx="2" className="screen" />
          <path d="M19 48 L14 55 L18 55 L16 61 L22 53 L18 53 Z" className="bolt" />
          <path d="M28 80 C42 100 66 92 77 64" className="cable" />
          <path d="M28 80 C42 100 66 92 77 64" className="current" />
        </g>
      )}
    </svg>
  );
}
