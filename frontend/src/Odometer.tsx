// Seiten zum Kilometerstand: Verlauf nach Tagen/Wochen/Monaten/Jahren und die Jahresübersicht.
import { useEffect, useState } from "react";

type Period = "day" | "week" | "month" | "year";

interface PeriodRow {
  period: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  readings: number;
}

interface MonthRow {
  month: number;
  startKm: number | null;
  endKm: number | null;
  distanceKm: number | null;
  readings: number;
  lastReading: string | null;
}

interface YearOverview {
  vin: string;
  vins: string[];
  year: number;
  years: number[];
  months: MonthRow[];
  totalKm: number | null;
}

const PERIOD_TABS: { id: Period; label: string }[] = [
  { id: "day", label: "Tage" },
  { id: "week", label: "Wochen" },
  { id: "month", label: "Monate" },
  { id: "year", label: "Jahre" },
];

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function km(value: number | null): string {
  return value === null ? "–" : `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`;
}

/** Macht aus "2026-10-11", "2026-W41", "2026-10" oder "2026" einen lesbaren Text. */
function periodLabel(period: string, type: Period): string {
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
function VinSelect({ vins, vin, onChange }: { vins: string[]; vin: string | null; onChange: (vin: string) => void }) {
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

/** Seite "Kilometerstand": Verlauf mit Umschalter Tage/Wochen/Monate/Jahre. */
export function OdometerHistoryPage() {
  const [period, setPeriod] = useState<Period>("day");
  const [vin, setVin] = useState<string | null>(null);
  const [data, setData] = useState<{ vin: string | null; vins: string[]; rows: PeriodRow[] } | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ period });
    if (vin) query.set("vin", vin);
    void fetch(`/api/odometer?${query}`)
      .then((r) => r.json())
      .then(setData);
  }, [period, vin]);

  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.distanceKm));
  const total = rows.reduce((sum, r) => sum + r.distanceKm, 0);

  return (
    <>
      <h1>Kilometerstand</h1>
      <p className="hint">
        Ford schickt nur Daten, wenn das Auto wach ist (fahren oder laden). Zeiträume ohne Messwert fehlen deshalb hier.
      </p>
      <VinSelect vins={data?.vins ?? []} vin={data?.vin ?? null} onChange={setVin} />
      <div className="tabs" role="tablist">
        {PERIOD_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={period === t.id} className={period === t.id ? "active" : undefined} onClick={() => setPeriod(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {data === null ? (
        <p>Lade…</p>
      ) : rows.length === 0 ? (
        <p>Noch keine Kilometerstände gespeichert.</p>
      ) : (
        <div className="table-wrap">
          <table className="km-table">
            <thead>
              <tr>
                <th>Zeitraum</th>
                <th className="num">Gefahren</th>
                <th className="bar-cell" aria-hidden="true" />
                <th className="num">Stand am Ende</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period}>
                  <td>{periodLabel(r.period, period)}</td>
                  <td className="num">{km(r.distanceKm)}</td>
                  <td className="bar-cell" aria-hidden="true">
                    <span className="bar" style={{ width: `${(r.distanceKm / max) * 100}%` }} />
                  </td>
                  <td className="num">{km(r.endKm)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                <td className="num">{km(Math.round(total * 10) / 10)}</td>
                <td className="bar-cell" />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

/** Seite "Jahresübersicht": 12 Monate mit Export als CSV, TXT und Excel. */
export function YearOverviewPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [vin, setVin] = useState<string | null>(null);
  const [data, setData] = useState<YearOverview | null | "empty">(null);

  useEffect(() => {
    const query = new URLSearchParams({ year: String(year) });
    if (vin) query.set("vin", vin);
    void fetch(`/api/odometer/year?${query}`).then(async (r) => setData(r.ok ? await r.json() : "empty"));
  }, [year, vin]);

  if (data === null) return <p>Lade…</p>;
  if (data === "empty") {
    return (
      <>
        <h1>Jahresübersicht</h1>
        <p>Noch keine Kilometerstände gespeichert.</p>
      </>
    );
  }

  const exportUrl = (format: string) => `/api/odometer/year/export?${new URLSearchParams({ vin: data.vin, year: String(year), format })}`;

  return (
    <>
      <h1>Jahresübersicht {year}</h1>
      <p className="hint">
        Kilometerstand am Anfang und Ende jedes Monats, z. B. für eine Jahresabrechnung. Gab es in einem Monat keinen Messwert, gilt der
        letzte bekannte Stand.
      </p>
      <div className="toolbar">
        <label className="field">
          Jahr{" "}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {data.years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <VinSelect vins={data.vins} vin={data.vin} onChange={setVin} />
        <div className="export">
          <span>Exportieren:</span>
          <a className="button small" href={exportUrl("csv")} download>
            CSV
          </a>
          <a className="button small" href={exportUrl("xlsx")} download>
            Excel
          </a>
          <a className="button small" href={exportUrl("txt")} download>
            TXT
          </a>
        </div>
      </div>
      <div className="table-wrap">
        <table className="km-table">
          <thead>
            <tr>
              <th>Monat</th>
              <th className="num">Monatsanfang</th>
              <th className="num">Monatsende</th>
              <th className="num">Gefahren</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month} className={m.endKm === null ? "future" : m.readings === 0 ? "carried" : undefined}>
                <td>{MONTHS[m.month - 1]}</td>
                <td className="num">{km(m.startKm)}</td>
                <td className="num">{km(m.endKm)}</td>
                <td className="num">{km(m.distanceKm)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Summe {year}</td>
              <td />
              <td />
              <td className="num">{km(data.totalKm)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">Grau = kein Messwert in diesem Monat, der Stand wurde übernommen.</p>
    </>
  );
}
