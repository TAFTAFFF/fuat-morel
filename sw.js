/* FUAT MOREL — sw.js (service worker)
   Amaç: ana ekrana eklenen oyun çevrimdışı da açılsın, ama arkadaşlara güncellemeler HEMEN gelsin.
   - HTML / JS / CSS / manifest: AĞ-ÖNCELİKLİ (çevrimiçiyken her zaman en yeni dosya; gelen yanıt önbelleğe yazılır),
     ağ yoksa ya da çok yavaşsa önbellekteki son sürüm.
   - Görseller / ikonlar: önbellek-öncelikli (arka planda tazelenir).
   - Google Fonts: CSS önbellekten hemen + arka planda tazeleme; font dosyaları önbellek-öncelikli.
   - Çok oyunculu bağlantı (wss://) service worker'dan geçmez; etkilenmez.
   VERSION değişince eski önbellekler silinir. Oyun dosyası eklenirse PRECACHE'e de ekleyin (eklenmese de ilk açılışta önbelleğe girer). */
'use strict';
const VERSION = 'fm-2026-10-16-tur5m';
const CACHE = 'fuatmorel-' + VERSION;
const FONT_CACHE = 'fuatmorel-fonts-v1';
const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/core.js', 'js/gfx.js', 'js/net.js', 'js/level.js', 'js/game.js', 'js/meta.js', 'js/netgame.js', 'js/audio.js',
  'js/render-world.js', 'js/render-chars.js', 'js/render-fx.js', 'js/render-hud.js', 'js/ui.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-64.png'
];
const NET_TIMEOUT = 7000;     // ağ bu kadar sürede yanıt vermezse (ve önbellekte varsa) önbellekten aç
// index.html'deki Google Fonts adresiyle AYNI olmalı (ilk kurulumda font dosyaları da önbelleğe alınır → çevrimdışı aynı görünüm)
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Lilita+One&display=swap';

async function precacheFonts() {
  try {
    const fc = await caches.open(FONT_CACHE);
    const r = await fetch(FONT_CSS);
    if (!r || !r.ok) return;
    const css = await r.clone().text();
    await fc.put(FONT_CSS, r);
    const urls = Array.from(new Set((css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || []))).slice(0, 40);
    await Promise.all(urls.map(u => fetch(u).then(x => { if (x && x.ok) return fc.put(u, x); }).catch(() => { })));
  } catch (e) { }
}

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // tek tek: bir dosya eksik/hatalı olsa da kurulum başarısız olmasın
    await Promise.all(PRECACHE.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => { if (r && r.ok) return c.put(u, r); }).catch(() => { })));
    await precacheFonts();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf('fuatmorel-') === 0 && k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k)));
    try { if (self.registration.navigationPreload) await self.registration.navigationPreload.disable(); } catch (e) { }
    await self.clients.claim();
  })());
});

function isFresh(url, req) {
  if (req.mode === 'navigate' || req.destination === 'document') return true;
  return /\.(html|js|css|webmanifest|json)$/i.test(url.pathname) || url.pathname.endsWith('/');
}

async function networkFirst(req, url) {
  const c = await caches.open(CACHE);
  const nav = req.mode === 'navigate';
  // sorgu dizgisi (?oda=KOD) önbellek anahtarına girmez
  const key = nav ? new Request(url.origin + url.pathname) : req;
  const net = fetch(req, { cache: 'no-cache' }).then(r => {
    if (r && r.ok && r.type === 'basic') c.put(key, r.clone()).catch(() => { });
    return r;
  });
  const cached = () => c.match(key, { ignoreSearch: true }).then(m => m || (nav ? c.match('index.html').then(x => x || c.match('./')) : null));
  try {
    const timeout = new Promise(res => setTimeout(() => res(null), NET_TIMEOUT));
    const first = await Promise.race([net.catch(() => null), timeout]);
    if (first) return first;
    const m = await cached();
    if (m) return m;
    return await net;           // önbellekte de yok: ağı beklemeye devam
  } catch (e) {
    const m = await cached();
    if (m) return m;
    return new Response('<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fuat Morel</title>' +
      '<body style="background:#1a0a2e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">' +
      '<div><h2>İnternet bağlantısı yok</h2><p>Bağlantı gelince sayfayı yenile.</p></div>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const m = await c.match(req, { ignoreVary: true });
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => { }); return r; });
  if (m) { net.catch(() => { }); return m; }
  return net;
}

async function staleWhileRevalidate(req, cacheName) {
  const c = await caches.open(cacheName);
  const m = await c.match(req, { ignoreVary: true });
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => { }); return r; });
  if (m) { net.catch(() => { }); return m; }
  return net;
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.hostname === 'fonts.googleapis.com') { ev.respondWith(staleWhileRevalidate(req, FONT_CACHE)); return; }
  if (url.hostname === 'fonts.gstatic.com') { ev.respondWith(cacheFirst(req, FONT_CACHE)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (isFresh(url, req)) { ev.respondWith(networkFirst(req, url)); return; }
  ev.respondWith(cacheFirst(req, CACHE));
});

/* Bildirime dokunma (arkadaş çevrimiçi oldu / lobi kurdu): açık oyun penceresini öne getir; kapalıysa oyunu aç.
   Bildirimde oda kodu varsa (data.code): açık pencereye 'fm-join' mesajı gider (sayfa yenilenmez), kapalıysa ?oda=KOD ile açılır. */
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const data = ev.notification.data || {};
  const code = String(data.code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  ev.waitUntil((async () => {
    const scope = self.registration.scope;
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url && c.url.indexOf(scope) === 0) {
        try { await c.focus(); } catch (e) { }
        if (code) { try { c.postMessage({ type: 'fm-join', code }); } catch (e) { } }
        return;
      }
    }
    try { await self.clients.openWindow(scope + (code ? '?oda=' + code : '')); } catch (e) { }
  })());
});
