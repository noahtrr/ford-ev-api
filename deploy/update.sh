#!/usr/bin/env bash
# Holt den neuesten Stand aus GitHub und startet die App neu.
# Aufruf auf dem Server im Repo-Ordner: sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# git als normaler Benutzer, dem der Ordner und der Deploy-Key gehören.
sudo -u "${SUDO_USER:-$(id -un)}" git pull --ff-only
docker compose -f deploy/docker-compose.yml up -d --build
docker image prune -f
echo "Fertig, die App läuft mit dem neuesten Stand."
