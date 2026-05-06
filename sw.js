const CACHE_NAME = "sunny-english-v3";
const APP_FILES = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(event.request).then((cached) => cached || fetch(event.request))),
  );
});
