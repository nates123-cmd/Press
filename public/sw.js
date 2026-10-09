/* Press service worker. Cache-first for the app shell, network for everything
 * else (Supabase, fonts, hotlinked images). Bump VERSION on every ship: the
 * launch right after a deploy still shows the old shell, the next one the new. */
const VERSION = 'press-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Hashed Vite assets are immutable: cache forever. The shell: cache, refresh in the background.
  const isAsset = url.pathname.includes('/assets/')
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetching = fetch(e.request).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()))
        return res
      }).catch(() => hit)
      return hit && isAsset ? hit : hit || fetching
    }),
  )
})
