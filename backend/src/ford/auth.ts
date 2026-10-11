// Ford-Login per OAuth2 ("Authorization Code Flow"):
// 1. Wir schicken dich auf Fords Login-Seite (loginUrl).
// 2. Ford leitet zurück auf unsere /callback-Adresse, mit einem einmaligen "code".
// 3. Den code tauschen wir gegen Tokens (exchangeCode).
// 4. Das Access-Token gilt ca. 20 Minuten, das Refresh-Token ca. 90 Tage.
//    Vor Ablauf holen wir uns automatisch ein neues (getAccessToken).
import type { Config } from "../config.js";
import type { Store } from "../db.js";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** Zeitpunkt (ms seit 1970), zu dem wir die Tokens bekommen haben. */
  obtained_at: number;
}

type FordConfig = Config["ford"];

export function loginUrl(ford: FordConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: ford.clientId,
    response_type: "code",
    redirect_uri: ford.redirectUri,
    scope: "openid offline_access",
    state,
  });
  return `${ford.authUrl}?${params}`;
}

async function requestTokens(ford: FordConfig, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(ford.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ford.clientId,
      client_secret: ford.clientSecret,
      redirect_uri: ford.redirectUri,
      scope: `${ford.clientId} offline_access openid`,
      ...body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Ford-Token-Anfrage fehlgeschlagen: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as Omit<Tokens, "obtained_at">;
  return { ...data, obtained_at: Date.now() };
}

export async function exchangeCode(ford: FordConfig, store: Store, code: string): Promise<void> {
  const tokens = await requestTokens(ford, { grant_type: "authorization_code", code });
  store.saveTokens(tokens);
}

/** Ist das Token in weniger als einer Minute abgelaufen? */
export function isExpired(tokens: Tokens, now = Date.now()): boolean {
  return now > tokens.obtained_at + (tokens.expires_in - 60) * 1000;
}

export async function getAccessToken(ford: FordConfig, store: Store): Promise<string> {
  let tokens = store.loadTokens();
  if (!tokens) {
    throw new NotLoggedInError();
  }
  if (isExpired(tokens)) {
    tokens = await requestTokens(ford, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    store.saveTokens(tokens);
  }
  return tokens.access_token;
}

export class NotLoggedInError extends Error {
  constructor() {
    super("Noch nicht bei Ford angemeldet. Öffne /login im Browser.");
  }
}
