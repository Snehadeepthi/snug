// Snug service worker. It no longer stores any copy of the app: on activation it deletes every cache
// the earlier versions made, and it never intercepts requests, so phones always load the latest deploy.
// (It stays registered only so Snug can still be installed as an app.)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
