import { useEffect, useState } from "react";

interface Departure {
  day: string;
  time: string;
  enabled: boolean;
  preconditioning: boolean | null;
}

interface Snapshot {
  vin: string;
  ts: string;
  socPct: number | null;
  rangeKm: number | null;
  odometerKm: number | null;
  plugStatus: string | null;
  chargeStatus: string | null;
  departures: Departure[] | null;
}

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Minuten ab Montag 00:00, damit sich Abfahrtszeiten vergleichen lassen. */
function minutesInWeek(day: number, time: string): number {
  const [h, m] = time.split(":").map(Number);
  return day * 24 * 60 + h * 60 + m;
}

/** Die nächste eingeschaltete Abfahrtszeit ab jetzt (Ortszeit des Browsers). */
function nextDeparture(departures: Departure[], now = new Date()): Departure | undefined {
  const week = 7 * 24 * 60;
  const today = (now.getDay() + 6) % 7; // JavaScript zählt ab Sonntag, Ford ab Montag
  const nowMinutes = minutesInWeek(today, `${now.getHours()}:${now.getMinutes()}`);
  const until = (d: Departure) => (minutesInWeek(DAYS.indexOf(d.day), d.time) - nowMinutes + week) % week;
  return departures
    .filter((d) => d.enabled)
    .reduce<Departure | undefined>((best, d) => (!best || until(d) < until(best) ? d : best), undefined);
}

function Departures({ departures }: { departures: Departure[] | null }) {
  if (departures === null) {
    return (
      <div className="departures">
        <h3>Abfahrtszeiten</h3>
        <p>Ford liefert für dieses Auto keine Abfahrtszeiten.</p>
      </div>
    );
  }
  const active = departures.filter((d) => d.enabled);
  const next = nextDeparture(departures);
  return (
    <div className="departures">
      <h3>Abfahrtszeiten</h3>
      {active.length === 0 ? (
        <p>Keine Abfahrtszeit eingestellt.</p>
      ) : (
        <ul>
          {active.map((d) => (
            <li key={`${d.day}-${d.time}`} className={d === next ? "next" : undefined}>
              <span>{DAY_NAMES[DAYS.indexOf(d.day)]}</span>
              <strong>{d.time} Uhr</strong>
              {d === next && <span className="tag">Nächste</span>}
              {d.preconditioning && <span className="tag">Vorklimatisieren</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function show(value: number | string | null, unit = ""): string {
  return value === null ? "–" : `${value}${unit}`;
}

export function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    const load = async () => {
      const status = await fetch("/api/status").then((r) => r.json());
      setLoggedIn(status.loggedIn);
      if (status.loggedIn) {
        setSnapshots(await fetch("/api/snapshots/latest").then((r) => r.json()));
      }
    };
    void load();
    // Jede Minute neu laden, das Backend fragt Ford selbst im Hintergrund ab.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (loggedIn === null) return <main>Lade…</main>;

  if (!loggedIn) {
    return (
      <main>
        <h1>Mein Ford</h1>
        <p>Melde dich einmal mit deinem FordPass-Konto an.</p>
        <a className="button" href="/login">
          Mit Ford anmelden
        </a>
      </main>
    );
  }

  return (
    <main>
      <h1>Mein Ford</h1>
      {snapshots.length === 0 && <p>Noch keine Daten. Die erste Abfrage läuft gleich.</p>}
      {snapshots.map((s) => (
        <section key={s.vin} className="card">
          <h2>{s.vin}</h2>
          <dl>
            <dt>Akku</dt>
            <dd>{show(s.socPct, " %")}</dd>
            <dt>Reichweite</dt>
            <dd>{show(s.rangeKm, " km")}</dd>
            <dt>Kilometerstand</dt>
            <dd>{show(s.odometerKm, " km")}</dd>
            <dt>Ladekabel</dt>
            <dd>{show(s.plugStatus)}</dd>
            <dt>Ladestatus</dt>
            <dd>{show(s.chargeStatus)}</dd>
          </dl>
          <Departures departures={s.departures ?? null} />
          <small>Stand: {new Date(s.ts).toLocaleString("de-DE")}</small>
        </section>
      ))}
    </main>
  );
}
