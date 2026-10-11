import { useEffect, useState } from "react";

interface Snapshot {
  vin: string;
  ts: string;
  socPct: number | null;
  rangeKm: number | null;
  odometerKm: number | null;
  plugStatus: string | null;
  chargeStatus: string | null;
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
          <small>Stand: {new Date(s.ts).toLocaleString("de-DE")}</small>
        </section>
      ))}
    </main>
  );
}
