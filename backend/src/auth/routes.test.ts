import { isoCBOR } from "@simplewebauthn/server/helpers";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Config } from "../config.js";
import { Store } from "../db.js";
import { FordClient } from "../ford/client.js";
import { buildServer } from "../server.js";
import { hashPassword, verifyPassword } from "./passwords.js";

const DOMAIN = "ford.example.test";
const ORIGIN = `https://${DOMAIN}`;

async function setup(auth: Partial<Config["auth"]> = {}) {
  const config: Config = {
    port: 0,
    dataDir: ":memory:",
    pollIntervalMinutes: 5,
    frontendUrl: "/",
    timeZone: "Europe/Berlin",
    auth: { username: "noah", passwordHash: await hashPassword("geheim123"), domain: DOMAIN, lockWithoutLogin: true, ...auth },
    ford: {
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "http://localhost:8080/callback",
      authUrl: "https://example.test/auth",
      tokenUrl: "https://example.test/token",
      apiBase: "https://example.test/api",
    },
  };
  const store = new Store(":memory:");
  const app = buildServer(config, store, new FordClient(config.ford, store));
  return { app, store };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

/** Meldet sich mit Passwort an und gibt das Cookie zurück. */
async function login(app: App, password = "geheim123") {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "noah", password } });
  expect(res.statusCode).toBe(200);
  return `sid=${res.cookies.find((c) => c.name === "sid")!.value}`;
}

const b64 = (data: Uint8Array | Buffer | string) => Buffer.from(data).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

/** Ein Passkey nur im Speicher, der sich wie ein echtes Gerät (Handy, Laptop) verhält. */
function softwarePasskey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(16);
  let counter = 0;
  const clientData = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN }));

  return {
    id: b64(id),
    register(challenge: string) {
      const cose = new Map<number, number | Uint8Array>([
        [1, 2], // Schlüsseltyp EC2
        [3, -7], // ES256
        [-1, 1], // Kurve P-256
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]);
      const authData = Buffer.concat([
        sha256(DOMAIN),
        Buffer.from([0x45]), // Nutzer anwesend + bestätigt + Schlüssel dabei
        Buffer.alloc(4),
        Buffer.alloc(16), // AAGUID
        Buffer.from([0, id.length]),
        id,
        isoCBOR.encode(cose),
      ]);
      const attestation = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never);
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        response: { clientDataJSON: b64(clientData("webauthn.create", challenge)), attestationObject: b64(attestation), transports: ["internal"] },
        clientExtensionResults: {},
      };
    },
    authenticate(challenge: string) {
      counter++;
      const cd = clientData("webauthn.get", challenge);
      const authData = Buffer.concat([sha256(DOMAIN), Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
      const signature = sign("sha256", Buffer.concat([authData, sha256(cd)]), privateKey);
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        response: { clientDataJSON: b64(cd), authenticatorData: b64(authData), signature: b64(signature) },
        clientExtensionResults: {},
      };
    },
  };
}

describe("Passwörter", () => {
  it("prüft scrypt- und bcrypt-Hashes (bcrypt kommt von Caddy)", async () => {
    const scrypt = await hashPassword("geheim123");
    expect(await verifyPassword("geheim123", scrypt)).toBe(true);
    expect(await verifyPassword("falsch", scrypt)).toBe(false);
    // Erzeugt mit: caddy hash-password --plaintext geheim123 (hier mit niedrigen Kosten, damit der Test schnell ist)
    const bcrypt = "$2b$04$Kd.dbnTYFwVnJHu/KlyQLekVdjPmPFpvPlCsULifhukqj1DsYt/Pa";
    expect(await verifyPassword("geheim123", bcrypt)).toBe(true);
    expect(await verifyPassword("falsch", bcrypt)).toBe(false);
  });
});

describe("Login", () => {
  it("sperrt die API ohne Anmeldung, lässt Health und Weboberfläche offen", async () => {
    const { app } = await setup();
    expect((await app.inject("/api/status")).statusCode).toBe(401);
    expect((await app.inject("/api/profile")).statusCode).toBe(401);
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect((await app.inject("/api/auth/me")).json()).toMatchObject({ loginRequired: true, loggedIn: false, username: null });
    // Swagger und der Ford-Login im Browser landen auf der Anmeldeseite.
    const docs = await app.inject({ url: "/api/docs/", headers: { accept: "text/html" } });
    expect(docs.statusCode).toBe(302);
    expect((await app.inject({ url: "/login", headers: { accept: "text/html" } })).headers.location).toBe("/");
  });

  it("meldet mit Passwort an und wieder ab", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    expect((await app.inject({ url: "/api/status", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/me", headers: { cookie } })).json()).toMatchObject({ loggedIn: true, username: "noah" });

    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect((await app.inject({ url: "/api/status", headers: { cookie } })).statusCode).toBe(401);
  });

  it("setzt das Cookie nur für HTTPS mit Secure", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-forwarded-proto": "https" },
      payload: { username: "noah", password: "geheim123" },
    });
    expect(res.cookies[0]).toMatchObject({ name: "sid", httpOnly: true, secure: true, sameSite: "Lax" });
  });

  it("lehnt falsche Daten ab und sperrt nach 5 Fehlversuchen", async () => {
    const { app } = await setup();
    const attempt = (username: string, password: string) =>
      app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
    expect((await attempt("jemand", "geheim123")).statusCode).toBe(401);
    for (let i = 0; i < 4; i++) expect((await attempt("noah", "falsch")).statusCode).toBe(401);
    expect((await attempt("noah", "geheim123")).statusCode).toBe(429);
  });

  it("sperrt auf dem Server alles, wenn der Login nicht eingerichtet ist", async () => {
    const { app } = await setup({ username: null, passwordHash: null });
    expect((await app.inject("/api/status")).statusCode).toBe(503);
    expect((await app.inject("/api/auth/me")).json()).toMatchObject({ loginRequired: true, setupMissing: true });
  });

  it("ändert das Passwort und kann zum Server-Passwort zurück", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    const other = await login(app);
    const change = (currentPassword: string) =>
      app.inject({ method: "POST", url: "/api/profile/password", headers: { cookie }, payload: { currentPassword, newPassword: "neuesPasswort" } });
    expect((await change("falsch")).statusCode).toBe(403);
    expect((await change("geheim123")).statusCode).toBe(200);
    // Das andere Gerät ist abgemeldet, das neue Passwort gilt, das alte nicht mehr.
    expect((await app.inject({ url: "/api/profile", headers: { cookie: other } })).statusCode).toBe(401);
    const profile = (await app.inject({ url: "/api/profile", headers: { cookie } })).json();
    expect(profile).toMatchObject({ passwordSource: "app", canResetPassword: true });
    await login(app, "neuesPasswort");

    await app.inject({ method: "DELETE", url: "/api/profile/password", headers: { cookie } });
    await login(app, "geheim123");
  });

  it("ändert den Anzeigenamen", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    await app.inject({ method: "PATCH", url: "/api/profile", headers: { cookie }, payload: { displayName: " Noah " } });
    expect((await app.inject({ url: "/api/profile", headers: { cookie } })).json()).toMatchObject({ displayName: "Noah", username: "noah" });
  });
});

describe("Passkeys", () => {
  it("fügt einen Passkey zum Konto hinzu und meldet damit an", async () => {
    const { app, store } = await setup();
    const cookie = await login(app);
    const passkey = softwarePasskey();

    const options = (await app.inject({ method: "POST", url: "/api/profile/passkeys/options", headers: { cookie } })).json();
    expect(options).toMatchObject({ rp: { id: DOMAIN, name: "Mein Ford" }, user: { name: "noah", id: store.account().webauthnUserId } });
    const added = await app.inject({
      method: "POST",
      url: "/api/profile/passkeys/verify",
      headers: { cookie },
      payload: { name: "Mein iPhone", response: passkey.register(options.challenge) },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ id: passkey.id, name: "Mein iPhone" });

    // Anmelden ohne Passwort, nur mit dem Passkey.
    const loginOptions = (await app.inject({ method: "POST", url: "/api/auth/passkey/login/options" })).json();
    const res = await app.inject({ method: "POST", url: "/api/auth/passkey/login/verify", payload: passkey.authenticate(loginOptions.challenge) });
    expect(res.statusCode).toBe(200);
    const passkeyCookie = `sid=${res.cookies[0].value}`;
    const profile = (await app.inject({ url: "/api/profile", headers: { cookie: passkeyCookie } })).json();
    expect(profile.passkeys).toMatchObject([{ name: "Mein iPhone", lastUsedAt: expect.any(String) }]);
    expect(profile.sessions.find((s: { current: boolean }) => s.current)).toMatchObject({ method: "passkey" });
  });

  it("nimmt eine Challenge nur einmal an", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    const passkey = softwarePasskey();
    const options = (await app.inject({ method: "POST", url: "/api/profile/passkeys/options", headers: { cookie } })).json();
    await app.inject({ method: "POST", url: "/api/profile/passkeys/verify", headers: { cookie }, payload: { response: passkey.register(options.challenge) } });

    const loginOptions = (await app.inject({ method: "POST", url: "/api/auth/passkey/login/options" })).json();
    const verify = () =>
      app.inject({ method: "POST", url: "/api/auth/passkey/login/verify", payload: passkey.authenticate(loginOptions.challenge) });
    expect((await verify()).statusCode).toBe(200);
    expect((await verify()).statusCode).toBe(400);
  });

  it("lehnt unbekannte Passkeys ab und braucht zum Hinzufügen eine Anmeldung", async () => {
    const { app } = await setup();
    const loginOptions = (await app.inject({ method: "POST", url: "/api/auth/passkey/login/options" })).json();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/passkey/login/verify",
      payload: softwarePasskey().authenticate(loginOptions.challenge),
    });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/profile/passkeys/options" })).statusCode).toBe(401);
  });

  it("benennt Passkeys um und entfernt sie", async () => {
    const { app, store } = await setup();
    const cookie = await login(app);
    store.addPasskey({ id: "abc", publicKey: new Uint8Array(1), counter: 0, transports: [], name: "Alt" });
    await app.inject({ method: "PATCH", url: "/api/profile/passkeys/abc", headers: { cookie }, payload: { name: "Laptop" } });
    expect(store.passkey("abc")?.name).toBe("Laptop");
    expect((await app.inject({ method: "DELETE", url: "/api/profile/passkeys/abc", headers: { cookie } })).statusCode).toBe(200);
    expect(store.passkeys()).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: "/api/profile/passkeys/abc", headers: { cookie } })).statusCode).toBe(404);
  });

  it("meldet alle anderen Geräte ab", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    const other = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/profile/sessions/logout-others", headers: { cookie } });
    expect(res.json()).toEqual({ loggedOut: 1 });
    expect((await app.inject({ url: "/api/status", headers: { cookie: other } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/status", headers: { cookie } })).statusCode).toBe(200);
  });
});
