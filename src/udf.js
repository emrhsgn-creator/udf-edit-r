"use strict";
/* UDF okuyucu ve yazıcı — masaüstü UYAP Doküman Editörü (v5.4.20) ile birebir.

   Kurallar, masaüstü editörde oluşturulup kaydedilen belgelerden çıkarıldı:
   - Prolog: `<?xml version="1.0" encoding="UTF-8" ?> \n\n<template format_id="1.8" >\n`
   - <elements> içindeki bloklar arasında ayraç yok; açılıştan sonra ve kapanıştan
     önce birer satır sonu.
   - Parça öznitelikleri: önce biçim (family, size, bold, …), sonra startOffset,
     length. Varsayılan biçim (Times New Roman 12, siyah) yazılmaz.
   - Aynı biçimdeki komşu parçalar birleşir; paragrafın satır sonu son parçaya
     dahildir. Yalnızca boşluktan oluşan parça <space> olarak yazılır. Sekme
     karakteri metnin içinde kalır.
   - Sayılar Java'nın Float/Double.toString biçiminde (6.0, 0.5, 28.35).
   - Liste: Bulleted/Numbered, BulletType/NumberType, ListLevel="1", ListId, LeftIndent="25.0".
   - Sayfa sonu: <page-break><paragraph><content … length="1" /></paragraph></page-break>
   - Boş paragraf: tek satır sonu, length="1" (görünmez karakter yok).

   Okunan belgedeki her paragrafın ve parçanın ham öznitelikleri (sıra ve
   yazılış dahil) editörde saklanır; dokunulmayan paragraflar aynen geri yazılır.
   Masaüstünde açılıp değiştirilmeden kaydedilen bir belge, burada da değişmeden
   kaydedilince content.xml bayt bayt aynı çıkar. */
(function(){

const VARS_AILE="Times New Roman", VARS_BOYUT=12;
const PROLOG='<?xml version="1.0" encoding="UTF-8" ?> \n\n<template format_id="1.8" >\n';
/* Masaüstünde "Yeni" ile açılan belgenin değerleri (1,5 cm kenar boşlukları). */
const YENI_SAYFA=[["mediaSizeName","1"],["leftMargin","42.525000000000006"],["rightMargin","42.525000000000006"],
  ["topMargin","42.525000000000006"],["bottomMargin","42.52500000000006"],["paperOrientation","1"],
  ["headerFOffset","20.0"],["footerFOffset","20.0"]];
const YENI_SON='\n</elements>\n<styles><style name="default" description="Geçerli" family="Dialog" size="12" bold="false" italic="false" FONT_ATTRIBUTE_KEY="javax.swing.plaf.FontUIResource[family=Dialog,name=Dialog,style=plain,size=12]" foreground="-13421773" /><style name="hvl-default" family="Times New Roman" size="12" description="Gövde" /></styles>\n</template>\n';
const YENI_ELEMENTS='<elements resolver="hvl-default" >\n';

/* ---------- Java sayı biçimi ---------- */
function javaUs(t){             // "1.5e-7" → "1.5E-7", mantis en az bir ondalık
  const m=t.match(/^(-?\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
  if(!m) return t;
  return m[1]+"."+(m[2]||"0")+"E"+(+m[3]);
}
function jf(v){                 // Float.toString
  const f=Math.fround(+v);
  if(!isFinite(f)) return String(f);
  if(f===0) return "0.0";
  let s="";
  for(let p=1;p<=9;p++){ s=f.toPrecision(p); if(Math.fround(+s)===f) break }
  const a=Math.abs(f);
  if(a>=1e-3&&a<1e7){ let t=String(+s); if(!t.includes(".")) t+=".0"; return t }
  return javaUs((+s).toExponential());
}
function jd(v){                 // Double.toString
  const a=Math.abs(v);
  if(v===0) return "0.0";
  if(a>=1e-3&&a<1e7){ let t=String(v); if(!t.includes(".")) t+=".0"; return t }
  return javaUs(v.toExponential());
}
const xa=s=>String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const oz=arr=>arr.map(([k,v])=>` ${k}="${xa(v)}"`).join("");
const al=(arr,k)=>{ const x=arr&&arr.find(a=>a[0]===k); return x?x[1]:undefined };
const ham=el=>[...el.attributes].map(a=>[a.name,a.value]);
const renk=n=>{ n=(+n)>>>0; return "#"+(n&0xFFFFFF).toString(16).padStart(6,"0").toUpperCase() };
const renkInt=h=>{ const v=parseInt(h.slice(1),16); return String((0xFF000000|v)|0) };
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

/* ---------- biçim anahtarı ----------
   Editördeki görünüm ile UDF öznitelikleri aynı dilde karşılaştırılsın diye. */
function stilUdf(a){
  return {
    fam: al(a,"family")&&al(a,"family")!==VARS_AILE ? al(a,"family") : null,
    size: al(a,"size")&&+al(a,"size")!==VARS_BOYUT ? +al(a,"size") : null,
    b: al(a,"bold")==="true", i: al(a,"italic")==="true", u: al(a,"underline")==="true",
    s: al(a,"strikethrough")==="true", sub: al(a,"subscript")==="true", sup: al(a,"superscript")==="true",
    fg: al(a,"foreground")!==undefined&&renk(al(a,"foreground"))!=="#000000" ? renk(al(a,"foreground")) : null,
    bg: al(a,"background")!==undefined ? renk(al(a,"background")) : null
  };
}
function stilEditor(st){
  return {
    fam: st.fam&&st.fam!==VARS_AILE ? st.fam : null,
    size: st.size&&st.size!==VARS_BOYUT ? st.size : null,
    b:!!st.b, i:!!st.i, u:!!st.u, s:!!st.s, sub:!!st.sub, sup:!!st.sup,
    fg: st.fg&&st.fg!=="#000000" ? st.fg : null,
    bg: st.bg||null
  };
}
const anahtar=k=>JSON.stringify([k.fam,k.size,k.b,k.i,k.u,k.s,k.sub,k.sup,k.fg,k.bg]);
function yeniParcaOz(k){
  const o=[];
  if(k.fam) o.push(["family",k.fam]);
  if(k.size) o.push(["size",Number.isInteger(k.size)?String(k.size):jf(k.size)]);
  if(k.b) o.push(["bold","true"]);
  if(k.i) o.push(["italic","true"]);
  if(k.u) o.push(["underline","true"]);
  if(k.sub) o.push(["subscript","true"]);
  if(k.sup) o.push(["superscript","true"]);
  if(k.s) o.push(["strikethrough","true"]);
  if(k.fg) o.push(["foreground",renkInt(k.fg)]);
  if(k.bg) o.push(["background",renkInt(k.bg)]);
  return o;
}

/* ================= OKUMA ================= */
function sekmeDuraklari(v){
  return (v||"").split(",").map(x=>parseFloat(x)).filter(x=>!isNaN(x));
}
function paragrafCss(a){
  const s=[];
  const h={"1":"center","2":"right","3":"justify"}[al(a,"Alignment")];
  if(h) s.push("text-align:"+h);
  const pt=(k,css)=>{ const v=parseFloat(al(a,k)); if(v) s.push(css+":"+v+"pt") };
  pt("LeftIndent","margin-left"); pt("RightIndent","margin-right"); pt("FirstLineIndent","text-indent");
  pt("SpaceAbove","margin-top"); pt("SpaceBelow","margin-bottom");
  const ls=parseFloat(al(a,"LineSpacing")); if(ls) s.push("--ls:"+ls);
  return s.join(";");
}
function parcaHtml(tag,a,metin){
  if(tag==="image"){
    const d=al(a,"imageData")||"";
    const tur=d.startsWith("/9j")?"jpeg":d.startsWith("iVBOR")?"png":d.startsWith("R0lG")?"gif":"png";
    const w=parseFloat(al(a,"width"))||0, h=parseFloat(al(a,"height"))||0;
    return `<img src="data:image/${tur};base64,${d}" width="${Math.round(w)}" height="${Math.round(h)}" data-wpt="${w}" data-hpt="${h}" data-ia="${xa(JSON.stringify(a))}">`;
  }
  if(!metin) return "";
  const k=stilUdf(a), css=[];
  if(k.fam) css.push("font-family:"+k.fam);
  if(k.size) css.push("font-size:"+k.size+"pt");
  if(k.fg) css.push("color:"+k.fg);
  if(k.bg) css.push("background-color:"+k.bg);
  if(k.b) css.push("font-weight:bold");
  if(k.i) css.push("font-style:italic");
  const dec=[k.u&&"underline",k.s&&"line-through"].filter(Boolean).join(" ");
  if(dec) css.push("text-decoration:"+dec);
  // Sekme, editörde ölçülebilir ögesiyle temsil ediliyor
  let ic=metin.split("\t").map(esc).join('<span data-udf="tab">\t</span>');
  if(k.sub) ic="<sub>"+ic+"</sub>";
  if(k.sup) ic="<sup>"+ic+"</sup>";
  return css.length?`<span style="${css.join(";")}">${ic}</span>`:ic;
}
function parcalar(p,t){
  const ur=[]; let html="";
  for(const c of p.children){
    const a=ham(c), s=+al(a,"startOffset")||0, n=+al(a,"length")||0;
    const metin=t.substr(s,n);
    ur.push([c.tagName,a,metin]);
    const gor=c.tagName==="image"?"":metin.replace(/[\n​]/g,"");
    html+=parcaHtml(c.tagName,a,gor);
  }
  return {ur,html};
}
function paragrafHtml(p,t,etiket){
  const a=ham(p), {ur,html}=parcalar(p,t);
  const css=paragrafCss(a);
  const tabs=sekmeDuraklari(al(a,"TabSet"));
  return `<${etiket}${css?` style="${css}"`:""}${tabs.length?` data-tabs="${tabs.join(" ")}"`:""} data-pa="${xa(JSON.stringify(a))}" data-ur="${xa(JSON.stringify(ur))}">${html||"<br>"}</${etiket}>`;
}
function listeTuru(a){ return al(a,"Bulleted")==="true"?"ul":al(a,"Numbered")==="true"?"ol":null }
function bloklarHtml(dugum,t,ctx){
  let out="", liste=null, listeId=null;
  const kapat=()=>{ if(liste){ out+=`</${liste}>`; liste=null } };
  for(const c of dugum.children){
    const T=c.tagName;
    if(T==="paragraph"){
      const a=ham(c), lt=listeTuru(a), id=al(a,"ListId")||"";
      if(lt){
        if(liste!==lt||listeId!==id){ kapat(); out+=`<${lt} data-listid="${xa(id)}">`; liste=lt; listeId=id }
        out+=paragrafHtml(c,t,"li");
      }else{ kapat(); out+=paragrafHtml(c,t,"p") }
      continue;
    }
    kapat();
    if(T==="table") out+=tabloHtml(c,t,ctx);
    else if(T==="page-break"){
      const ic=c.querySelector("paragraph");
      const pb=ic?{pa:ham(ic),ur:parcalar(ic,t).ur}:null;
      out+=`<div data-udf="pagebreak" contenteditable="false"${pb?` data-pb="${xa(JSON.stringify(pb))}"`:""}>— Sayfa sonu —</div>`;
    }
    else ctx.diger.push(c);           // header, footer ve bilinmeyenler editörün dışında korunur
  }
  kapat();
  return out;
}
function tabloHtml(tb,t,ctx){
  let h=`<table data-ta="${xa(JSON.stringify(ham(tb)))}"><tbody>`;
  for(const r of tb.children){
    if(r.tagName!=="row") continue;
    h+=`<tr data-ra="${xa(JSON.stringify(ham(r)))}">`;
    for(const c of r.children){
      if(c.tagName!=="cell") continue;
      const a=ham(c), cs=+al(a,"colspan")||1, rs=+al(a,"rowspan")||1;
      const kenar=al(a,"border")&&al(a,"borderSpec")!=="0";
      const st=[];
      const fc=al(a,"fillColor"); if(fc&&fc!=="16777215"&&fc!=="-1") st.push("background-color:"+renk(fc));
      if(!kenar) st.push("border-style:none");
      h+=`<td${cs>1?` colspan="${cs}"`:""}${rs>1?` rowspan="${rs}"`:""}${st.length?` style="${st.join(";")}"`:""}${kenar?"":' data-nb="1"'} data-ca="${xa(JSON.stringify(a))}">${bloklarHtml(c,t,ctx)||"<p><br></p>"}</td>`;
    }
    h+="</tr>";
  }
  return h+"</tbody></table>";
}

/* content.xml → {html, ham}. ham: yazarken aynen kullanılacak çerçeve. */
function udfOku(xml){
  const m=xml.match(/<content>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/content>/);
  if(!m) throw new Error("content.xml'de metin yok");
  const t=m[1];
  const d=new DOMParser().parseFromString(xml.replace(m[0],"<content/>"),"application/xml");
  if(d.querySelector("parsererror")) throw new Error("content.xml çözümlenemedi");
  const el=d.querySelector("elements");
  if(!el) throw new Error("content.xml'de <elements> yok");
  const ctx={diger:[]};
  const html=bloklarHtml(el,t,ctx);
  // Çerçeve: elements öncesi ve sonrası ham metin
  const bas=xml.slice(0,xml.indexOf("<content"));
  const pf=d.querySelector("pageFormat");
  const elAc=xml.match(/<elements\b[^>]*>\n?/)[0];
  const ozBas=xml.indexOf("</content>")+"</content>".length;
  const ozelHam=xml.slice(ozBas,xml.indexOf(elAc));
  const kapanis=xml.slice(xml.lastIndexOf("</elements>"));
  const sonEk=(xml.slice(0,xml.lastIndexOf("</elements>")).match(/\n$/)?"\n":"");
  // Masaüstü, dosyadan okunan belgeyi kaydederken metnin sonuna paragraf
  // dışı bir satır sonu bırakıyor; varsa koru.
  let kapsam=0;
  for(const c of el.querySelectorAll("[startOffset]")) kapsam=Math.max(kapsam,(+c.getAttribute("startOffset"))+(+c.getAttribute("length")||0));
  // Üst/alt yazı ve bilinmeyen ögeler ham XML'den aynen alınır
  const hamParcalar={};
  for(const tag of new Set(ctx.diger.map(c=>c.tagName))){
    hamParcalar[tag]=xml.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>|<${tag}\\b[^>]*/>`,"g"))||[];
  }
  const sayac={};
  const ustAlt=ctx.diger.map(c=>{
    let en=Infinity, son=0;
    for(const x of [c,...c.querySelectorAll("[startOffset]")]){
      if(!x.hasAttribute("startOffset")) continue;
      const s=+x.getAttribute("startOffset"); en=Math.min(en,s); son=Math.max(son,s+(+x.getAttribute("length")||0));
    }
    if(en===Infinity){ en=0; son=0 }
    const i=sayac[c.tagName]=(sayac[c.tagName]||0)+1;
    const hamXml=(hamParcalar[c.tagName]||[])[i-1]||new XMLSerializer().serializeToString(c).replace(/ xmlns="[^"]*"/,"");
    return {tag:c.tagName,xml:hamXml,metin:t.slice(en,son),bas:en};
  });
  return {html:html||"<p><br></p>", ham:{
    bas, ozelHam, sayfa:pf?ham(pf):null, elAc, kapanis, sonEk,
    ekSatir: t.length>kapsam ? t.slice(kapsam) : "",
    // Masaüstü, açtığı belgeyi değiştirip kaydederken metnin sonuna paragraf
    // dışı bir satır sonu ekliyor (tek paragraflı boş belge hariç).
    cokParagraf: el.children.length>1,
    ustAlt
  }};
}

/* ================= YAZMA ================= */
function cssImza(el){
  const s=el.style;
  return JSON.stringify([s.textAlign||"",s.marginLeft||"",s.marginRight||"",s.textIndent||"",
    s.marginTop||"",s.marginBottom||"",s.getPropertyValue("--ls")||"",s.lineHeight||"",el.dataset.tabs||""]);
}
/* Editördeki paragrafın parçaları: [{metin, k}] ya da {img} */
function editorParcalari(el){
  const out=[]; let cur=null;
  const w=document.createTreeWalker(el,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  let n, sonStil=null;
  const ekle=(metin,k)=>{
    const a=anahtar(k);
    if(cur&&cur.a===a) cur.metin+=metin; else { cur={metin,k,a}; out.push(cur) }
  };
  while((n=w.nextNode())){
    if(n.nodeType===1){
      if(n.dataset&&n.dataset.udf==="tab"){ ekle("\t",sonStil||stilEditor(window.inlineStyleOf(n.firstChild||n,el))); continue }
      if(n.tagName==="IMG"){ out.push({img:n}); cur=null; continue }
      // Liste/tablo içinde iç içe blok varsa onu ayrı paragraf yazar; burada atla
      continue;
    }
    if(n.parentElement.closest('[data-udf="tab"]')) continue;
    let metin=n.nodeValue.replace(/\r/g,"").replace(/\n/g," ").replace(/ /g," ").replace(/​/g,"");
    if(!metin) continue;
    const k=stilEditor(window.inlineStyleOf(n,el)); sonStil=k;
    ekle(metin,k);
  }
  return out;
}
function editorImzasi(el){
  return JSON.stringify(editorParcalari(el).map(p=>p.img?["img",p.img.getAttribute("src").length]:[p.metin,p.a]));
}

function Yazici(){ this.metin=""; this.listeId=0 }
Yazici.prototype.ofsetli=function(a,s,n){
  const o=a.filter(x=>x[0]!=="startOffset"&&x[0]!=="length");
  // Ofsetlerin sırası korunur: hamda nerede idiyse orada
  const iS=a.findIndex(x=>x[0]==="startOffset");
  if(iS<0){ o.push(["startOffset",String(s)],["length",String(n)]); return o }
  const r=[];
  for(const x of a){
    if(x[0]==="startOffset") r.push(["startOffset",String(s)]);
    else if(x[0]==="length") r.push(["length",String(n)]);
    else r.push(x);
  }
  if(!a.some(x=>x[0]==="length")) r.splice(r.findIndex(x=>x[0]==="startOffset")+1,0,["length",String(n)]);
  return r;
};
Yazici.prototype.parca=function(tag,a,metin){
  const s=this.metin.length;
  this.metin+=metin;
  return `<${tag}${oz(this.ofsetli(a,s,metin.length))} />`;
};

/* Paragraf öznitelikleri: hamı koru, yalnızca görünümü değişenleri güncelle */
const PAR_SIRA=["Bulleted","Numbered","BulletType","NumberType","ListLevel","ListId","Alignment","LeftIndent","RightIndent","FirstLineIndent","LineSpacing","SpaceAbove","SpaceBelow","TabSet"];
function paragrafDegerleri(el){
  const s=el.style, pt=v=>{ const x=parseFloat(v); return isNaN(x)?0:(/px$/.test(v)?x*.75:x) };
  const lsv=parseFloat(s.getPropertyValue("--ls")), lh=parseFloat(s.lineHeight);
  return {
    Alignment: {center:"1",right:"2",justify:"3"}[s.textAlign]||"0",
    LeftIndent: pt(s.marginLeft), RightIndent: pt(s.marginRight), FirstLineIndent: pt(s.textIndent),
    SpaceAbove: pt(s.marginTop), SpaceBelow: pt(s.marginBottom),
    LineSpacing: !isNaN(lsv) ? lsv : (lh&&!isNaN(lh)&&Math.abs(lh-1.42)>1e-6 ? +(lh-1).toFixed(6) : 0),
    TabSet: el.dataset.tabs ? el.dataset.tabs.split(" ").map(v=>jf(+v)+":0:0").join(",") : ""
  };
}
function degerYaz(k,v){ return k==="Alignment"||k==="TabSet" ? String(v) : jf(v) }
function paragrafOz(el,ek){
  const pa=el.dataset.pa?JSON.parse(el.dataset.pa):null;
  const yeni=paragrafDegerleri(el);
  if(pa){
    if(el.dataset.p0===cssImza(el)) return pa;
    const eski=el.dataset.p0v?JSON.parse(el.dataset.p0v):{};
    let o=pa.slice();
    for(const k of Object.keys(yeni)){
      if(JSON.stringify(eski[k])===JSON.stringify(yeni[k])) continue;
      const v=degerYaz(k,yeni[k]), i=o.findIndex(x=>x[0]===k);
      if(i>=0) o[i]=[k,v];
      else if(!(yeni[k]===0||yeni[k]==="0"||yeni[k]==="")) o.push([k,v]);
    }
    return o;
  }
  const o=(ek||[]).slice();
  for(const k of PAR_SIRA){
    if(!(k in yeni)||o.some(x=>x[0]===k)) continue;
    const v=yeni[k];
    if(v===0||v==="0"||v==="") continue;
    o.push([k,degerYaz(k,v)]);
  }
  return o;
}

Yazici.prototype.paragraf=function(el,ek){
  const pa=paragrafOz(el,ek);
  const ur=el.dataset.ur?JSON.parse(el.dataset.ur):null;
  let ic="";
  // Dokunulmamış paragraf: parçalar aynen
  if(ur&&el.dataset.u0&&el.dataset.u0===editorImzasi(el)){
    for(const [tag,a,metin] of ur) ic+=this.parca(tag,a,metin.replace(/​/g,""));
    return `<paragraph${oz(pa)}>${ic}</paragraph>`;
  }
  // Değişmiş ya da yeni: masaüstü kurallarıyla.
  // Her parça, özgün paragrafta aynı konumdaki parçanın özniteliklerinden
  // türetilir: masaüstü de böyle yapar — eklenen biçim mevcut özniteliklerin
  // sonuna eklenir, kaldırılan silinir, dokunulmayanların sırası kalır.
  const hamlar=[]; let pos=0;
  if(ur) for(const [tag,a,m] of ur){ hamlar.push({tag,a,bas:pos,son:pos+m.length,k:stilUdf(a)}); pos+=m.length }
  const hamAt=i=>hamlar.find(h=>h.tag!=="image"&&i>=h.bas&&i<h.son)||[...hamlar].reverse().find(h=>h.tag!=="image"&&h.bas<=i)||null;
  const p=editorParcalari(el);
  const ALAN=[["fam","family"],["size","size"],["b","bold"],["i","italic"],["u","underline"],["sub","subscript"],["sup","superscript"],["s","strikethrough"],["fg","foreground"],["bg","background"]];
  const alanDeger=(f,v)=>f==="fam"?v:f==="size"?(Number.isInteger(v)?String(v):jf(v)):(f==="fg"||f==="bg")?renkInt(v):"true";
  const turet=(taban,k)=>{
    const o=taban.filter(y=>y[0]!=="startOffset"&&y[0]!=="length");
    const tk=stilUdf(taban), ekler=[];
    for(const [f,ad] of ALAN){
      if(JSON.stringify(tk[f])===JSON.stringify(k[f])) continue;
      const i=o.findIndex(y=>y[0]===ad);
      if(k[f]){ if(i>=0) o[i]=[ad,alanDeger(f,k[f])]; else ekler.push([ad,alanDeger(f,k[f])]) }
      else if(i>=0) o.splice(i,1);
    }
    return o.concat(ekler);
  };
  // Paragrafın tüm metnine aynı biçim değişikliği uygulandıysa (ör. Tümünü
  // seç → Kalın) masaüstü bunu satır sonuna da uygular.
  let q=0, ortak=null;
  for(const x of p){
    if(x.img){ q+=1; continue }
    const h=hamAt(q); x.h=h;
    const ko=h?h.k:stilEditor({}), d={};
    for(const [f] of ALAN) if(JSON.stringify(ko[f])!==JSON.stringify(x.k[f])) d[f]=x.k[f];
    if(ortak===null) ortak=d;
    else for(const f of Object.keys(ortak)) if(!(f in d)||JSON.stringify(d[f])!==JSON.stringify(ortak[f])) delete ortak[f];
    q+=x.metin.length;
  }
  ortak=ortak||{};
  const kosu=[];
  for(const x of p){
    if(x.img){ kosu.push(x); continue }
    const a=x.h?turet(x.h.a,x.k):yeniParcaOz(x.k);
    kosu.push({metin:x.metin,a,k:x.k});
  }
  // Satır sonu: özgün biçimi (+ paragrafın tümüne uygulanan değişiklik)
  const sonHam=[...hamlar].reverse().find(h=>h.tag!=="image"&&ur[hamlar.indexOf(h)][2].includes("\n"));
  let sk, sa;
  if(sonHam){ sk=Object.assign({},sonHam.k,ortak); sa=turet(sonHam.a,sk) }
  else{ const son=[...kosu].reverse().find(x=>!x.img); sk=son?son.k:stilEditor({}); sa=son?son.a:[] }
  kosu.push({metin:"\n",a:sa,k:sk});
  // Aynı biçimdeki komşular birleşir
  const bir=[];
  for(const x of kosu){
    const o=bir[bir.length-1];
    if(o&&!o.img&&!x.img&&anahtar(o.k)===anahtar(x.k)) o.metin+=x.metin; else bir.push(Object.assign({},x));
  }
  for(const x of bir){
    if(x.img){
      const ia=x.img.dataset.ia?JSON.parse(x.img.dataset.ia):null;
      const src=x.img.getAttribute("src")||"", veri=src.slice(src.indexOf(",")+1);
      const w=x.img.dataset.wpt||(x.img.width*.75), h=x.img.dataset.hpt||(x.img.height*.75);
      const a=ia&&al(ia,"imageData")===veri ? ia
        : [["imageData",veri],["startOffset","0"],["length","1"],["width",(+w).toFixed(1)],["height",(+h).toFixed(1)]];
      ic+=this.parca("image",a,"\uFFFC");
      continue;
    }
    ic+=this.parca(/^ +$/.test(x.metin)?"space":"content",x.a,x.metin);
  }
  return `<paragraph${oz(pa)}>${ic}</paragraph>`;
};

Yazici.prototype.bloklar=function(kok){
  let out="";
  for(const el of kok.children){
    const T=el.tagName;
    if(el.dataset&&el.dataset.udf==="sb") continue;
    if(el.dataset&&el.dataset.udf==="pagebreak"){ out+=this.sayfaSonu(el); continue }
    if(T==="UL"||T==="OL"){
      if(!el.dataset.listid) el.dataset.listid=String(++this.listeId);
      else this.listeId=Math.max(this.listeId,+el.dataset.listid||0);
      for(const li of el.children){
        if(li.tagName!=="LI") continue;
        const ek=T==="UL"
          ? [["Bulleted","true"],["BulletType","BULLET_TYPE_ELLIPSE"],["ListLevel","1"],["ListId",el.dataset.listid],["LeftIndent","25.0"]]
          : [["Numbered","true"],["NumberType","NUMBER_TYPE_NUMBER_DOT"],["ListLevel","1"],["ListId",el.dataset.listid],["LeftIndent","25.0"]];
        out+=this.paragraf(li,ek);
      }
      continue;
    }
    if(T==="TABLE"){ out+=this.tablo(el); continue }
    if(T==="P"||T==="DIV"||T==="LI"||/^H\d$/.test(T)){ out+=this.paragraf(el); continue }
    if(T==="BR") continue;
    // Bloğa sarılmamış satır içi öge: paragraf say
    out+=this.paragraf(el);
  }
  return out;
};
Yazici.prototype.sayfaSonu=function(el){
  const pb=el.dataset.pb?JSON.parse(el.dataset.pb):null;
  const pa=pb?pb.pa:[];
  const ra=pb&&pb.ur&&pb.ur[0]?pb.ur[0][1].filter(y=>y[0]!=="startOffset"&&y[0]!=="length"):[];
  const tag=pb&&pb.ur&&pb.ur[0]?pb.ur[0][0]:"content";
  return `<page-break><paragraph${oz(pa)}>${this.parca(tag,ra,"\n")}</paragraph></page-break>`;
};
Yazici.prototype.tablo=function(tb){
  const satirlar=[...tb.rows].filter(r=>r.dataset.udf!=="sb");     // sayfalama boşlukları dosyaya girmez
  const sutun=Math.max(1,...satirlar.map(r=>[...r.cells].reduce((t,c)=>t+(c.colSpan||1),0)));
  let ta=tb.dataset.ta?JSON.parse(tb.dataset.ta):null;
  if(ta){
    if(al(ta,"columnCount")!==String(sutun)){
      ta=ta.map(([k,v])=>k==="columnCount"?[k,String(sutun)]:k==="columnSpans"?[k,Array(sutun).fill("1").join(",")]:[k,v]);
    }
  }else ta=[["tableName","Sabit"],["columnCount",String(sutun)],["columnSpans",Array(sutun).fill("1").join(",")],["border","borderCell"]];
  let h=`<table${oz(ta)}>`;
  for(const r of satirlar){
    const ra=r.dataset.ra?JSON.parse(r.dataset.ra):[["rowName","row1"],["rowType","dataRow"]];
    h+=`<row${oz(ra)}>`;
    for(const c of r.cells){
      let ca=c.dataset.ca?JSON.parse(c.dataset.ca):null;
      const kenarsiz=c.dataset.nb==="1"||c.style.borderStyle==="none";
      if(!ca){
        ca=[];
        if(c.colSpan>1) ca.push(["colspan",String(c.colSpan)]);
        if(c.rowSpan>1) ca.push(["rowspan",String(c.rowSpan)]);
        if(!kenarsiz) ca.push(["border","borderCell"],["borderWidth","0.5"],["borderSpec","15"],["borderColor","0"],["borderStyle","borderStyle-solid"]);
      }else{
        const ayar=(k,v,varsa)=>{ const i=ca.findIndex(x=>x[0]===k); if(v===null){ if(i>=0) ca.splice(i,1) } else if(i>=0) ca[i]=[k,v]; else if(varsa) ca.unshift([k,v]) };
        ayar("colspan",c.colSpan>1?String(c.colSpan):null,true);
        ayar("rowspan",c.rowSpan>1?String(c.rowSpan):null,true);
      }
      const bg=typeof hex==="function"?hex(c.style.backgroundColor):null;
      if(bg&&bg!=="#FFFFFF"){ const i=ca.findIndex(x=>x[0]==="fillColor"); const v=String(parseInt(bg.slice(1),16)); if(i>=0) ca[i]=["fillColor",v]; else ca.push(["fillColor",v]) }
      h+=`<cell${oz(ca)}>`;
      const bloklu=[...c.children].some(x=>/^(P|DIV|UL|OL|TABLE)$/.test(x.tagName));
      h+=bloklu?this.bloklar(c):this.paragraf(c);
      h+="</cell>";
    }
    h+="</row>";
  }
  return h+"</table>";
};
Yazici.prototype.ustAlt=function(b){
  // Ham öge: metin dilimi bu noktaya taşınır, ofsetler kaydırılır
  const fark=this.metin.length-b.bas;
  this.metin+=b.metin;
  return b.xml.replace(/startOffset="(\d+)"/g,(_,s)=>`startOffset="${+s+fark}"`);
};

function sayfaOz(hamOz,p){
  const o=(hamOz||YENI_SAYFA).map(x=>x.slice());
  const yaz=(k,v)=>{
    const i=o.findIndex(x=>x[0]===k);
    if(i>=0){ if(Math.abs(parseFloat(o[i][1])-v)>1e-6) o[i]=[k,jd(v)] }
    else o.push([k,jd(v)]);
  };
  yaz("leftMargin",p.ml); yaz("rightMargin",p.mr); yaz("topMargin",p.mt); yaz("bottomMargin",p.mb);
  const i=o.findIndex(x=>x[0]==="paperOrientation");
  if(i>=0){ if(o[i][1]!==String(p.orient)) o[i]=["paperOrientation",String(p.orient)] }
  return o;
}

/* Editör → content.xml */
function udfYaz(kok,h,sayfa,degisti){
  h=h||null;
  const y=new Yazici();
  let govde="";
  const ust=h?h.ustAlt.filter(b=>b.tag==="header"):[], alt=h?h.ustAlt.filter(b=>b.tag!=="header"):[];
  for(const b of ust) govde+=y.ustAlt(b);
  govde+=y.bloklar(kok);
  for(const b of alt) govde+=y.ustAlt(b);
  const ek=h?(h.ekSatir||(degisti&&h.cokParagraf?"\n":"")):"";
  const metin=(y.metin+ek).replace(/\]\]>/g,"]] >");
  const bas=h?h.bas:PROLOG;
  const pf=`<pageFormat${oz(sayfaOz(h&&h.sayfa,sayfa))} />`;
  const ozel=h?h.ozelHam.replace(/<pageFormat\b[^>]*\/>/,()=>pf):`<properties>${pf}</properties>\n`;
  const elAc=h?h.elAc:YENI_ELEMENTS;
  const kapanis=h?h.kapanis:YENI_SON.slice(1);
  const ara=h?h.sonEk:"\n";
  return `${bas}<content><![CDATA[${metin}]]></content>${ozel}${elAc}${govde}${ara}${kapanis}`;
}

/* Yüklemeden sonra: her paragrafın şimdiki görünümünü imza olarak sakla;
   kaydederken değişip değişmediği buna bakılarak anlaşılır. */
function imzalariKaydet(kok){
  for(const el of kok.querySelectorAll("[data-ur]")){
    el.dataset.u0=editorImzasi(el);
    el.dataset.p0=cssImza(el);
    el.dataset.p0v=JSON.stringify(paragrafDegerleri(el));
  }
}

window.UdfBicim={udfOku,udfYaz,imzalariKaydet,jf,jd,YENI_SAYFA};
})();
