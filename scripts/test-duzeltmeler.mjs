/* Gerçek kullanımda ortaya çıkan hataların sınaması:
   - Belgeyi değiştir → Kaydet → İmzala: imzalanan dosya SON hâli içermeli
     (kaydetmeden önceki içerik imzalanıyordu).
   - Paragrafa sarılmamış metin (tarayıcı bazen doğrudan kâğıda yazar) dosyaya
     girmeli; eskiden "Belge eksik kaydedilecekti" ile kaydetme durduruluyordu.
   - Android Geri tuşu: ilk basışta uyarı, ikincide çıkış — ama "değişti" bayrağı
     sıfırlanmamalı; sıfırlanınca Kaydet imzalı eski dosyayı yazıyordu. */
import { JSDOM } from "jsdom";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";

let fail = 0;
const ok = (c, n) => { console.log((c ? "  ✓ " : "  ✗ ") + n); if (!c) fail++; };
const bekle = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "udfduz-"));
const ssl = (...a) => execFileSync("openssl", a, { stdio: ["ignore", "pipe", "pipe"] });

try {
  ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "30",
      "-subj", "/C=TR/CN=DENEME AVUKAT/title=AVUKAT/serialNumber=00000000000",
      "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"));
  ssl("x509", "-in", join(dir, "c.pem"), "-outform", "DER", "-out", join(dir, "c.der"));
  const sertDer = new Uint8Array(readFileSync(join(dir, "c.der")));
  const kart = async veri => new Uint8Array(execFileSync("openssl",
    ["pkeyutl", "-sign", "-inkey", join(dir, "k.pem"), "-pkeyopt", "rsa_padding_mode:pkcs1"], { input: Buffer.from(veri) }));

  const html = readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
  const kopru = readFileSync(new URL("../www/native-bridge.js", import.meta.url), "utf8");
  const ornek = readFileSync(new URL("./ornek-dilekce.udf", import.meta.url));

  function ortam(yerel) {
    let geriDinleyici = null, cikti = 0;
    const dom = new JSDOM(html, {
      runScripts: "dangerously", pretendToBeVisual: true, url: "https://udf.deneme/",
      beforeParse(w) {
        Object.defineProperty(w, "crypto", { value: webcrypto });
        w.setImmediate = (f, ...a) => setTimeout(() => f(...a), 0);
        w.document.execCommand = () => true;
        w.document.queryCommandState = () => false;
        w.print = () => {};
        w.URL.createObjectURL = () => "blob:x";
        w.URL.revokeObjectURL = () => {};
        w.confirm = () => true;
        if (yerel) w.Capacitor = {
          isNativePlatform: () => true,
          Plugins: {
            Dosya: { addListener() {}, farkliKaydet: async () => ({ uri: "content://x/1" }) },
            App: { addListener(olay, f) { if (olay === "backButton") geriDinleyici = f; }, exitApp() { cikti++; } }
          }
        };
      }
    });
    if (yerel) { const s = dom.window.document.createElement("script"); s.textContent = kopru; dom.window.document.body.appendChild(s); }
    return { dom, w: dom.window, geri: () => geriDinleyici && geriDinleyici(), cikis: () => cikti };
  }

  /* ---- 1) değiştir → kaydet → imzala ---- */
  {
    const { w } = ortam(false);
    await bekle(500);
    w.localStorage.setItem("imzaKaynak", "pc");
    w.localStorage.setItem("imzaKoprusu", JSON.stringify({ adres: "deneme", kod: "KOD" }));
    const b64 = u => Buffer.from(u).toString("base64");
    w.imzaKaynaklari.pc.sertifikalar = async () => [{ id: "1", der: b64(sertDer) }];
    w.imzaKaynaklari.pc.imzala = async (id, pin, veri) => kart(veri);

    await w.openFile(new w.File([ornek], "ornek-dilekce.udf"));
    const sheet = w.document.getElementById("sheet");
    const metin = [...sheet.querySelectorAll("p")].flatMap(p => [...p.childNodes]).find(n => n.nodeType === 3 && n.nodeValue.trim());
    metin.nodeValue = metin.nodeValue + " EKLENEN-SATIR";
    w.touch();
    ok(w.doc.dirty, "değişiklik algılandı");
    await w.saveUdf();
    ok(!w.doc.dirty, "kaydedildi");

    w.imzalaPenceresi();
    for (let i = 0; i < 40 && w.document.getElementById("iOk").disabled; i++) await bekle(50);
    ok(!w.document.getElementById("iOk").disabled, "sertifika listelendi");
    w.document.getElementById("iPin").value = "0000";
    w.document.getElementById("iOk").click();
    for (let i = 0; i < 100 && !w.doc.imza; i++) await bekle(50);
    ok(!!w.doc.imza, "belge imzalandı");
    if (w.doc.imza) {
      const xml = await (await JSZip.loadAsync(w.doc.imza.zip)).file("content.xml").async("string");
      ok(xml.includes("EKLENEN-SATIR"), "imzalanan dosya kaydedilen son hâli içeriyor");
    }
  }

  /* ---- 2) paragrafa sarılmamış metin ---- */
  {
    const { w } = ortam(false);
    await bekle(500);
    await w.openFile(new w.File([ornek], "ornek-dilekce.udf"));
    const d = w.document, sheet = d.getElementById("sheet");
    sheet.appendChild(d.createTextNode("Kağıda doğrudan "));
    const b = d.createElement("b"); b.textContent = "yazılan"; sheet.appendChild(b);
    sheet.appendChild(d.createTextNode(" metin"));
    w.touch();
    const r = await w.udfUret();
    ok(r.ok, "serbest metinle kaydetme durdurulmuyor");
    const t = r.xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1];
    ok(t.includes("Kağıda doğrudan yazılan metin\n"), "serbest metin tek paragraf olarak yazıldı");
    ok(/<content bold="true"[^>]*\/>/.test(r.xml), "serbest metindeki kalın biçim korundu");
  }

  /* ---- 3) Android Geri tuşu ---- */
  {
    const { w, geri, cikis } = ortam(true);
    await bekle(500);
    await w.openFile(new w.File([ornek], "ornek-dilekce.udf"));
    w.touch();
    geri();
    ok(w.doc.dirty && cikis() === 0, "ilk Geri: uyarı, değişiklik bayrağı duruyor, çıkılmadı");
    geri();
    ok(cikis() === 1, "ikinci Geri: çıkıldı");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fail) { console.error(`\n${fail} sınama başarısız.`); process.exit(1); }
console.log("Düzeltme sınamaları geçti.");
