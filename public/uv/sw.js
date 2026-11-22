importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts(self.__uv$config.sw || "/uv/uv.sw.js");

const uv = new UVServiceWorker();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function handle(event) {
  if (typeof uv.route === "function" && !uv.route(event)) {
    return fetch(event.request);
  }
  return uv.fetch(event);
}

self.addEventListener("fetch", (event) => {
  event.respondWith(handle(event));
});
