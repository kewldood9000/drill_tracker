import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const configuredBase = process.env.VITE_BASE_PATH ?? (process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : "/");
const base = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: "offline-service-worker",
      generateBundle(_, bundle) {
        const assets = [
          base,
          `${base}manifest.webmanifest`,
          `${base}icon.svg`,
          ...Object.keys(bundle).map((file) => `${base}${file}`),
        ];
        const source = `const CACHE = "drill-tracker-${Date.now()}";
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response;
    }).catch(() => caches.match(${JSON.stringify(base)})));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response;
  })));
});`;
        this.emitFile({ type: "asset", fileName: "sw.js", source });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
});
