// Anmeldeseite (Passwort oder Passkey) und Profilseite mit den Kontoeinstellungen.
import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, LogOut, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { CarDrawing } from "./common";
import { Button, buttonClass, Card, ErrorMessage, Field, LearnMore, Modal, Skeleton, TextsReveal, useToast, Wordmark } from "./ui";

/** Event, wenn die Anmeldung weg ist (abgemeldet oder Sitzung abgelaufen). App zeigt dann die Anmeldeseite. */
export const LOGGED_OUT = "ford-logged-out";

export interface Me {
  loginRequired: boolean;
  setupMissing: boolean;
  loggedIn: boolean;
  username: string | null;
  displayName: string | null;
}

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Session {
  id: string;
  method: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

interface Profile {
  username: string | null;
  displayName: string | null;
  passwordSource: "server" | "app" | "none";
  passwordChangedAt: string | null;
  canResetPassword: boolean;
  passkeysAvailable: boolean;
  passkeys: Passkey[];
  sessions: Session[];
  fordConnected: boolean;
}

/** Schickt JSON ans Backend. Wirft einen Fehler mit dem Text vom Server, wenn etwas schiefgeht. */
async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? data.message ?? `Fehler ${res.status}`);
  return data as T;
}

/** Fehlermeldung für den Nutzer. Abbrechen im Passkey-Fenster ist kein richtiger Fehler. */
function errorText(err: unknown): string | null {
  if (err instanceof WebAuthnError && err.code === "ERROR_CEREMONY_ABORTED") return null;
  if (err instanceof Error && err.name === "NotAllowedError") return "Abgebrochen oder abgelaufen. Bitte nochmal versuchen.";
  return err instanceof Error ? err.message : String(err);
}

/** Macht aus dem User-Agent des Browsers einen kurzen Gerätenamen wie "iPhone · Safari". */
export function deviceName(userAgent: string | null): string {
  if (!userAgent) return "Unbekanntes Gerät";
  const os = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "Gerät";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  return browser ? `${os} · ${browser}` : os;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
const date = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" });

/** Linke Seite der Anmeldung: Wortmarke und ein Explorer, der auf einer Straße fährt. */
function LoginHero() {
  return (
    <section className="login-hero">
      <h1>
        <Wordmark size={32} />
      </h1>
      <div className="road-scene">
        <CarDrawing charging={false} />
        <div className="road" />
      </div>
    </section>
  );
}

const LOGIN_INTRO =
  "Akku, Reichweite, Ladevorgänge und Kilometerstand deines Ford Explorer an einem Ort – direkt von Ford, mit Fahrtenbuch und Export.";

/** Anmeldeseite. Wird statt der App gezeigt, solange man nicht angemeldet ist. */
export function LoginPage({ setupMissing, onLoggedIn }: { setupMissing: boolean; onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Zählt Fehlversuche, damit das Feld bei jedem erneut wackelt.
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);

  const fail = (err: unknown) => {
    setError(errorText(err));
    setAttempt((a) => a + 1);
    setBusy(null);
  };

  const withPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("password");
    setError(null);
    try {
      await api("POST", "/api/auth/login", { username, password });
      onLoggedIn();
    } catch (err) {
      fail(err);
    }
  };

  const withPasskey = async () => {
    setBusy("passkey");
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("POST", "/api/auth/passkey/login/options");
      const response = await startAuthentication({ optionsJSON });
      await api("POST", "/api/auth/passkey/login/verify", response);
      onLoggedIn();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="login-screen">
      <main className="login">
        <LoginHero />
        <section className="login-panel">
          <p className="login-intro">{LOGIN_INTRO}</p>
          {setupMissing ? (
            <ErrorMessage text="Der Login ist auf dem Server noch nicht eingerichtet: LOGIN_USER und LOGIN_HASH fehlen. Bis das erledigt ist, bleibt die App gesperrt." />
          ) : (
            <form onSubmit={withPassword} className="form">
              <Field
                label="Benutzername"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
              />
              <Field
                label="Passwort"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                autoComplete="current-password"
                required
                error={error}
                errorKey={attempt}
              />
              <Button type="submit" wide loading={busy === "password"} disabled={busy !== null}>
                Anmelden
              </Button>
              {browserSupportsWebAuthn() && (
                <Button variant="secondary" wide icon={Fingerprint} onClick={withPasskey} loading={busy === "passkey"} disabled={busy !== null}>
                  Mit Passkey anmelden
                </Button>
              )}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}

function AccountSection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(profile.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("PATCH", "/api/profile", { displayName: name });
      setError(null);
      toast("Gespeichert");
      reload();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Card title="Konto">
      <dl>
        <dt>Benutzername</dt>
        <dd>{profile.username ?? "–"}</dd>
      </dl>
      <form onSubmit={save} className="form inline">
        <Field label="Anzeigename" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={profile.username ?? ""} error={error} />
        <Button type="submit" variant="secondary">
          Speichern
        </Button>
      </form>
    </Card>
  );
}

function PasskeySection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(() => deviceName(navigator.userAgent).split(" · ")[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [newName, setNewName] = useState("");
  const [removing, setRemoving] = useState<Passkey | null>(null);
  // Name im Dialog behalten, solange er sich schließt.
  const [shown, setShown] = useState<Passkey | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("POST", "/api/profile/passkeys/options");
      const response = await startRegistration({ optionsJSON });
      await api("POST", "/api/profile/passkeys/verify", { name, response });
      toast("Passkey hinzugefügt. Ab jetzt meldest du dich damit ohne Passwort an.");
      reload();
    } catch (err) {
      const text =
        err instanceof WebAuthnError && err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
          ? "Dieses Gerät hat schon einen Passkey für dein Konto."
          : errorText(err);
      setError(text);
    } finally {
      setBusy(false);
    }
  };

  const startRename = (p: Passkey) => {
    setNewName(p.name);
    setShown(p);
    setRenaming(p);
  };

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming || !newName.trim()) return;
    await api("PATCH", `/api/profile/passkeys/${encodeURIComponent(renaming.id)}`, { name: newName })
      .then(() => toast("Passkey umbenannt"))
      .catch((err) => toast(errorText(err) ?? "Umbenennen fehlgeschlagen", "error"));
    setRenaming(null);
    reload();
  };

  const remove = async () => {
    if (!removing) return;
    await api("DELETE", `/api/profile/passkeys/${encodeURIComponent(removing.id)}`)
      .then(() => toast("Passkey entfernt"))
      .catch((err) => toast(errorText(err) ?? "Entfernen fehlgeschlagen", "error"));
    setRemoving(null);
    reload();
  };

  return (
    <Card title="Passkeys">
      <p className="hint">
        Mit einem Passkey meldest du dich per Fingerabdruck, Gesicht oder Geräte-PIN an, ganz ohne Passwort. Er ist auf deinem Gerät
        gespeichert (z. B. im iCloud-Schlüsselbund oder Google-Passwortmanager). Dein Passwort bleibt als Notlösung immer gültig.
      </p>
      {profile.passkeys.length === 0 ? (
        <p>Noch kein Passkey eingerichtet.</p>
      ) : (
        <ul className="list">
          {profile.passkeys.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <small>
                  Hinzugefügt am {date(p.createdAt)} · {p.lastUsedAt ? `zuletzt benutzt ${dateTime(p.lastUsedAt)}` : "noch nie benutzt"}
                </small>
              </div>
              <div className="actions">
                <Button variant="ghost" small icon={Pencil} onClick={() => startRename(p)}>
                  Umbenennen
                </Button>
                <Button
                  variant="ghost"
                  small
                  icon={Trash2}
                  onClick={() => {
                    setShown(p);
                    setRemoving(p);
                  }}
                >
                  Entfernen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!profile.passkeysAvailable ? (
        <p className="hint">Passkeys gehen erst, wenn der Login eingerichtet ist (LOGIN_USER und LOGIN_HASH).</p>
      ) : !browserSupportsWebAuthn() ? (
        <p className="hint">Dieser Browser kann keine Passkeys.</p>
      ) : (
        <form onSubmit={add} className="form inline">
          <Field label="Name für den neuen Passkey" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="z. B. iPhone" error={error} />
          <Button type="submit" variant="secondary" icon={KeyRound} loading={busy}>
            Passkey hinzufügen
          </Button>
        </form>
      )}

      <Modal open={renaming !== null} onClose={() => setRenaming(null)} title="Passkey umbenennen">
        <form id="rename-passkey" onSubmit={rename} className="form">
          <Field label="Neuer Name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} required autoFocus />
        </form>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setRenaming(null)}>
            Abbrechen
          </Button>
          <Button type="submit" form="rename-passkey">
            Speichern
          </Button>
        </div>
      </Modal>
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Passkey „${shown?.name ?? ""}“ entfernen?`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Abbrechen
            </Button>
            <Button onClick={remove}>Entfernen</Button>
          </>
        }
      >
        Mit diesem Passkey kannst du dich danach nicht mehr anmelden.
      </Modal>
    </Card>
  );
}

function PasswordSection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<{ field: "current" | "repeat"; text: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setAttempt((a) => a + 1);
    if (next !== repeat) return setError({ field: "repeat", text: "Die neuen Passwörter sind verschieden." });
    try {
      await api("POST", "/api/profile/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      setError(null);
      toast("Passwort geändert. Alle anderen Geräte wurden abgemeldet.");
      reload();
    } catch (err) {
      setError({ field: "current", text: errorText(err) ?? "Ändern fehlgeschlagen" });
    }
  };

  const reset = async () => {
    setConfirmReset(false);
    await api("DELETE", "/api/profile/password")
      .then(() => toast("Es gilt wieder das Passwort aus der Server-Einrichtung."))
      .catch((err) => toast(errorText(err) ?? "Zurücksetzen fehlgeschlagen", "error"));
    reload();
  };

  if (profile.passwordSource === "none") return null;
  return (
    <Card title="Passwort">
      <p className="hint">
        {profile.passwordSource === "server"
          ? "Du nutzt das Passwort aus der Server-Einrichtung."
          : `Im Profil geändert am ${dateTime(profile.passwordChangedAt!)}.`}
      </p>
      <form onSubmit={change} className="form">
        <input type="text" name="username" value={profile.username ?? ""} autoComplete="username" readOnly hidden />
        <Field
          label="Aktuelles Passwort"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
          error={error?.field === "current" ? error.text : null}
          errorKey={attempt}
        />
        <Field
          label="Neues Passwort"
          hint="Mindestens 8 Zeichen"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <Field
          label="Neues Passwort wiederholen"
          type="password"
          value={repeat}
          onChange={(e) => {
            setRepeat(e.target.value);
            if (error?.field === "repeat") setError(null);
          }}
          autoComplete="new-password"
          minLength={8}
          required
          error={error?.field === "repeat" ? error.text : null}
          errorKey={attempt}
        />
        <div className="actions">
          <Button type="submit" variant="secondary">
            Passwort ändern
          </Button>
          {profile.canResetPassword && (
            <button type="button" className="link-btn" onClick={() => setConfirmReset(true)}>
              Zurück zum Passwort aus der Server-Einrichtung
            </button>
          )}
        </div>
      </form>
      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Server-Passwort verwenden?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Abbrechen
            </Button>
            <Button onClick={reset}>Zurücksetzen</Button>
          </>
        }
      >
        Danach gilt wieder das Passwort aus der Server-Einrichtung.
      </Modal>
    </Card>
  );
}

function SessionSection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const toast = useToast();
  const others = profile.sessions.filter((s) => !s.current).length;
  const logoutOthers = async () => {
    await api("POST", "/api/profile/sessions/logout-others");
    toast(others === 1 ? "Ein Gerät abgemeldet" : `${others} Geräte abgemeldet`);
    reload();
  };
  return (
    <Card title="Angemeldete Geräte">
      {profile.sessions.length === 0 ? (
        <p className="hint">Keine. Ohne eingerichteten Login braucht es keine Anmeldung.</p>
      ) : (
        <ul className="list">
          {profile.sessions.map((s) => (
            <li key={s.id}>
              <div>
                <strong>
                  {deviceName(s.userAgent)} {s.current && <span className="tag">Dieses Gerät</span>}
                </strong>
                <small>
                  Angemeldet mit {s.method === "passkey" ? "Passkey" : "Passwort"} am {date(s.createdAt)} · zuletzt aktiv{" "}
                  {dateTime(s.lastSeenAt)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {others > 0 && (
        <Button variant="secondary" small onClick={logoutOthers}>
          Alle anderen Geräte abmelden ({others})
        </Button>
      )}
    </Card>
  );
}

/** Profilseite mit allen Kontoeinstellungen. */
export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<Profile>("GET", "/api/profile")
      .then(setProfile)
      .catch((err) => setError(errorText(err)));
  useEffect(() => void load(), []);

  const logout = async () => {
    await api("POST", "/api/auth/logout");
    window.dispatchEvent(new Event(LOGGED_OUT));
  };

  if (error) return <ErrorMessage text={error} />;
  return (
    <>
      <TextsReveal title="Profil" />
      <Skeleton ready={profile !== null} lines={8}>
        {profile && (
          <>
            {!profile.passkeysAvailable && <ErrorMessage text="Der Login ist nicht eingerichtet, die App ist ohne Passwort erreichbar." />}
            <AccountSection profile={profile} reload={load} />
            <PasskeySection profile={profile} reload={load} />
            <PasswordSection profile={profile} reload={load} />
            <SessionSection profile={profile} reload={load} />
            <Card title="Ford-Verbindung">
              <p>{profile.fordConnected ? "Mit deinem FordPass-Konto verbunden." : "Noch nicht mit Ford verbunden."}</p>
              <a className={buttonClass("secondary", { small: true })} href="/login">
                {profile.fordConnected ? "Neu mit Ford verbinden" : "Mit Ford verbinden"}
              </a>
            </Card>
            <div className="actions">
              {profile.sessions.length > 0 && (
                <Button variant="secondary" icon={LogOut} onClick={logout}>
                  Abmelden
                </Button>
              )}
              <LearnMore href="/api/docs" external>
                API-Endpunkte (Swagger)
              </LearnMore>
              <LearnMore href="/styleguide">Styleguide</LearnMore>
            </div>
          </>
        )}
      </Skeleton>
    </>
  );
}
