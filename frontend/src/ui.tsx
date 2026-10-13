// Bausteine des Design-Systems (design-system/mein-ford/MASTER.md).
// Bewegung kommt aus transitions.css (transitions.dev), Werte aus tokens.css.
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CircleAlert, X, type LucideIcon } from "lucide-react";

/** Standard für alle Lucide-Icons: 1.5px Linie, dekorativ (Text steht daneben). */
export const ICON = { size: 20, strokeWidth: 1.5, "aria-hidden": true } as const;

/** Zeit-Token aus tokens.css in Millisekunden, z. B. cssMs("--modal-close-dur"). */
export function cssMs(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/** Erzwingt ein Layout, damit die nächste Klassenänderung als Übergang läuft. */
const reflow = (el: Element | null) => void (el as HTMLElement | null)?.offsetWidth;

/** Öffnen/Schließen mit .is-open / .is-closing (Dropdown, Modal). Bleibt montiert, bis das Schließen fertig ist. */
function useOpenClose(open: boolean, closeToken: string) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  useEffect(() => {
    if (open) return setPhase("open");
    setPhase((p) => (p === "open" ? "closing" : p));
    const t = setTimeout(() => setPhase((p) => (p === "closing" ? "closed" : p)), cssMs(closeToken));
    return () => clearTimeout(t);
  }, [open, closeToken]);
  return phase;
}

/* ── Marke ─────────────────────────────────────────────── */

/** Signet: offener Ring mit Punkt – Ladestand und Fahrzeug von oben. Funktioniert auch als 16px-Favicon. */
export function Signet({ size = 24 }: { size?: number }) {
  return (
    <svg className="signet" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="signet-bg" />
      <path d="M22.4 22.4 A9 9 0 1 1 25 16" className="signet-ring" />
      <circle cx="16" cy="16" r="3" className="signet-dot" />
    </svg>
  );
}

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="wordmark">
      <Signet size={size} />
      <span>Mein Ford</span>
    </span>
  );
}

/* ── Button ────────────────────────────────────────────── */

type Variant = "primary" | "secondary" | "ghost";

/** Klassen für Buttons und Links, die wie Buttons aussehen. */
export function buttonClass(variant: Variant = "primary", { small = false, wide = false } = {}) {
  return `btn btn-${variant}${small ? " btn-sm" : ""}${wide ? " btn-wide" : ""}`;
}

export function Button({
  variant = "primary",
  small,
  wide,
  loading = false,
  icon: Icon,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean; wide?: boolean; loading?: boolean; icon?: LucideIcon }) {
  return (
    <button
      {...rest}
      type={type}
      className={`${buttonClass(variant, { small, wide })}${className ? ` ${className}` : ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <MatrixLoader /> : Icon && <Icon {...ICON} />}
      {children}
    </button>
  );
}

/* ── Eingabefeld mit Label und Fehler (Error state shake) ─ */

export function Field({
  label,
  hint,
  error,
  errorKey,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** Fehlertext direkt am Feld. Leer = kein Fehler. */
  error?: string | null;
  /** Ändert sich das, wackelt das Feld erneut (z. B. nach jedem Absenden). */
  errorKey?: number;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!error || !el) return;
    el.classList.remove("is-shaking");
    reflow(el);
    el.classList.add("is-shaking");
    const t = setTimeout(() => el.classList.remove("is-shaking"), cssMs("--shake-dur-a") * 2 + cssMs("--shake-dur-b") * 2);
    return () => clearTimeout(t);
  }, [error, errorKey]);
  return (
    <div className={`field t-input-wrap${error ? " is-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div ref={box} className={`input t-input${error ? " is-error" : ""}`}>
        <input
          id={id}
          {...input}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
      </div>
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <p className="field-error t-error-msg" id={`${id}-error`} role={error ? "alert" : undefined}>
        <CircleAlert {...ICON} size={16} />
        {error}
      </p>
    </div>
  );
}

/* ── Karte ─────────────────────────────────────────────── */

export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

/** Karte, deren Höhe beim Inhaltswechsel weich nachzieht (Card resize). */
export function ResizeCard({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current!;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={`card card-resize t-resize${className ? ` ${className}` : ""}`} style={{ height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/* ── Tabs (Tabs sliding) ──────────────────────────────── */

export interface TabItem {
  id: string;
  label: string;
  /** Mit href werden die Tabs zu Links (eigene Adresse je Reiter). */
  href?: string;
}

export function Tabs({ items, active, onChange, label }: { items: TabItem[]; active: string; onChange?: (id: string) => void; label: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const move = (animate: boolean) => {
      const tab = bar.current?.querySelector<HTMLElement>("[data-active='true']");
      const p = pill.current;
      if (!tab || !p) return;
      if (!animate) p.style.transition = "none";
      p.style.transform = `translateX(${tab.offsetLeft}px)`;
      p.style.width = `${tab.offsetWidth}px`;
      if (!animate) {
        reflow(p);
        p.style.transition = "";
      }
    };
    move(!first.current);
    first.current = false;
    const ro = new ResizeObserver(() => move(false));
    ro.observe(bar.current!);
    return () => ro.disconnect();
  }, [active]);

  const isLinks = items.some((t) => t.href);
  return (
    <div ref={bar} className="tabs t-tabs" role={isLinks ? "navigation" : "tablist"} aria-label={label}>
      <span ref={pill} className="t-tabs-pill" aria-hidden="true" />
      {items.map((t) =>
        t.href ? (
          <a key={t.id} href={t.href} className="t-tab" data-active={t.id === active} aria-selected={t.id === active} aria-current={t.id === active ? "page" : undefined}>
            {t.label}
          </a>
        ) : (
          <button key={t.id} type="button" role="tab" className="t-tab" data-active={t.id === active} aria-selected={t.id === active} onClick={() => onChange?.(t.id)}>
            {t.label}
          </button>
        ),
      )}
    </div>
  );
}

/* ── Dropdown (Menu dropdown) ─────────────────────────── */

export interface MenuItem {
  label: string;
  href?: string;
  download?: boolean;
  onSelect?: () => void;
  icon?: LucideIcon;
}

export function Dropdown({
  label,
  icon: Icon,
  items,
  align = "left",
  variant = "secondary",
  small,
}: {
  label: string;
  icon?: LucideIcon;
  items: MenuItem[];
  align?: "left" | "right";
  variant?: Variant;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const phase = useOpenClose(open, "--dropdown-close-dur");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Erster Eintrag bekommt den Fokus, sobald das Menü im DOM ist.
  useEffect(() => {
    if (phase === "open") root.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const all = [...(root.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLElement);
        all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (item: MenuItem) => {
    item.onSelect?.();
    setOpen(false);
  };

  return (
    <div className="dropdown" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={buttonClass(variant, { small })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {Icon && <Icon {...ICON} />}
        {label}
        <ChevronDown {...ICON} size={16} className="dropdown-caret" />
      </button>
      {phase !== "closed" && (
        <div
          id={id}
          role="menu"
          className={`menu t-dropdown${phase === "open" ? " is-open" : " is-closing"}`}
          data-origin={align === "right" ? "top-right" : "top-left"}
          data-align={align}
          ref={(el) => {
            // Erst ohne .is-open zeichnen, dann öffnen: so läuft der Übergang auch beim ersten Mal.
            if (el && phase === "open" && !el.dataset.shown) {
              el.classList.remove("is-open");
              reflow(el);
              el.classList.add("is-open");
              el.dataset.shown = "1";
            }
          }}
        >
          {items.map((item) =>
            item.href ? (
              <a key={item.label} role="menuitem" href={item.href} download={item.download || undefined} onClick={() => pick(item)}>
                {item.icon && <item.icon {...ICON} />}
                {item.label}
              </a>
            ) : (
              <button key={item.label} type="button" role="menuitem" onClick={() => pick(item)}>
                {item.icon && <item.icon {...ICON} />}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ── Modal (Modal open / close) ───────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const phase = useOpenClose(open, "--modal-close-dur");
  const [shown, setShown] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const d = dialog.current;
    if (phase === "closed") return setShown(false);
    if (phase === "open" && d && !d.open) {
      d.showModal(); // Fokusfalle, Esc und inerter Hintergrund kommen vom Browser
      reflow(d);
      setShown(true);
    }
  }, [phase]);

  if (phase === "closed") return null;
  const state = phase === "closing" ? " is-closing" : shown ? " is-open" : "";
  return createPortal(
    <dialog
      ref={dialog}
      className={`modal${state}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Esc: erst animiert schließen
        onClose();
      }}
    >
      <div className="modal-scrim" onClick={onClose} />
      <div className={`modal-panel t-modal${state}`}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
            <X {...ICON} />
          </button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </dialog>,
    document.body,
  );
}

/* ── Toasts (Banner stacking + Toast) ─────────────────── */

type Tone = "success" | "error" | "info";
interface ToastData {
  id: number;
  text: string;
  tone: Tone;
  entered: boolean;
  leaving: boolean;
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

/** Meldung unten einblenden: const toast = useToast(); toast("Gespeichert"). */
export const useToast = () => useContext(ToastContext);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), cssMs("--stack-close"));
  }, []);

  const toast = useCallback(
    (text: string, tone: Tone = "success") => {
      const id = ++toastId;
      setToasts((all) => {
        const next = [{ id, text, tone, entered: false, leaving: false }, ...all];
        // Höchstens drei sichtbar, die älteste wird hinten hinausgeschoben.
        next.filter((t) => !t.leaving).slice(3).forEach((t) => setTimeout(() => dismiss(t.id)));
        return next;
      });
      setTimeout(() => dismiss(id), cssMs("--dur-toast-hold"));
    },
    [dismiss],
  );

  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!toasts.some((t) => !t.entered)) return;
    reflow(host.current);
    setToasts((all) => all.map((t) => (t.entered ? t : { ...t, entered: true })));
  }, [toasts]);

  let depth = 0;
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toast-host" role="status" aria-live="polite">
          <div className="t-stack" ref={host}>
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`toast t-stack-banner tone-${t.tone}${t.entered ? "" : " is-enter"}${t.leaving ? " is-leaving" : ""}`}
                data-depth={t.leaving ? undefined : Math.min(depth++, 2)}
              >
                {t.tone === "error" ? <CircleAlert {...ICON} /> : <SuccessCheck size={20} />}
                <span className="toast-text">{t.text}</span>
                <button type="button" className="icon-btn" aria-label="Meldung schließen" onClick={() => dismiss(t.id)}>
                  <X {...ICON} />
                </button>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** Einzelner Toast, frei platzierbar (Toast open / close). */
export function InlineToast({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className={`toast t-toast${open ? " is-open" : ""}`}>{children}</div>;
}

/* ── Schalter, Checkbox, Erfolg ───────────────────────── */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const [init, setInit] = useState(false);
  return (
    <label className="control-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`toggle t-toggle${init ? " is-init" : ""}`}
        data-on={checked}
        onClick={() => {
          setInit(true);
          onChange(!checked);
        }}
      >
        <span className="toggle-thumb t-toggle-thumb" />
      </button>
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="control-row">
      <button type="button" role="checkbox" aria-checked={checked} disabled={disabled} className="checkbox t-check" onClick={() => onChange(!checked)}>
        <svg viewBox="0 0 10.1668 10.1668" aria-hidden="true">
          <path d="M1 5.52L3.92 9.17L9.17 1" />
        </svg>
      </button>
      <span>{label}</span>
    </label>
  );
}

/** Häkchen, das sich einzeichnet (Success check). Spielt beim Einblenden einmal ab. */
export function SuccessCheck({ size = 24, play = true }: { size?: number; play?: boolean }) {
  const wrap = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const path = wrap.current?.querySelector("path");
    if (path) wrap.current!.style.setProperty("--check-len", String(Math.ceil(path.getTotalLength()) + 1));
  }, []);
  return (
    <span ref={wrap} className="success-check t-success-check" data-state={play ? "in" : "out"} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/* ── Laden ─────────────────────────────────────────────── */

const TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

/** 4×4-Punkte-Loader (Matrix dot loader), Variante "twinkle". */
export function MatrixLoader({ label }: { label?: string }) {
  const cycle = typeof document === "undefined" ? 0 : cssMs("--matrix-cycle");
  return (
    <span className="t-matrix" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {TWINKLE.map((order, i) => (
        <i key={i} style={{ ["--d" as string]: Math.round(order * (cycle / 16)) }} />
      ))}
    </span>
  );
}

/**
 * Platzhalter, der beim Laden pulsiert und dann weich zum Inhalt überblendet (Skeleton loader and reveal).
 * ready = Daten sind da. lines = wie viele Platzhalterzeilen.
 */
export function Skeleton({ ready, lines = 3, children }: { ready: boolean; lines?: number; children?: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ready || revealed) return;
    reflow(box.current);
    setRevealed(true);
  }, [ready, revealed]);
  return (
    <div ref={box} className={`skeleton t-skel${revealed ? " is-revealed" : ""}`} aria-busy={!ready}>
      <div className="t-skel-skeleton is-pulsing" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="skeleton-bar" />
        ))}
      </div>
      <div className="t-skel-content">{ready && children}</div>
    </div>
  );
}

/** Kleiner Ladehinweis für Bereiche, die nachladen. */
export function Loading({ text = "Wird geladen" }: { text?: string }) {
  return (
    <p className="loading" role="status">
      <MatrixLoader />
      {text}
    </p>
  );
}

/** Fehlermeldung im Inhalt: Icon und Text, Farbe nur als Rahmen. */
export function ErrorMessage({ text }: { text: string }) {
  return (
    <p className="message error" role="alert">
      <CircleAlert {...ICON} size={16} />
      {text}
    </p>
  );
}

/* ── Text und Zahlen ──────────────────────────────────── */

/** Status-Text, der beim Wechsel weich austauscht (Text states swap). */
export function TextSwap({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (text === shown) return;
    const node = el.current!;
    node.classList.add("is-exit");
    const t = setTimeout(() => {
      node.classList.remove("is-exit");
      node.classList.add("is-enter-start");
      setShown(text);
    }, cssMs("--text-swap-dur"));
    return () => clearTimeout(t);
  }, [text, shown]);
  useLayoutEffect(() => {
    const node = el.current!;
    if (!node.classList.contains("is-enter-start")) return;
    reflow(node);
    node.classList.remove("is-enter-start");
  }, [shown]);
  return (
    <span ref={el} className="t-text-swap" aria-live="polite">
      {shown}
    </span>
  );
}

/** Überschrift mit Unterzeile, die gestaffelt erscheinen (Texts reveal). */
export function TextsReveal({ title, subtitle, as: Tag = "h1" }: { title: ReactNode; subtitle?: ReactNode; as?: "h1" | "h2" }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    reflow(box.current);
    box.current?.classList.add("is-shown");
  }, []);
  return (
    <div ref={box} className="texts-reveal t-stagger">
      <Tag className="t-stagger-line t-stagger-line--1">{title}</Tag>
      {subtitle && <p className="t-stagger-line t-stagger-line--2 lead">{subtitle}</p>}
    </div>
  );
}

/** Zahl, deren geänderte Ziffern neu hereinspringen (Number pop-in). */
export function NumberPop({ value }: { value: string }) {
  const prev = useRef(value);
  const group = useRef<HTMLSpanElement>(null);
  let same = 0;
  while (same < prev.current.length && same < value.length && prev.current[same] === value[same]) same++;
  if (prev.current === value) same = value.length;
  useLayoutEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    const g = group.current!;
    g.classList.remove("is-animating");
    reflow(g);
    g.classList.add("is-animating");
  }, [value]);
  const chars = value.split("");
  return (
    <span ref={group} className="t-digit-group" aria-label={value}>
      {chars.map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          className="t-digit"
          aria-hidden="true"
          data-same={i < same ? "" : undefined}
          data-stagger={i === chars.length - 2 ? "1" : i === chars.length - 1 ? "2" : undefined}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

/** Zähler mit Ziffernwalzen (Spinning counter). Ohne Bewegungsunschärfe, siehe MASTER.md. */
export function SpinningCounter({ value }: { value: number }) {
  const digits = String(Math.max(0, Math.round(value))).split("").map(Number);
  const spins = useRef(0);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    spins.current += 1;
    setTurn(spins.current);
  }, [value]);
  return (
    <span className="t-reel" aria-label={String(value)}>
      {digits.map((d, col) => (
        <span key={digits.length - col} className="t-reel-col" aria-hidden="true">
          <span
            className="t-reel-strip"
            style={{
              transform: `translateY(calc(var(--reel-cell) * ${-(turn * 10 + d)}))`,
              transition: `transform var(--reel-dur) var(--reel-ease) calc(var(--reel-stagger) * ${col})`,
            }}
          >
            {/* ponytail: der Streifen wächst mit jeder Änderung um 10 Zellen; reicht für Anzeigen, die selten wechseln */}
            {Array.from({ length: (turn + 1) * 10 }, (_, i) => (
              <span key={i} className="t-reel-digit">
                {i % 10}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/* ── Weitere Bausteine ────────────────────────────────── */

/** Zwei Icons im selben Platz, weich getauscht (Icon swap). */
export function IconSwap({ showB, a, b }: { showB: boolean; a: ReactNode; b: ReactNode }) {
  return (
    <span className="t-icon-swap" data-state={showB ? "b" : "a"}>
      <span className="t-icon" data-icon="a">
        {a}
      </span>
      <span className="t-icon" data-icon="b">
        {b}
      </span>
    </span>
  );
}

/** Aufklappbarer Bereich (Accordion expand). */
export function Accordion({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="accordion t-acc" data-open={open}>
      <button type="button" className="accordion-head t-acc-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {title}
        <span className="t-acc-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path d="M4 6.5L8 10.5L12 6.5" />
          </svg>
        </span>
      </button>
      <div className="t-acc-panel" id={id} role="region">
        <div className="t-acc-panel-inner">
          <div className="accordion-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** „Mehr erfahren“-Link mit Pfeil (Learn more hover). */
export function LearnMore({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <a className="learn-more t-learn" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
      <span className="t-learn-chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
          <path className="t-learn-arm t-learn-arm-top" d="M6 4L10 8" />
          <path className="t-learn-arm t-learn-arm-bot" d="M10 8L6 12" />
        </svg>
      </span>
    </a>
  );
}

/** Kurzer Hinweis über einem Icon-Button (Tooltip open/close). Die Beschriftung ist auch der zugängliche Name. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const group = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [show, setShow] = useState(false);
  const place = () => {
    const g = group.current!;
    const t = tip.current!;
    const text = t.firstElementChild as HTMLElement;
    const cs = getComputedStyle(t);
    const width = Math.ceil(text.scrollWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
    const trigger = g.firstElementChild!.getBoundingClientRect();
    const x = trigger.width / 2 - width / 2;
    t.style.transition = "none";
    t.style.width = `${width}px`;
    t.style.setProperty("--tt-x", `${x}px`);
    reflow(t);
    t.style.transition = "";
    setShow(true);
  };
  return (
    <span ref={group} className="t-tt-group" onPointerEnter={place} onPointerLeave={() => setShow(false)} onFocus={place} onBlur={() => setShow(false)}>
      {Children.only(children)}
      <span ref={tip} id={id} className="t-tt" role="tooltip" aria-hidden={!show} data-show={show}>
        <span className="t-tt-text">{label}</span>
      </span>
    </span>
  );
}

/** Fläche, die in einen Bereich hineingleitet (Panel reveal), z. B. ein Detailbereich. */
export function Panel({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="panel t-panel-slide" data-open={open} aria-hidden={!open} inert={!open}>
      {children}
    </div>
  );
}

/**
 * Seitenwechsel (Page side-by-side): die neue Seite kommt aus der Richtung der Navigation.
 * direction 1 = von links (zurück), 2 = von rechts (weiter).
 */
export function PageTransition({ pageKey, direction, children }: { pageKey: string; direction: 1 | 2; children: ReactNode }) {
  const page = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = page.current!;
    el.classList.remove("is-active", "is-settled");
    reflow(el);
    el.classList.add("is-active");
    const t = setTimeout(() => el.classList.add("is-settled"), cssMs("--page-slide-dur"));
    return () => clearTimeout(t);
  }, [pageKey]);
  return (
    <div className="t-page-slide">
      <div ref={page} key={pageKey} className="t-page" data-page-id={direction}>
        {children}
      </div>
    </div>
  );
}
