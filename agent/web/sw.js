// Snug service worker: network-first (always fresh when online), cached app shell as offline fallback.
const CACHE = "snug-v7";
const SHELL = ["./", "index.html", "styles.css", "logo.svg", "icon-192.png", "js/common.js", "js/fit.js",
               "js/measure_core.js", "js/measure.js", "js/app.js", "js/auth.js", "vendor/html5-qrcode.min.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith("/app/") || u.pathname.includes("/vendor/mediapipe/")) return;  // never cache API/agent calls
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
