/* Servis çalışanı: uygulamayı çevrimdışı kullanılabilir kılar.
   Editörün tamamı (arayüz + UDF codec) tek dosyada olduğu için önbelleğe
   alınacak çok az şey var. Ağ hiç kullanılmıyor; ilk açılıştan sonra
   uçak modunda da çalışır. */
const SURUM = "udf-editor-v1";
const DOSYALAR = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x !== SURUM).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

/* Önce ağ, olmazsa önbellek: güncelleme yayınlandığında kullanıcı bir sonraki
   açılışta yenisini alır, çevrimdışıyken de uygulama açılır. */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(y => {
        const kopya = y.clone();
        caches.open(SURUM).then(c => c.put(e.request, kopya)).catch(() => {});
        return y;
      })
      .catch(() => caches.match(e.request).then(y => y || caches.match("./index.html")))
  );
});
