/* Codec'i TARAYICI ortamını taklit ederek sınar.
   Buffer'ı bilerek siliyoruz: paketleme sırasında dolgu yanlış sıraya girerse
   kaydetme "nodebuffer is not supported by this platform" hatasıyla ölüyor ve
   bu yalnızca gerçek cihazda ortaya çıkıyordu. Bu test onu derlemede yakalar. */
delete globalThis.Buffer;
globalThis.window = globalThis;

await import("../src/udf.browser.js");

const src =
  `<p style="text-align:center"><span style="font-size:14pt;color:#003366"><strong>BAŞLIK</strong></span></p>` +
  `<p style="text-align:justify;line-height:1.5;text-indent:24pt">Normal, <strong>kalın</strong>, <em>eğik</em>, <u>altı çizili</u>, <span style="background-color:#FFFF00">vurgulu</span>.</p>` +
  `<p style="margin-left:36pt;text-indent:-36pt">DAVACI<tab/>: Mehmet Yılmaz</p>` +
  `<ul><li>Madde bir</li></ul><ol><li>Birinci</li></ol><page-break/>` +
  `<table><tr><td colspan="2" style="background-color:#EEEEEE"><p><strong>Kalem</strong></p></td></tr>` +
  `<tr><td style="border-style:none"><p>A</p></td><td><p>B</p></td></tr></table>`;

let fail = 0;
const ok = (cond, name) => { console.log((cond ? "  ✓ " : "  ✗ ") + name); if (!cond) fail++; };

const blob = await window.UDF.toUdf(src);
const ab = await blob.arrayBuffer();
const back = await window.UDF.toHtml(ab);

const s = new Uint8Array(ab);
ok(s[0] === 0x50 && s[1] === 0x4b && s[2] === 3 && s[3] === 4, "geçerli ZIP arşivi");

const checks = {
  "hizalama": /text-align:center/,
  "yazı rengi": /#003366/,
  "vurgu rengi": /background-color:#ffff00/i,
  "asılı girinti": /text-indent:-36pt/,
  "sekme": /<tab\/>/,
  "madde listesi": /<ul>/,
  "numaralı liste": /<ol>/,
  "sayfa sonu": /<page-break\/>/,
  "tablo colspan": /colspan="2"/,
  "hücre arka rengi": /#eeeeee/i,
  "satır aralığı": /line-height:1\.5/,
  "Türkçe karakterler": /Mehmet Yılmaz/
};
for (const [name, rx] of Object.entries(checks)) ok(rx.test(back), name);
ok(!/border:0\.5px/.test(back.match(/<td style="padding[^>]*>/)?.[0] || "x"), "kenarlıksız hücre");

if (fail) { console.error(`\n${fail} sınama başarısız.`); process.exit(1); }
console.log("\nTüm sınamalar geçti.");
