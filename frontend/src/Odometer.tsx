// Seite Kilometerstand mit zwei Reitern: Anzeige (Verlauf nach Tagen/Wochen/Monaten/Jahren)
// und Export (Jahresübersicht mit CSV, Excel und TXT).
import { Fragment, useCallback, useEffect, useState } from "react";
import { CATEGORY_LABELS, Collapse, ExpandChevron, ExportButtons, Select, MONTHS, PageTabs, PeriodTabs, VinSelect, km, periodLabel, type Category, type Period } from "./common";
import { ErrorMessage, Loading, Skeleton } from "./ui";

interface PeriodRow {
  period: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  readings: number;
  privateKm: number;
  businessKm: number;
}

/** Ein Messwert in der aufgeklappten Tagesansicht. */
interface DayReading {
  /** Kennung zum Markieren. */
  id: string;
  /** Wann Ford den Kilometerstand geliefert hat. */
  ts: string;
  km: number;
  /** Gefahrene km seit dem vorherigen Messwert. */
  distanceKm: number;
  category: Category | null;
}

interface MonthRow {
  month: number;
  startKm: number | null;
  endKm: number | null;
  distanceKm: number | null;
  privateKm: number | null;
  businessKm: number | null;
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
  totalPrivateKm: number | null;
  totalBusinessKm: number | null;
}

/** Kleine Zeile "privat 20 km · geschäftlich 30 km" unter den gefahrenen km. Leer, wenn nichts markiert ist. */
function CategorySplit({ privateKm, businessKm }: { privateKm: number | null; businessKm: number | null }) {
  if (!privateKm && !businessKm) return null;
  return (
    <span className="split">
      {privateKm ? <span className="cat private">privat {km(privateKm)}</span> : null}
      {businessKm ? <span className="cat business">geschäftl. {km(businessKm)}</span> : null}
    </span>
  );
}

/** Schickt die Markierung privat/geschäftlich (oder null = entfernen) für Messwerte ans Backend. */
async function saveCategory(vin: string | null, ts: string[], category: Category | null): Promise<void> {
  const res = await fetch("/api/odometer/category", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vin: vin ?? undefined, ts, category }),
  });
  if (!res.ok) throw new Error(`Speichern fehlgeschlagen (Fehler ${res.status})`);
}

/**
 * Aufgeklappter Tag: jeder Messwert mit Uhrzeit, Kilometerstand und den km seit dem vorherigen Messwert.
 * Jede Strecke lässt sich als privat oder geschäftlich markieren.
 */
function DayDetails({ vin, date, onChanged }: { vin: string | null; date: string; onChanged: () => void }) {
  const [readings, setReadings] = useState<DayReading[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = new URLSearchParams({ date });
    if (vin) query.set("vin", vin);
    void fetch(`/api/odometer/day?${query}`)
      .then((r) => r.json())
      .then((d: { readings: DayReading[] }) => setReadings(d.readings));
  }, [vin, date]);
  useEffect(load, [load]);

  const mark = async (ts: string[], category: Category | null) => {
    if (ts.length === 0) return;
    setError(null);
    try {
      await saveCategory(vin, ts, category);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (readings === null) return <Loading />;
  if (readings.length === 0) return <p className="hint">An diesem Tag hat Ford keine neuen Kilometer gemeldet.</p>;
  const time = (ts: string) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="day-details">
      <div className="day-actions">
          <span>Ganzen Tag markieren:</span>
          <button className="chip private" onClick={() => void mark(readings.map((r) => r.id), "private")}>
            Privat
          </button>
          <button className="chip business" onClick={() => void mark(readings.map((r) => r.id), "business")}>
            Geschäftlich
          </button>
          <button className="chip" onClick={() => void mark(readings.filter((r) => r.category).map((r) => r.id), null)}>
          Zurücksetzen
        </button>
      </div>
      {error && <ErrorMessage text={error} />}
      <table className="km-table readings">
        <thead>
          <tr>
            <th>Uhrzeit</th>
            <th className="num">Stand</th>
            <th className="num">Seit davor</th>
            <th>Fahrt</th>
          </tr>
        </thead>
        <tbody>
          {readings.map((r) => (
            <tr key={r.id} className={r.category ?? undefined}>
              <td>{time(r.ts)} Uhr</td>
              <td className="num">{km(r.km)}</td>
              <td className="num">+{km(r.distanceKm)}</td>
              <td>
                <span className="chips" role="group" aria-label="Fahrt markieren">
                  {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                    <button
                      key={c}
                      className={`chip ${c}`}
                      aria-pressed={r.category === c}
                      // Nochmal auf die gewählte Markierung tippen entfernt sie wieder.
                      onClick={() => void mark([r.id], r.category === c ? null : c)}
                    >
                      {CATEGORY_LABELS[c]}
                    </button>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        „Seit davor“ = gefahrene km seit dem vorherigen Messwert. Diese Strecke wird mit Privat oder Geschäftlich markiert. Nochmal tippen
        entfernt die Markierung.
      </p>
    </div>
  );
}

/** Reiter "Anzeige": Verlauf mit Umschalter Tage/Wochen/Monate/Jahre. */
function OdometerHistoryTab() {
  const [period, setPeriod] = useState<Period>("day");
  const [vin, setVin] = useState<string | null>(null);
  const [data, setData] = useState<{ vin: string | null; vins: string[]; rows: PeriodRow[] } | null>(null);
  // Die aufgeklappten Tage (nur in der Ansicht "Tage").
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    const query = new URLSearchParams({ period });
    if (vin) query.set("vin", vin);
    void fetch(`/api/odometer?${query}`)
      .then((r) => r.json())
      .then(setData);
  }, [period, vin]);
  useEffect(load, [load]);

  const toggle = (day: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.distanceKm));
  const sum = (pick: (r: PeriodRow) => number) => Math.round(rows.reduce((s, r) => s + pick(r), 0) * 10) / 10;
  const expandable = period === "day";

  return (
    <>
      <p className="hint">
        Ford schickt nur Daten, wenn das Auto wach ist (fahren oder laden). Zeiträume ohne Messwert fehlen deshalb hier.
        {period === "day" && " Tippe auf einen Tag, um die Uhrzeiten zu sehen und Fahrten als privat oder geschäftlich zu markieren."}
      </p>
      <VinSelect vins={data?.vins ?? []} vin={data?.vin ?? null} onChange={setVin} />
      <PeriodTabs period={period} onChange={setPeriod} />
      {data === null ? (
        <Skeleton ready={false} lines={6} />
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
              {rows.map((r) => {
                const isOpen = expandable && open.has(r.period);
                return (
                  <Fragment key={r.period}>
                    <tr className={expandable ? "expandable" : undefined} onClick={expandable ? () => toggle(r.period) : undefined}>
                      <td>
                        {expandable ? (
                          <button className="expand" aria-expanded={isOpen} onClick={(e) => (e.stopPropagation(), toggle(r.period))}>
                            <ExpandChevron open={isOpen} />
                            {periodLabel(r.period, period)}
                          </button>
                        ) : (
                          periodLabel(r.period, period)
                        )}
                      </td>
                      <td className="num">
                        {km(r.distanceKm)}
                        <CategorySplit privateKm={r.privateKm} businessKm={r.businessKm} />
                      </td>
                      <td className="bar-cell" aria-hidden="true">
                        <span className="bar" style={{ width: `${(r.distanceKm / max) * 100}%` }} />
                      </td>
                      <td className="num">{km(r.endKm)}</td>
                    </tr>
                    {expandable && (
                      <tr className="details-row">
                        <td colSpan={4}>
                          <Collapse open={isOpen}>
                            <DayDetails vin={data.vin} date={r.period} onChanged={load} />
                          </Collapse>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                <td className="num">
                  {km(sum((r) => r.distanceKm))}
                  <CategorySplit privateKm={sum((r) => r.privateKm)} businessKm={sum((r) => r.businessKm)} />
                </td>
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

/** Reiter "Export": Jahresübersicht mit 12 Monaten und Export als CSV, TXT und Excel. */
function YearOverviewTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [vin, setVin] = useState<string | null>(null);
  const [data, setData] = useState<YearOverview | null | "empty">(null);

  useEffect(() => {
    const query = new URLSearchParams({ year: String(year) });
    if (vin) query.set("vin", vin);
    void fetch(`/api/odometer/year?${query}`).then(async (r) => setData(r.ok ? await r.json() : "empty"));
  }, [year, vin]);

  if (data === null) return <Skeleton ready={false} lines={8} />;
  if (data === "empty") return <p>Noch keine Kilometerstände gespeichert.</p>;

  const exportUrl = (format: string) => `/api/odometer/year/export?${new URLSearchParams({ vin: data.vin, year: String(year), format })}`;

  return (
    <>
      <h2>Jahresübersicht {year}</h2>
      <p className="hint">
        Kilometerstand am Anfang und Ende jedes Monats, z. B. für eine Jahresabrechnung. Gab es in einem Monat keinen Messwert, gilt der
        letzte bekannte Stand.
      </p>
      <div className="toolbar">
        <Select label="Jahr" value={String(year)} options={data.years.map(String)} onChange={(v) => setYear(Number(v))} />
        <VinSelect vins={data.vins} vin={data.vin} onChange={setVin} />
        <ExportButtons label="Exportieren" url={exportUrl} />
      </div>
      <div className="table-wrap">
        <table className="km-table">
          <thead>
            <tr>
              <th>Monat</th>
              <th className="num">Monatsanfang</th>
              <th className="num">Monatsende</th>
              <th className="num">Gefahren</th>
              <th className="num">Privat</th>
              <th className="num">Geschäftlich</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month} className={m.endKm === null ? "future" : m.readings === 0 ? "carried" : undefined}>
                <td>{MONTHS[m.month - 1]}</td>
                <td className="num">{km(m.startKm)}</td>
                <td className="num">{km(m.endKm)}</td>
                <td className="num">{km(m.distanceKm)}</td>
                <td className="num">{km(m.privateKm)}</td>
                <td className="num">{km(m.businessKm)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Summe {year}</td>
              <td />
              <td />
              <td className="num">{km(data.totalKm)}</td>
              <td className="num">{km(data.totalPrivateKm)}</td>
              <td className="num">{km(data.totalBusinessKm)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">
        Grau = kein Messwert in diesem Monat, der Stand wurde übernommen. Privat und Geschäftlich zählen nur Fahrten, die du unter
        Kilometerstand → Anzeige → Tage markiert hast. Der Rest ist nicht markiert.
      </p>
    </>
  );
}

const TABS = [
  { id: "", label: "Anzeige" },
  { id: "export", label: "Export" },
];

/** Seite "Kilometerstand": Anzeige und Export als Reiter. sub = Reiter aus der Adresse ("" oder "export"). */
export function OdometerPage({ sub }: { sub: string }) {
  const tab = sub === "export" ? "export" : "";
  return (
    <>
      <h1>Kilometerstand</h1>
      <PageTabs base="#/kilometerstand" tabs={TABS} active={tab} />
      {tab === "export" ? <YearOverviewTab /> : <OdometerHistoryTab />}
    </>
  );
}
