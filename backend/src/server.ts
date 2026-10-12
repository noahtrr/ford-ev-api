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
import {
  chargingMonthsTable,
  chargingSessionsTable,
  chargingYearOverview,
  chargingYears,
  daySessions,
  detectSessions,
  summarizeCharging,
} from "./charging.js";
import { EXPORT_FORMATS, type ExportFormat } from "./export.js";
import { PERIODS, TRIP_CATEGORIES, dayReadings, overviewTable, summarize, yearOverview, type Period, type TripCategory } from "./odometer.js";
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
        {
          name: "Ladevorgänge",
          description:
            "Ladevorgänge, abgeleitet aus den gespeicherten Messwerten (Ladestand, Kabel, Ladestatus), mit Verlauf, Jahresübersicht und Export",
        },
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

    app.get<{ Querystring: { vin?: string; date: string } }>(
      "/api/odometer/day",
      {
        schema: {
          tags: ["Kilometerstand"],
          summary: "Alle Messwerte eines Tages mit Uhrzeit",
          description:
            "Für die aufgeklappte Tagesansicht: jeder Zeitpunkt, zu dem Ford einen Kilometerstand geliefert hat, mit Kilometerstand, gefahrenen km seit dem vorherigen Messwert und der Markierung privat/geschäftlich. Älteste zuerst.",
          querystring: {
            type: "object",
            required: ["date"],
            properties: { vin: vinProperty, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Tag, z. B. 2026-10-11" } },
          },
        },
      },
      async (req) => {
        const vin = pickVin(req.query.vin);
        return { vin, date: req.query.date, readings: vin ? dayReadings(store.odometerReadings(vin), req.query.date, config.timeZone) : [] };
      },
    );

    app.put<{ Body: { vin?: string; ts: string[]; category: TripCategory | null } }>(
      "/api/odometer/category",
      {
        schema: {
          tags: ["Kilometerstand"],
          summary: "Fahrten als privat oder geschäftlich markieren",
          description:
            "Markiert die Strecke bis zu den angegebenen Messwerten (Feld id aus /api/odometer/day). category null entfernt die Markierung.",
          body: {
            type: "object",
            required: ["ts", "category"],
            properties: {
              vin: vinProperty,
              ts: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5000 },
              category: { type: ["string", "null"], enum: [...TRIP_CATEGORIES, null] },
            },
          },
        },
      },
      async (req, reply) => {
        const vin = pickVin(req.body.vin);
        if (!vin) return reply.code(404).send({ error: "Noch keine Kilometerstände gespeichert." });
        return { updated: store.setTripCategory(vin, req.body.ts, req.body.category) };
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

    const formatProperty = { type: "string", enum: Object.keys(EXPORT_FORMATS), default: "csv" };

    app.get<{ Querystring: { vin?: string; year?: number; format?: ExportFormat } }>(
      "/api/odometer/year/export",
      {
        schema: {
          tags: ["Kilometerstand"],
          summary: "Jahresübersicht als Datei herunterladen",
          description: "CSV (für Excel mit Semikolon), TXT (Texttabelle) oder XLSX (Excel).",
          querystring: { ...yearQuery, properties: { ...yearQuery.properties, format: formatProperty } },
        },
      },
      async (req, reply) => {
        const vin = pickVin(req.query.vin);
        if (!vin) return reply.code(404).send({ error: "Noch keine Kilometerstände gespeichert." });
        const year = req.query.year ?? new Date().getFullYear();
        const name = req.query.format ?? "csv";
        const format = EXPORT_FORMATS[name];
        const overview = yearOverview(vin, store.odometerReadings(vin), year, config.timeZone);
        return reply
          .type(format.type)
          .header("content-disposition", `attachment; filename="kilometerstand-${year}.${name}"`)
          .send(format.build(overviewTable(overview, config.timeZone)));
      },
    );

    // ---- Ladevorgänge ----
    const sessionsOf = (vin: string) => detectSessions(store.chargingSamples(vin));
    const noData = { error: "Noch keine Messwerte gespeichert." };

    app.get<{ Querystring: { vin?: string; period?: Period } }>(
      "/api/charging",
      {
        schema: {
          tags: ["Ladevorgänge"],
          summary: "Ladevorgänge nach Tagen, Wochen, Monaten oder Jahren",
          description:
            "Je Zeitraum: Anzahl Ladevorgänge, geladene Prozent, Energie (nur wenn Ford Energie oder Akkukapazität schickt), gewonnene Reichweite und Ladedauer. Nur Zeiträume mit Ladevorgängen, neueste zuerst.",
          querystring: {
            type: "object",
            properties: { vin: vinProperty, period: { type: "string", enum: PERIODS, default: "day" } },
          },
        },
      },
      async (req) => {
        const vin = pickVin(req.query.vin);
        const period = req.query.period ?? "day";
        return { vin, vins: store.vins(), period, rows: vin ? summarizeCharging(sessionsOf(vin), period, config.timeZone) : [] };
      },
    );

    app.get<{ Querystring: { vin?: string; date: string } }>(
      "/api/charging/day",
      {
        schema: {
          tags: ["Ladevorgänge"],
          summary: "Alle Ladevorgänge eines Tages",
          description:
            "Für die aufgeklappte Tagesansicht: jeder Ladevorgang mit Beginn, Ende, Ladestand vorher und nachher, Reichweite, Ladeart, Ort und Markierung. Älteste zuerst.",
          querystring: {
            type: "object",
            required: ["date"],
            properties: { vin: vinProperty, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Tag, z. B. 2026-10-11" } },
          },
        },
      },
      async (req) => {
        const vin = pickVin(req.query.vin);
        return { vin, date: req.query.date, sessions: vin ? daySessions(sessionsOf(vin), req.query.date, config.timeZone) : [] };
      },
    );

    app.put<{ Body: { vin?: string; ids: string[]; category: TripCategory | null } }>(
      "/api/charging/category",
      {
        schema: {
          tags: ["Ladevorgänge"],
          summary: "Ladevorgänge als privat oder geschäftlich markieren",
          description: "ids = Feld id aus /api/charging/day. category null entfernt die Markierung.",
          body: {
            type: "object",
            required: ["ids", "category"],
            properties: {
              vin: vinProperty,
              ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5000 },
              category: { type: ["string", "null"], enum: [...TRIP_CATEGORIES, null] },
            },
          },
        },
      },
      async (req, reply) => {
        const vin = pickVin(req.body.vin);
        if (!vin) return reply.code(404).send(noData);
        return { updated: store.setChargingCategory(vin, req.body.ids, req.body.category) };
      },
    );

    app.get<{ Querystring: { vin?: string; year?: number } }>(
      "/api/charging/year",
      {
        schema: {
          tags: ["Ladevorgänge"],
          summary: "Jahresübersicht der Ladevorgänge mit allen 12 Monaten",
          querystring: yearQuery,
        },
      },
      async (req, reply) => {
        const vin = pickVin(req.query.vin);
        if (!vin) return reply.code(404).send(noData);
        const year = req.query.year ?? new Date().getFullYear();
        const sessions = sessionsOf(vin);
        return {
          ...chargingYearOverview(vin, sessions, year, config.timeZone),
          years: chargingYears(sessions, config.timeZone),
          vins: store.vins(),
        };
      },
    );

    app.get<{ Querystring: { vin?: string; year?: number; format?: ExportFormat; type?: "months" | "sessions" } }>(
      "/api/charging/year/export",
      {
        schema: {
          tags: ["Ladevorgänge"],
          summary: "Ladevorgänge eines Jahres als Datei herunterladen",
          description:
            "type=months: Monatsübersicht. type=sessions: jeder einzelne Ladevorgang. Als CSV (für Excel mit Semikolon), TXT (Texttabelle) oder XLSX (Excel).",
          querystring: {
            ...yearQuery,
            properties: {
              ...yearQuery.properties,
              format: formatProperty,
              type: { type: "string", enum: ["months", "sessions"], default: "months" },
            },
          },
        },
      },
      async (req, reply) => {
        const vin = pickVin(req.query.vin);
        if (!vin) return reply.code(404).send(noData);
        const year = req.query.year ?? new Date().getFullYear();
        const name = req.query.format ?? "csv";
        const type = req.query.type ?? "months";
        const sessions = sessionsOf(vin);
        const table =
          type === "sessions"
            ? chargingSessionsTable(vin, year, sessions, config.timeZone)
            : chargingMonthsTable(chargingYearOverview(vin, sessions, year, config.timeZone));
        const file = type === "sessions" ? `ladevorgaenge-einzeln-${year}` : `ladevorgaenge-${year}`;
        return reply
          .type(EXPORT_FORMATS[name].type)
          .header("content-disposition", `attachment; filename="${file}.${name}"`)
          .send(EXPORT_FORMATS[name].build(table));
      },
    );
  });

  if (publicDir && existsSync(publicDir)) {
    app.register(fastifyStatic, { root: publicDir });
  }

  return app;
}
