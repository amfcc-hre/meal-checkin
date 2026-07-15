/* offline cache for the Meal Check-In app */
var CACHE = "meal-checkin-v2";
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }));
  self.skipWaiting();
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ if(k !== CACHE) return caches.delete(k); }));
  }));
  self.clients.claim();
});
self.addEventListener("fetch", function(e){
  // Student list: network-first so a new term's list is picked up when online,
  // fall back to the saved copy when offline.
  if(e.request.url.indexOf("students.csv") !== -1){
    e.respondWith(
      fetch(e.request).then(function(resp){
        var copy = resp.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        return resp;
      }).catch(function(){ return caches.match(e.request); })
    );
    return;
  }
  // Everything else: cache-first (fast, works offline).
  e.respondWith(caches.match(e.request).then(function(r){ return r || fetch(e.request); }));
});
