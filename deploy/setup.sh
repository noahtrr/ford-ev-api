#!/usr/bin/env bash
# Richtet einen frischen Ubuntu/Debian-Server für die Ford-App ein:
# Docker installieren, Firewall einschalten, Einstellungen abfragen, App starten.
#
# Aufruf auf dem Server im Repo-Ordner:  sudo bash deploy/setup.sh
# Mehrfach ausführen ist ok, vorhandene Einstellungen werden nur auf Nachfrage ersetzt.
# Am Ende kann es auf Wunsch auch die automatischen Updates über GitHub vorbereiten.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo starten: sudo bash deploy/setup.sh" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
REPO_DIR=$(pwd)
# Der normale Benutzer (z. B. ubuntu), der das Skript mit sudo gestartet hat.
OWNER=${SUDO_USER:-root}

echo "== 1/6 Pakete aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl git ufw unattended-upgrades

echo "== 2/6 Docker installieren"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version
# Der normale Benutzer darf Docker ohne sudo nutzen (braucht der automatische Deploy).
[[ $OWNER != root ]] && usermod -aG docker "$OWNER"

echo "== 3/6 Firewall: nur SSH, HTTP und HTTPS erlauben"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== 4/6 Einstellungen"
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
  login_user=$(ask "Benutzername für die Weboberfläche" "admin")
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
  # Dem normalen Benutzer geben, damit der automatische Deploy (deploy/deploy.sh) sie lesen kann.
  chown "$OWNER": .env deploy/caddy.env
fi

echo "== 5/6 App bauen und starten (dauert beim ersten Mal ein paar Minuten)"
docker compose -f deploy/docker-compose.yml up -d --build

domain=$(sed -n 's/^DOMAIN=//p' deploy/caddy.env)

echo "== 6/6 Automatische Updates über GitHub (optional, geht auch später)"
if [[ $OWNER != root && $(ask "Jetzt einrichten? (j/n)" n) == j ]]; then
  home=$(getent passwd "$OWNER" | cut -d: -f6)
  keydir=$(mktemp -d)
  ssh-keygen -q -t ed25519 -N "" -C github-actions -f "$keydir/key"
  # Dieser Schlüssel darf auf dem Server nur deploy/deploy.sh starten, sonst nichts.
  install -d -m 700 -o "$OWNER" -g "$OWNER" "$home/.ssh"
  echo "command=\"$REPO_DIR/deploy/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat "$keydir/key.pub")" >>"$home/.ssh/authorized_keys"
  chown "$OWNER": "$home/.ssh/authorized_keys"
  chmod 600 "$home/.ssh/authorized_keys"
  cat <<SECRETS

Trage auf GitHub unter Repo → Settings → Secrets and variables → Actions
diese vier Secrets ein ("New repository secret"). Schicke sie niemandem.

  DEPLOY_HOST      ${domain}
  DEPLOY_USER      ${OWNER}
  DEPLOY_HOST_KEY  $(awk '{print $1" "$2}' /etc/ssh/ssh_host_ed25519_key.pub)
  DEPLOY_SSH_KEY   der ganze Block hier drunter, mit den Zeilen BEGIN und END:

$(cat "$keydir/key")

SECRETS
  # Der private Schlüssel liegt danach nur noch bei GitHub.
  rm -rf "$keydir"
  read -r -p "Kopiert und bei GitHub eingetragen? Dann Enter drücken. " _
fi

cat <<DONE

Fertig! Die App läuft unter:  https://${domain}

Noch zu tun im Ford-Entwicklerportal: als Redirect URI eintragen
  https://${domain}/callback
Danach die Adresse öffnen, mit Benutzername/Passwort anmelden und
auf „Mit Ford verbinden“ klicken. Unter Profil kannst du einen Passkey hinzufügen.

Später von Hand aktualisieren:  cd ${REPO_DIR} && sudo bash deploy/update.sh
Logs ansehen:                   cd ${REPO_DIR} && sudo docker compose -f deploy/docker-compose.yml logs -f
DONE
