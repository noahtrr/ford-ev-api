import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { FordClient } from "./ford/client.js";
import { buildServer } from "./server.js";

const config: Config = {
  port: 0,
  dataDir: ":memory:",
  pollIntervalMinutes: 5,
  frontendUrl: "/",
  ford: {
    clientId: "id",
    clientSecret: "secret",
    redirectUri: "http://localhost:8080/callback",
    authUrl: "https://example.test/auth",
    tokenUrl: "https://example.test/token",
    apiBase: "https://example.test/api",
  },
};

function setup() {
  const store = new Store(":memory:");
  return buildServer(config, store, new FordClient(config.ford, store));
}

describe("server", () => {
  it("meldet, dass noch niemand eingeloggt ist", async () => {
    const res = await setup().inject("/api/status");
    expect(res.json()).toEqual({ loggedIn: false });
  });

  it("leitet /login zu Ford weiter", async () => {
    const res = await setup().inject("/login");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/example\.test\/auth\?/);
  });

  it("lehnt einen Rücksprung ohne passenden state ab", async () => {
    const res = await setup().inject("/callback?code=x&state=falsch");
    expect(res.statusCode).toBe(400);
  });

  it("liefert null, solange keine Abfahrtszeiten abgefragt wurden", async () => {
    const res = await setup().inject("/api/departure-times");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("null");
  });
});
