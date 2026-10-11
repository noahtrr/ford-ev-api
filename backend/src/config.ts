// Alle Einstellungen kommen aus Umgebungsvariablen (siehe .env.example).
// So landen keine Passwörter oder Schlüssel im Code.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  }
  return value;
}

export interface Config {
  port: number;
  dataDir: string;
  pollIntervalMinutes: number;
  /** Wohin nach dem Login weitergeleitet wird. Im Entwicklungsmodus die Vite-Adresse. */
  frontendUrl: string;
  /** Zeitzone für Tage, Wochen und Monate in der Kilometerstand-Übersicht. */
  timeZone: string;
  /** Login für die Weboberfläche (siehe src/auth/). */
  auth: {
    /** Benutzername. Ohne ihn ist der Login nicht eingerichtet. */
    username: string | null;
    /** Passwort-Hash aus der Server-Einrichtung (bcrypt von Caddy oder scrypt). */
    passwordHash: string | null;
    /** Adresse der App ohne https://, z. B. ford.zenvmc.de. Passkeys gehören immer zu genau dieser Adresse. */
    domain: string | null;
    /** true = ohne eingerichteten Login ist alles gesperrt (Server). false = alles offen (Entwicklung am eigenen Rechner). */
    lockWithoutLogin: boolean;
  };
  ford: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authUrl: string;
    tokenUrl: string;
    apiBase: string;
  };
}

/** Ordner der Datenbank. Einzeln, damit Hilfsskripte ohne Ford-Zugangsdaten laufen. */
export const loadConfigDataDir = () => process.env.DATA_DIR ?? "./data";

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8080),
    dataDir: loadConfigDataDir(),
    // Ford erlaubt etwa eine Anfrage pro Minute, daher nicht unter 2 Minuten gehen.
    pollIntervalMinutes: Math.max(2, Number(process.env.POLL_INTERVAL_MINUTES ?? 5)),
    frontendUrl: process.env.FRONTEND_URL ?? "/",
    timeZone: process.env.TIME_ZONE ?? "Europe/Berlin",
    // Dieselben Werte wie für Caddy (deploy/caddy.env), so gilt das bisherige Passwort weiter.
    auth: {
      username: process.env.LOGIN_USER || null,
      passwordHash: process.env.LOGIN_HASH || null,
      domain: process.env.DOMAIN || null,
      lockWithoutLogin: process.env.NODE_ENV === "production",
    },
    ford: {
      clientId: required("FORD_CLIENT_ID"),
      clientSecret: required("FORD_CLIENT_SECRET"),
      redirectUri: process.env.FORD_REDIRECT_URI ?? "http://localhost:8080/callback",
      authUrl: "https://api.vehicle.ford.com/fcon-public/v1/auth/init",
      tokenUrl:
        "https://api.vehicle.ford.com/dah2vb2cprod.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1A_FCON_AUTHORIZE",
      apiBase: "https://api.vehicle.ford.com/fcon-query/v1",
    },
  };
}
