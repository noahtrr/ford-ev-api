// Login für die Weboberfläche: mit Passwort oder mit Passkey, dazu die Profileinstellungen.
//
// Es gibt genau ein Konto. Benutzername und Passwort kommen aus der Server-Einrichtung
// (LOGIN_USER und LOGIN_HASH in deploy/caddy.env), das Passwort lässt sich im Profil ändern.
// Passkeys werden im Profil zu diesem Konto hinzugefügt. Das Passwort bleibt immer als
// Notlösung, damit man sich nicht aussperren kann, wenn ein Gerät mit Passkey verloren geht.
//
// Nach dem Login merkt sich der Browser ein Cookie (Sitzung, 30 Tage gültig).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { Session, Store } from "../db.js";
import { hashPassword, verifyPassword } from "./passwords.js";

const COOKIE = "sid";
const SESSION_DAYS = 30;
const CHALLENGE_MINUTES = 5;
// Höchstens so viele offene Challenges merken, damit niemand den Speicher volllaufen lassen kann.
const MAX_CHALLENGES = 1000;
const MIN_PASSWORD_LENGTH = 8;
// Nach 5 falschen Passwörtern ist der Login für diese IP-Adresse 15 Minuten gesperrt.
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

declare module "fastify" {
  interface FastifyRequest {
    /** Die Sitzung des Browsers, wenn er angemeldet ist. */
    session: Session | null;
  }
}

/** Diese Adressen gehen auch ohne Login, damit man sich überhaupt anmelden kann. */
const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/auth/me",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/passkey/login/options",
  "/api/auth/passkey/login/verify",
]);

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

/**
 * Schützt alle Adressen der App (Hook auf oberster Ebene, gilt auch für Swagger).
 * Gibt eine Funktion zurück, die die Konto-Routen anmeldet (nach Swagger aufrufen, damit Swagger sie sieht).
 */
export function setupAuth(app: FastifyInstance, config: Config, store: Store): (app: FastifyInstance) => void {
  /** Gibt es Benutzername und Passwort? Nur dann kann man sich anmelden. */
  const loginConfigured = () => !!config.auth.username && !!effectivePasswordHash();
  /** Das Passwort aus dem Profil, sonst das aus der Server-Einrichtung. */
  const effectivePasswordHash = () => store.account().passwordHash ?? config.auth.passwordHash;
  /** Ohne eingerichteten Login ist am eigenen Rechner alles offen, auf dem Server alles gesperrt. */
  const loginRequired = () => loginConfigured() || config.auth.lockWithoutLogin;

  if (!loginConfigured()) {
    app.log.warn(
      config.auth.lockWithoutLogin
        ? "Login nicht eingerichtet (LOGIN_USER/LOGIN_HASH fehlen): die App ist gesperrt."
        : "Login nicht eingerichtet (LOGIN_USER/LOGIN_HASH fehlen): die App ist ohne Passwort erreichbar.",
    );
  }

  // Für Passkeys: zu welcher Adresse sie gehören. Auf dem Server fest aus DOMAIN,
  // am eigenen Rechner die Adresse, unter der der Browser die App aufgerufen hat.
  const relyingParty = (req: FastifyRequest) =>
    config.auth.domain
      ? { rpID: config.auth.domain, origin: `https://${config.auth.domain}` }
      : { rpID: req.hostname, origin: `${req.protocol}://${req.host}` };

  // Einmal-Codes (Challenges) für Passkeys, nur ein paar Minuten gültig.
  const challenges = new Map<string, { kind: "login" | "register"; expires: number }>();
  const rememberChallenge = (challenge: string, kind: "login" | "register") => {
    const now = Date.now();
    for (const [c, v] of challenges) if (v.expires < now) challenges.delete(c);
    // Die ältesten zuerst verwerfen (eine Map behält die Reihenfolge, in der etwas dazukam).
    for (const c of challenges.keys()) {
      if (challenges.size < MAX_CHALLENGES) break;
      challenges.delete(c);
    }
    challenges.set(challenge, { kind, expires: now + CHALLENGE_MINUTES * 60_000 });
  };
  /** Prüft und verbraucht eine Challenge, damit sie nicht zweimal benutzt werden kann. */
  const useChallenge = (kind: "login" | "register") => (challenge: string) => {
    const entry = challenges.get(challenge);
    challenges.delete(challenge);
    return !!entry && entry.kind === kind && entry.expires > Date.now();
  };

  const failedLogins = new Map<string, { count: number; until: number }>();

  async function startSession(req: FastifyRequest, reply: FastifyReply, method: "password" | "passkey") {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60_000);
    store.createSession({
      id: randomUUID(),
      tokenHash: hashToken(token),
      method,
      userAgent: req.headers["user-agent"] ?? null,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    });
    reply.setCookie(COOKIE, token, {
      path: "/",
      httpOnly: true, // JavaScript im Browser kommt nicht an das Cookie
      sameSite: "lax", // fremde Seiten können nicht in deinem Namen etwas ändern
      secure: req.protocol === "https",
      expires,
    });
  }

  // Bei jeder Anfrage: Sitzung aus dem Cookie lesen und geschützte Adressen absichern.
  app.decorateRequest("session", null);
  app.addHook("preHandler", async (req, reply) => {
    const token = req.cookies[COOKIE];
    req.session = token ? (store.sessionByTokenHash(hashToken(token)) ?? null) : null;
    if (req.session && Date.now() - Date.parse(req.session.lastSeenAt) > 60_000) store.touchSession(req.session.id);

    const route = req.routeOptions.url;
    const callbackPath = new URL(config.ford.redirectUri).pathname;
    const isProtected =
      route !== undefined &&
      !PUBLIC_ROUTES.has(route) &&
      (route.startsWith("/api/") || route === "/login" || route === callbackPath);
    if (!isProtected || req.session || !loginRequired()) return;

    if (!loginConfigured()) {
      return reply.code(503).send({ error: "Login ist nicht eingerichtet: LOGIN_USER und LOGIN_HASH fehlen." });
    }
    // Im Browser aufgerufene Seiten (z. B. Swagger) zur Anmeldung schicken, API-Aufrufe ablehnen.
    if (req.method === "GET" && req.headers.accept?.includes("text/html")) return reply.redirect("/");
    return reply.code(401).send({ error: "Bitte anmelden." });
  });

  return (app) => {
    const ok = { type: "object", properties: { ok: { type: "boolean" } } };
    const error = { type: "object", properties: { error: { type: "string" } } };

    app.get(
      "/api/auth/me",
      {
        schema: {
          tags: ["Konto"],
          summary: "Bin ich angemeldet?",
          description:
            "Geht ohne Login. loginRequired = false heißt: am eigenen Rechner ohne eingerichteten Login, alles ist offen.",
          response: {
            200: {
              type: "object",
              properties: {
                loginRequired: { type: "boolean" },
                setupMissing: { type: "boolean", description: "true = LOGIN_USER oder LOGIN_HASH fehlen auf dem Server" },
                loggedIn: { type: "boolean" },
                username: { type: ["string", "null"] },
                displayName: { type: ["string", "null"] },
              },
            },
          },
        },
      },
      async (req) => ({
        loginRequired: loginRequired(),
        setupMissing: !loginConfigured(),
        loggedIn: !!req.session,
        username: req.session || !loginRequired() ? config.auth.username : null,
        displayName: req.session || !loginRequired() ? store.account().displayName : null,
      }),
    );

    app.post<{ Body: { username: string; password: string } }>(
      "/api/auth/login",
      {
        schema: {
          tags: ["Konto"],
          summary: "Anmelden mit Benutzername und Passwort",
          description: `Setzt das Sitzungs-Cookie. Nach ${MAX_FAILED_LOGINS} Fehlversuchen ist der Login ${LOCK_MINUTES} Minuten gesperrt.`,
          body: {
            type: "object",
            required: ["username", "password"],
            properties: { username: { type: "string" }, password: { type: "string" } },
          },
          response: { 200: ok, 401: error, 429: error, 503: error },
        },
      },
      async (req, reply) => {
        if (!loginConfigured()) return reply.code(503).send({ error: "Login ist nicht eingerichtet." });
        const ip = req.ip;
        const failed = failedLogins.get(ip);
        if (failed && failed.count >= MAX_FAILED_LOGINS && failed.until > Date.now()) {
          return reply.code(429).send({ error: `Zu viele Fehlversuche. Bitte in ${LOCK_MINUTES} Minuten nochmal.` });
        }
        const { username, password } = req.body;
        // Das Passwort immer prüfen (auch bei falschem Namen), damit die Antwort gleich lange dauert.
        const passwordOk = await verifyPassword(password, effectivePasswordHash()!);
        if (!passwordOk || username !== config.auth.username) {
          const count = failed && failed.until > Date.now() ? failed.count + 1 : 1;
          failedLogins.set(ip, { count, until: Date.now() + LOCK_MINUTES * 60_000 });
          return reply.code(401).send({ error: "Benutzername oder Passwort falsch." });
        }
        failedLogins.delete(ip);
        await startSession(req, reply, "password");
        return { ok: true };
      },
    );

    app.post(
      "/api/auth/logout",
      {
        schema: {
          tags: ["Konto"],
          summary: "Abmelden",
          description: "Beendet die Sitzung dieses Browsers.",
          response: { 200: ok },
        },
      },
      async (req, reply) => {
        if (req.session) store.deleteSession(req.session.id);
        reply.clearCookie(COOKIE, { path: "/" });
        return { ok: true };
      },
    );

    app.post(
      "/api/auth/passkey/login/options",
      {
        schema: {
          tags: ["Konto"],
          summary: "Login mit Passkey, Schritt 1",
          description: "Liefert die Optionen für navigator.credentials.get() im Browser.",
        },
      },
      async (req, reply) => {
        if (!loginConfigured()) return reply.code(503).send({ error: "Login ist nicht eingerichtet." });
        const options = await generateAuthenticationOptions({
          rpID: relyingParty(req).rpID,
          userVerification: "required",
        });
        rememberChallenge(options.challenge, "login");
        return options;
      },
    );

    app.post<{ Body: AuthenticationResponseJSON }>(
      "/api/auth/passkey/login/verify",
      {
        schema: {
          tags: ["Konto"],
          summary: "Login mit Passkey, Schritt 2",
          description: "Prüft die Antwort des Browsers und setzt das Sitzungs-Cookie.",
          body: { type: "object", required: ["id", "response"], properties: { id: { type: "string" } } },
          response: { 200: ok, 400: error, 401: error },
        },
      },
      async (req, reply) => {
        const passkey = store.passkey(req.body.id);
        if (!passkey) return reply.code(401).send({ error: "Dieser Passkey gehört zu keinem Konto in dieser App." });
        const { rpID, origin } = relyingParty(req);
        try {
          const { verified, authenticationInfo } = await verifyAuthenticationResponse({
            response: req.body,
            expectedChallenge: useChallenge("login"),
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
              id: passkey.id,
              publicKey: passkey.publicKey,
              counter: passkey.counter,
              transports: passkey.transports,
            },
          });
          if (!verified) return reply.code(401).send({ error: "Passkey konnte nicht bestätigt werden." });
          store.passkeyUsed(passkey.id, authenticationInfo.newCounter);
        } catch (err) {
          req.log.warn({ err }, "Passkey-Login fehlgeschlagen");
          return reply.code(400).send({ error: "Passkey konnte nicht bestätigt werden. Bitte nochmal versuchen." });
        }
        await startSession(req, reply, "passkey");
        return { ok: true };
      },
    );

    // ---- Profil (nur angemeldet, das erledigt der preHandler oben) ----

    const passkeySchema = {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        createdAt: { type: "string" },
        lastUsedAt: { type: ["string", "null"] },
      },
    };

    app.get(
      "/api/profile",
      {
        schema: {
          tags: ["Konto"],
          summary: "Profil: Konto, Passkeys, angemeldete Geräte",
          response: {
            200: {
              type: "object",
              properties: {
                username: { type: ["string", "null"] },
                displayName: { type: ["string", "null"] },
                passwordSource: {
                  type: "string",
                  enum: ["server", "app", "none"],
                  description: "server = aus deploy/caddy.env, app = im Profil geändert",
                },
                passwordChangedAt: { type: ["string", "null"] },
                canResetPassword: {
                  type: "boolean",
                  description: "true = es gibt ein Passwort aus der Server-Einrichtung, zu dem man zurück kann",
                },
                passkeysAvailable: {
                  type: "boolean",
                  description: "false = Login nicht eingerichtet, Passkeys gehen dann nicht",
                },
                passkeys: { type: "array", items: passkeySchema },
                sessions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      method: { type: "string" },
                      userAgent: { type: ["string", "null"] },
                      createdAt: { type: "string" },
                      lastSeenAt: { type: "string" },
                      current: { type: "boolean" },
                    },
                  },
                },
                fordConnected: { type: "boolean" },
              },
            },
          },
        },
      },
      async (req) => {
        const account = store.account();
        return {
          username: config.auth.username,
          displayName: account.displayName,
          passwordSource: account.passwordHash ? "app" : config.auth.passwordHash ? "server" : "none",
          passwordChangedAt: account.passwordChangedAt,
          canResetPassword: !!account.passwordHash && !!config.auth.passwordHash,
          passkeysAvailable: loginConfigured(),
          passkeys: store.passkeys().map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt })),
          sessions: store.sessions().map((s) => ({ ...s, current: s.id === req.session?.id })),
          fordConnected: store.loadTokens() !== undefined,
        };
      },
    );

    app.patch<{ Body: { displayName: string | null } }>(
      "/api/profile",
      {
        schema: {
          tags: ["Konto"],
          summary: "Anzeigenamen ändern",
          body: {
            type: "object",
            required: ["displayName"],
            properties: { displayName: { type: ["string", "null"], maxLength: 60 } },
          },
          response: { 200: ok },
        },
      },
      async (req) => {
        store.setDisplayName(req.body.displayName?.trim() || null);
        return { ok: true };
      },
    );

    app.post<{ Body: { currentPassword: string; newPassword: string } }>(
      "/api/profile/password",
      {
        schema: {
          tags: ["Konto"],
          summary: "Passwort ändern",
          description: "Meldet alle anderen Geräte ab. Das neue Passwort gilt statt dem aus der Server-Einrichtung.",
          body: {
            type: "object",
            required: ["currentPassword", "newPassword"],
            properties: {
              currentPassword: { type: "string" },
              newPassword: { type: "string", minLength: MIN_PASSWORD_LENGTH, maxLength: 200 },
            },
          },
          response: { 200: ok, 400: error, 403: error },
        },
      },
      async (req, reply) => {
        const current = effectivePasswordHash();
        if (!current) return reply.code(400).send({ error: "Login ist nicht eingerichtet." });
        if (!(await verifyPassword(req.body.currentPassword, current))) {
          return reply.code(403).send({ error: "Das aktuelle Passwort stimmt nicht." });
        }
        store.setPasswordHash(await hashPassword(req.body.newPassword));
        store.deleteOtherSessions(req.session?.id ?? null);
        return { ok: true };
      },
    );

    app.delete(
      "/api/profile/password",
      {
        schema: {
          tags: ["Konto"],
          summary: "Zurück zum Passwort aus der Server-Einrichtung",
          description: "Löscht das im Profil geänderte Passwort. Danach gilt wieder LOGIN_HASH aus deploy/caddy.env.",
          response: { 200: ok, 400: error },
        },
      },
      async (_req, reply) => {
        if (!config.auth.passwordHash)
          return reply.code(400).send({ error: "Es gibt kein Passwort aus der Server-Einrichtung." });
        store.setPasswordHash(null);
        return { ok: true };
      },
    );

    app.post(
      "/api/profile/passkeys/options",
      {
        schema: {
          tags: ["Konto"],
          summary: "Passkey hinzufügen, Schritt 1",
          description: "Liefert die Optionen für navigator.credentials.create() im Browser.",
        },
      },
      async (req, reply) => {
        if (!loginConfigured()) return reply.code(400).send({ error: "Ohne eingerichteten Login gehen keine Passkeys." });
        const account = store.account();
        const options = await generateRegistrationOptions({
          rpName: "Mein Ford",
          rpID: relyingParty(req).rpID,
          userName: config.auth.username!,
          userDisplayName: account.displayName ?? config.auth.username!,
          userID: new Uint8Array(Buffer.from(account.webauthnUserId, "base64url")),
          attestationType: "none",
          // Ein Gerät, das schon einen Passkey hat, nicht nochmal anlegen.
          excludeCredentials: store.passkeys().map((p) => ({ id: p.id, transports: p.transports })),
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
        });
        rememberChallenge(options.challenge, "register");
        return options;
      },
    );

    app.post<{ Body: { name?: string; response: RegistrationResponseJSON } }>(
      "/api/profile/passkeys/verify",
      {
        schema: {
          tags: ["Konto"],
          summary: "Passkey hinzufügen, Schritt 2",
          description: "Prüft die Antwort des Browsers und speichert den Passkey beim Konto.",
          body: {
            type: "object",
            required: ["response"],
            properties: { name: { type: "string", maxLength: 60 }, response: { type: "object" } },
          },
          response: { 200: passkeySchema, 400: error },
        },
      },
      async (req, reply) => {
        const { rpID, origin } = relyingParty(req);
        try {
          const { verified, registrationInfo } = await verifyRegistrationResponse({
            response: req.body.response,
            expectedChallenge: useChallenge("register"),
            expectedOrigin: origin,
            expectedRPID: rpID,
          });
          if (!verified) return reply.code(400).send({ error: "Passkey konnte nicht bestätigt werden." });
          const { credential } = registrationInfo;
          if (store.passkey(credential.id)) return reply.code(400).send({ error: "Diesen Passkey gibt es schon." });
          const name =
            req.body.name?.trim() || `Passkey vom ${new Date().toLocaleDateString("de-DE", { timeZone: config.timeZone })}`;
          store.addPasskey({
            id: credential.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: credential.transports ?? [],
            name,
          });
          const saved = store.passkey(credential.id)!;
          return { id: saved.id, name: saved.name, createdAt: saved.createdAt, lastUsedAt: saved.lastUsedAt };
        } catch (err) {
          req.log.warn({ err }, "Passkey konnte nicht hinzugefügt werden");
          return reply.code(400).send({ error: "Passkey konnte nicht bestätigt werden. Bitte nochmal versuchen." });
        }
      },
    );

    const idParam = { type: "object", required: ["id"], properties: { id: { type: "string" } } };

    app.patch<{ Params: { id: string }; Body: { name: string } }>(
      "/api/profile/passkeys/:id",
      {
        schema: {
          tags: ["Konto"],
          summary: "Passkey umbenennen",
          params: idParam,
          body: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 60 } } },
          response: { 200: ok, 404: error },
        },
      },
      async (req, reply) =>
        store.renamePasskey(req.params.id, req.body.name.trim() || "Passkey")
          ? { ok: true }
          : reply.code(404).send({ error: "Passkey nicht gefunden." }),
    );

    app.delete<{ Params: { id: string } }>(
      "/api/profile/passkeys/:id",
      {
        schema: {
          tags: ["Konto"],
          summary: "Passkey entfernen",
          description: "Mit diesem Passkey kann man sich danach nicht mehr anmelden. Das Passwort geht weiterhin.",
          params: idParam,
          response: { 200: ok, 404: error },
        },
      },
      async (req, reply) =>
        store.deletePasskey(req.params.id) ? { ok: true } : reply.code(404).send({ error: "Passkey nicht gefunden." }),
    );

    app.post(
      "/api/profile/sessions/logout-others",
      {
        schema: {
          tags: ["Konto"],
          summary: "Alle anderen Geräte abmelden",
          response: { 200: { type: "object", properties: { loggedOut: { type: "integer" } } } },
        },
      },
      async (req) => ({ loggedOut: store.deleteOtherSessions(req.session?.id ?? null) }),
    );
  };
}
