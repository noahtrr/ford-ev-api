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
2. Eine App anlegen und als Redirect URI die Adresse eintragen, unter der die App läuft, mit `/callback` dahinter: `http://localhost:8080/callback` am eigenen Rechner, `https://deine-domain/callback` auf einem Server.
3. Client ID und Client Secret notieren. Ford braucht manchmal Minuten bis Stunden, bis eine neue App oder Redirect URI funktioniert (vorher kommt nach dem FordPass-Login ein Fehler 403).

## Auf einem Server betreiben (empfohlen)

Im Ordner `deploy/` liegt alles für einen Server im Internet. Davor sitzt [Caddy](https://caddyserver.com) und holt automatisch ein HTTPS-Zertifikat. Die App selbst fragt nach Benutzername und Passwort (oder einem Passkey), damit niemand Fremdes Standort und Akkustand deines Autos sieht.

1. **Server:** einen kleinen VPS mit **Ubuntu 24.04** besorgen (z. B. OVH VPS-1). Den Zugang (IP, Benutzer, Passwort) bekommst du per E-Mail.
2. **Einloggen und Setup starten** (Windows: PowerShell):
   ```bash
   ssh ubuntu@DEINE-IP
   git clone https://github.com/noahtrr/ford-ev-api.git
   cd ford-ev-api
   sudo bash deploy/setup.sh
   ```
   Ist das Repo privat, klappt `git clone` nur mit einem Deploy-Key (GitHub: Repo → Settings → Deploy keys, ohne „write access“) und der Adresse `git@github.com:noahtrr/ford-ev-api.git`.

   Das Skript installiert Docker, schaltet die Firewall ein (nur SSH, HTTP, HTTPS), fragt nach Ford Client ID und Secret, einem Benutzernamen und Passwort für die Weboberfläche und startet die App. Ohne eigene Domain nimmst du einfach die vorgeschlagene Adresse `DEINE-IP.sslip.io`. Am Ende kann es auch gleich die automatischen Updates über GitHub vorbereiten (siehe unten).
3. **Ford-Portal:** die Redirect URI, die das Skript am Ende anzeigt (`https://…/callback`), bei deiner Ford-App eintragen.
4. Adresse im Browser öffnen, anmelden, dann „Mit Ford verbinden“. Optional im Menü unter **Profil** einen Passkey hinzufügen.

**Automatische Updates:** Wenn du im Setup „j“ gewählt und die vier Secrets bei GitHub eingetragen hast, baut und testet GitHub Actions bei jedem Push auf `main` das Docker-Image und spielt es selbst auf dem Server ein. Details und Fehlersuche: [deploy/AUTO-DEPLOY.md](deploy/AUTO-DEPLOY.md).

**Von Hand aktualisieren:** `cd ~/ford-ev-api && sudo bash deploy/update.sh`
**Logs ansehen:** `sudo docker compose -f deploy/docker-compose.yml logs -f`

**Login und Passkeys:** Benutzername und Passwort aus dem Setup stehen in `deploy/caddy.env` (`LOGIN_USER`, `LOGIN_HASH`). Im Profil kannst du das Passwort ändern, Passkeys hinzufügen und andere Geräte abmelden. Das Passwort bleibt immer gültig, auch mit Passkey. Passwort aus dem Profil vergessen? Dann gilt nach diesem Befehl wieder das aus der Einrichtung:
`sudo docker compose -f deploy/docker-compose.yml exec app node backend/dist/reset-password.js`

## Am eigenen Rechner mit Docker

```bash
cp .env.example .env   # Client ID und Secret sowie LOGIN_USER und LOGIN_HASH eintragen
docker compose up -d --build
```

Danach <http://localhost:8080> öffnen, anmelden und auf „Mit Ford verbinden“ klicken. Die Datenbank liegt im Docker-Volume `ford-data` und bleibt bei Neustarts erhalten.

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

Alle Endpunkte mit Beschreibung zeigt die App selbst unter `/api/docs` (Swagger, nur angemeldet).

## Erkenntnisse und Stolperfallen

Was wir beim Bauen gelernt haben, damit du es nicht nochmal herausfinden musst.

**Ford-API**

- Die FordConnect Query API ist **nur lesend**. Sperren, Klima oder Laden starten geht damit nicht.
- Ford erlaubt etwa **eine Anfrage pro Minute**, sonst kommt Fehler 429. Die App verteilt ihre Abfragen deshalb mit Abstand (Telemetrie alle 5 Minuten, Abfahrtszeiten und Fahrzeugdaten alle 30 Minuten).
- Das Auto schickt nur neue Daten, wenn es **wach** ist (fahren, laden). Im Stand bleiben die Werte gleich.
- Das Access-Token gilt etwa 20 Minuten, das Refresh-Token etwa 90 Tage. Danach musst du einmal neu „Mit Ford verbinden“.
- Welche Werte kommen, hängt vom Modell ab. Bei unserem Auto kommen Türen, Fenster, Haube, Zündung, Kilometerstand, Standort, Akkustand, Reichweite, Ladestatus und Stecker. Es kommen **keine** Abfahrtszeiten (`/electric/departure-times` antwortet mit 403, obwohl im Portal alle Rechte an sind), keine 12-V-Batterie, kein Alarm und keine Energie in kWh.
- Ford liefert über die API **kein Fahrzeugbild**. Die App zeigt ein Foto nur, wenn `/garage` einen Bild-Link enthält, sonst eine Zeichnung.
- Die Redirect URI muss **exakt** (mit `https://` und `/callback`) im Ford-Portal und in `FORD_REDIRECT_URI` stehen. Eine neue oder geänderte URI braucht bei Ford etwas Zeit, bis sie gilt.
- Maßgeblich für Pfade und Login ist Fords Postman-Sammlung `FordConnect-2.0.postman_collection.json`.

**Server und Domain**

- Den App-Port 8080 **nie** direkt ins Internet stellen, immer Caddy davor (so ist es in `deploy/docker-compose.yml`). Die App glaubt die mitgeschickte IP-Adresse nur Absendern aus dem internen Netz.
- Domain bei Cloudflare: den DNS-Eintrag auf **„DNS only“ (graue Wolke)** stellen, sonst bekommt Caddy kein Let's-Encrypt-Zertifikat.
- Passkeys gehören immer zu genau einer Adresse (`DOMAIN` in `deploy/caddy.env`). Nach einem Domainwechsel musst du sie im Profil neu anlegen, das Passwort geht weiter.
- Nach jeder Änderung am `deploy/Caddyfile` das Label `ford.caddyfile-version` in `deploy/docker-compose.yml` hochzählen, sonst läuft beim automatischen Deploy das alte Caddyfile weiter.

**Sicherheit**

- Zugangsdaten stehen nur in `.env` und `deploy/caddy.env`. Beide sind in `.gitignore` und dürfen nie committet werden.
- Passwörter speichert die App nur als Hash, Sitzungs-Cookies nur als Hash. Nach 5 falschen Passwörtern ist der Login für diese IP 15 Minuten gesperrt.
- Adressen zu Ladeorten und zum aktuellen Standort schlägt die App bei OpenStreetMap nach, dabei gehen die Koordinaten an Nominatim. Abschalten mit `REVERSE_GEOCODING=off` in `.env`.
- Die E-Mail-Adresse in Git-Commits ist öffentlich sichtbar. Wer das nicht will, stellt bei GitHub unter Settings → Emails „Keep my email address private“ ein.
