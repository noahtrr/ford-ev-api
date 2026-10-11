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
- `src/odometer.ts` – Kilometerstand nach Tagen/Wochen/Monaten/Jahren, Jahresübersicht und Export
- `src/xlsx.ts` – schreibt Excel-Dateien ohne zusätzliches Paket
- `src/server.ts` – Webadressen (`/login`, `/api/...`)
- `src/auth/` – Login in die App mit Passwort oder Passkey, Profileinstellungen

## Einrichtung im Ford-Portal

1. Auf [developer.ford.com/developer-eu](https://developer.ford.com/developer-eu) mit **derselben E-Mail wie in FordPass** anmelden.
2. Eine App anlegen und als Redirect URI `http://localhost:8080/callback` eintragen.
3. Client ID und Client Secret notieren. Ford braucht manchmal etwas Zeit, bis die neue App funktioniert.

## Starten mit Docker

```bash
cp .env.example .env   # dann Client ID und Secret sowie LOGIN_USER und LOGIN_HASH in .env eintragen
docker compose up -d --build
```

Danach <http://localhost:8080> öffnen, anmelden und auf „Mit Ford verbinden“ klicken.

Die Datenbank liegt im Docker-Volume `ford-data` und bleibt bei Neustarts erhalten.

> Läuft der Container auf einem anderen Rechner (z. B. Server oder Raspberry Pi), muss die Redirect URI im Ford-Portal und in `.env` auf dessen Adresse zeigen, oder du nutzt einen SSH-Tunnel: `ssh -L 8080:localhost:8080 dein-server`.

## Betrieb auf einem Server (z. B. OVH VPS)

Im Ordner `deploy/` liegt alles für einen Server im Internet. Davor sitzt [Caddy](https://caddyserver.com) und holt automatisch ein HTTPS-Zertifikat. Die App selbst fragt nach Benutzername und Passwort (oder einem Passkey), damit niemand Fremdes Standort und Akkustand deines Autos sieht.

1. **Server bestellen:** im OVH-Kundencenter einen VPS (VPS-1 reicht) mit **Ubuntu 24.04** bestellen. Ein Standort in Europa ist am schnellsten. Den Zugang (IP, Benutzer `ubuntu`, Passwort) schickt OVH per E-Mail.
2. **Einloggen:** im Terminal (Windows: PowerShell) `ssh ubuntu@DEINE-IP`, beim ersten Mal das Passwort aus der E-Mail und danach ein neues vergeben.
3. **Zugriff auf das private Repo** mit einem Deploy-Key, der nur lesen darf:
   ```bash
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
   cat ~/.ssh/id_ed25519.pub
   ```
   Die ausgegebene Zeile auf GitHub unter *Repo → Settings → Deploy keys → Add deploy key* einfügen (Haken bei „write access“ **nicht** setzen).
4. **Repo holen und Setup starten:**
   ```bash
   git clone git@github.com:noahtrr/ford-ev-api.git
   cd ford-ev-api
   sudo bash deploy/setup.sh
   ```
   Das Skript installiert Docker, schaltet die Firewall ein (nur SSH, HTTP, HTTPS) und fragt nach Ford Client ID und Secret sowie einem Passwort für die Weboberfläche. Ohne eigene Domain nimmst du einfach die vorgeschlagene Adresse `DEINE-IP.sslip.io`.
5. **Ford-Portal:** die Redirect URI, die das Skript am Ende anzeigt (`https://…/callback`), bei deiner Ford-App eintragen.
6. Adresse im Browser öffnen, mit Benutzername/Passwort anmelden, dann „Mit Ford verbinden“.
7. Optional: im Menü unter **Profil** einen Passkey hinzufügen. Danach meldest du dich per Fingerabdruck, Gesicht oder Geräte-PIN an.

**Automatisch aktualisieren:** Nach einer einmaligen Einrichtung ([deploy/AUTO-DEPLOY.md](deploy/AUTO-DEPLOY.md)) baut und testet GitHub Actions bei jedem Push auf `main` das Docker-Image und spielt es selbst auf dem Server ein.

**Login und Passkeys:** Benutzername und Passwort aus `deploy/setup.sh` stehen in `deploy/caddy.env` (`LOGIN_USER`, `LOGIN_HASH`). Im Profil kannst du das Passwort ändern, Passkeys hinzufügen und andere Geräte abmelden. Das Passwort bleibt immer gültig, auch mit Passkey. Passwort aus dem Profil vergessen? Dann gilt nach diesem Befehl wieder das aus der Einrichtung:
`sudo docker compose -f deploy/docker-compose.yml exec app node backend/dist/reset-password.js`

Neuen Stand von Hand einspielen: `cd ~/ford-ev-api && sudo bash deploy/update.sh`
Logs ansehen: `sudo docker compose -f deploy/docker-compose.yml logs -f`

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
| `GET /api/odometer?period=day` | Kilometerstand nach Tagen (`week`, `month`, `year`) |
| `GET /api/odometer/year?year=2026` | Jahresübersicht mit 12 Monaten |
| `GET /api/odometer/year/export?year=2026&format=csv` | Jahresübersicht als Datei (`csv`, `txt`, `xlsx`) |
| `GET /api/health` | Lebenszeichen für Docker/Monitoring |
