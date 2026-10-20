// 앱 화면 파일을 캐시해 오프라인/느린 네트워크에서도 열리게 합니다.
// 날씨 API는 항상 네트워크에서 가져오고, 실패하면 앱이 저장해 둔 마지막 날씨를 보여줍니다.
const CACHE = "gbgolf-v1";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "courses.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 네트워크 우선, 실패 시 캐시 (골프장 목록·그린피 수정이 바로 반영되도록)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
