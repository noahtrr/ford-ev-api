// Seite Ladevorgänge mit zwei Reitern: Anzeige (Verlauf nach Tagen/Wochen/Monaten/Jahren)
// und Export (Jahresübersicht und einzelne Ladevorgänge als CSV, Excel und TXT).
// Ford meldet keine fertigen Ladevorgänge, das Backend leitet sie aus Ladestand, Kabel und Ladestatus ab.
import { Fragment, useCallback, useEffect, useState } from "react";
import { CATEGORY_LABELS, ExportButtons, MONTHS, PageTabs, PeriodTabs, VinSelect, hours, km, MapFrame, mapsUrl, num, periodLabel, type Category, type Period } from "./common";

interface Totals {
  sessions: number;
  addedSocPct: number;
  /** null = Ford schickt weder Energie noch Akkukapazität. */
  energyKwh: number | null;
  addedRangeKm: number;
  durationMin: number;
  privateSessions: number;
  businessSessions: number;
  privateKwh: number | null;
  businessKwh: number | null;
}

interface PeriodRow extends Totals {
  period: string;
}

interface Session {
  id: string;
  pluggedIn: string;
  pluggedOut: string;
  start: string;
  end: string;
  durationMin: number;
  startSocPct: number | null;
  endSocPct: number | null;
  addedSocPct: number | null;
  startRangeKm: number | null;
  endRangeKm: number | null;
  addedRangeKm: number | null;
  energyKwh: number | null;
  avgPowerKw: number | null;
  powerType: string | null;
  odometerKm: number | null;
  lat: number | null;
  lon: number | null;
  /** Adresse zum Ort, null = (noch) nicht nachgeschlagen. */
  address: string | null;
  /** Wann der Ort fest gespeichert wurde. */
  locationSavedAt: string | null;
  lastStatus: string | null;
  ongoing: boolean;
  timeToFullMin: number | null;
  category: Category | null;
}

interface MonthRow extends Totals {
  month: number;
  future: boolean;
}

interface YearOverview {
  vin: string;
  vins: string[];
  year: number;
  years: number[];
  months: MonthRow[];
  total: Totals;
}

const POWER_TYPES: Record<string, string> = { AC: "AC", DC: "DC (Schnellladen)", WIRELESS: "Induktiv" };
const STATUS: Record<string, string> = {
  COMPLETED: "fertig",
  STOPPED: "abgebrochen",
  PAUSED: "pausiert",
  SCHEDULED: "geplant",
  IN_PROGRESS: "lädt",
  FAULT: "Fehler",
};

const pct = (v: number | null) => num(v, "%");
const time = (ts: string) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const dateTime = (ts: string) => new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** "privat 2 · geschäftl. 1" unter der Anzahl. Leer, wenn nichts markiert ist. */
function CategorySplit({ t }: { t: Pick<Totals, "privateSessions" | "businessSessions"> }) {
  if (!t.privateSessions && !t.businessSessions) return null;
  return (
    <span className="split">
      {t.privateSessions ? <span className="cat private">privat {t.privateSessions}</span> : null}
      {t.businessSessions ? <span className="cat business">geschäftl. {t.businessSessions}</span> : null}
    </span>
  );
}

async function saveCategory(vin: string | null, ids: string[], category: Category | null): Promise<void> {
  const res = await fetch("/api/charging/category", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vin: vin ?? undefined, ids, category }),
  });
  if (!res.ok) throw new Error(`Speichern fehlgeschlagen (Fehler ${res.status})`);
}

/**
 * Kartenausschnitt vom Ladeort, wie ein Foto: nicht verschiebbar, ein Tipp öffnet Google Maps.
 * Der Ort wurde beim Erkennen des Ladevorgangs fest gespeichert.
 */
function LocationSnapshot({ lat, lon, savedAt }: { lat: number; lon: number; savedAt: string | null }) {
  const url = mapsUrl(lat, lon);
  return (
    <div className="location-snapshot">
      <MapFrame lat={lat} lon={lon} label="Ladeort" />
      <div className="location-meta">
        <span>
          {lat.toFixed(5)}, {lon.toFixed(5)}
          {savedAt && ` · gespeichert ${dateTime(savedAt)}`}
        </span>
        <a className="button small" href={url} target="_blank" rel="noopener noreferrer">
          In Google Maps öffnen
        </a>
      </div>
    </div>
  );
}

/** Ein Ladevorgang in der aufgeklappten Tagesansicht. */
function SessionCard({ s, onMark }: { s: Session; onMark: (category: Category | null) => void }) {
  return (
    <div className={`session${s.category ? ` ${s.category}` : ""}`}>
      <div className="session-head">
        <strong>
          {time(s.start)} – {s.ongoing ? "lädt noch" : `${time(s.end)} Uhr`}
        </strong>
        <span>{hours(s.durationMin)}</span>
      </div>
      <div className="session-soc">
        <span className="soc-bar" aria-hidden="true">
          <span className="soc-before" style={{ width: `${s.startSocPct ?? 0}%` }} />
          <span className="soc-added" style={{ width: `${s.addedSocPct ?? 0}%` }} />
        </span>
        <span>
          {pct(s.startSocPct)} → {pct(s.endSocPct)} <b>(+{pct(s.addedSocPct)})</b>
        </span>
      </div>
      <dl className="session-facts">
        <dt>Reichweite</dt>
        <dd>
          {km(s.startRangeKm)} → {km(s.endRangeKm)} (+{km(s.addedRangeKm)})
        </dd>
        {s.energyKwh !== null && (
          <>
            <dt>Energie</dt>
            <dd>
              {num(s.energyKwh, "kWh")}
              {s.avgPowerKw !== null && ` · Ø ${num(s.avgPowerKw, "kW")}`}
            </dd>
          </>
        )}
        <dt>Ladeart</dt>
        <dd>{s.powerType ? (POWER_TYPES[s.powerType] ?? s.powerType) : "Ford liefert keine Angabe"}</dd>
        {s.ongoing && s.timeToFullMin !== null && (
          <>
            <dt>Voll in</dt>
            <dd>{hours(Math.round(s.timeToFullMin))}</dd>
          </>
        )}
        <dt>Kabel</dt>
        <dd>
          eingesteckt {dateTime(s.pluggedIn)}
          {!s.ongoing && `, zuletzt gesehen ${dateTime(s.pluggedOut)}`}
          {s.lastStatus && STATUS[s.lastStatus.toUpperCase()] && ` · ${STATUS[s.lastStatus.toUpperCase()]}`}
        </dd>
        <dt>Kilometerstand</dt>
        <dd>{km(s.odometerKm)}</dd>
        <dt>Ort</dt>
        <dd>{s.lat !== null && s.lon !== null ? (s.address ?? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`) : "Ford liefert keine Angabe"}</dd>
      </dl>
      {s.lat !== null && s.lon !== null && <LocationSnapshot lat={s.lat} lon={s.lon} savedAt={s.locationSavedAt} />}
      <span className="chips" role="group" aria-label="Ladevorgang markieren">
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
          <button key={c} className={`chip ${c}`} aria-pressed={s.category === c} onClick={() => onMark(s.category === c ? null : c)}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Aufgeklappter Tag: jeder Ladevorgang mit allen Werten. */
function DayDetails({ vin, date, onChanged }: { vin: string | null; date: string; onChanged: () => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = new URLSearchParams({ date });
    if (vin) query.set("vin", vin);
    void fetch(`/api/charging/day?${query}`)
      .then((r) => r.json())
      .then((d: { sessions: Session[] }) => setSessions(d.sessions));
  }, [vin, date]);
  useEffect(load, [load]);

  const mark = async (ids: string[], category: Category | null) => {
    setError(null);
    try {
      await saveCategory(vin, ids, category);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (sessions === null) return <p className="hint">Lade…</p>;
  return (
    <div className="day-details">
      {error && <p className="message error">{error}</p>}
      {sessions.map((s) => (
        <SessionCard key={s.id} s={s} onMark={(c) => void mark([s.id], c)} />
      ))}
    </div>
  );
}

/** Reiter "Anzeige": Ladevorgänge nach Tagen, Wochen, Monaten oder Jahren. */
function ChargingHistoryTab() {
  const [period, setPeriod] = useState<Period>("day");
  const [vin, setVin] = useState<string | null>(null);
  const [data, setData] = useState<{ vin: string | null; vins: string[]; rows: PeriodRow[] } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    const query = new URLSearchParams({ period });
    if (vin) query.set("vin", vin);
    void fetch(`/api/charging?${query}`)
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
  const max = Math.max(1, ...rows.map((r) => r.addedSocPct));
  const sum = (pick: (r: PeriodRow) => number | null) => Math.round(rows.reduce((s, r) => s + (pick(r) ?? 0), 0) * 10) / 10;
  const hasEnergy = rows.some((r) => r.energyKwh !== null);
  const expandable = period === "day";

  return (
    <>
      <p className="hint">
        Ford meldet keine fertigen Ladevorgänge. Die App erkennt sie an Ladestand, Ladekabel und Ladestatus, die Ford alle paar Minuten schickt,
        solange das Auto wach ist. Beginn und Ende sind deshalb auf ein paar Minuten genau.
        {period === "day" && " Tippe auf einen Tag, um die einzelnen Ladevorgänge zu sehen und als privat oder geschäftlich zu markieren."}
      </p>
      <VinSelect vins={data?.vins ?? []} vin={data?.vin ?? null} onChange={setVin} />
      <PeriodTabs period={period} onChange={setPeriod} />
      {data === null ? (
        <p>Lade…</p>
      ) : rows.length === 0 ? (
        <p>Noch keine Ladevorgänge erkannt.</p>
      ) : (
        <div className="table-wrap">
          <table className="km-table">
            <thead>
              <tr>
                <th>Zeitraum</th>
                <th className="num">Ladungen</th>
                <th className="num">Geladen</th>
                <th className="bar-cell" aria-hidden="true" />
                <th className="num">Dauer</th>
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
                            <span className="arrow" aria-hidden="true">
                              ▸
                            </span>
                            {periodLabel(r.period, period)}
                          </button>
                        ) : (
                          periodLabel(r.period, period)
                        )}
                      </td>
                      <td className="num">
                        {r.sessions}
                        <CategorySplit t={r} />
                      </td>
                      <td className="num">
                        +{pct(r.addedSocPct)}
                        {hasEnergy && <span className="split">{num(r.energyKwh, "kWh")}</span>}
                      </td>
                      <td className="bar-cell" aria-hidden="true">
                        <span className="bar charge" style={{ width: `${(r.addedSocPct / max) * 100}%` }} />
                      </td>
                      <td className="num">{hours(r.durationMin)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="details-row">
                        <td colSpan={5}>
                          <DayDetails vin={data.vin} date={r.period} onChanged={load} />
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
                  {sum((r) => r.sessions)}
                  <CategorySplit t={{ privateSessions: sum((r) => r.privateSessions), businessSessions: sum((r) => r.businessSessions) }} />
                </td>
                <td className="num">
                  +{pct(sum((r) => r.addedSocPct))}
                  {hasEnergy && <span className="split">{num(sum((r) => r.energyKwh), "kWh")}</span>}
                </td>
                <td className="bar-cell" />
                <td className="num">{hours(sum((r) => r.durationMin))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

/** Reiter "Export": Jahresübersicht mit 12 Monaten, Export der Monate oder aller einzelnen Ladevorgänge. */
function ChargingExportTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [vin, setVin] = useState<string | null>(null);
  const [data, setData] = useState<YearOverview | null | "empty">(null);

  useEffect(() => {
    const query = new URLSearchParams({ year: String(year) });
    if (vin) query.set("vin", vin);
    void fetch(`/api/charging/year?${query}`).then(async (r) => setData(r.ok ? await r.json() : "empty"));
  }, [year, vin]);

  if (data === null) return <p>Lade…</p>;
  if (data === "empty") return <p>Noch keine Messwerte gespeichert.</p>;

  const exportUrl = (type: string) => (format: string) =>
    `/api/charging/year/export?${new URLSearchParams({ vin: data.vin, year: String(year), format, type })}`;
  const hasEnergy = data.total.energyKwh !== null;
  const cols = hasEnergy ? 8 : 6;

  return (
    <>
      <h2>Jahresübersicht {year}</h2>
      <p className="hint">
        Ladevorgänge je Monat, gezählt nach dem Tag, an dem das Laden begann. Die Datei „Alle Ladevorgänge“ enthält jeden Ladevorgang einzeln
        mit Uhrzeit, Ladestand, Reichweite, Ladeart, Kilometerstand, Ort und Markierung.
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
      </div>
      <div className="toolbar">
        <ExportButtons label="Monatsübersicht:" url={exportUrl("months")} />
        <ExportButtons label="Alle Ladevorgänge:" url={exportUrl("sessions")} />
      </div>
      <div className="table-wrap">
        <table className="km-table">
          <thead>
            <tr>
              <th>Monat</th>
              <th className="num">Ladungen</th>
              <th className="num">Geladen</th>
              {hasEnergy && <th className="num">Energie</th>}
              <th className="num">Reichweite</th>
              <th className="num">Dauer</th>
              <th className="num">Privat</th>
              <th className="num">Geschäftl.</th>
              {hasEnergy && <th className="num">Geschäftl. kWh</th>}
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month} className={m.future ? "future" : m.sessions === 0 ? "carried" : undefined}>
                <td>{MONTHS[m.month - 1]}</td>
                {m.future ? (
                  <td colSpan={cols} />
                ) : (
                  <>
                    <td className="num">{m.sessions}</td>
                    <td className="num">{pct(m.addedSocPct)}</td>
                    {hasEnergy && <td className="num">{num(m.energyKwh, "kWh")}</td>}
                    <td className="num">+{km(m.addedRangeKm)}</td>
                    <td className="num">{hours(m.durationMin)}</td>
                    <td className="num">{m.privateSessions}</td>
                    <td className="num">{m.businessSessions}</td>
                    {hasEnergy && <td className="num">{num(m.businessKwh, "kWh")}</td>}
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Summe {year}</td>
              <td className="num">{data.total.sessions}</td>
              <td className="num">{pct(data.total.addedSocPct)}</td>
              {hasEnergy && <td className="num">{num(data.total.energyKwh, "kWh")}</td>}
              <td className="num">+{km(data.total.addedRangeKm)}</td>
              <td className="num">{hours(data.total.durationMin)}</td>
              <td className="num">{data.total.privateSessions}</td>
              <td className="num">{data.total.businessSessions}</td>
              {hasEnergy && <td className="num">{num(data.total.businessKwh, "kWh")}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">
        „Geladen“ ist die Summe der geladenen Prozentpunkte.
        {!hasEnergy && " Ford schickt für dein Auto weder Energie noch Akkukapazität, deshalb gibt es keine kWh."} Privat und Geschäftlich zählen
        nur Ladevorgänge, die du unter Ladevorgänge → Anzeige → Tage markiert hast.
      </p>
    </>
  );
}

const TABS = [
  { id: "", label: "Anzeige" },
  { id: "export", label: "Export" },
];

/** Seite "Ladevorgänge": Anzeige und Export als Reiter. sub = Reiter aus der Adresse ("" oder "export"). */
export function ChargingPage({ sub }: { sub: string }) {
  const tab = sub === "export" ? "export" : "";
  return (
    <>
      <h1>Ladevorgänge</h1>
      <PageTabs base="#/ladevorgaenge" tabs={TABS} active={tab} />
      {tab === "export" ? <ChargingExportTab /> : <ChargingHistoryTab />}
    </>
  );
}
