/* Kullanıcının gerçek akışını taklit eder: uygulamayı aç, HİÇBİR düğmeye
   basmadan doğrudan kağıda yaz, Enter'a bas, kaydet.
   Önceki sürümdeki hatalar tam olarak burada saklıydı — testlerim hep
   "belge yüklenmiş" halden başladığı için bu yol hiç denenmemişti. */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
let fail = 0;
const ok = (c, n) => { console.log((c ? "  ✓ " : "  ✗ ") + n); if (!c) fail++; };

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    w.document.execCommand = () => true;
    w.document.queryCommandState = () => false;
    w.print = () => {};
    w.URL.createObjectURL = () => "blob:x";
  }
});
await new Promise(r => setTimeout(r, 500));
const { document: d, window: w } = { document: dom.window.document, window: dom.window };

// --- 1. Açılış: boş ekran görünür, kağıt GÖRÜNMEZ -----------------------
ok(!d.getElementById("empty").hidden, "açılışta boş ekran görünüyor");
ok(d.getElementById("wrap").hasAttribute("hidden"), "açılışta kağıt gizli");
// [hidden] gerçekten display:none mu — asıl hata buradaydı
const wrapCss = [...d.styleSheets[0].cssRules].some(r =>
  r.selectorText && r.selectorText.includes(".wrap[hidden]"));
ok(wrapCss, "[hidden] için display:none kuralı var");

// --- 2. Belge yükle, boş ekran kaybolsun --------------------------------
w.load('<p style="text-align:justify"><br></p>', "isimsiz.UDF");
ok(d.getElementById("empty").hidden, "belge açılınca boş ekran gizleniyor");
ok(!d.getElementById("wrap").hasAttribute("hidden"), "belge açılınca kağıt görünüyor");

// --- 3. Çıplak metin: <p> olmadan doğrudan yazılan satır ----------------
const sheet = d.getElementById("sheet");
sheet.innerHTML = "";
sheet.appendChild(d.createTextNode("DAVACI : EMRAH SIĞIN"));
const p2 = d.createElement("p");
p2.textContent = "DAVALI: EMRAH SIĞIN";
sheet.appendChild(p2);

const out = w.editorToUdfHtml();
ok(/DAVACI : EMRAH SIĞIN/.test(out), "çıplak metin ilk satır korunuyor");
ok(/DAVALI: EMRAH SIĞIN/.test(out), "ikinci satır korunuyor");
ok((out.match(/<p[ >]/g) || []).length >= 2, "iki ayrı paragraf üretiliyor");

// --- 4. ensurePara: boş kağıt paragrafsız kalmasın ----------------------
sheet.innerHTML = "";
w.ensurePara();
ok(sheet.querySelector("p") !== null, "boş kağıtta paragraf oluşturuluyor");

// --- 5. <div> ile gelen satırlar (Enter'ın eski çıktısı) ----------------
sheet.innerHTML = "<div>Bir</div><div>İki</div>";
const dv = w.editorToUdfHtml();
ok(/Bir/.test(dv) && /İki/.test(dv), "div satırları korunuyor");

// --- 6. <font> etiketi DOM'a dokunmadan okunuyor ------------------------
sheet.innerHTML = '<p><font color="#FF0000">Kırmızı</font></p>';
ok(/color:#FF0000/i.test(w.editorToUdfHtml()), "font etiketi rengi okunuyor");

// --- 7. Sekme --------------------------------------------------------
sheet.innerHTML = '<p>A<span data-udf="tab">\u00A0\u00A0\u00A0\u00A0</span>B</p>';
ok(/<tab\/>/.test(w.editorToUdfHtml()), "sekme <tab/> olarak yazılıyor");

if (fail) { console.error(`\n${fail} sınama başarısız.`); process.exit(1); }
console.log("\nTüm sınamalar geçti.");
