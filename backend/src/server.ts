// Der Webserver: Login-Routen, eine kleine REST-API und die Weboberfläche.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
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

  // Beschreibt alle Endpunkte als OpenAPI. Die Swagger-Oberfläche liegt unter /api/docs,
  // die Beschreibung als JSON unter /api/docs/json.
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Mein Ford – API",
        description: "Die Endpunkte, die diese App selbst anbietet. Fahrzeugdaten kommen aus der Datenbank, die das Backend regelmäßig bei Ford auffüllt.",
        version: "1.0.0",
      },
      tags: [
        { name: "App", description: "Zustand der App" },
        { name: "Anmeldung", description: "Login mit dem FordPass-Konto" },
        { name: "Fahrzeug", description: "Daten zu deinen Autos" },
      ],
    },
  });
  app.register(fastifySwaggerUi, { routePrefix: "/api/docs" });

  // Die Routen erst nach Swagger anmelden, damit Swagger sie alle sieht.
  app.register(async (app) => {
    app.get("/api/health", { schema: { tags: ["App"], summary: "Prüft, ob die App läuft" } }, async () => ({ ok: true }));

    app.get(
      "/api/status",
      { schema: { tags: ["App"], summary: "Zeigt, ob du bei Ford angemeldet bist" } },
      async () => ({ loggedIn: store.loadTokens() !== undefined }),
    );

    const loginSchema = {
      tags: ["Anmeldung"],
      summary: "Startet den Login bei Ford",
      description: "Leitet zur Ford-Anmeldeseite weiter. Im Browser öffnen, nicht hier ausprobieren.",
    };
    app.get("/login", { schema: loginSchema }, async (_req, reply) => {
      const state = randomUUID();
      pendingStates.add(state);
      return reply.redirect(loginUrl(config.ford, state));
    });

    // Der Pfad muss zur FORD_REDIRECT_URI passen.
    const callbackPath = new URL(config.ford.redirectUri).pathname;
    const callbackSchema = {
      tags: ["Anmeldung"],
      summary: "Rücksprung von Ford nach dem Login",
      description: "Ford ruft diese Adresse nach der Anmeldung auf. Nicht von Hand aufrufen.",
      querystring: {
        type: "object",
        properties: { code: { type: "string" }, state: { type: "string" } },
      },
    };
    app.get<{ Querystring: { code?: string; state?: string } }>(callbackPath, { schema: callbackSchema }, async (req, reply) => {
      const { code, state } = req.query;
      if (!code || !state || !pendingStates.delete(state)) {
        return reply.code(400).send("Ungültige Anmeldung, bitte erneut über /login starten.");
      }
      await exchangeCode(config.ford, store, code);
      void pollOnce(client, store, app.log);
      return reply.redirect(config.frontendUrl);
    });

    app.get(
      "/api/vehicles",
      {
        schema: {
          tags: ["Fahrzeug"],
          summary: "Fragt deine Autos direkt bei Ford ab",
          description: "Live-Abfrage von Fords /garage. Zählt gegen Fords Abfragelimit.",
        },
      },
      async () => client.garage(),
    );

    // Modell, Baujahr und (falls Ford einen schickt) Bild-Link je Auto, aus der gespeicherten /garage-Antwort.
    app.get(
      "/api/vehicle-info",
      {
        schema: {
          tags: ["Fahrzeug"],
          summary: "Modell, Baujahr und Bild je Auto",
          description: "Aus der zuletzt gespeicherten /garage-Antwort. null, solange noch nichts abgefragt wurde.",
        },
      },
      async () => store.vehicleInfo(),
    );

    app.get(
      "/api/snapshots/latest",
      {
        schema: {
          tags: ["Fahrzeug"],
          summary: "Neuester Stand je Auto",
          description: "Akku, Reichweite, Kilometerstand, Standort, Türen, Fenster und mehr, wie in der Übersicht.",
        },
      },
      async () => store.latestSnapshots(),
    );

    // Die letzte Antwort von Fords /electric/departure-times, unverändert. Zum Nachsehen,
    // wie Ford die Abfahrtszeiten für dein Auto wirklich schickt.
    app.get(
      "/api/departure-times",
      {
        schema: {
          tags: ["Fahrzeug"],
          summary: "Letzte Antwort von Ford zu Abfahrtszeiten",
          description: "Unverändert, wie Ford sie geschickt hat. null, solange noch nichts abgefragt wurde.",
        },
      },
      async () => store.latestDepartureTimes(),
    );
  });

  if (publicDir && existsSync(publicDir)) {
    app.register(fastifyStatic, { root: publicDir });
  }

  return app;
}
