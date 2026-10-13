import { useEffect, useState, type ReactNode } from "react";
import { LOGGED_OUT, LoginPage, ProfilePage, type Me } from "./Account";
import { ChargingPage } from "./Charging";
import { OdometerPage } from "./Odometer";
import { CarDrawing, MapFrame, mapsUrl } from "./common";

// Antwortet das Backend mit 401, ist die Anmeldung abgelaufen: dann zur Anmeldeseite.
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await originalFetch(...args);
  if (res.status === 401) window.dispatchEvent(new Event(LOGGED_OUT));
  return res;
};

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
  /** Ortsname zum Standort, null solange er noch nachgeschlagen wird (oder das Nachschlagen aus ist). */
  address?: string | null;
  plugStatus: string | null;
  chargeStatus: string | null;
  locked: boolean | null;
  doors: Opening[] | null;
  windows: Opening[] | null;
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

/** Standort wie bei den Ladevorgängen: Ortsname, Kartenausschnitt und Link zu Google Maps. Geht über die ganze Breite. */
function PositionTile({ lat, lon, address }: { lat: number | null; lon: number | null; address: string | null }) {
  if (lat === null || lon === null) return <Tile title="Standort" value={null} />;
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return (
    <div className="tile position-tile">
      <span className="tile-title">Standort</span>
      <strong className="tile-value">{address ?? coords}</strong>
      <MapFrame lat={lat} lon={lon} label="Standort" />
      <div className="location-meta">
        <span>{address && coords}</span>
        <a className="button small" href={mapsUrl(lat, lon)} target="_blank" rel="noopener noreferrer">
          In Google Maps öffnen
        </a>
      </div>
    </div>
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
              <PositionTile lat={s.lat ?? null} lon={s.lon ?? null} address={s.address ?? null} />
            </div>
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
