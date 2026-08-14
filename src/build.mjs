/* Şerit kabuğu + motor + UDF codec'ini tek dosyada birleştirir. */
import { readFileSync, writeFileSync } from "node:fs";
const shell  = readFileSync("src/shell.html","utf8");
const engine = readFileSync("src/engine.js","utf8");
const bundle = readFileSync("src/udf.browser.js","utf8");
if(!shell.includes("__UDF_BUNDLE__")||!shell.includes("__ENGINE__"))
  { console.error("HATA: kabukta yer tutucu yok"); process.exit(1); }
const out = shell.replace("__UDF_BUNDLE__",()=>bundle).replace("__ENGINE__",()=>engine);
writeFileSync("www/index.html",out);
console.log("www/index.html yazıldı:", (out.length/1024|0)+" KB");
