// /styleguide: alle Tokens, Komponenten und Übergänge des Design-Systems live.
import { Bell, BatteryCharging, Copy, Download, Gauge, House, Info, Moon, Plus, Sun, User, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Accordion,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Field,
  ICON,
  IconSwap,
  InlineToast,
  LearnMore,
  Loading,
  MatrixLoader,
  Modal,
  NumberPop,
  PageTransition,
  Panel,
  ResizeCard,
  Signet,
  Skeleton,
  SpinningCounter,
  SuccessCheck,
  Tabs,
  TextSwap,
  TextsReveal,
  Toggle,
  Tooltip,
  useToast,
  Wordmark,
} from "./ui";

const COLORS: [string, string][] = [
  ["--bg", "Hintergrund"],
  ["--surface-1", "Karten"],
  ["--surface-2", "Modals, Menüs"],
  ["--border", "Linien"],
  ["--border-strong", "Rahmen von Bedienelementen"],
  ["--muted", "Icons, Deko"],
  ["--text-muted", "Sekundärtext"],
  ["--text", "Text"],
  ["--accent", "Primäre Aktion, Fokus, aktiv"],
  ["--success", "Status: ok"],
  ["--warning", "Status: Achtung"],
  ["--error", "Status: Fehler"],
];
const TYPE = [
  ["--text-3xl", "48"],
  ["--text-2xl", "32"],
  ["--text-xl", "24"],
  ["--text-lg", "20"],
  ["--text-base", "16"],
  ["--text-sm", "14"],
  ["--text-xs", "12"],
];
const SPACES = ["--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6", "--space-7"];
const RADII = ["--radius-sm", "--radius-md", "--radius-lg", "--radius-full"];
const MOTION = ["--dur-fast", "--dur-base", "--dur-slow", "--dur-fast-out", "--dur-base-out", "--dur-slow-out", "--dur-reduced", "--ease-out", "--ease-in-out"];

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Relative Helligkeit nach WCAG aus "#rrggbb". */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="sg-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Ein Beispiel mit Titel, Zuordnung zur transitions.dev-Vorlage und optionalem Wiederholen-Knopf. */
function Demo({ title, source, onReplay, children }: { title: string; source?: string; onReplay?: () => void; children: ReactNode }) {
  return (
    <Card className="sg-demo">
      <div className="sg-demo-head">
        <div>
          <h3>{title}</h3>
          {source && <p className="hint">transitions.dev: {source}</p>}
        </div>
        {onReplay && (
          <Button variant="ghost" small onClick={onReplay}>
            Wiederholen
          </Button>
        )}
      </div>
      <div className="sg-demo-body">{children}</div>
    </Card>
  );
}

function Swatches() {
  const bg = token("--bg");
  return (
    <div className="sg-swatches">
      {COLORS.map(([name, use]) => {
        const value = token(name);
        const onBg = contrast(value, bg);
        const onSurface = contrast(value, token("--surface-1"));
        return (
          <div key={name} className="sg-swatch">
            <span className="sg-swatch-color" style={{ background: `var(${name})` }} />
            <code>{name}</code>
            <span className="tabular">{value}</span>
            <span className="hint">{use}</span>
            {name !== "--bg" && (
              <span className="hint tabular">
                {onBg.toFixed(1)}:1 auf bg · {onSurface.toFixed(1)}:1 auf surface-1
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ButtonsDemo() {
  return (
    <Demo title="Button">
      {(["primary", "secondary", "ghost"] as const).map((v) => (
        <div key={v} className="sg-row">
          <Button variant={v}>{v}</Button>
          <Button variant={v} icon={Download}>
            Mit Icon
          </Button>
          <Button variant={v} disabled>
            Deaktiviert
          </Button>
          <Button variant={v} loading>
            Lädt
          </Button>
        </div>
      ))}
      <p className="hint">Hover nur mit Maus, gedrückt beim Tippen, Fokus mit der Tab-Taste: 2px Linie in --accent mit Abstand.</p>
    </Demo>
  );
}

function FieldDemo() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  return (
    <Demo title="Eingabefeld mit Label und Fehler" source="Error state shake">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setAttempt((a) => a + 1);
          setError(value.includes("@") ? null : "Bitte eine gültige E-Mail-Adresse eingeben.");
        }}
      >
        <Field
          label="E-Mail"
          hint="Ohne @ zeigt das Feld einen Fehler."
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          error={error}
          errorKey={attempt}
        />
        <Field label="Deaktiviert" value="Nicht änderbar" disabled readOnly />
        <div className="sg-row">
          <Button type="submit" variant="secondary">
            Prüfen
          </Button>
        </div>
      </form>
    </Demo>
  );
}

function CardsDemo() {
  const [more, setMore] = useState(false);
  return (
    <>
      <Demo title="Karte">
        <Card title="Kartentitel">
          <p className="hint">Fläche --surface-1, 1px --border, Radius 12px. Tiefe nur über Grautöne.</p>
        </Card>
      </Demo>
      <Demo title="Karte mit Inhaltswechsel" source="Card resize">
        <ResizeCard>
          <p>Akku 84 %, Reichweite 312 km.</p>
          {more && <p className="hint">Zuletzt geladen am Dienstag an einer DC-Säule, 31 Minuten, von 22 % auf 80 %. Kabel wurde um 18:42 Uhr abgezogen.</p>}
          <Button variant="secondary" small onClick={() => setMore(!more)}>
            {more ? "Weniger" : "Mehr anzeigen"}
          </Button>
        </ResizeCard>
      </Demo>
    </>
  );
}

function NavigationDemo() {
  const items = [
    { icon: House, label: "Übersicht" },
    { icon: Gauge, label: "Kilometerstand" },
    { icon: BatteryCharging, label: "Ladevorgänge" },
    { icon: User, label: "Profil" },
  ];
  const [active, setActive] = useState(0);
  const nav = (cls: string) => (
    <nav className={cls} aria-label={`Beispiel ${cls}`}>
      {items.map((it, i) => (
        <a
          key={it.label}
          href="#"
          className="nav-item"
          aria-current={i === active ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            setActive(i);
          }}
        >
          <it.icon {...ICON} />
          {it.label}
        </a>
      ))}
    </nav>
  );
  return (
    <Demo title="Navigation" source="Seitenwechsel: Page side-by-side">
      <p className="hint">Ab 1024px Seitenleiste links, darunter Leiste unten mit höchstens 5 Einträgen und Safe-Area-Abstand.</p>
      <div className="sg-nav-preview">
        {nav("sg-sidebar")}
        {nav("sg-bottom-nav")}
      </div>
      <PageTransition pageKey={String(active)} direction={2}>
        <p className="sg-page">Inhalt: {items[active].label}</p>
      </PageTransition>
    </Demo>
  );
}

function OverlayDemo() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [inline, setInline] = useState(false);
  const [panel, setPanel] = useState(false);
  return (
    <>
      <Demo title="Modal" source="Modal open / close">
        <Button onClick={() => setModal(true)}>Modal öffnen</Button>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Passkey entfernen?"
          actions={
            <>
              <Button variant="secondary" onClick={() => setModal(false)}>
                Abbrechen
              </Button>
              <Button onClick={() => setModal(false)}>Entfernen</Button>
            </>
          }
        >
          Mit diesem Passkey kannst du dich danach nicht mehr anmelden.
        </Modal>
      </Demo>
      <Demo title="Toast" source="Toast open / close, Banner stacking">
        <div className="sg-row">
          <Button variant="secondary" icon={Bell} onClick={() => toast("Gespeichert")}>
            Meldung
          </Button>
          <Button variant="secondary" onClick={() => toast("Verbindung zu Ford fehlgeschlagen", "error")}>
            Fehlermeldung
          </Button>
          <Button variant="ghost" onClick={() => setInline(!inline)}>
            Einzelner Toast
          </Button>
        </div>
        <p className="hint">Mehrere Meldungen stapeln sich, die älteste wird nach hinten geschoben.</p>
        <InlineToast open={inline}>
          <Info {...ICON} />
          <span className="toast-text">Die nächste Abfrage bei Ford läuft in 2 Minuten.</span>
        </InlineToast>
      </Demo>
      <Demo title="Panel / Drawer" source="Panel reveal">
        <Button variant="secondary" onClick={() => setPanel(!panel)} aria-expanded={panel}>
          {panel ? "Panel schließen" : "Panel öffnen"}
        </Button>
        <div className="sg-panel-slot">
          <Panel open={panel}>
            <h3>Details zum Ladevorgang</h3>
            <p className="hint">Gleitet 12px herein, mit kurzer Unschärfe. Schließen ist kürzer als Öffnen.</p>
          </Panel>
        </div>
      </Demo>
    </>
  );
}

function ControlsDemo() {
  const [tab, setTab] = useState("day");
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [checked, setChecked] = useState(true);
  const [checked2, setChecked2] = useState(false);
  return (
    <>
      <Demo title="Tabs" source="Tabs sliding">
        <Tabs
          label="Zeitraum"
          items={[
            { id: "day", label: "Tage" },
            { id: "week", label: "Wochen" },
            { id: "month", label: "Monate" },
            { id: "year", label: "Jahre" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </Demo>
      <Demo title="Dropdown" source="Menu dropdown">
        <div className="sg-row">
          <Dropdown
            label="Exportieren"
            icon={Download}
            items={[
              { label: "CSV", onSelect: () => {} },
              { label: "Excel", onSelect: () => {} },
              { label: "TXT", onSelect: () => {} },
            ]}
          />
          <Dropdown variant="ghost" label="Mehr" align="right" items={[{ label: "Kopieren", icon: Copy, onSelect: () => {} }, { label: "Neu", icon: Plus, onSelect: () => {} }]} />
        </div>
      </Demo>
      <Demo title="Schalter und Checkbox" source="Toggle, Checkbox check">
        <Toggle label="Benachrichtigungen" checked={on} onChange={setOn} />
        <Toggle label="Nur beim Laden abfragen" checked={off} onChange={setOff} />
        <Toggle label="Deaktiviert" checked={false} onChange={() => {}} disabled />
        <Checkbox label="Als geschäftlich markieren" checked={checked} onChange={setChecked} />
        <Checkbox label="Wochenenden ausblenden" checked={checked2} onChange={setChecked2} />
      </Demo>
    </>
  );
}

function LoadingDemo() {
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const t = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(t);
  }, [run]);
  return (
    <>
      <Demo title="Skeleton" source="Skeleton loader and reveal" onReplay={() => setRun(run + 1)}>
        <Skeleton key={run} ready={ready} lines={4}>
          <h3>Ford Explorer 2026</h3>
          <p>Akku 84 % · Reichweite 312 km</p>
          <p className="hint">Stand: heute, 08:14 Uhr</p>
        </Skeleton>
      </Demo>
      <Demo title="Lade-Hinweis" source="Matrix dot loader">
        <div className="sg-row">
          <Loading />
          <MatrixLoader label="Lädt" />
          <Button loading>Speichern</Button>
        </div>
      </Demo>
    </>
  );
}

function FeedbackDemo() {
  const [run, setRun] = useState(0);
  const [dark, setDark] = useState(true);
  const states = ["Verbindet mit Ford", "Lädt Fahrzeugdaten", "Aktuell"];
  const [state, setState] = useState(0);
  return (
    <>
      <Demo title="Bestätigung" source="Success check" onReplay={() => setRun(run + 1)}>
        <div className="sg-row sg-big-icon">
          <SuccessCheck key={run} size={48} />
          <span>Passkey hinzugefügt</span>
        </div>
      </Demo>
      <Demo title="Icon-Wechsel" source="Icon swap">
        <button type="button" className="icon-btn" aria-label={dark ? "Helles Bild" : "Dunkles Bild"} onClick={() => setDark(!dark)}>
          <IconSwap showB={!dark} a={<Moon {...ICON} />} b={<Sun {...ICON} />} />
        </button>
      </Demo>
      <Demo title="Status-Text" source="Text states swap">
        <div className="sg-row">
          <strong>
            <TextSwap text={states[state]} />
          </strong>
          <Button variant="ghost" small onClick={() => setState((state + 1) % states.length)}>
            Nächster Status
          </Button>
        </div>
      </Demo>
    </>
  );
}

function TextDemo() {
  const [run, setRun] = useState(0);
  const [soc, setSoc] = useState(84);
  const [odo, setOdo] = useState(12480);
  return (
    <>
      <Demo title="Überschrift" source="Texts reveal" onReplay={() => setRun(run + 1)}>
        <TextsReveal key={run} as="h2" title="Guten Morgen" subtitle="Dein Explorer ist zu 84 % geladen." />
      </Demo>
      <Demo title="Zahlen" source="Number pop-in, Spinning counter">
        <div className="sg-numbers">
          <span className="sg-number">
            <NumberPop value={`${soc} %`} />
          </span>
          <span className="sg-number">
            <SpinningCounter value={odo} />
            <span> km</span>
          </span>
        </div>
        <div className="sg-row">
          <Button variant="secondary" small icon={Zap} onClick={() => setSoc(Math.min(100, soc + 3))}>
            Laden
          </Button>
          <Button variant="secondary" small onClick={() => setOdo(odo + 37)}>
            37 km fahren
          </Button>
        </div>
      </Demo>
    </>
  );
}

function DisclosureDemo() {
  return (
    <>
      <Demo title="Akkordeon" source="Accordion expand">
        <Accordion title="Warum fehlen manche Tage?">
          Ford schickt nur Daten, wenn das Auto wach ist (fahren oder laden). Zeiträume ohne Messwert fehlen.
        </Accordion>
        <Accordion title="Wie genau sind Ladevorgänge?">Beginn und Ende sind auf ein paar Minuten genau.</Accordion>
      </Demo>
      <Demo title="Tooltip und Link" source="Tooltip open/close, Learn more hover">
        <div className="sg-row">
          <Tooltip label="Kopieren">
            <button type="button" className="icon-btn" aria-label="Kopieren">
              <Copy {...ICON} />
            </button>
          </Tooltip>
          <Tooltip label="Herunterladen">
            <button type="button" className="icon-btn" aria-label="Herunterladen">
              <Download {...ICON} />
            </button>
          </Tooltip>
          <LearnMore href="#motion">Mehr erfahren</LearnMore>
        </div>
      </Demo>
    </>
  );
}

export default function Styleguide() {
  return (
    <main className="app-main styleguide">
      <header className="sg-header">
        <Wordmark />
        <TextsReveal title="Design-System" subtitle="Tokens, Komponenten und Übergänge von Mein Ford. Ruhig, monochrom, dunkel." />
        <a href="/" className="learn-more">
          Zur App
        </a>
      </header>

      <Section id="marke" title="Marke">
        <div className="sg-row sg-brand">
          <Wordmark size={32} />
          {[16, 24, 32, 64].map((s) => (
            <span key={s} className="sg-signet">
              <Signet size={s} />
              <span className="hint tabular">{s}px</span>
            </span>
          ))}
        </div>
        <p className="hint">Wortmarke in Inter 600, eng gesetzt. Signet: offener Ring mit Punkt, einfarbig, lesbar ab 16px.</p>
      </Section>

      <Section id="farben" title="Farben">
        <Swatches />
        <p className="hint">
          Statusfarben nur als Fläche oder Linie, nie als Textfarbe. Sekundärtext nutzt --text-muted, weil --muted als Text unter 4.5:1 liegt.
        </p>
      </Section>

      <Section id="typo" title="Typografie">
        {TYPE.map(([name, px]) => (
          <p key={name} className="sg-type" style={{ fontSize: `var(${name})` }}>
            <span className="hint tabular">
              {px} · {name}
            </span>
            Akku 84 % · 312 km
          </p>
        ))}
        <p className="sg-weights">
          <span style={{ fontWeight: "var(--weight-regular)" }}>Regular 400</span>
          <span style={{ fontWeight: "var(--weight-medium)" }}>Medium 500</span>
          <span style={{ fontWeight: "var(--weight-semibold)" }}>Semibold 600</span>
        </p>
      </Section>

      <Section id="raster" title="Abstände und Radien">
        {SPACES.map((s) => (
          <div key={s} className="sg-space">
            <code>{s}</code>
            <span className="hint tabular">{token(s)}</span>
            <span className="sg-space-bar" style={{ width: `var(${s})` }} />
          </div>
        ))}
        <div className="sg-row">
          {RADII.map((r) => (
            <span key={r} className="sg-radius" style={{ borderRadius: `var(${r})` }}>
              <code>{r}</code>
            </span>
          ))}
        </div>
      </Section>

      <Section id="motion" title="Motion">
        <dl className="sg-motion">
          {MOTION.map((m) => (
            <div key={m}>
              <dt>
                <code>{m}</code>
              </dt>
              <dd className="tabular">{token(m)}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          Nur transform, opacity und filter. Skalierung ab 0.96, Wege bis 12px, Unschärfe bis 4px. Schließen dauert etwa 70 % vom Öffnen. Mit
          „Bewegung reduzieren“ bleiben nur Opacity-Fades unter 150ms.
        </p>
      </Section>

      <Section id="komponenten" title="Komponenten">
        <div className="sg-grid">
          <ButtonsDemo />
          <FieldDemo />
          <CardsDemo />
          <NavigationDemo />
          <OverlayDemo />
          <ControlsDemo />
          <LoadingDemo />
          <FeedbackDemo />
          <TextDemo />
          <DisclosureDemo />
        </div>
      </Section>
    </main>
  );
}
