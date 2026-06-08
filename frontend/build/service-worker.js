/* Minimal service worker for PWA installability + offline shell */
const CACHE = "sw-workplace-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/favicon.ico"];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    // Never cache /api/* — always go to network
    if (url.pathname.startsWith("/api/")) return;
    if (event.request.method !== "GET") return;
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const networkFetch = fetch(event.request)
                .then((res) => {
                    if (res && res.status === 200 && res.type === "basic") {
                        const copy = res.clone();
                        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
