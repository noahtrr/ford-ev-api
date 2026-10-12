// Service Worker: macht die App installierbar und startet sie schneller.
//
// Gespeichert wird nur die Hülle der App (HTML, JavaScript, CSS, Bilder), nie Daten vom Auto.
// Alles unter /api, der Ford-Login und Swagger gehen immer direkt an den Server,
// damit Login und Sitzungs-Cookie genauso funktionieren wie im Browser.
const CACHE = "mein-ford-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Alte Caches von früheren Versionen wegräumen.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Die Startseite: immer zuerst frisch vom Server (neue Version nach einem Deploy),
  // ohne Netz die zuletzt gespeicherte.
  if (req.mode === "navigate") {
    if (url.pathname !== "/" && url.pathname !== "/index.html") return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // JavaScript und CSS von Vite: der Dateiname ändert sich bei jeder neuen Version,
  // darum darf einmal Geladenes für immer aus dem Speicher kommen.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
  // Alles andere (API, Login, Bilder vom Auto) läuft ganz normal über das Netz.
});
