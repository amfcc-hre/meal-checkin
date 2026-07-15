/* Offline shell cache for the online-synchronised Meal Check-In app. */
var CACHE = "meal-checkin-supabase-v1";
var ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icon.png"
];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){
      if(k !== CACHE) return caches.delete(k);
    }));
  }));
  self.clients.claim();
});

self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);

  // Do not intercept Supabase, CDN, or any other cross-origin requests.
  if(url.origin !== self.location.origin) return;

  // Network-first for app updates and navigation, then cached fallback.
  if(e.request.mode === "navigate" || /\/(index\.html|app\.js|config\.js)$/.test(url.pathname)){
    e.respondWith(
      fetch(e.request).then(function(resp){
        var copy = resp.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        return resp;
      }).catch(function(){ return caches.match(e.request); })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function(r){ return r || fetch(e.request); })
  );
});
