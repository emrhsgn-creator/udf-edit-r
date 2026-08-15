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


// --- 8. Paragraf penceresi: ayarlar gerçekten uygulanıyor mu? ----------
// Odak pencerenin kutularına geçtiğinde seçim kayboluyordu; hedef paragraflar
// artık AÇILIŞTA yakalanıyor. Test tam olarak o durumu kuruyor.
sheet.innerHTML = '<p id="hedef">Bir paragraf</p>';
const hedef = d.getElementById("hedef");
const rng = d.createRange(); rng.selectNodeContents(hedef);
const gs = w.getSelection(); gs.removeAllRanges(); gs.addRange(rng);

d.getElementById("bParaFmt").click();
ok(d.getElementById("dlg").classList.contains("on"), "Paragraf penceresi açılıyor");

// kullanıcı kutulara dokunuyor -> seçim editörden çıkıyor
d.getElementById("dLh").value = "2";
d.getElementById("dBf").value = "0,5";
d.getElementById("dMl").value = "1";
d.getElementById("dHa").value = "1";
d.querySelector('[data-al="center"]').click();
gs.removeAllRanges();                       // seçim kayboldu (asıl hata buydu)

d.getElementById("dOk").click();

ok(hedef.style.lineHeight === "2", "satır aralığı uygulandı");
ok(Math.abs(parseFloat(hedef.style.marginTop) - 14.17) < 0.2, "önce 0,5cm = 14,17pt");
ok(hedef.style.textAlign === "center", "hizalama uygulandı");
// asılı girinti: gövde sağa (1+1=2cm), ilk satır sola taşar (-1cm)
ok(Math.abs(parseFloat(hedef.style.marginLeft) - 56.69) < 0.3, "asılı girinti sol kenarı");
ok(parseFloat(hedef.style.textIndent) < 0, "asılı girinti ilk satırı sola taşıyor");
ok(!d.getElementById("dlg").classList.contains("on"), "Tamam pencereyi kapatıyor");

// --- 9. Gerçek sekme karakteri --------------------------------------
sheet.innerHTML = '<p>DAVACI\t: EMRAH</p><p>VEKİLİ\t: EMRAH</p>';
const tabOut = w.editorToUdfHtml();
ok((tabOut.match(/<tab\/>/g) || []).length === 2, "her satırda sekme yazılıyor");
ok(/DAVACI/.test(tabOut) && /VEKİLİ/.test(tabOut), "sekmeli satırlar korunuyor");
ok((tabOut.match(/EMRAH/g) || []).length === 2, "sekme sonrası metin kaybolmuyor");

// --- 10. Çok satırlı belge tam kaydediliyor mu? ----------------------
sheet.innerHTML =
  '<p style="text-align:center"><span style="font-size:24pt">BAŞLIK</span></p>' +
  '<p>DAVACI\t: A</p><p><strong><u>VEKİLİ\t: B</u></strong></p>' +
  '<p>DAVALI\t: C</p><p>VEKİLİ\t: D<br></p>';
const coklu = w.editorToUdfHtml();
ok((coklu.match(/<p[ >]/g) || []).length === 5, "beş paragrafın hepsi yazılıyor");
["BAŞLIK","A","B","C","D"].forEach(function (t) {
  ok(new RegExp(">" + t + "<|" + t + "<").test(coklu), "içerik korunuyor: " + t);
});

// --- 11. Kaydetme doğrulaması bağlı mı? -----------------------------
// (Gerçek round-trip test-codec.mjs'de; jsdom'da Blob API'si eksik.)
ok(typeof w.udfUret === "function", "kaydetme doğrulaması tanımlı");
// Boşluklar bilerek yok sayılıyor: codec onları normalleştirebiliyor.
ok(w.sadeMetin("<p>A<tab/>B</p>") === "AB", "metin karşılaştırıcı çalışıyor");

// --- 12. Boş belgede kağıt tam sayfa mı? ----------------------------
w.load('<p><br></p>', "isimsiz.UDF");
const shVar = d.documentElement.style.getPropertyValue("--sh");
ok(shVar !== "", "yazı görünümünde sayfa yüksekliği hesaplanıyor");
ok(parseInt(shVar) > 300, "boş belgede kağıt büzülmüyor: " + shVar);
const phVar = sheet.style.getPropertyValue("--ph");
ok(phVar === "841.89pt", "sayfa görünümünde A4 yüksekliği: " + phVar);
// yatay sayfada yükseklik/genişlik yer değiştirmeli
w.doc.page.orient = 0; w.applyPage();
ok(sheet.style.getPropertyValue("--ph") === "595.28pt", "yatay sayfada yükseklik dönüyor");
ok(sheet.style.getPropertyValue("--pw") === "841.89pt", "yatay sayfada genişlik dönüyor");
w.doc.page.orient = 1; w.applyPage();

if (fail) { console.error(`\n${fail} sınama başarısız.`); process.exit(1); }
console.log("\nTüm sınamalar geçti.");
