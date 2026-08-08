var CACHE_NAME = "yuanshan-workbench-v2";
var ASSETS = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// 网络优先：在线时始终拉取最新内容，离线才回退缓存。
// 这样每次部署后用户无需强刷即可看到更新，同时保留离线可用能力。
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") { return; }
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) { return; }
  e.respondWith(
    fetch(e.request).then(function (response) {
      if (response && response.status === 200) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(e.request, copy);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
