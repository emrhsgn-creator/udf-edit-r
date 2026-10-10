/* Masaüstü UYAP editörünün yazı tiplerine ölçüce birebir uyan açık yazı tipleri.
   Android'de Times New Roman / Arial yok; yerine geçen yazı tipi daha geniş
   olduğu için satırlar farklı yerden kırılır, sayfalar kayar. Tinos (Times New
   Roman) ve Arimo (Arial) aynı harf genişliklerine sahip (SIL OFL 1.1).
   Cihazda asıl yazı tipi varsa (Windows, iOS) o kullanılır: local() önce gelir. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";

const AILELER = [
  { kaynak: "tinos", ad: "Times New Roman", yerel: {
      "400normal": ["Times New Roman", "TimesNewRomanPSMT"], "700normal": ["Times New Roman Bold", "TimesNewRomanPS-BoldMT"],
      "400italic": ["Times New Roman Italic", "TimesNewRomanPS-ItalicMT"], "700italic": ["Times New Roman Bold Italic", "TimesNewRomanPS-BoldItalicMT"] } },
  { kaynak: "arimo", ad: "Arial", yerel: {
      "400normal": ["Arial", "ArialMT"], "700normal": ["Arial Bold", "Arial-BoldMT"],
      "400italic": ["Arial Italic", "Arial-ItalicMT"], "700italic": ["Arial Bold Italic", "Arial-BoldItalicMT"] } }
];
const BICIMLER = [["400", "normal"], ["700", "normal"], ["400", "italic"], ["700", "italic"]];
const ALTKUMELER = ["latin", "latin-ext"];

export function yaziTipleriniHazirla() {
  mkdirSync("www/fonts", { recursive: true });
  let css = "/* Otomatik üretilir: src/yazi-tipleri.mjs */\n";
  for (const a of AILELER) {
    const kok = `node_modules/@fontsource/${a.kaynak}`;
    for (const alt of ALTKUMELER) {
      // Alt kümenin kapsadığı karakterler (her dosya yalnızca kendi aralığından sorumlu)
      const aralik = JSON.parse(readFileSync(`${kok}/unicode.json`, "utf8"))[alt];
      for (const [kalinlik, bicim] of BICIMLER) {
        const dosya = `${a.kaynak}-${alt}-${kalinlik}-${bicim}.woff2`;
        copyFileSync(`${kok}/files/${dosya}`, `www/fonts/${dosya}`);
        const yerel = a.yerel[kalinlik + bicim].map(n => `local("${n}")`).join(",");
        css += `@font-face{font-family:"${a.ad}";font-style:${bicim};font-weight:${kalinlik};font-display:swap;` +
               `src:${yerel},url(${dosya}) format("woff2");${aralik ? `unicode-range:${aralik};` : ""}}\n`;
      }
    }
    copyFileSync(`${kok}/LICENSE`, `www/fonts/${a.kaynak}-LICENSE.txt`);
  }
  writeFileSync("www/fonts/fonts.css", css);
}
