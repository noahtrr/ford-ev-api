// Notfall: Passwort aus dem Profil vergessen und kein Passkey zur Hand.
// Löscht das im Profil geänderte Passwort, danach gilt wieder LOGIN_HASH aus deploy/caddy.env.
// Auf dem Server: sudo docker compose -f deploy/docker-compose.yml exec app node backend/dist/reset-password.js
import { loadConfigDataDir } from "./config.js";
import { Store } from "./db.js";

const store = new Store(loadConfigDataDir());
store.setPasswordHash(null);
console.log("Erledigt: Es gilt wieder das Passwort aus der Server-Einrichtung (LOGIN_HASH in deploy/caddy.env).");
