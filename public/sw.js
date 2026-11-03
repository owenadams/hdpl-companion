const SHELL_CACHE = 'hdpl-shell-v2'
const DATA_CACHE = 'hdpl-data-v2'
const APP_BASE = new URL('./', self.location.href)
const appUrl = (path) => new URL(path, APP_BASE).href
const SHELL_FILES = [appUrl('./'), appUrl('manifest.webmanifest'), appUrl('app-icon.svg'), appUrl('data/hdpl-pages.json')]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => ![SHELL_CACHE, DATA_CACHE].includes(key)).map((key) => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  const isData = new URL(request.url).pathname.endsWith('/data/hdpl-pages.json')
  const isNavigation = request.mode === 'navigate'

  event.respondWith((async () => {
    const cached = await caches.match(request)
    try {
      const response = await fetch(request)
      if (response.ok && (isData || isNavigation || ['script', 'style', 'image', 'font'].includes(request.destination))) {
        const cache = await caches.open(isData ? DATA_CACHE : SHELL_CACHE)
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      if (cached) return cached
      if (isNavigation) return (await caches.match(APP_BASE.href)) || Response.error()
      return Response.error()
    }
  })())
})