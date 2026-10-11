// Der Webserver: Login-Routen, eine kleine REST-API und die Weboberfläche.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Config } from "./config.js";
import type { Store } from "./db.js";
import { exchangeCode, loginUrl } from "./ford/auth.js";
import type { FordClient } from "./ford/client.js";
import { pollOnce } from "./poller.js";

export function buildServer(config: Config, store: Store, client: FordClient, publicDir?: string) {
  const app = Fastify({ logger: true });
  // Schützt den Login vor fremden Rückleitungen (CSRF).
  const pendingStates = new Set<string>();

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/status", async () => ({ loggedIn: store.loadTokens() !== undefined }));

  app.get("/login", async (_req, reply) => {
    const state = randomUUID();
    pendingStates.add(state);
    return reply.redirect(loginUrl(config.ford, state));
  });

  // Der Pfad muss zur FORD_REDIRECT_URI passen.
  const callbackPath = new URL(config.ford.redirectUri).pathname;
  app.get<{ Querystring: { code?: string; state?: string } }>(callbackPath, async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !state || !pendingStates.delete(state)) {
      return reply.code(400).send("Ungültige Anmeldung, bitte erneut über /login starten.");
    }
    await exchangeCode(config.ford, store, code);
    void pollOnce(client, store, app.log);
    return reply.redirect(config.frontendUrl);
  });

  app.get("/api/vehicles", async () => client.garage());

  // Modell, Baujahr und (falls Ford einen schickt) Bild-Link je Auto, aus der gespeicherten /garage-Antwort.
  app.get("/api/vehicle-info", async () => store.vehicleInfo());

  app.get("/api/snapshots/latest", async () => store.latestSnapshots());

  // Die letzte Antwort von Fords /electric/departure-times, unverändert. Zum Nachsehen,
  // wie Ford die Abfahrtszeiten für dein Auto wirklich schickt.
  app.get("/api/departure-times", async () => store.latestDepartureTimes());

  if (publicDir && existsSync(publicDir)) {
    app.register(fastifyStatic, { root: publicDir });
  }

  return app;
}
