# Automatischer Deploy einrichten

Nach dieser Einrichtung passiert bei jedem Push (oder Merge) auf `main` automatisch:

1. GitHub Actions prüft und testet den Code.
2. Das Docker-Image wird gebaut, gestartet und getestet.
3. Das Image wird zu GitHub hochgeladen (`ghcr.io/noahtrr/ford-ev-api`).
4. GitHub meldet sich per SSH beim Server, der Server lädt das neue Image und startet die App neu.

Bei Pull Requests laufen nur Schritt 1 und 2, es wird nichts deployt.

Solange die Secrets unten fehlen, wird Schritt 4 einfach übersprungen (gelbe Warnung, kein Fehler).

**Am einfachsten:** `sudo bash deploy/setup.sh` fragt am Ende „Automatische Updates über GitHub … Jetzt einrichten?“. Mit `j` erledigt es die Schritte 2, 3 und 5 und zeigt dir die vier Werte für Schritt 4. Du musst sie dann nur noch bei GitHub eintragen (Schritt 4) und ausprobieren (Schritt 6).

Die Schritte unten sind dasselbe von Hand, falls du den Server schon früher eingerichtet hast.

---

## Schritt 1: Auf dem Server einloggen

```bash
ssh ubuntu@DEINE-DOMAIN
cd ~/ford-ev-api
git pull
```

## Schritt 2: Deinem Benutzer Docker erlauben

Der automatische Deploy läuft als Benutzer `ubuntu`, nicht als root.

```bash
sudo usermod -aG docker ubuntu
sudo chown ubuntu: .env deploy/caddy.env
```

Danach **einmal ausloggen und wieder einloggen** (`exit`, dann wieder `ssh ubuntu@DEINE-DOMAIN`), damit die neue Gruppe gilt. Test: `docker ps` muss ohne `sudo` funktionieren.

## Schritt 3: Einen Schlüssel nur für GitHub anlegen

Dieser Schlüssel darf auf dem Server **nur** den Deploy starten, sonst nichts.

```bash
ssh-keygen -t ed25519 -N "" -C github-actions -f ~/github-actions-key
echo "command=\"$HOME/ford-ev-api/deploy/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat ~/github-actions-key.pub)" >> ~/.ssh/authorized_keys
```

Jetzt den **privaten** Schlüssel anzeigen und komplett kopieren (inklusive der Zeilen `-----BEGIN…` und `-----END…`):

```bash
cat ~/github-actions-key
```

Und noch den Fingerabdruck des Servers anzeigen und kopieren (eine Zeile, beginnt mit `ssh-ed25519`):

```bash
cat /etc/ssh/ssh_host_ed25519_key.pub
```

## Schritt 4: Secrets bei GitHub eintragen

Auf GitHub: **Repo → Settings → Secrets and variables → Actions → New repository secret**. Lege diese vier an:

| Name | Wert |
| --- | --- |
| `DEPLOY_HOST` | deine Domain, z. B. `ford.example.de` |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | der private Schlüssel aus Schritt 3 (der ganze Block) |
| `DEPLOY_HOST_KEY` | die `ssh-ed25519 …`-Zeile aus Schritt 3 |

Schicke diese Werte **niemandem** und füge sie nirgends sonst ein, auch nicht im Chat.

## Schritt 5: Privaten Schlüssel auf dem Server löschen

Er liegt jetzt sicher bei GitHub, auf dem Server braucht ihn niemand mehr:

```bash
rm ~/github-actions-key ~/github-actions-key.pub
```

## Schritt 6: Ausprobieren

Auf GitHub: **Actions → CI → Run workflow** (Branch `main`). Nach ein paar Minuten sollten alle drei Jobs grün sein: `check`, `docker`, `deploy`. Im Log von `deploy` steht am Ende „Fertig, die neue Version läuft.“

Ein Login bei ghcr.io auf dem Server ist **nicht** nötig: GitHub gibt dem Server bei jedem Deploy ein Token mit, das nur ein paar Minuten gilt und danach wieder gelöscht wird.

---

## Wenn etwas schiefgeht

- **`Permission denied (publickey)`:** `DEPLOY_SSH_KEY` unvollständig kopiert, oder Schritt 3 (`authorized_keys`) fehlt.
- **`Host key verification failed`:** `DEPLOY_HOST_KEY` falsch, nochmal die Zeile aus Schritt 3 eintragen.
- **`permission denied … docker.sock`:** Schritt 2 fehlt, oder du hast dich danach nicht neu eingeloggt. Hilft auch: Server einmal neu starten (`sudo reboot`).
- **App wird nicht gesund:** im Deploy-Log stehen die letzten Zeilen der App. Oft fehlt etwas in `.env`.

**Zurück auf eine ältere Version:** auf GitHub unter Actions den Lauf des alten Commits öffnen und **Re-run all jobs** klicken.

**Ohne GitHub aktualisieren** (z. B. wenn GitHub Actions gerade nicht geht) geht weiterhin: `sudo bash deploy/update.sh` baut das Image direkt auf dem Server.
