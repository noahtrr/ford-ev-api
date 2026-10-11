#!/usr/bin/env bash
# Richtet einen frischen Ubuntu/Debian-Server für die Ford-App ein:
# Docker installieren, Firewall einschalten, Einstellungen abfragen, App starten.
#
# Aufruf auf dem Server im Repo-Ordner:  sudo bash deploy/setup.sh
# Mehrfach ausführen ist ok, vorhandene Einstellungen werden nur auf Nachfrage ersetzt.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo starten: sudo bash deploy/setup.sh" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
REPO_DIR=$(pwd)

echo "== 1/5 Pakete aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl git ufw unattended-upgrades

echo "== 2/5 Docker installieren"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version

echo "== 3/5 Firewall: nur SSH, HTTP und HTTPS erlauben"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== 4/5 Einstellungen"
ask() { # ask "Frage" Standardwert -> Antwort
  local answer
  read -r -p "$1${2:+ [$2]}: " answer
  echo "${answer:-$2}"
}

write_settings=yes
if [[ -f .env && -f deploy/caddy.env ]]; then
  [[ $(ask "Einstellungen gibt es schon. Neu eingeben? (j/n)" n) == j ]] || write_settings=no
fi

if [[ $write_settings == yes ]]; then
  public_ip=$(curl -4fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  echo "Ohne eigene Domain nimm einfach den Vorschlag (funktioniert über sslip.io)."
  domain=$(ask "Adresse der App" "${public_ip}.sslip.io")
  client_id=$(ask "Ford Client ID" "")
  read -r -s -p "Ford Client Secret (wird nicht angezeigt): " client_secret; echo
  login_user=$(ask "Benutzername für die Weboberfläche" "noah")
  while true; do
    read -r -s -p "Passwort für die Weboberfläche: " login_pw; echo
    read -r -s -p "Passwort wiederholen: " login_pw2; echo
    [[ -n $login_pw && $login_pw == "$login_pw2" ]] && break
    echo "Passwörter leer oder verschieden, bitte nochmal."
  done

  login_hash=$(docker run --rm caddy:2 caddy hash-password --plaintext "$login_pw")

  umask 077
  cat > .env <<ENV
FORD_CLIENT_ID=${client_id}
FORD_CLIENT_SECRET=${client_secret}
FORD_REDIRECT_URI=https://${domain}/callback
POLL_INTERVAL_MINUTES=5
ENV
  # Einfache Anführungszeichen, damit die $-Zeichen im Hash nicht ersetzt werden.
  cat > deploy/caddy.env <<ENV
DOMAIN=${domain}
LOGIN_USER=${login_user}
LOGIN_HASH='${login_hash}'
ENV
  umask 022
fi

echo "== 5/5 App bauen und starten (dauert beim ersten Mal ein paar Minuten)"
docker compose -f deploy/docker-compose.yml up -d --build

domain=$(sed -n 's/^DOMAIN=//p' deploy/caddy.env)
cat <<DONE

Fertig! Die App läuft unter:  https://${domain}

Noch zu tun im Ford-Entwicklerportal: als Redirect URI eintragen
  https://${domain}/callback
Danach die Adresse öffnen, mit Benutzername/Passwort anmelden und
auf „Mit Ford anmelden“ klicken.

Später aktualisieren:  cd ${REPO_DIR} && sudo bash deploy/update.sh
Logs ansehen:          cd ${REPO_DIR} && sudo docker compose -f deploy/docker-compose.yml logs -f
DONE
