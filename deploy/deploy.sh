#!/usr/bin/env bash
# Automatischer Deploy, aufgerufen von GitHub Actions per SSH (siehe deploy/AUTO-DEPLOY.md).
# Liest von stdin zwei Zeilen: GitHub-Benutzer und ein kurzlebiges Token für ghcr.io.
# Holt den neuesten Stand (Compose-Datei, Caddyfile) und das neue Image und startet neu.
#
# Alles steckt in main(), damit bash das ganze Skript liest, bevor "git pull" es ändert.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."

  local gh_user gh_token
  read -r gh_user
  read -r gh_token

  echo "== Neuesten Stand aus GitHub holen"
  git pull --ff-only

  # Anmeldung nur in einem Wegwerf-Ordner, damit das Token nicht auf dem Server bleibt.
  docker_config=$(mktemp -d)
  trap 'rm -rf "$docker_config"' EXIT
  export DOCKER_CONFIG=$docker_config

  echo "== Neues Image laden"
  printf '%s' "$gh_token" | docker login ghcr.io -u "$gh_user" --password-stdin >/dev/null
  docker compose -f deploy/docker-compose.yml pull app caddy
  docker logout ghcr.io >/dev/null

  echo "== App neu starten"
  docker compose -f deploy/docker-compose.yml up -d --no-build --remove-orphans

  echo "== Warten, bis die App gesund ist"
  local container status
  container=$(docker compose -f deploy/docker-compose.yml ps -q app)
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$container")
    if [[ $status == healthy ]]; then
      docker image prune -f >/dev/null
      echo "Fertig, die neue Version läuft."
      return 0
    fi
    sleep 2
  done

  echo "Die App wurde nicht gesund (Status: $status). Letzte Logs:" >&2
  docker compose -f deploy/docker-compose.yml logs --tail 50 app >&2
  return 1
}

main "$@"
