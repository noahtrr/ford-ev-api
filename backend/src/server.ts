// Der Webserver: Login-Routen, eine kleine REST-API und die Weboberfläche.
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Config } from "./config.js";
import { setupAuth } from "./auth/routes.js";
import type { Store } from "./db.js";
import { exchangeCode, loginUrl } from "./ford/auth.js";
import type { FordClient } from "./ford/client.js";
import { PERIODS, summarize, toCsv, toTxt, toXlsx, yearOverview, type Period } from "./odometer.js";
import { pollOnce } from "./poller.js";

export function buildServer(config: Config, store: Store, client: FordClient, publicDir?: string) {
  // trustProxy: die App steht hinter Caddy, das die echte IP und "https" in X-Forwarded-* mitschickt.
  const app = Fastify({ logger: true, trustProxy: true });
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
        { name: "Konto", description: "Login in diese App (Passwort oder Passkey) und Profileinstellungen" },
        { name: "Anmeldung", description: "Verbindung mit dem FordPass-Konto" },
        { name: "Fahrzeug", description: "Daten zu deinen Autos" },
        { name: "Kilometerstand", description: "Verlauf des Kilometerstands und Jahresübersicht zum Exportieren" },
      ],
    },
  });
  app.register(fastifySwaggerUi, { routePrefix: "/api/docs" });

  // Login: ab hier braucht jede Adresse außer der Weboberfläche selbst eine Anmeldung.
  app.register(fastifyCookie);
  const authRoutes = setupAuth(app, config, store);

  // Die Routen erst nach Swagger anmelden, damit Swagger sie alle sieht.
  app.register(async (app) => {
    authRoutes(app);

    app.get("/api/health", { schema: { tags: ["App"], summary: "Prüft, ob die App läuft" } }, async () => ({ ok: true }));

    app.get(
      "/api/status",
      { schema: { tags: ["App"], summary: "Zeigt, ob du bei Ford angemeldet bist" } },
      async () => ({ loggedIn: store.loadTokens() !== undefined }),
    );

    const loginSchema = {
      tags: ["Anmeldung"],
      summary: "Verbindet die App mit deinem FordPass-Konto",
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

    // Ohne vin wird das erste Auto genommen, für das es Messwerte gibt.
    const pickVin = (vin?: string) => vin || store.vins()[0] || null;
    const vinProperty = { type: "string", description: "Fahrgestellnummer. Leer = erstes Auto." };

    app.get<{ Querystring: { vin?: string; period?: Period } }>(
      "/api/odometer",
      {
        schema: {
          tags: ["Kilometerstand"],
          summary: "Kilometerstand nach Tagen, Wochen, Monaten oder Jahren",
          description:
            "Je Zeitraum: Kilometerstand am Anfang und Ende und die gefahrenen Kilometer. Nur Zeiträume mit Messwerten, neueste zuerst.",
          querystring: {
            type: "object",
            properties: { vin: vinProperty, period: { type: "string", enum: PERIODS, default: "day" } },
          },
        },
      },
      async (req) => {
        const vin = pickVin(req.query.vin);
        const period = req.query.period ?? "day";
        return { vin, vins: store.vins(), period, rows: vin ? summarize(store.odometerReadings(vin), period, config.timeZone) : [] };
      },
    );

    const yearQuery = {
      type: "object",
      properties: { vin: vinProperty, year: { type: "integer", minimum: 2000, maximum: 2100, description: "Leer = aktuelles Jahr" } },
    };

    /** Jahre, für die es Kilometerstände gibt, plus das aktuelle Jahr. Neueste zuerst. */
    const yearsWithData = (vin: string | null) => {
      const years = new Set([new Date().getFullYear()]);
      if (vin) for (const r of summarize(store.odometerReadings(vin), "year", config.timeZone)) years.add(Number(r.period));
      return [...years].sort((a, b) => b - a);
    };

    app.get<{ Querystring: { vin?: string; year?: number } }>(
      "/api/odometer/year",
      {
        schema: {
          tags: ["Kilometerstand"],
          summary: "Jahresübersicht mit allen 12 Monaten",
          description:
            "Kilometerstand am Monatsanfang und -ende und gefahrene km je Monat. Ohne Messwert im Monat wird der letzte bekannte Stand übernommen.",
          querystring: yearQuery,
        },
      },
      async (req, reply) => {
        const vin = pickVin(req.query.vin);
        if (!vin) return reply.code(404).send({ error: "Noch keine Kilometerstände gespeichert." });
        const year = req.query.year ?? new Date().getFullYear();
        return { ...yearOverview(vin, store.odometerReadings(vin), year, config.timeZone), years: yearsWithData(vin), vins: store.vins() };
      },
    );

    const exportFormats = {
      csv: { type: "text/csv; charset=utf-8", build: toCsv },
      txt: { type: "text/plain; charset=utf-8", build: toTxt },
      xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", build: toXlsx },
    } as const;

    app.get<{ Querystring: { vin?: string; year?: number; format: keyof typeof exportFormats } }>(
      "/api/odometer/year/export",
      {
        schema: {
          tags: ["Kilometerstand"],
          summary: "Jahresübersicht als Datei herunterladen",
          description: "CSV (für Excel mit Semikolon), TXT (Texttabelle) oder XLSX (Excel).",
          querystring: {
            ...yearQuery,
            properties: { ...yearQuery.properties, format: { type: "string", enum: Object.keys(exportFormats), default: "csv" } },
          },
        },
      },
      async (req, reply) => {
        const vin = pickVin(req.query.vin);
        if (!vin) return reply.code(404).send({ error: "Noch keine Kilometerstände gespeichert." });
        const year = req.query.year ?? new Date().getFullYear();
        const format = exportFormats[req.query.format ?? "csv"];
        const overview = yearOverview(vin, store.odometerReadings(vin), year, config.timeZone);
        return reply
          .type(format.type)
          .header("content-disposition", `attachment; filename="kilometerstand-${year}.${req.query.format ?? "csv"}"`)
          .send(format.build(overview, config.timeZone));
      },
    );
  });

  if (publicDir && existsSync(publicDir)) {
    app.register(fastifyStatic, { root: publicDir });
  }

  return app;
}
