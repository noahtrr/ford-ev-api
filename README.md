# ford-ev-api

Eigene App, die über die offizielle Ford-API (FordConnect Query) Daten des eigenen Elektroautos abruft, speichert und im Browser anzeigt. Läuft im Betrieb als Docker-Container.

## Was die Ford-API kann

- Login einmalig im Browser mit deinem FordPass-Konto, danach erneuert die App den Zugang selbst (ca. 90 Tage lang).
- **Nur lesen:** Akkustand, Reichweite, Kilometerstand, Standort, Ladestatus und mehr. Sperren, Fernstart oder Laden starten geht mit dieser API nicht.
- Ford erlaubt etwa eine Anfrage pro Minute. Die App fragt deshalb alle paar Minuten im Hintergrund ab.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `backend/` | Node.js-Server (TypeScript, Fastify): Ford-Login, regelmäßige Abfrage, REST-API, SQLite-Datenbank |
| `frontend/` | Weboberfläche (React mit Vite) |
| `Dockerfile`, `docker-compose.yml` | Alles zusammen als ein Container |

Wichtige Dateien im Backend:

- `src/ford/auth.ts` – Anmeldung bei Ford und automatisches Erneuern des Zugangs
- `src/ford/client.ts` – Abfragen an die Ford-API
- `src/ford/telemetry.ts` – macht aus Fords Antwort einfache Werte
- `src/poller.ts` – fragt regelmäßig ab und speichert neue Werte
- `src/server.ts` – Webadressen (`/login`, `/api/...`)

## Einrichtung im Ford-Portal

1. Auf [developer.ford.com/developer-eu](https://developer.ford.com/developer-eu) mit **derselben E-Mail wie in FordPass** anmelden.
2. Eine App anlegen und als Redirect URI `http://localhost:8080/callback` eintragen.
3. Client ID und Client Secret notieren. Ford braucht manchmal etwas Zeit, bis die neue App funktioniert.

## Starten mit Docker

```bash
cp .env.example .env   # dann Client ID und Secret in .env eintragen
docker compose up -d --build
```

Danach <http://localhost:8080> öffnen und auf „Mit Ford anmelden“ klicken.

Die Datenbank liegt im Docker-Volume `ford-data` und bleibt bei Neustarts erhalten.

> Läuft der Container auf einem anderen Rechner (z. B. Server oder Raspberry Pi), muss die Redirect URI im Ford-Portal und in `.env` auf dessen Adresse zeigen, oder du nutzt einen SSH-Tunnel: `ssh -L 8080:localhost:8080 dein-server`.

## Entwickeln ohne Docker

Voraussetzung: Node.js 22.

```bash
npm install
cp .env.example .env   # Werte eintragen, FRONTEND_URL=http://localhost:5173 aktivieren
npm run dev            # Backend auf :8080, Oberfläche auf http://localhost:5173
```

Weitere Befehle:

```bash
npm test          # Tests
npm run typecheck # TypeScript prüfen
npm run build     # Produktions-Build
```

## API des Backends

| Adresse | Zweck |
| --- | --- |
| `GET /login` | startet die Anmeldung bei Ford |
| `GET /callback` | Rücksprung von Ford nach dem Login |
| `GET /api/status` | ob schon eingeloggt |
| `GET /api/vehicles` | deine Fahrzeuge (direkt von Ford) |
| `GET /api/snapshots/latest` | neueste gespeicherte Werte je Fahrzeug |
| `GET /api/health` | Lebenszeichen für Docker/Monitoring |
