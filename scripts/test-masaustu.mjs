/* Masaüstü UYAP Doküman Editörü (v5.4.20) ile birebirlik sınaması.
   scripts/masaustu/ altındaki dosyalar masaüstü editörde oluşturulup kaydedildi
   (kişisel veri içermez):
   - bos.udf          "Yeni" ile açılıp kaydedilmiş boş belge
   - yerel1.udf       elle yazılmış: alt/üst simge, üstü çizili, üç paragraf
   - yerel2.udf       sayfa sonu ve madde listesi
   - yerel3-masaustu.xml  yerel1 masaüstünde açılıp 1. paragraf ortalanmış,
                      tümü kalın yapılmış ve kaydedilmiş hali
   Beklenen: değiştirmeden kaydedince content.xml bayt bayt aynı; aynı
   düzenleme yapılınca masaüstünün ürettiğiyle bayt bayt aynı. */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";

let fail = 0;
const ok = (c, n) => { console.log((c ? "  ✓ " : "  ✗ ") + n); if (!c) fail++; };
const yol = f => new URL("./masaustu/" + f, import.meta.url);

const html = readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    Object.defineProperty(w, "crypto", { value: webcrypto });
    w.setImmediate = (f, ...a) => setTimeout(() => f(...a), 0);
    w.document.execCommand = () => true;
    w.document.queryCommandState = () => false;
    w.print = () => {};
    w.URL.createObjectURL = () => "blob:x";
  }
});
await new Promise(r => setTimeout(r, 500));
const w = dom.window;

const ac = async ad => {
  const b = readFileSync(yol(ad));
  await w.openFile(new w.File([new w.Uint8Array(b)], ad));
  return await (await JSZip.loadAsync(b)).file("content.xml").async("string");
};

for (const ad of ["bos.udf", "yerel1.udf", "yerel2.udf"]) {
  const asil = await ac(ad);
  ok(!!w.doc.udfHam, `${ad}: masaüstü okuyucusuyla açıldı`);
  const r = await w.udfUret();
  ok(r.ok, `${ad}: kaydetme doğrulaması geçti`);
  ok(r.xml === asil, `${ad}: değiştirmeden kaydet → content.xml bayt bayt aynı`);
}

// Masaüstündeki düzenlemenin aynısı
await ac("yerel1.udf");
const d = w.document, sheet = d.getElementById("sheet");
sheet.querySelector("p").style.textAlign = "center";
for (const p of sheet.querySelectorAll("p")) {
  if (!p.textContent) continue;
  const b = d.createElement("b");
  while (p.firstChild) b.appendChild(p.firstChild);
  p.appendChild(b);
}
w.touch();
const r = await w.udfUret();
const beklenen = readFileSync(yol("yerel3-masaustu.xml"), "utf8");
ok(r.xml === beklenen, "ortala + tümü kalın: masaüstünün ürettiğiyle bayt bayt aynı");
if (r.xml !== beklenen) {
  let i = 0; while (r.xml[i] === beklenen[i]) i++;
  console.log("    ilk fark:", JSON.stringify(r.xml.slice(i - 40, i + 60)), "\n    beklenen:", JSON.stringify(beklenen.slice(i - 40, i + 60)));
}

// Yeni belge: masaüstünün "Yeni" belgesiyle aynı çerçeve ve kenar boşlukları
d.getElementById("bNew").click();
const yeni = (await w.udfUret()).xml;
const bos = await (await JSZip.loadAsync(readFileSync(yol("bos.udf")))).file("content.xml").async("string");
ok(yeni === bos, "yeni boş belge: masaüstünün boş belgesiyle bayt bayt aynı");

// Biçim ayrıntıları
sheet.innerHTML = '<p style="margin-left:28.35pt;line-height:1.5;margin-top:6pt">a<s>b</s><sub>c</sub><sup>d</sup> <span style="color:#C00000">e</span></p><p><br></p>';
w.touch();
const x = (await w.udfUret()).xml;
ok(/<paragraph LeftIndent="28\.35" LineSpacing="0\.5" SpaceAbove="6\.0">/.test(x), "paragraf değerleri Java biçiminde (28.35, 0.5, 6.0)");
ok(/<content strikethrough="true" startOffset/.test(x) && /<content subscript="true"/.test(x) && /<content superscript="true"/.test(x),
   "üstü çizili / alt simge / üst simge masaüstü adlarıyla");
ok(/<space startOffset="\d+" length="1" \/>/.test(x), "yalnızca boşluktan oluşan parça <space>");
ok(/foreground="-4194304"/.test(x), "renk masaüstü gibi işaretli tamsayı");
ok(!/​/.test(x), "görünmez karakter (U+200B) yazılmıyor");
ok(/<paragraph><content startOffset="\d+" length="1" \/><\/paragraph>/.test(x), "boş paragraf tek satır sonu");

if (fail) { console.log(`\n${fail} sınama başarısız.`); process.exit(1); }
console.log("\nMasaüstü birebirlik sınaması geçti.");
