import { useEffect, useState, type ReactNode } from "react";
import { OdometerHistoryPage, YearOverviewPage } from "./Odometer";

interface Departure {
  day: string;
  time: string;
  enabled: boolean;
  preconditioning: boolean | null;
}

interface Opening {
  name: string;
  open: boolean | null;
}

interface Snapshot {
  vin: string;
  ts: string;
  socPct: number | null;
  rangeKm: number | null;
  odometerKm: number | null;
  lat: number | null;
  lon: number | null;
  plugStatus: string | null;
  chargeStatus: string | null;
  departures: Departure[] | null;
  locked: boolean | null;
  doors: Opening[] | null;
  windows: Opening[] | null;
  battery12v: { socPct: number | null; voltage: number | null } | null;
  alarm: string | null;
}

interface VehicleInfo {
  vin: string;
  model: string | null;
  year: number | null;
  imageUrl: string | null;
}

/** null = Fahrzeugdaten wurden noch nie bei Ford abgefragt. */
type VehicleInfoResponse = { fetchedAt: string; vehicles: VehicleInfo[] } | null;

const NO_DATA = "Ford liefert keine Daten";

/** Eine Kachel in der Übersicht. Ohne value zeigt sie, dass Ford den Wert nicht schickt. */
function Tile({
  title,
  value,
  tone,
  children,
}: {
  title: string;
  value: string | null;
  tone?: "ok" | "warn";
  children?: ReactNode;
}) {
  return (
    <div className={`tile${value === null ? " missing" : ""}${tone ? ` ${tone}` : ""}`}>
      <span className="tile-title">{title}</span>
      <strong className="tile-value">{value ?? NO_DATA}</strong>
      {value !== null && children}
    </div>
  );
}

/** Liste von Türen oder Fenstern mit offen/zu. */
function Openings({ items }: { items: Opening[] }) {
  return (
    <ul className="openings">
      {items.map((o) => (
        <li key={o.name} className={o.open ? "open" : undefined}>
          <span>{o.name}</span>
          <span>{o.open === null ? "unbekannt" : o.open ? "offen" : "zu"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Kurzer Text wie "Alle zu" oder "2 offen". */
function openingsSummary(items: Opening[] | null): string | null {
  if (!items) return null;
  const open = items.filter((o) => o.open).length;
  if (open > 0) return `${open} offen`;
  return items.some((o) => o.open === false) ? "Alle zu" : "Unbekannt";
}

function DoorsTile({ doors, locked }: { doors: Opening[] | null; locked: boolean | null }) {
  const summary = openingsSummary(doors);
  const lockText = locked === null ? null : locked ? "Verriegelt" : "Entriegelt";
  const value = summary && lockText ? `${summary} · ${lockText}` : (summary ?? lockText);
  const warn = doors?.some((o) => o.open) || locked === false;
  return (
    <Tile title="Türen" value={value} tone={value === null ? undefined : warn ? "warn" : "ok"}>
      {doors && <Openings items={doors} />}
    </Tile>
  );
}

function WindowsTile({ windows }: { windows: Opening[] | null }) {
  const summary = openingsSummary(windows);
  const warn = windows?.some((o) => o.open);
  return (
    <Tile title="Fenster" value={summary} tone={summary === null ? undefined : warn ? "warn" : "ok"}>
      {windows && <Openings items={windows} />}
    </Tile>
  );
}

function Battery12vTile({ battery }: { battery: Snapshot["battery12v"] }) {
  const parts = battery
    ? [battery.socPct !== null ? `${Math.round(battery.socPct)} %` : null, battery.voltage !== null ? `${battery.voltage.toFixed(1)} V` : null]
    : [];
  const value = parts.filter(Boolean).join(" · ") || null;
  // Unter 12,2 V oder 50 % ist eine 12-V-Batterie ziemlich leer.
  const low = !!battery && ((battery.voltage !== null && battery.voltage < 12.2) || (battery.socPct !== null && battery.socPct < 50));
  return <Tile title="12-V-Batterie" value={value} tone={value === null ? undefined : low ? "warn" : "ok"} />;
}

function PositionTile({ lat, lon }: { lat: number | null; lon: number | null }) {
  if (lat === null || lon === null) return <Tile title="Standort" value={null} />;
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  return (
    <Tile title="Standort" value={`${lat.toFixed(5)}, ${lon.toFixed(5)}`}>
      <a className="button small" href={url} target="_blank" rel="noopener noreferrer">
        In Google Maps öffnen
      </a>
    </Tile>
  );
}

/** Übersetzt Fords Alarm-Status. Unbekannte Werte werden so angezeigt, wie Ford sie schickt. */
function alarmText(alarm: string | null): { text: string | null; tone?: "ok" | "warn" } {
  if (alarm === null) return { text: null };
  const a = alarm.toUpperCase();
  if (["ARMED", "SET", "ON"].includes(a)) return { text: "Scharf", tone: "ok" };
  if (["DISARMED", "NOT_ARMED", "UNSET", "NOT_SET", "OFF"].includes(a)) return { text: "Aus" };
  if (["TRIGGERED", "ACTIVE", "ALARM", "SOUNDING"].includes(a)) return { text: "Ausgelöst!", tone: "warn" };
  return { text: alarm };
}

function AlarmTile({ alarm }: { alarm: string | null }) {
  const { text, tone } = alarmText(alarm);
  return <Tile title="Alarmanlage" value={text} tone={tone} />;
}

/** Ein einfaches gezeichnetes Auto, wenn Ford kein Bild liefert. */
function CarDrawing() {
  return (
    <svg viewBox="0 0 240 90" className="car-drawing" aria-hidden="true">
      <path
        d="M14 62 C14 52 20 48 34 46 L62 42 C76 28 92 20 120 20 C146 20 162 28 180 42 L206 46 C222 49 228 54 228 62 L228 68 L14 68 Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path d="M70 42 C82 30 96 26 118 26 L118 42 Z M126 26 C146 26 158 32 170 42 L126 42 Z" fill="currentColor" opacity="0.35" />
      <circle cx="62" cy="68" r="14" fill="currentColor" opacity="0.6" />
      <circle cx="182" cy="68" r="14" fill="currentColor" opacity="0.6" />
      <circle cx="62" cy="68" r="6" fill="currentColor" opacity="0.25" />
      <circle cx="182" cy="68" r="6" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

/** Bild oben auf der Karte: das Foto von Ford, wenn es eins gibt, sonst eine Zeichnung. */
function VehicleImage({ info, fetched }: { info: VehicleInfo | undefined; fetched: boolean }) {
  const [broken, setBroken] = useState(false);
  const name = [info?.model, info?.year].filter(Boolean).join(" ");
  return (
    <figure className="vehicle-image">
      {info?.imageUrl && !broken ? (
        <img src={info.imageUrl} alt={name || "Mein Auto"} onError={() => setBroken(true)} />
      ) : (
        <>
          <CarDrawing />
          <figcaption>
            {fetched ? "Ford liefert über die API kein Fahrzeugbild." : "Fahrzeugdaten werden noch bei Ford abgefragt."}
          </figcaption>
        </>
      )}
    </figure>
  );
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

/** Ausklappbare Swagger-Übersicht der eigenen API. Lädt erst beim ersten Aufklappen. */
function ApiDocs() {
  const [opened, setOpened] = useState(false);
  return (
    <details className="api-docs" onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      <summary>API-Endpunkte (Swagger)</summary>
      <p>
        Alle Endpunkte, die diese App anbietet. Mit „Try it out“ kannst du sie direkt ausprobieren.{" "}
        <a href="/api/docs" target="_blank" rel="noopener noreferrer">
          In neuem Tab öffnen
        </a>
      </p>
      {opened && <iframe src="/api/docs" title="Swagger-Übersicht der API" />}
    </details>
  );
}

function show(value: number | string | null, unit = ""): string {
  return value === null ? "–" : `${value}${unit}`;
}

/** Startseite mit den Kacheln je Auto. */
function OverviewPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfoResponse>(null);

  useEffect(() => {
    const load = async () => {
      const status = await fetch("/api/status").then((r) => r.json());
      setLoggedIn(status.loggedIn);
      if (status.loggedIn) {
        setSnapshots(await fetch("/api/snapshots/latest").then((r) => r.json()));
        setVehicleInfo(await fetch("/api/vehicle-info").then((r) => r.json()));
      }
    };
    void load();
    // Jede Minute neu laden, das Backend fragt Ford selbst im Hintergrund ab.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (loggedIn === null) return <p>Lade…</p>;

  if (!loggedIn) {
    return (
      <>
        <h1>Mein Ford</h1>
        <p>Melde dich einmal mit deinem FordPass-Konto an.</p>
        <a className="button" href="/login">
          Mit Ford anmelden
        </a>
        <ApiDocs />
      </>
    );
  }

  return (
    <>
      <h1>Mein Ford</h1>
      {snapshots.length === 0 && <p>Noch keine Daten. Die erste Abfrage läuft gleich.</p>}
      {snapshots.map((s) => {
        const info = vehicleInfo?.vehicles.find((v) => v.vin === s.vin);
        const name = [info?.model, info?.year].filter(Boolean).join(" ");
        return (
          <section key={s.vin} className="card">
            <VehicleImage info={info} fetched={vehicleInfo !== null} />
            <h2>{name || s.vin}</h2>
            {name && <p className="vin">{s.vin}</p>}
            <div className="tiles">
              <Tile title="Akku" value={s.socPct === null ? null : show(s.socPct, " %")} />
              <Tile title="Reichweite" value={s.rangeKm === null ? null : show(s.rangeKm, " km")} />
              <Tile title="Kilometerstand" value={s.odometerKm === null ? null : show(s.odometerKm, " km")} />
              <Tile title="Ladekabel" value={s.plugStatus} />
              <Tile title="Ladestatus" value={s.chargeStatus} />
              <DoorsTile doors={s.doors ?? null} locked={s.locked ?? null} />
              <WindowsTile windows={s.windows ?? null} />
              <Battery12vTile battery={s.battery12v ?? null} />
              <PositionTile lat={s.lat ?? null} lon={s.lon ?? null} />
              <AlarmTile alarm={s.alarm ?? null} />
            </div>
            <Departures departures={s.departures ?? null} />
            <small>Stand: {new Date(s.ts).toLocaleString("de-DE")}</small>
          </section>
        );
      })}
      <ApiDocs />
    </>
  );
}

/** Die Seiten der App. Die Adresse steht hinter dem # (z. B. /#/kilometerstand), so braucht der Server nichts extra. */
const PAGES = [
  { path: "#/", label: "Übersicht", page: OverviewPage },
  { path: "#/kilometerstand", label: "Kilometerstand", page: OdometerHistoryPage },
  { path: "#/jahresuebersicht", label: "Jahresübersicht", page: YearOverviewPage },
];

function currentPath(): string {
  return PAGES.some((p) => p.path === window.location.hash) ? window.location.hash : "#/";
}

/** Kopfzeile mit Hamburger-Menü. */
function Header({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  // Nach einem Klick auf eine Seite das Menü wieder schließen.
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="topbar">
      <button className="hamburger" aria-label="Menü" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span />
        <span />
        <span />
      </button>
      <span className="topbar-title">{PAGES.find((p) => p.path === path)?.label}</span>
      {open && <div className="menu-backdrop" onClick={() => setOpen(false)} />}
      <nav className={`menu${open ? " open" : ""}`} aria-hidden={!open}>
        {PAGES.map((p) => (
          <a key={p.path} href={p.path} className={p.path === path ? "active" : undefined} onClick={() => setOpen(false)}>
            {p.label}
          </a>
        ))}
        <a href="/api/docs" target="_blank" rel="noopener noreferrer">
          API-Endpunkte (Swagger)
        </a>
      </nav>
    </header>
  );
}

export function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => {
      setPath(currentPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const Page = PAGES.find((p) => p.path === path)!.page;
  return (
    <>
      <Header path={path} />
      <main>
        <Page />
      </main>
    </>
  );
}
