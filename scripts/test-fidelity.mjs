/* Gerçek bir UYAP dilekçesiyle sadakat sınaması.
   Belgeyi editörden geçirip orijinaliyle karşılaştırır: metin, karakter
   bazında biçim, paragraf öznitelikleri ve sayfa düzeni. Buradaki hatalar
   sessiz veri kaybı demek olduğu için sınama zinciri bunda duruyor. */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import JSZip from "jszip";

const ORNEK = new URL("./ornek/dilekce.udf", import.meta.url);
if (!existsSync(ORNEK)) {
  console.log("  -- örnek belge yok, sadakat sınaması atlandı");
  process.exit(0);
}

delete globalThis.Buffer;
globalThis.window = globalThis;
await import("../src/udf.browser.js");
const CODEC = globalThis.UDF;

let fail = 0;
const ok = (c, n) => { console.log((c ? "  ✓ " : "  ✗ ") + n); if (!c) fail++; };

const buf = readFileSync(ORNEK);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const xml0 = await (await JSZip.loadAsync(ab)).file("content.xml").async("string");

const dom = new JSDOM(readFileSync(new URL("../www/index.html", import.meta.url), "utf8"), {
  runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    w.document.execCommand = () => true;
    w.document.queryCommandState = () => false;
    w.print = () => {};
    w.URL.createObjectURL = () => "blob:x";
  }
});
await new Promise(r => setTimeout(r, 600));
const w = dom.window;

// Açma akışı: sayfa düzeni arşivden okunur, içerik codec'ten gelir
const sf = await CODEC.sayfaOku(ab);
ok(sf !== null, "sayfa düzeni okunabiliyor");
Object.assign(w.doc.page, {
  ml: sf.leftMargin, mr: sf.rightMargin, mt: sf.topMargin,
  mb: sf.bottomMargin, orient: sf.paperOrientation
});
w.doc.sayfaHam = sf;
w.load(w.udfHtmlToEditor(await CODEC.toHtml(ab)), "d.udf");

const xml1 = await (await JSZip.loadAsync(
  await (await CODEC.toUdf(w.editorToUdfHtml(), w.sayfaNesnesi())).arrayBuffer()
)).file("content.xml").async("string");

/* --- metin ve karakter bazında biçim --- */
const harita = x => {
  const cd = x.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1];
  const el = x.slice(x.indexOf("<elements"));
  const m = [];
  for (const p of el.matchAll(/<content ([^>]*)\/>/g)) {
    const o = Object.fromEntries([...p[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    const key = (o.bold === "true" ? "B" : "-") + (o.italic === "true" ? "I" : "-") +
                (o.underline === "true" ? "U" : "-") + o.size + o.family;
    for (let i = 0; i < +o.length; i++) m[+o.startOffset + i] = key;
  }
  return { cd, m };
};
const A = harita(xml0), B = harita(xml1);
const norm = t => t.replace(/\s+/g, "");
ok(norm(A.cd) === norm(B.cd), `metin birebir (${norm(A.cd).length} karakter)`);
ok((A.cd.match(/\t/g) || []).length === (B.cd.match(/\t/g) || []).length,
   "sekme sayısı korunuyor: " + (B.cd.match(/\t/g) || []).length);

let biçimFark = 0;
const n = Math.min(A.m.length, B.m.length);
for (let i = 0; i < n; i++) if (A.m[i] !== B.m[i]) biçimFark++;
ok(biçimFark === 0, `biçim karakter bazında eşleşiyor (${n} karakter, ${biçimFark} fark)`);

/* --- paragraf öznitelikleri --- */
const paras = x => [...x.slice(x.indexOf("<elements")).matchAll(/<paragraph ([^>]*)>/g)]
  .map(m => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]])));
const PA = paras(xml0), PB = paras(xml1);
ok(PA.length === PB.length, `paragraf sayısı: ${PA.length} -> ${PB.length}`);
const hiza = L => L.map(p => p.Alignment).join(",");
ok(hiza(PA) === hiza(PB), "her paragrafın hizalaması aynı");
const aralik = L => L.map(p => Math.round(parseFloat(p.SpaceBelow || 0)) + "/" +
                                Math.round(parseFloat(p.SpaceAbove || 0))).join(",");
ok(aralik(PA) === aralik(PB), "paragraf aralıkları aynı");

/* --- sayfa düzeni --- */
const pf = x => {
  const m = x.match(/<pageFormat\b([^>]*)/);
  const o = {};
  for (const [, k, v] of m[1].matchAll(/(\w+)="([^"]*)"/g)) o[k] = Math.round(parseFloat(v) * 100) / 100;
  return o;
};
const S0 = pf(xml0), S1 = pf(xml1);
ok(Object.keys(S0).every(k => Math.abs((S0[k] || 0) - (S1[k] || 0)) < 0.02),
   `sayfa düzeni korunuyor (kenar ${S1.leftMargin}pt)`);

if (fail) { console.error(`\n${fail} sınama başarısız.`); process.exit(1); }
console.log("\nSadakat sınaması geçti.");
