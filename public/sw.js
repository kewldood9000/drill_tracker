const CACHE = "drill-tracker-v1";
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(["/", "/manifest.webmanifest"]))));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => { if (event.request.method !== "GET") return; event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); return response; }).catch(()=>caches.match("/")))); });
