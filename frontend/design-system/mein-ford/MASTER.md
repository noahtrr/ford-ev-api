# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Mein Ford
**Generated:** 2026-10-13 22:57:14
**Category:** Smart Home/IoT Dashboard
**Design Dials:** Variance 2/10 (Centered / Minimal) | Motion 4/10 (Standard) | Density 4/10 (Standard)

---

## Verbindlich: Vorgaben von Mein Ford

> Dieser Abschnitt hat Vorrang vor allem, was weiter unten vom Skill erzeugt wurde.
> Umsetzung im Code: `src/tokens.css` (alle Werte), `src/transitions.css` (Bewegung), `src/ui.tsx` (Komponenten),
> live zu sehen unter **/styleguide**.

**Produkt:** Begleit-App für den Ford Explorer (Elektro): Akku, Reichweite, Fahrtenbuch, Ladevorgänge. PWA, Web auf Desktop, Tablet und Handy (iOS Safari, Android Chrome).
**Stack:** React 19 + Vite + eigenes CSS (kein Tailwind). Icons: `lucide-react`. Schrift: `@fontsource-variable/inter` (selbst gehostet, offline-fähig).
**Stil:** dunkel, minimal, elegant, monochrom, hochwertig, ruhig.

### Farben (semantische Tokens, nie Hex in Komponenten)

| Token | Wert | Einsatz |
|---|---|---|
| `--bg` | `#0A0A0A` | Hintergrund |
| `--surface-1` | `#111111` | Karten |
| `--surface-2` | `#1A1A1A` | Modals, Menüs |
| `--border` | `#262626` | 1px-Linien statt Schatten |
| `--border-strong` | `#666666` | Rahmen von Eingabefeldern und Bedienelementen (≥ 3:1) |
| `--muted` | `#737373` | Icons, Deko |
| `--text-muted` | `#8A8A8A` | Sekundärtext (5.0–5.7:1) |
| `--text` | `#EDEDED` | Text (16.9:1) |
| `--accent` | `#FFFFFF` | sparsam: primäre Aktion, Fokus, aktiv |
| `--on-accent` | `#0A0A0A` | Text auf `--accent` |
| `--success` / `--warning` / `--error` | `#4A7C59` / `#8C7A3B` / `#8C3B3B` | nur Fläche, Linie, Punkt. Nie Textfarbe |

Tiefe entsteht über Grau-Abstufungen und 1px-Linien, nicht über Farbe oder Schatten. Status nie nur über Farbe: immer Text oder Icon dazu.

### Typografie

- Eine Familie: Inter (Fallback `system-ui`), Gewichte 400 / 500 / 600.
- Skala 12 / 14 / 16 / 20 / 24 / 32 / 48px als `--text-xs` … `--text-3xl` (in rem, wächst mit der Systemschrift).
- Body 16px, Zeilenhöhe 1.6. Überschriften 600, `letter-spacing: -0.02em`, Zeilenhöhe 1.2.
- Zahlen immer `font-variant-numeric: tabular-nums`.

### Layout und Formen

- Abstände 4 / 8 / 16 / 24 / 32 / 48 / 64px (`--space-1` … `--space-7`).
- Radien: 8px Inputs/Buttons, 12px Karten, 16px Modals, `--radius-full` für Pillen.
- Mobile-first. Breakpoints 360 / 768 / 1024 / 1440. Unter 1024px Leiste unten (höchstens 5 Einträge), ab 1024px Seitenleiste.
- Kein horizontales Scrollen der Seite (Tabellen scrollen in ihrem eigenen Container).
- Tipp-Ziele mindestens 44×44px, Safe-Area-Insets an allen fixen Leisten (`viewport-fit=cover`).
- Hover nur hinter `@media (hover: hover)`. Hover/Gedrückt über eine Overlay-Fläche mit Opacity, ohne Layout-Verschiebung.
- Fokus: `outline: 2px solid var(--accent)` mit 2px Abstand.
- Icons: Lucide, 1.5px Linie, 16 / 20 / 24px. Keine Emojis.

### Marke

- Wortmarke „Mein Ford“: Inter 600, eng gesetzt, mit Signet davor (`<Wordmark />`).
- Signet: offener Ring mit Punkt (Ladestand, Auto von oben), einfarbig. Favicon (32px, weiße Kachel) und App-Icons (randlos `#0A0A0A`, Signet weiß) in `public/`.
- UI-Texte: kurz, ruhig, präzise, keine Ausrufezeichen.

### Motion: transitions.dev statt GSAP

Die GSAP-Snippets weiter unten werden **nicht** verwendet. Alle Animationen stammen aus https://transitions.dev/library.html (lokal unter `.claude/skills/transitions-dev`), Selektoren unverändert, Werte auf diese Tokens gemappt:

| Token | Wert |
|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` |
| `--dur-fast` / `--dur-base` / `--dur-slow` | 150 / 250 / 400ms |
| `--dur-fast-out` / `--dur-base-out` / `--dur-slow-out` | 100 / 175 / 280ms (Exit ≈ 70 % vom Enter) |
| `--dur-reduced` | 100ms (nur bei weniger Bewegung) |

Regeln: nur `transform`, `opacity`, `filter`. Skalierung ab 0.96, Wege höchstens 12px, Unschärfe höchstens 4px. Bei `prefers-reduced-motion: reduce` sind alle Wege, Skalierungen und Unschärfen 0, Übergänge sind nur noch Opacity-Fades mit 100ms, Endlos-Animationen stehen still.
Nicht verwenden: Confetti, Like button, 3D tilt, alle Pro-Effekte.

| UI-Element | Übergang | Komponente |
|---|---|---|
| Seitenwechsel | Page side-by-side | `PageTransition` |
| Tabs | Tabs sliding | `Tabs` |
| Dropdowns | Menu dropdown | `Dropdown` |
| Dialoge | Modal open / close | `Modal` (natives `<dialog>`) |
| Drawer / Panel | Panel reveal | `Panel` |
| Benachrichtigungen | Toast open / close, Banner stacking | `useToast()`, `InlineToast` |
| Tooltips | Tooltip open / close | `Tooltip` |
| Akkordeon | Accordion expand | `Accordion`, `Collapse` |
| Laden | Skeleton loader and reveal, Matrix dot loader | `Skeleton`, `MatrixLoader`, `Loading` |
| Formularfehler | Error state shake | `Field` (Prop `error`, `errorKey`) |
| Bestätigung | Success check, Checkbox check | `SuccessCheck`, `Checkbox` |
| Schalter | Toggle | `Toggle` |
| Icon-Wechsel | Icon swap | `IconSwap` |
| Status-Text | Text states swap | `TextSwap` |
| Überschriften | Texts reveal | `TextsReveal` |
| Zahlen | Number pop-in, Spinning counter | `NumberPop`, `SpinningCounter` |
| Karten mit Inhaltswechsel | Card resize | `ResizeCard` |
| „Mehr erfahren“ | Learn more hover | `LearnMore` |

### Komponenten und Zustände

Button (primary / secondary / ghost), Field (Label, Hinweis, Inline-Fehler), Card, Navigation (Seitenleiste + Leiste unten), Modal, Toast, Tabs, Dropdown, Toggle, Checkbox, Skeleton.
Jede Komponente hat: default, hover (nur Maus), active, focus-visible, disabled (Opacity 0.4, `not-allowed`), loading (`aria-busy`, Matrix-Loader im Button).

### Bewusste Abweichungen

| Thema | Skill / Vorlage | Hier | Warum |
|---|---|---|---|
| Palette | Slate-Blau + Grün `#22C55E` | Monochrom nach Vorgabe | feste Vorgabe |
| Schrift | Plus Jakarta Sans | Inter, selbst gehostet | feste Vorgabe; kein Google-Fonts-Abruf, offline in der PWA |
| Schatten | `--shadow-sm` … `--shadow-xl` | keine, 1px-Linien | feste Vorgabe |
| GSAP Stagger | `back.out` Stagger-Liste | transitions.dev | feste Vorgabe |
| `--muted` als Sekundärtext | `#737373` | `--text-muted: #8A8A8A` für Text | `#737373` erreicht nur 4.0–4.2:1, AA braucht 4.5:1 |
| Rahmen von Eingabefeldern | `--border #262626` | `--border-strong #666666` | Bedienelemente brauchen ≥ 3:1 |
| Statusfarben als Text | – | nur Fläche/Linie | `#8C3B3B` 2.6:1, `#4A7C59` 4.1:1 |
| Nur transform/opacity/filter | – | Ausnahmen aus den Original-Snippets: Tabs-Pille (`width`), Akkordeon (`grid-template-rows`), Card resize (`height`), Farbwechsel bei Tabs/Toggle/Fehlerrahmen | gibt es ohne diese Eigenschaften nicht; laufen nicht bei weniger Bewegung |
| Weniger Bewegung | Snippets setzen `transition: none` | ein gemeinsamer Block: nur Opacity, 100ms | Vorgabe „nur Opacity-Fades unter 150ms“ |
| Wege/Skalierung in Snippets | Panel 100px, Banner 60px, Check 40px/10px Blur, Icon swap 0.25 | 12px, 12px, 12px/4px, 0.96 | Grenzen aus der Vorgabe |
| Error state shake | Fehler verschwindet nach 3s | Fehler bleibt, bis man tippt | Fehler am Feld muss lesbar bleiben |
| Spinning counter | vertikale SVG-Unschärfe | ohne Unschärfe | weniger Aufwand, ruhiger |
| Page side-by-side | zwei absolut gestapelte Seiten | nur die neue Seite im Fluss | Seiten haben unterschiedliche Höhen |

### Pre-Delivery-Prüfung (13.10.2026)

- 375px und 1440px: Übersicht, Kilometerstand, Profil, Login, Styleguide ohne horizontales Scrollen (Headless Chrome, `scrollWidth == innerWidth`).
- Textkontrast: automatische Prüfung aller sichtbaren Texte gegen ihren Hintergrund, kein Wert unter 4.5:1.
- Weniger Bewegung: keine Transition außer Opacity, keine über 100ms, Modal-Skalierung 1.
- Keine Hex-Farben oder ms-Werte außerhalb von `tokens.css` (nur technische 0ms/1ms).
- Modal: Fokus im Dialog, Esc schließt animiert. Dropdown: Fokus auf erstem Eintrag, Pfeiltasten, Esc. Toasts: `role="status"`, stapeln sich.

---

## Skill-Ausgabe (Referenz, wird von oben überschrieben)

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E293B` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#334155` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--color-on-secondary` |
| Accent/CTA | `#22C55E` | `--color-accent` |
| On Accent/CTA | `#0F172A` | `--color-on-accent` |
| Background | `#0F172A` | `--color-background` |
| Foreground | `#F8FAFC` | `--color-foreground` |
| Card | `#1B2336` | `--color-card` |
| Card Foreground | `#F8FAFC` | `--color-card-foreground` |
| Muted | `#272F42` | `--color-muted` |
| Muted Foreground | `#94A3B8` | `--color-muted-foreground` |
| Border | `#475569` | `--color-border` |
| Destructive | `#EF4444` | `--color-destructive` |
| On Destructive | `#000000` | `--color-on-destructive` |
| Ring | `#FFFFFF` | `--color-ring` |

**Color Notes:** Dark tech + status green

### Typography

- **Heading Font:** Plus Jakarta Sans
- **Body Font:** Plus Jakarta Sans
- **Mood:** neumorphism, soft ui, monochromatic, cool grey, minimal, physical, depth, ceramic, system font, utility
- **Google Fonts:** [Plus Jakarta Sans + Plus Jakarta Sans](https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,700;1,400)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap');
```

### Spacing Variables

*Density: 4/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #22C55E;
  color: #0F172A;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #F8FAFC;
  border: 2px solid #1E293B;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #0F172A;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E293B;
  outline: none;
  box-shadow: 0 0 0 3px #1E293B20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** Real-Time / Operations Landing

- **Conversion Strategy:** Offer a demo or sandbox and show trust signals. Label telemetry as live only when backed by a current source, with update time and stale state. Provide pause/hide or update-frequency controls for tickers and previews, stop offscreen/hidden work, support keyboard controls, and render a static final snapshot under reduced motion.
- **CTA Placement:** Primary CTA in nav + After metrics
- **Section Order:** Hero (product + live preview or status) > Key metrics/indicators > How it works > CTA (Start trial / Contact)

---

## Motion

**Stagger List** (Standard) — Trigger: load or scroll | Duration: 300-450ms | Easing: `back.out(1.4)`

```js
gsap.from('.grid-item', { opacity: 0, scale: 0.92, y: 16, duration: 0.4, stagger: { each: 0.06, from: 'start', grid: 'auto' }, ease: 'back.out(1.4)' });
```

**Framework notes:** grid: 'auto' lets GSAP infer rows/columns from a CSS grid layout for a natural wave stagger; Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Combine with from: 'center' for a bento-grid layout to draw the eye inward first
- ❌ Don't use back.out on dense data tables; the overshoot reads as sloppy on informational UI
- ⚡ Group DOM writes; avoid interleaving layout reads (getBoundingClientRect) between staggered tweens

---

## Anti-Patterns (Do NOT Use)

- ❌ Slow updates
- ❌ No automation

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
