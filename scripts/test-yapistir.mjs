/* Yapıştırma: başka bir UDF'den kopyalanan biçimli metin, motorun anladığı
   ögelere indirgenip biçimini koruyor mu?

   Bu sınama gerçek bir hatadan doğdu: yapıştırma text/plain'e indiriliyordu,
   bu yüzden başka bir UDF'den kopyalanan her şey düz metne dönüyordu. */
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
const { window: w } = dom;
const temizle = w.yapistirTemizle;

ok(typeof temizle === "function", "temizleyici dışa açık");

// --- biçim korunuyor mu ------------------------------------------------
const t1 = temizle('<p style="text-align:center"><strong>BAŞLIK</strong></p>');
ok(/<strong>/i.test(t1), "kalın korunuyor");
ok(/text-align:\s*center/i.test(t1), "hizalama korunuyor");
ok(/BAŞLIK/.test(t1), "Türkçe harfler korunuyor");

const t2 = temizle('<p style="line-height:1.5;text-indent:24pt;margin-left:36pt">A</p>');
["line-height","text-indent","margin-left"].forEach(k =>
  ok(t2.includes(k), `paragraf özelliği korunuyor: ${k}`));

const t3 = temizle('<span style="font-size:14pt;color:#003366;background-color:#FFFF00">x</span>');
["font-size","color","background-color"].forEach(k =>
  ok(t3.includes(k), `karakter özelliği korunuyor: ${k}`));

const t4 = temizle('<table><tr><td colspan="2"><p>A</p></td></tr></table>');
ok(/<table>/i.test(t4) && /colspan="2"/i.test(t4), "tablo ve colspan korunuyor");

// --- çöp atılıyor mu ---------------------------------------------------
const c1 = temizle('<p class="MsoNormal" id="x" style="mso-fareast-font:x;text-align:left">M</p>');
ok(!/class=|id=|mso-/i.test(c1), "sınıf, kimlik ve mso- artıkları atılıyor");
ok(/text-align/i.test(c1), "atarken geçerli stil korunuyor");

ok(!/script/i.test(temizle('<p>A<script>alert(1)<\/script></p>')), "script siliniyor");
ok(temizle('<p>A<o:p></o:p>B</p>').replace(/<[^>]*>/g,"") === "AB",
   "ad alanlı ögeler içerik kaybetmeden açılıyor");

const c2 = temizle('<div><a href="http://x">bağlantı</a></div>');
ok(!/<a\b/i.test(c2) && /bağlantı/.test(c2), "bağlantı açılıyor, metni kalıyor");

ok(!/<img/i.test(temizle('<p><img src="http://x/a.png"></p>')), "ağdaki resim atılıyor");
ok(/<img/i.test(temizle('<p><img src="data:image/png;base64,AAA"></p>')), "gömülü resim kalıyor");

/* Temizlenen içerik editöre yüklendiğinde biçim gerçekten duruyor mu?
   Codec'in kendisi test-codec ve test-fidelity'de sınanıyor; burada
   yapıştırma yolunun editöre biçimli içerik bıraktığını doğruluyoruz. */
const belge =
  '<p style="text-align:center"><strong>SULH VE İBRA PROTOKOLÜ</strong></p>' +
  '<p style="text-align:justify;line-height:1.5">Davacı <strong>EREN</strong> ' +
  've <em>vekili</em>, işbu protokolü imzalamıştır.</p>' +
  '<table><tr><td><p>Taraf</p></td><td><p><strong>Tutar</strong></p></td></tr></table>';

w.load(w.udfHtmlToEditor(temizle(belge)), "yeni.UDF");
const kagit = w.document.getElementById("sheet").innerHTML;

ok(/<strong>/i.test(kagit), "yapıştırılan kalın editörde duruyor");
ok(/<em>/i.test(kagit), "yapıştırılan eğik editörde duruyor");
ok(/text-align/i.test(kagit), "yapıştırılan hizalama editörde duruyor");
ok(/<table/i.test(kagit), "yapıştırılan tablo editörde duruyor");
ok(/İBRA/.test(kagit) && /imzalamıştır/.test(kagit), "Türkçe harfler editörde duruyor");
ok(!kagit.includes("?"), "soru işaretine dönen harf yok");

console.log(fail ? `\n${fail} sınama başarısız.` : "\nYapıştırma sınaması geçti.");
process.exit(fail ? 1 : 0);
