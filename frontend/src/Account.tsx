// Anmeldeseite (Passwort oder Passkey) und Profilseite mit den Kontoeinstellungen.
import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

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

function Message({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) return <p className="message error">{error}</p>;
  if (success) return <p className="message ok">{success}</p>;
  return null;
}

/** Anmeldeseite. Wird statt der App gezeigt, solange man nicht angemeldet ist. */
export function LoginPage({ setupMissing, onLoggedIn }: { setupMissing: boolean; onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (setupMissing) {
    return (
      <main>
        <h1>Mein Ford</h1>
        <p className="message error">
          Der Login ist auf dem Server noch nicht eingerichtet: LOGIN_USER und LOGIN_HASH fehlen. Bis das erledigt ist, bleibt die App
          gesperrt.
        </p>
      </main>
    );
  }

  const withPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/auth/login", { username, password });
      onLoggedIn();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("POST", "/api/auth/passkey/login/options");
      const response = await startAuthentication({ optionsJSON });
      await api("POST", "/api/auth/passkey/login/verify", response);
      onLoggedIn();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <h1>Mein Ford</h1>
      <p>Bitte melde dich an.</p>
      {browserSupportsWebAuthn() && (
        <>
          <button className="button wide" onClick={withPasskey} disabled={busy}>
            Mit Passkey anmelden
          </button>
          <div className="divider">oder mit Passwort</div>
        </>
      )}
      <form onSubmit={withPassword} className="form">
        <label>
          Benutzername
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>
          Passwort
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button className="button wide secondary" type="submit" disabled={busy}>
          Anmelden
        </button>
      </form>
      <Message error={error} />
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function AccountSection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const [name, setName] = useState(profile.displayName ?? "");
  const [msg, setMsg] = useState<{ error?: string | null; success?: string | null }>({});
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("PATCH", "/api/profile", { displayName: name });
      setMsg({ success: "Gespeichert." });
      reload();
    } catch (err) {
      setMsg({ error: errorText(err) });
    }
  };
  return (
    <Section title="Konto">
      <dl>
        <dt>Benutzername</dt>
        <dd>{profile.username ?? "–"}</dd>
      </dl>
      <form onSubmit={save} className="form inline">
        <label>
          Anzeigename
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={profile.username ?? ""} />
        </label>
        <button className="button small" type="submit">
          Speichern
        </button>
      </form>
      <Message {...msg} />
    </Section>
  );
}

function PasskeySection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const [name, setName] = useState(() => deviceName(navigator.userAgent).split(" · ")[0]);
  const [msg, setMsg] = useState<{ error?: string | null; success?: string | null }>({});
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg({});
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("POST", "/api/profile/passkeys/options");
      const response = await startRegistration({ optionsJSON });
      await api("POST", "/api/profile/passkeys/verify", { name, response });
      setMsg({ success: "Passkey hinzugefügt. Ab jetzt kannst du dich damit ohne Passwort anmelden." });
      reload();
    } catch (err) {
      const text =
        err instanceof WebAuthnError && err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
          ? "Dieses Gerät hat schon einen Passkey für dein Konto."
          : errorText(err);
      setMsg({ error: text });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (p: Passkey) => {
    const newName = window.prompt("Neuer Name für den Passkey:", p.name);
    if (!newName?.trim()) return;
    await api("PATCH", `/api/profile/passkeys/${encodeURIComponent(p.id)}`, { name: newName }).catch((err) => setMsg({ error: errorText(err) }));
    reload();
  };

  const remove = async (p: Passkey) => {
    if (!window.confirm(`Passkey „${p.name}“ entfernen? Mit ihm kannst du dich danach nicht mehr anmelden.`)) return;
    await api("DELETE", `/api/profile/passkeys/${encodeURIComponent(p.id)}`).catch((err) => setMsg({ error: errorText(err) }));
    reload();
  };

  return (
    <Section title="Passkeys">
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
                <button className="link" onClick={() => rename(p)}>
                  Umbenennen
                </button>
                <button className="link danger" onClick={() => remove(p)}>
                  Entfernen
                </button>
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
          <label>
            Name für den neuen Passkey
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="z. B. iPhone" />
          </label>
          <button className="button small" type="submit" disabled={busy}>
            Passkey hinzufügen
          </button>
        </form>
      )}
      <Message {...msg} />
    </Section>
  );
}

function PasswordSection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [msg, setMsg] = useState<{ error?: string | null; success?: string | null }>({});

  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) return setMsg({ error: "Die neuen Passwörter sind verschieden." });
    try {
      await api("POST", "/api/profile/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      setMsg({ success: "Passwort geändert. Alle anderen Geräte wurden abgemeldet." });
      reload();
    } catch (err) {
      setMsg({ error: errorText(err) });
    }
  };

  const reset = async () => {
    if (!window.confirm("Wieder das Passwort aus der Server-Einrichtung verwenden?")) return;
    await api("DELETE", "/api/profile/password").catch((err) => setMsg({ error: errorText(err) }));
    setMsg({ success: "Es gilt wieder das Passwort aus der Server-Einrichtung." });
    reload();
  };

  if (profile.passwordSource === "none") return null;
  return (
    <Section title="Passwort">
      <p className="hint">
        {profile.passwordSource === "server"
          ? "Du nutzt das Passwort aus der Server-Einrichtung."
          : `Im Profil geändert am ${dateTime(profile.passwordChangedAt!)}.`}
      </p>
      <form onSubmit={change} className="form">
        <input type="text" name="username" value={profile.username ?? ""} autoComplete="username" readOnly hidden />
        <label>
          Aktuelles Passwort
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          Neues Passwort (mindestens 8 Zeichen)
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <label>
          Neues Passwort wiederholen
          <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <div className="actions">
          <button className="button small" type="submit">
            Passwort ändern
          </button>
          {profile.canResetPassword && (
            <button type="button" className="link" onClick={reset}>
              Zurück zum Passwort aus der Server-Einrichtung
            </button>
          )}
        </div>
      </form>
      <Message {...msg} />
    </Section>
  );
}

function SessionSection({ profile, reload }: { profile: Profile; reload: () => void }) {
  const others = profile.sessions.filter((s) => !s.current).length;
  const logoutOthers = async () => {
    await api("POST", "/api/profile/sessions/logout-others");
    reload();
  };
  return (
    <Section title="Angemeldete Geräte">
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
        <button className="button small secondary" onClick={logoutOthers}>
          Alle anderen Geräte abmelden ({others})
        </button>
      )}
    </Section>
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

  if (error) return <Message error={error} />;
  if (!profile) return <p>Lade…</p>;
  return (
    <>
      <h1>Profil</h1>
      {!profile.passkeysAvailable && (
        <p className="message error">Der Login ist nicht eingerichtet, die App ist ohne Passwort erreichbar.</p>
      )}
      <AccountSection profile={profile} reload={load} />
      <PasskeySection profile={profile} reload={load} />
      <PasswordSection profile={profile} reload={load} />
      <SessionSection profile={profile} reload={load} />
      <Section title="Ford-Verbindung">
        <p>{profile.fordConnected ? "Mit deinem FordPass-Konto verbunden." : "Noch nicht mit Ford verbunden."}</p>
        <a className="button small" href="/login">
          {profile.fordConnected ? "Neu mit Ford verbinden" : "Mit Ford verbinden"}
        </a>
      </Section>
      {profile.sessions.length > 0 && (
        <button className="button secondary" onClick={logout}>
          Abmelden
        </button>
      )}
    </>
  );
}
