/* E-imza sınaması. Gerçek kart yerine OpenSSL ile üretilen geçici bir RSA
   sertifikası kullanılır; CMS yapısı karttan bağımsız olduğu için aynı yol sınanır.
   - üretilen sign.sgn OpenSSL "cms -verify" ile doğrulanıyor mu
   - imzalı belge editörde açılınca tanınıyor mu, imza geçerli görünüyor mu
   - değiştirmeden kaydedince dosya bayt bayt aynı mı (imza korunuyor)
   - değiştirince imza kaldırılıp düz UDF mi yazılıyor */
import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";

let fail = 0;
const ok = (c, n) => { console.log((c ? "  ✓ " : "  ✗ ") + n); if (!c) fail++; };
const dir = mkdtempSync(join(tmpdir(), "udfimza-"));
const ssl = (...a) => execFileSync("openssl", a, { stdio: ["ignore", "pipe", "pipe"] });

try {
  ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "30",
      "-subj", "/C=TR/CN=DENEME AVUKAT/title=AVUKAT/serialNumber=00000000000",
      "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"));
  ssl("x509", "-in", join(dir, "c.pem"), "-outform", "DER", "-out", join(dir, "c.der"));
  const sertDer = new Uint8Array(readFileSync(join(dir, "c.der")));

  const html = readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, "crypto", { value: webcrypto });
      w.setImmediate = (f, ...a) => setTimeout(() => f(...a), 0);   // JSZip jsdom'da bunsuz asılı kalıyor
      w.document.execCommand = () => true;
      w.document.queryCommandState = () => false;
      w.print = () => {};
      w.URL.createObjectURL = () => "blob:x";
    }
  });
  await new Promise(r => setTimeout(r, 500));
  const w = dom.window;
  ok(typeof w.Imza?.cadesOlustur === "function", "imza çekirdeği yüklendi");
  ok(!!w.document.getElementById("bSign"), "Dosya sekmesinde İmzala düğmesi var");

  // "Kart": DigestInfo'yu PKCS#1 v1.5 ile imzalar (CKM_RSA_PKCS eşdeğeri)
  const kart = async veri => {
    const pem = execFileSync("openssl", ["pkeyutl", "-sign", "-inkey", join(dir, "k.pem"),
      "-pkeyopt", "rsa_padding_mode:pkcs1"], { input: Buffer.from(veri) });
    return new Uint8Array(pem);
  };

  const ornek = readFileSync(new URL("./ornek-dilekce.udf", import.meta.url));
  const xml = await (await JSZip.loadAsync(ornek)).file("content.xml").async("uint8array");
  const sgn = await w.Imza.cadesOlustur(xml, sertDer, kart);
  writeFileSync(join(dir, "content.xml"), xml);
  writeFileSync(join(dir, "sign.sgn"), sgn);
  let dogru = true;
  try {
    ssl("cms", "-verify", "-binary", "-inform", "DER", "-in", join(dir, "sign.sgn"),
        "-content", join(dir, "content.xml"), "-CAfile", join(dir, "c.pem"), "-purpose", "any", "-out", join(dir, "o"));
  } catch (e) { dogru = false; console.log(String(e.stderr)); }
  ok(dogru, "OpenSSL cms -verify sign.sgn'yi doğruluyor");
  const yapi = String(ssl("cms", "-cmsout", "-print", "-noout", "-inform", "DER", "-in", join(dir, "sign.sgn")));
  ok(/eContent: <ABSENT>/.test(yapi), "ayrık imza (content.xml gömülü değil)");
  ok(["contentType", "signingTime", "messageDigest", "signingCertificateV2"].every(a => yapi.includes(a)),
     "CAdES-BES öznitelikleri tam");

  const z = new JSZip(); z.file("content.xml", xml); z.file("sign.sgn", sgn);
  const imzali = await z.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  // Editörde aç
  // openFile'ın yaptığı: içeriği yükle, sonra imzayı tanı. (Codec'in toHtml'i
  // jsdom'da asılı kaldığı için içerik burada doğrudan yükleniyor.)
  const ac = async (bytes, ad) => { w.load('<p>deneme</p>', ad); await w.imzaYukle(new w.Uint8Array(bytes).buffer); };
  await ac(imzali, "imzali.udf");
  const d = w.doc;
  ok(!!d.imza, "imzalı belge tanındı");
  ok(d.imza?.bilgi[0]?.imzaGecerli === true, "imza geçerli görünüyor");
  ok(d.imza?.bilgi[0]?.belgeDegismemis === true, "belge değişmemiş görünüyor");
  ok(d.imza?.bilgi[0]?.sertifika.ad === "DENEME AVUKAT", "imzacı adı okunuyor");
  const st = w.document.getElementById("stImza");
  ok(!st.hidden && st.textContent === "İmzalı", "durum çubuğunda 'İmzalı'");

  let r = await w.kaydedilecek();
  const ayni = new Uint8Array(await r.blob.arrayBuffer());
  ok(Buffer.compare(Buffer.from(ayni), Buffer.from(imzali)) === 0, "değiştirmeden kaydet: dosya bayt bayt aynı, imza korunuyor");

  // Değiştir → imza kalkmalı
  w.touch();
  ok(st.textContent === "İmza kalkacak", "değişiklikten sonra 'İmza kalkacak' uyarısı");
  r = await w.kaydedilecek();
  const yeni = await JSZip.loadAsync(await r.blob.arrayBuffer());
  ok(!yeni.file("sign.sgn") && !!yeni.file("content.xml"), "değişmiş belge imzasız kaydediliyor");

  // Bozuk imza: content.xml'de bir bayt değişsin
  const bozukXml = xml.slice(); bozukXml[bozukXml.length - 20] ^= 1;
  const z2 = new JSZip(); z2.file("content.xml", bozukXml); z2.file("sign.sgn", sgn);
  await ac(await z2.generateAsync({ type: "uint8array" }), "bozuk.udf");
  ok(w.doc.imza?.bilgi[0]?.belgeDegismemis === false, "sonradan değiştirilmiş belge yakalanıyor");
  ok(st.textContent === "İmza geçersiz", "durum çubuğunda 'İmza geçersiz'");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fail) { console.log(`\n${fail} sınama başarısız.`); process.exit(1); }
console.log("\nİmza sınaması geçti.");
