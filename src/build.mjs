/* Şerit kabuğu + motor + UDF codec'ini tek dosyada birleştirir. */
import { readFileSync, writeFileSync } from "node:fs";
import { yaziTipleriniHazirla } from "./yazi-tipleri.mjs";
const shell  = readFileSync("src/shell.html","utf8");
const engine = readFileSync("src/engine.js","utf8");
const bundle = readFileSync("src/udf.browser.js","utf8");
const jszip  = readFileSync("node_modules/jszip/dist/jszip.min.js","utf8");
const imza   = readFileSync("src/imza.js","utf8");
const udf    = readFileSync("src/udf.js","utf8");
const imzaUI = readFileSync("src/imza-arayuz.js","utf8");
const serit  = readFileSync("src/serit.js","utf8");
if(!shell.includes("__UDF_BUNDLE__")||!shell.includes("__ENGINE__"))
  { console.error("HATA: kabukta yer tutucu yok"); process.exit(1); }
const out = shell.replace("__UDF_BUNDLE__",()=>bundle).replace("__JSZIP__",()=>jszip)
  .replace("__IMZA__",()=>imza).replace("__ENGINE__",()=>engine).replace("__UDF__",()=>udf).replace("__IMZA_ARAYUZ__",()=>imzaUI).replace("__SERIT__",()=>serit);
writeFileSync("www/index.html",out);
yaziTipleriniHazirla();
console.log("www/index.html yazıldı:", (out.length/1024|0)+" KB");
