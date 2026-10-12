import { useEffect, useState, type ReactNode } from "react";
import { LOGGED_OUT, LoginPage, ProfilePage, type Me } from "./Account";
import { ChargingPage } from "./Charging";
import { OdometerPage } from "./Odometer";
import { mapsUrl } from "./common";

// Antwortet das Backend mit 401, ist die Anmeldung abgelaufen: dann zur Anmeldeseite.
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await originalFetch(...args);
  if (res.status === 401) window.dispatchEvent(new Event(LOGGED_OUT));
  return res;
};

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
  const url = mapsUrl(lat, lon);
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

/** Ein gezeichneter Ford Explorer von der Seite. Beim Laden steht er an einer Ladesäule und Strom fließt ins Auto. */
function CarDrawing({ charging }: { charging: boolean }) {
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
      <use href="#explorer-wheel" x="85" y="96" />
      <use href="#explorer-wheel" x="292" y="96" />
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

const isCharging = (s: Snapshot) => ["IN_PROGRESS", "FAST_CHARGING"].includes(s.chargeStatus?.toUpperCase() ?? "");

/** Bild oben auf der Karte: beim Laden die Ladeanimation, sonst das Foto von Ford oder die Zeichnung. */
function VehicleImage({ info, charging }: { info: VehicleInfo | undefined; charging: boolean }) {
  const [broken, setBroken] = useState(false);
  const name = [info?.model, info?.year].filter(Boolean).join(" ");
  return (
    <figure className="vehicle-image">
      {info?.imageUrl && !broken && !charging ? (
        <img src={info.imageUrl} alt={name || "Mein Auto"} onError={() => setBroken(true)} />
      ) : (
        <>
          <CarDrawing charging={charging} />
          {charging && <figcaption>Lädt gerade</figcaption>}
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
        <p>Verbinde die App einmal mit deinem FordPass-Konto.</p>
        <a className="button" href="/login">
          Mit Ford verbinden
        </a>
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
            <VehicleImage info={info} charging={isCharging(s)} />
            <h2>{name || s.vin}</h2>
            {name && <p className="vin">{s.vin}</p>}
            <div className="hero-stats">
              <Tile title="Akku" value={s.socPct === null ? null : show(s.socPct, " %")}>
                <div className={`soc-meter${s.socPct !== null && s.socPct < 20 ? " low" : ""}`}>
                  <span style={{ width: `${Math.min(100, Math.max(0, s.socPct ?? 0))}%` }} />
                </div>
              </Tile>
              <Tile title="Reichweite" value={s.rangeKm === null ? null : show(s.rangeKm, " km")} />
            </div>
            <div className="tiles">
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
    </>
  );
}

/**
 * Die Seiten der App. Die Adresse steht hinter dem # (z. B. /#/kilometerstand), so braucht der Server nichts extra.
 * Was nach der Seite kommt, ist der Reiter auf der Seite (z. B. /#/kilometerstand/export).
 */
const PAGES: { path: string; label: string; page: (props: { sub: string }) => ReactNode }[] = [
  { path: "#/", label: "Übersicht", page: OverviewPage },
  { path: "#/kilometerstand", label: "Kilometerstand", page: OdometerPage },
  { path: "#/ladevorgaenge", label: "Ladevorgänge", page: ChargingPage },
  { path: "#/profil", label: "Profil", page: ProfilePage },
];

/** Alte Adressen, die es nicht mehr gibt, z. B. aus Lesezeichen. */
const REDIRECTS: Record<string, string> = { "#/jahresuebersicht": "#/kilometerstand/export" };

/** Seite und Reiter aus der Adresse. */
function currentRoute(): { path: string; sub: string } {
  const hash = REDIRECTS[window.location.hash] ?? window.location.hash;
  for (const p of PAGES) {
    if (p.path === "#/") continue;
    if (hash === p.path) return { path: p.path, sub: "" };
    if (hash.startsWith(`${p.path}/`)) return { path: p.path, sub: hash.slice(p.path.length + 1) };
  }
  return { path: "#/", sub: "" };
}

/** Kopfzeile mit Hamburger-Menü. */
function Header({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  // Nach einem Klick auf eine Seite das Menü wieder schließen.
  useEffect(() => setOpen(false), [path]);
  // Menü und Abdunklung liegen bewusst außerhalb der Kopfzeile: deren
  // backdrop-filter würde sonst "position: fixed" auf die Kopfzeilenhöhe begrenzen.
  return (
    <>
      <header className="topbar">
        <button className="hamburger" aria-label="Menü" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span />
          <span />
          <span />
        </button>
        <span className="topbar-title">{PAGES.find((p) => p.path === path)?.label}</span>
      </header>
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
    </>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  // Ohne Internet (z. B. die installierte App im Funkloch) kommt der Server nicht an.
  const [offline, setOffline] = useState(false);
  const loadMe = () =>
    void originalFetch("/api/auth/me")
      .then(async (r) => {
        setMe(await r.json());
        setOffline(false);
      })
      .catch(() => setOffline(true));
  useEffect(() => {
    loadMe();
    window.addEventListener("online", loadMe);
    const onLoggedOut = () => setMe((m) => (m && m.loginRequired ? { ...m, loggedIn: false } : m));
    window.addEventListener(LOGGED_OUT, onLoggedOut);
    return () => {
      window.removeEventListener("online", loadMe);
      window.removeEventListener(LOGGED_OUT, onLoggedOut);
    };
  }, []);

  if (me === null && offline) {
    return (
      <main>
        <h1>Mein Ford</h1>
        <p>Keine Verbindung zum Server. Prüfe dein Internet und versuche es noch einmal.</p>
        <button type="button" className="button" onClick={loadMe}>
          Erneut versuchen
        </button>
      </main>
    );
  }
  if (me === null) return <main>Lade…</main>;
  if (me.loginRequired && !me.loggedIn) return <LoginPage setupMissing={me.setupMissing} onLoggedIn={loadMe} />;
  return <LoggedInApp />;
}

function LoggedInApp() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    if (REDIRECTS[window.location.hash]) window.location.replace(REDIRECTS[window.location.hash]);
    const onChange = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const Page = PAGES.find((p) => p.path === route.path)!.page;
  return (
    <>
      <Header path={route.path} />
      <main>
        <Page sub={route.sub} />
      </main>
    </>
  );
}
