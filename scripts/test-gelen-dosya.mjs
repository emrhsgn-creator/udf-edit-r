/* Android'de Birlikte aç / Paylaş ile gelen dosyanın yolu: DosyaPlugin olayını
   taklit eder, www/native-bridge.js'in belgeyi açmasını ve Kaydet'in hangi dosyaya
   yazacağını sınar. Burası bozulursa kullanıcının dosyasının üzerine başka belge
   yazılabilir; o yüzden "açılamadı" yolları da denenir. */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const html = readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
const kopru = readFileSync(new URL("../www/native-bridge.js", import.meta.url), "utf8");
const ornek = readFileSync(new URL("./ornek-dilekce.udf", import.meta.url));
let fail = 0;
const ok = (c, n) => { console.log((c ? "  ✓ " : "  ✗ ") + n); if (!c) fail++; };
const bekle = ms => new Promise(r => setTimeout(r, ms));

const b64 = b => Buffer.from(b).toString("base64");
const dosyalar = {
  "content://saglayici/document/msf%3A1": { ad: "2024.01.15 dilekçe.UDF", veri: b64(ornek) },
  "content://saglayici/document/msf%3A2": { ad: "ikinci.udf", veri: b64(ornek) },
  "content://saglayici/document/msf%3A3": { ad: "msf:3", veri: b64(ornek) },
  "content://saglayici/document/msf%3A4": { ad: null, veri: b64(ornek) },
  "content://saglayici/document/arsiv": { ad: "arsiv.zip", veri: b64(Buffer.from("UDF değil")) },
};
let dinleyici = null, onay = true, sorulan = 0;

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    Object.defineProperty(w, "crypto", { value: webcrypto });
    w.setImmediate = (f, ...a) => setTimeout(() => f(...a), 0);   // JSZip jsdom'da bunsuz asılı kalıyor
    w.document.execCommand = () => true;
    w.document.queryCommandState = () => false;
    w.print = () => {};
    w.URL.createObjectURL = () => "blob:x";
    w.confirm = () => { sorulan++; return onay; };
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Dosya: {
          addListener(olay, f) { if (olay === "dosyaGeldi") dinleyici = f; },
          async oku({ uri }) {
            if (!dosyalar[uri]) throw new Error("Dosya çok büyük.");
            return dosyalar[uri];
          },
        },
      },
    };
  }
});
const w = dom.window, d = w.document;
await bekle(500);
// jsdom <script src> yüklemez; kabuktaki sırayla, motordan sonra çalıştırılır.
w.eval(kopru);

const gelsin = uri => dinleyici({ uri });
const ad = () => w.doc.name;
const uyari = () => d.getElementById("notice").classList.contains("show") ? d.getElementById("notice").textContent : "";

ok(typeof dinleyici === "function", "köprü dosyaGeldi olayını dinliyor");

// --- 1. Adres dosya adını taşımıyor: ad sağlayıcıdan gelir ---------------
await gelsin("content://saglayici/document/msf%3A1");
ok(w.doc.loaded && ad() === "2024.01.15 dilekçe.UDF", "belge sağlayıcının verdiği adla açılıyor (noktalı, büyük harfli)");
ok(w.doc.kaynakUri === "content://saglayici/document/msf%3A1", "Kaydet aynı dosyayı hedefliyor");
const metin = d.getElementById("sheet").textContent;
ok(metin.length > 0, "belgenin metni editörde");
ok(!!w.doc.udfHam, "masaüstü okuyucusu kullanıldı");

// --- 2. UDF olmayan dosya: açık belgeye ve Kaydet hedefine dokunmaz -------
await gelsin("content://saglayici/document/arsiv");
ok(/Dosya açılamadı/.test(uyari()), "UDF olmayan dosyada uyarı veriliyor");
ok(ad() === "2024.01.15 dilekçe.UDF" && d.getElementById("sheet").textContent === metin, "açık belge değişmedi");
ok(w.doc.kaynakUri === "content://saglayici/document/msf%3A1", "Kaydet açılamayan dosyanın üzerine yazmıyor");
ok(!!w.doc.udfHam, "açık belgenin ham biçimi korunuyor");

// --- 3. Okunamayan dosya -------------------------------------------------
await gelsin("content://saglayici/document/yok");
ok(/Dosya okunamadı/.test(uyari()) && /çok büyük/.test(uyari()), "okunamayan dosyada sebep gösteriliyor");
ok(ad() === "2024.01.15 dilekçe.UDF", "okunamayan dosya açık belgeye dokunmuyor");

// --- 4. Kaydedilmemiş değişiklik ------------------------------------------
w.setDirty(true); sorulan = 0; onay = false;
await gelsin("content://saglayici/document/msf%3A2");
ok(sorulan === 1, "kaydedilmemiş değişiklik varken soruyor");
ok(ad() === "2024.01.15 dilekçe.UDF" && w.doc.dirty, "vazgeçilince belge ve değişiklik yerinde");
onay = true;
await gelsin("content://saglayici/document/msf%3A2");
ok(ad() === "ikinci.udf" && !w.doc.dirty, "onaylanınca yeni dosya açılıyor");
ok(w.doc.kaynakUri === "content://saglayici/document/msf%3A2", "Kaydet artık yeni dosyayı hedefliyor");

// --- 5. Aynı dosya yeniden gelebilir --------------------------------------
await gelsin("content://saglayici/document/msf%3A2");
ok(ad() === "ikinci.udf" && !uyari(), "aynı dosyaya yeniden dokunmak hata vermiyor");

// --- 6. Uygulama içinden Aç: önceki dosyanın adresi devralınmaz ------------
const secici = d.getElementById("fUdf");
Object.defineProperty(secici, "files", { configurable: true, value: [new w.File([new w.Uint8Array(ornek)], "secilen.udf")] });
secici.onchange({ target: secici });
await bekle(2000);
ok(ad() === "secilen.udf", "seçiciden açıldı");
ok(w.doc.kaynakUri === null, "Kaydet önceki dosyanın üzerine yazmıyor");

// --- 7. Ad sağlayıcıdan gelmezse -------------------------------------------
await gelsin("content://saglayici/document/msf%3A3");
ok(ad() === "msf_3.udf", "geçersiz karakterli ad düzeltiliyor");
await gelsin("content://saglayici/document/msf%3A4");
ok(ad() === "belge.udf", "ad hiç yoksa belge.udf");

console.log(fail ? `\n${fail} sınama başarısız` : "\nGelen dosya sınamaları geçti");
process.exit(fail ? 1 : 0);
