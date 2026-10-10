"use strict";
/* Editör motoru. UDF dönüşümü udf-cli (MIT) codec'i ile yapılır; buradaki iş
   editör DOM'unu codec'in beklediği HTML alt kümesine deterministik yazmak. */

const $=id=>document.getElementById(id), sheet=$("sheet");
const PT=px=>+(px*.75).toFixed(1);
const FONTS=["Times New Roman","Arial","Tahoma","Verdana","Courier New","Calibri","Georgia"];
const SIZES=[8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72];
const PALETTE=["#000000","#333333","#666666","#999999","#FFFFFF","#B22222","#C00000","#FF1B0F",
               "#FF9900","#FFC000","#FFFF00","#92D050","#00B050","#00B0F0","#0070C0","#003366",
               "#7030A0","#FF00FF","#FFCCCC","#FFE699","#FFF2CC","#D9EAD3","#CFE2F3","#EAD1DC"];

/* Yeni belge, masaüstü editörün "Yeni" belgesiyle aynı: 1,5 cm kenar boşlukları. */
const YENI_SAYFA=()=>({w:595.28,h:841.89,mt:42.525000000000006,mr:42.525000000000006,mb:42.52500000000006,ml:42.525000000000006,orient:1});
const doc={name:"isimsiz.UDF",kaynakUri:null,sayfaHam:null,udfHam:null,dirty:false,loaded:false,fore:"#FF1B0F",back:"#FFFF00",zoom:125,
  page:YENI_SAYFA()};

const store={
  async get(k){try{const r=await window.storage.get(k);return r?JSON.parse(r.value):null}catch(_){return null}},
  async set(k,v){try{await window.storage.set(k,JSON.stringify(v))}catch(_){}},
  async list(p){try{const r=await window.storage.list(p);return r?r.keys:[]}catch(_){return []}}
};

/* ================= UDF <-> EDİTÖR ================= */
function udfHtmlToEditor(html){
  const d=document.createElement("div"); d.innerHTML=html;
  // Sekme, genişliği ölçülebilsin diye kendi ögesinde tutuluyor; içindeki
  // gerçek \t, durak bilgisi yoksa yedek olarak çalışır.
  // DİKKAT: <tab/> ve <page-break/> HTML'de kendi kendine kapanan etiket
  // DEĞİL. Tarayıcı bunları açık etiket sayar ve ARKASINDAKİ içeriği onların
  // içine alır. Öge doğrudan değiştirilirse o içerik sessizce yok olur —
  // sekmeden sonraki metin, sayfa sonundan sonraki tüm paragraflar gider.
  // Bu yüzden çocukları ögenin yerine geri koyuyoruz.
  const yerineKoy=(t,yeni)=>{
    const frag=document.createDocumentFragment();
    while(t.firstChild)frag.appendChild(t.firstChild);
    t.replaceWith(yeni);
    yeni.after(frag);
  };
  d.querySelectorAll("tab").forEach(t=>yerineKoy(t,yeniTab()));
  // Belge kendi sekme duraklarını taşıyor (UDF'de TabSet). Bunlar yok sayılırsa
  // "DOSYA NO : ..." gibi satırlardaki iki nokta üst üsteler aynı kolona gelmez.
  d.querySelectorAll("p,li").forEach(el=>{
    // tab-stops geçerli bir CSS özelliği olmadığı için tarayıcı onu style
    // nesnesine almıyor; ham öznitelikten okumak gerekiyor.
    const raw=el.getAttribute("style")||"";
    const m=raw.match(/tab-stops\s*:\s*([^;]+)/i);
    if(m){
      const arr=m[1].split(/[\s,]+/).map(parseFloat).filter(v=>!isNaN(v));
      if(arr.length)el.dataset.tabs=arr.join(" ");
      el.setAttribute("style",raw.replace(/tab-stops\s*:[^;]*;?/i,""));
    }
  });
  d.querySelectorAll("page-break").forEach(t=>{
    const s=document.createElement("div");
    s.dataset.udf="pagebreak"; s.contentEditable="false"; s.textContent="— Sayfa sonu —";
    yerineKoy(t,s);
  });
  // Codec kenarlıksız hücreyi "border yok" diye ifade ediyor; açıkça işaretlemezsek
  // editör varsayılan çerçeveyi çizer ve kaydederken bu durum kaybolur.
  d.querySelectorAll("td").forEach(td=>{
    if(!/border\s*:/.test(td.getAttribute("style")||"")){td.style.borderStyle="none";td.dataset.nb="1"}});
  if(!d.children.length)d.innerHTML="<p><br></p>";
  return d.innerHTML;
}

const hex=c=>{if(!c)return null;c=c.trim();
  if(c[0]==="#")return c.length===4?"#"+[...c.slice(1)].map(x=>x+x).join("").toUpperCase():c.toUpperCase();
  const m=c.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/);if(!m)return null;
  return "#"+[m[1],m[2],m[3]].map(n=>(+n).toString(16).padStart(2,"0")).join("").toUpperCase()};
const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function inlineStyleOf(node,stop){
  const st={fam:null,size:null,fg:null,bg:null,b:false,i:false,u:false,s:false,sub:false,sup:false};
  let n=node.parentElement;
  while(n&&n!==stop&&n!==sheet.parentElement){
    const t=n.tagName;
    if(t==="B"||t==="STRONG")st.b=true;
    if(t==="I"||t==="EM")st.i=true;
    if(t==="U")st.u=true;
    if(t==="S"||t==="STRIKE"||t==="DEL")st.s=true;
    if(t==="SUB")st.sub=true;
    if(t==="SUP")st.sup=true;
    if(t==="FONT"){
      if(!st.fg&&n.getAttribute("color"))st.fg=hex(n.getAttribute("color"));
      if(!st.fam&&n.getAttribute("face"))st.fam=n.getAttribute("face").split(",")[0].replace(/['"]/g,"").trim();
    }
    const y=n.style;
    if(y){
      if(y.fontWeight==="bold"||parseInt(y.fontWeight,10)>=600)st.b=true;
      if(y.fontStyle==="italic")st.i=true;
      const dec=y.textDecorationLine||y.textDecoration||"";
      if(/underline/.test(dec))st.u=true;
      if(/line-through/.test(dec))st.s=true;
      if(!st.fam&&y.fontFamily)st.fam=y.fontFamily.split(",")[0].replace(/['"]/g,"").trim();
      if(!st.size&&y.fontSize)st.size=/pt$/.test(y.fontSize)?parseFloat(y.fontSize):PT(parseFloat(y.fontSize));
      if(!st.fg&&y.color)st.fg=hex(y.color);
      if(!st.bg&&y.backgroundColor)st.bg=hex(y.backgroundColor);
    }
    n=n.parentElement;
  }
  return st;
}
const same=(a,b)=>a.fam===b.fam&&a.size===b.size&&a.fg===b.fg&&a.bg===b.bg&&
  a.b===b.b&&a.i===b.i&&a.u===b.u&&a.s===b.s&&a.sub===b.sub&&a.sup===b.sup;

function inlineHtml(container){
  const runs=[];let cur=null;
  const w=document.createTreeWalker(container,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  let n;
  while((n=w.nextNode())){
    if(n.nodeType===1){
      if(n.dataset&&n.dataset.udf==="tab"){runs.push({tab:true});cur=null;continue}
      if(n.tagName==="IMG"){runs.push({img:n});cur=null;continue}
      if(n.tagName==="BR"){runs.push({br:true});cur=null}
      continue;
    }
    if(n.parentElement.closest('[data-udf="tab"]'))continue;
    const txt=n.nodeValue.replace(/\r/g,"").replace(/\n/g," ");
    if(!txt)continue;
    const st=inlineStyleOf(n,container);
    // \t olduğu gibi korunuyor: codec bunu CDATA'ya birebir yazıyor ve
    // orijinal belgedeki gösterimle aynı oluyor.
    if(cur&&same(cur.st,st))cur.text+=txt;else{cur={st,text:txt};runs.push(cur)}
  }
  return runs.map(r=>{
    if(r.tab)return "<tab/>";
    if(r.br)return "<br>";
    if(r.img)return `<img src="${r.img.getAttribute("src")}" width="${r.img.dataset.wpt||PT(r.img.width)}" height="${r.img.dataset.hpt||PT(r.img.height)}">`;
    const s=[];
    if(r.st.fam&&r.st.fam!=="Times New Roman")s.push("font-family:"+r.st.fam);
    if(r.st.size&&r.st.size!==12)s.push("font-size:"+r.st.size+"pt");
    if(r.st.fg&&r.st.fg!=="#000000")s.push("color:"+r.st.fg);
    if(r.st.bg)s.push("background-color:"+r.st.bg);
    let t=esc(r.text);
    if(r.st.sub)t="<sub>"+t+"</sub>";
    if(r.st.sup)t="<sup>"+t+"</sup>";
    if(r.st.s)t="<s>"+t+"</s>";
    if(r.st.u)t="<u>"+t+"</u>";
    if(r.st.i)t="<em>"+t+"</em>";
    if(r.st.b)t="<strong>"+t+"</strong>";
    return s.length?`<span style="${s.join(";")}">${t}</span>`:t;
  }).join("");
}

function paraStyle(p){
  const s=p.style,o=[];
  if(s.textAlign&&s.textAlign!=="left")o.push("text-align:"+s.textAlign);
  if(s.lineHeight&&parseFloat(s.lineHeight)!==1.42)o.push("line-height:"+parseFloat(s.lineHeight));
  ["textIndent","marginLeft","marginRight","marginTop","marginBottom"].forEach(k=>{
    const v=parseFloat(s[k]);
    if(v)o.push(k.replace(/[A-Z]/g,m=>"-"+m.toLowerCase())+":"+v+"pt")});
  if(p.dataset&&p.dataset.tabs)o.push("tab-stops:"+p.dataset.tabs.split(" ").map(v=>v+"pt").join(" "));
  return o.length?` style="${o.join(";")}"`:"";
}

function blocksHtml(root){
  const out=[];
  let buf=[];
  // Kagida dogrudan yazilan metin hicbir <p> icinde olmayabiliyor. Yalnizca
  // element cocuklari gezersek bu metin kaydedilirken sessizce kayboluyor;
  // bu yuzden blok disinda kalanlari toplayip paragrafa sariyoruz.
  const flush=()=>{
    if(!buf.length)return;
    const tmp=document.createElement("p");
    buf.forEach(n=>tmp.appendChild(n.cloneNode(true)));
    const h=inlineHtml(tmp);
    if(h)out.push(`<p>${h}</p>`);
    buf=[];
  };
  const BLOCK={P:1,DIV:1,OL:1,UL:1,TABLE:1};
  for(const el of root.childNodes){
    if(el.nodeType===3){ if(el.nodeValue.replace(/\s+/g,""))buf.push(el); continue }
    if(el.nodeType!==1)continue;
    const T=el.tagName;
    if(!BLOCK[T]&&!(el.dataset&&el.dataset.udf==="pagebreak")){ buf.push(el); continue }
    flush();
    if(el.dataset&&el.dataset.udf==="pagebreak"){out.push("<page-break/>");continue}
    if(T==="P"||T==="DIV"){out.push(`<p${paraStyle(el)}>${inlineHtml(el)}</p>`);continue}
    if(T==="OL"||T==="UL"){
      const li=[...el.children].filter(x=>x.tagName==="LI").map(x=>`<li>${inlineHtml(x)}</li>`).join("");
      out.push(`<${T.toLowerCase()}>${li}</${T.toLowerCase()}>`);continue}
    if(T==="TABLE"){
      const rows=[...el.querySelectorAll("tr")].map(tr=>{
        const tds=[...tr.children].map(td=>{
          const a=[];
          if(td.colSpan>1)a.push(`colspan="${td.colSpan}"`);
          if(td.rowSpan>1)a.push(`rowspan="${td.rowSpan}"`);
          const cs=[];
          const bg=hex(td.style.backgroundColor);if(bg)cs.push("background-color:"+bg);
          if(td.style.borderStyle==="none"||td.dataset.nb==="1")cs.push("border-style:none");
          if(td.style.verticalAlign)cs.push("vertical-align:"+td.style.verticalAlign);
          if(cs.length)a.push(`style="${cs.join(";")}"`);
          return `<td${a.length?" "+a.join(" "):""}>${td.children.length?blocksHtml(td):`<p>${inlineHtml(td)}</p>`}</td>`;
        }).join("");
        return `<tr>${tds}</tr>`}).join("");
      out.push(`<table>${rows}</table>`);continue}
    out.push(`<p>${inlineHtml(el)}</p>`);
  }
  flush();
  return out.join("");
}
const editorToUdfHtml=()=>blocksHtml(sheet)||"<p></p>";

/* ================= DOSYA ================= */
/* Kaydetmeden önce doğrula.
   Üretilen UDF geri okunup metni editördekiyle karşılaştırılıyor. Fark varsa
   kullanıcı sessizce eksik bir dosya kaydetmiş olmaz — dilekçede bu kabul
   edilemez. Bu kontrol, cihazda ortaya çıkıp burada üretilemeyen kayıpları
   da yakalar. */
const sadeMetin=h=>h
  .replace(/<tab\/>/g," ").replace(/<page-break\/>/g," ")
  .replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&")
  .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g,"");

/* Kaydederken yazılacak sayfa düzeni. Belgeden okunan diğer alanlar
   (kağıt boyutu, üstbilgi/altbilgi payları) aynen korunuyor. */
function sayfaNesnesi(){
  const p=doc.page;
  return Object.assign({mediaSizeName:1,headerFOffset:20,footerFOffset:20},doc.sayfaHam||{},{
    leftMargin:p.ml, rightMargin:p.mr, topMargin:p.mt, bottomMargin:p.mb,
    paperOrientation:p.orient
  });
}
window.sayfaNesnesi=sayfaNesnesi;

/* Editörün düz metni: kaydedilen dosya geri okunduğunda aynısı çıkmalı. */
function govdeMetni(kok){
  const k=kok.cloneNode(true);
  k.querySelectorAll('[data-udf="pagebreak"]').forEach(x=>x.remove());
  return (k.textContent||"").replace(/[\s\u00A0\u200B]+/g,"");
}
async function udfUret(){
  const xml=window.UdfBicim.udfYaz(sheet,doc.udfHam,doc.page,doc.dirty);
  const z=new JSZip(); z.file("content.xml",xml);
  const blob=await z.generateAsync({type:"blob",compression:"DEFLATE"});
  let ok=true, beklenen=0, gelen=0;
  try{
    const d=document.createElement("div");
    d.innerHTML=window.UdfBicim.udfOku(xml).html;
    const a=govdeMetni(sheet), b=govdeMetni(d);
    beklenen=a.length; gelen=b.length; ok=(a===b);
  }catch(_){ ok=false }
  return {blob,ok,beklenen,gelen,xml};
}
window.udfUret=udfUret;
window.sadeMetin=sadeMetin;

function kayipUyar(r){
  showNotice('<span class="mk">!</span><span><b>Belge eksik kaydedilecekti, kaydetme durduruldu.</b><br>'+
    `Editörde ${r.beklenen} karakter var, dosyaya ${r.gelen} karakter yazılıyor. `+
    'Lütfen bu ekranın görüntüsünü geliştiriciye iletin.</span>');
}

async function openFile(file){
  hideNotice();
  try{
    const ab=await file.arrayBuffer();
    // Önce masaüstüyle birebir okuyucu; çözemezse eski codec
    try{
      const xml=await (await JSZip.loadAsync(ab)).file("content.xml").async("string");
      const r=window.UdfBicim.udfOku(xml);
      const sf={}; for(const [k,v] of (r.ham.sayfa||[])) sf[k]=parseFloat(v);
      doc.page=YENI_SAYFA();
      if(sf.leftMargin!==undefined)doc.page.ml=sf.leftMargin;
      if(sf.rightMargin!==undefined)doc.page.mr=sf.rightMargin;
      if(sf.topMargin!==undefined)doc.page.mt=sf.topMargin;
      if(sf.bottomMargin!==undefined)doc.page.mb=sf.bottomMargin;
      if(sf.paperOrientation!==undefined)doc.page.orient=sf.paperOrientation;
      doc.sayfaHam=sf; doc.udfHam=r.ham;
      load(udfHtmlToEditor(r.html),file.name);
      window.UdfBicim.imzalariKaydet(sheet);
      await window.imzaYukle(ab);
      return;
    }catch(e){ console.warn("UDF okuyucu:",e) }
    doc.udfHam=null;
    const html=await window.UDF.toHtml(ab);
    // Sayfa düzeni codec'in HTML katmanında taşınmıyor; arşivden ayrıca okunuyor.
    const sf=await window.UDF.sayfaOku(ab);
    if(sf){
      if(sf.leftMargin!==undefined)doc.page.ml=sf.leftMargin;
      if(sf.rightMargin!==undefined)doc.page.mr=sf.rightMargin;
      if(sf.topMargin!==undefined)doc.page.mt=sf.topMargin;
      if(sf.bottomMargin!==undefined)doc.page.mb=sf.bottomMargin;
      if(sf.paperOrientation!==undefined)doc.page.orient=sf.paperOrientation;
      doc.sayfaHam=sf;                       // diğer alanlar aynen geri yazılsın
    }
    load(udfHtmlToEditor(html),file.name);
    await window.imzaYukle(ab);
  }catch(e){
    showNotice(`<span class="mk">!</span><span><b>Dosya açılamadı.</b> ${esc(String(e.message||e))}</span>`);
  }
}
function load(html,name){
  doc.name=name;doc.loaded=true;sheet.innerHTML=html;
  $("empty").hidden=true;$("wrap").hidden=false;
  $("fname").textContent="Doküman Editörü — "+name;
  applyPage();if(document.body.dataset.view==="page")fitPage();
  setDirty(false);stats();saveRecent();layoutTabs();
}
async function saveUdf(asName){
  const name=String(asName||doc.name).replace(/\.udf$/i,"")+".udf";
  const r=await window.kaydedilecek();
  if(!r.ok){ kayipUyar(r); return }
  const blob=r.blob;

  /* iOS'ta ana ekrana eklenmiş uygulamada indirme bağlantısı çalışmıyor;
     paylaşım sayfası "Dosyalara Kaydet" seçeneğini veriyor. Desteklenmiyorsa
     klasik indirmeye düşüyoruz. */
  const dosya=new File([blob],name,{type:"application/octet-stream"});
  if(navigator.canShare&&navigator.canShare({files:[dosya]})){
    try{
      await navigator.share({files:[dosya],title:name});
      tamamla(name); return;
    }catch(e){
      if(e&&e.name==="AbortError")return;      // kullanıcı vazgeçti
    }
  }
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  tamamla(name);
}
function tamamla(name){
  doc.name=name;$("fname").textContent="Doküman Editörü — "+name;
  setDirty(false);saveRecent();
}
async function saveRecent(){await store.set("recent:"+doc.name,{name:doc.name,html:sheet.innerHTML,at:Date.now(),page:doc.page,udfHam:doc.udfHam})}
async function loadRecent(){
  const keys=await store.list("recent:");if(!keys.length)return;
  const items=(await Promise.all(keys.map(k=>store.get(k)))).filter(Boolean).sort((a,b)=>b.at-a.at).slice(0,6);
  if(!items.length)return;
  $("recent").hidden=false;$("recentList").innerHTML="";
  items.forEach(it=>{const b=document.createElement("button");
    b.innerHTML=`${esc(it.name)}<span>${new Date(it.at).toLocaleDateString("tr-TR")}</span>`;
    b.onclick=()=>{if(it.page)doc.page=it.page;doc.imza=null;doc.udfHam=it.udfHam||null;load(it.html,it.name)};
    $("recentList").appendChild(b)});
}

/* ================= DURUM ================= */
function setDirty(v){doc.dirty=v;$("stMode").textContent=v?"Değişti":"Ekle";if(window.imzaDurumu)imzaDurumu()}
function stats(){
  const txt=sheet.innerText||"";
  $("stPara").textContent="Paragraf : "+sheet.querySelectorAll("p,li").length;
  $("stChar").textContent="Karakter : "+txt.replace(/\n/g,"").length.toLocaleString("tr-TR");
  $("stPage").textContent="Sayfa : "+sayfaBilgisi();
}

/* Sayfa sayısı yalnızca açık sayfa sonlarından hesaplanıyordu; belge doğal
   taşmayla dokuz sayfa olsa bile 1/1 görünüyordu. Artık içerik yüksekliği
   gerçek sayfa yüksekliğine bölünerek bulunuyor. */
/* ================= SAYFALAMA =================
   Sayfa görünümünde içerik, masaüstü editördeki gibi sayfalara bölünür:
   yazılabilir alanın altına taşan SATIR (paragrafın tamamı değil) bir sonraki
   sayfanın üst kenar boşluğundan devam eder; tablolar satır satır bölünür;
   elle eklenen sayfa sonu kalan sayfayı doldurur.
   Bunun için araya yalnızca görünümde var olan boşluk ögeleri
   ([data-udf="sb"]) konur. Bunlar metin içermez, dosyaya yazılmaz, yazdırırken
   gizlenir ve her yeniden sayfalamada silinip baştan hesaplanır. */
const SB_SEC='[data-udf="sb"]';
function sbKaldir(){
  const ebeveyn=new Set();
  sheet.querySelectorAll(SB_SEC).forEach(m=>{ if(m.tagName!=="TR") ebeveyn.add(m.parentNode); m.remove() });
  ebeveyn.forEach(e=>{ if(e&&e.isConnected) e.normalize() });
}
/* Seçim, paragraf içi karakter konumu olarak saklanır: boşluk ögeleri silinip
   metin düğümleri birleşince düğüm/ofset geçersizleşir. */
function secimKaydet(){
  const s=getSelection();
  if(!s.rangeCount||!sheet.contains(s.anchorNode)) return null;
  const nokta=(node,off)=>{
    const blok=(node.nodeType===1?node:node.parentElement).closest("p,li,td,div")||sheet;
    if(blok.matches&&blok.matches(SB_SEC)) return null;
    const r=document.createRange(); r.setStart(blok,0);
    try{ r.setEnd(node,off) }catch(_){ return null }
    return {blok,n:r.toString().length};
  };
  return {a:nokta(s.anchorNode,s.anchorOffset),f:nokta(s.focusNode,s.focusOffset)};
}
function secimGeriYukle(k){
  if(!k||!k.a||!k.f||!k.a.blok.isConnected||!k.f.blok.isConnected) return;
  const bul=({blok,n})=>{
    const w=document.createTreeWalker(blok,NodeFilter.SHOW_TEXT); let t;
    while((t=w.nextNode())){ if(n<=t.length) return [t,n]; n-=t.length }
    return [blok,blok.childNodes.length];
  };
  const [an,ao]=bul(k.a), [fn,fo]=bul(k.f);
  try{ getSelection().setBaseAndExtent(an,ao,fn,fo) }catch(_){}
}
function sbYeni(){
  const m=document.createElement("span");
  m.dataset.udf="sb"; m.contentEditable="false";
  m.style.cssText="display:inline-block;width:100%;height:0;vertical-align:top";
  return m;
}
function sayfala(){
  const k=secimKaydet();
  sbKaldir();
  const pb=[...sheet.querySelectorAll('[data-udf="pagebreak"]')];
  pb.forEach(x=>x.style.height="");
  if(document.body.dataset.view!=="page"){ sheet.style.minHeight=""; secimGeriYukle(k); return null }
  const p=doc.page,land=p.orient===0, PX=96/72;
  const ph=(land?p.w:p.h)*PX, mt=p.mt*PX, mb=p.mb*PX, zoom=(doc.zoom||100)/100;
  let s0=sheet.getBoundingClientRect().top;
  const y=v=>(v-s0)/zoom;
  const alt=v=>Math.floor(v/ph)*ph+ph-mb;                 // bulunduğu sayfanın yazılabilir alt sınırı
  const sonraki=v=>(Math.floor(v/ph)+1)*ph+mt;            // sonraki sayfanın ilk satırı
  // Bir paragrafın karakterleri (sekme ögesinin \t'i dahil)
  const karakterler=blok=>{
    const out=[], w=document.createTreeWalker(blok,NodeFilter.SHOW_TEXT); let t;
    while((t=w.nextNode())){
      if(t.parentElement.closest("table")!==blok.closest("table")) continue;   // iç içe tablo
      for(let i=0;i<t.length;i++) out.push([t,i]);
    }
    return out;
  };
  const r=document.createRange();
  const kutu=([t,i])=>{ r.setStart(t,i); r.setEnd(t,i+1); const b=r.getClientRects(); const x=b.length?b[b.length-1]:r.getBoundingClientRect(); return {ust:y(x.top),alt:y(x.bottom)} };
  const sbKoy=(t,i,blok)=>{
    const m=sbYeni();
    if(t){ const sag=t.splitText(i); sag.parentNode.insertBefore(m,sag) }
    else blok.insertBefore(m,blok.firstChild);
    const m0=y(m.getBoundingClientRect().top);
    m.style.height=Math.max(0,sonraki(m0)-m0)+"px";
  };
  // Bloklar belge sırasıyla
  const bloklar=[];
  const topla=kok=>{
    for(const el of kok.children){
      if(el.matches(SB_SEC)) continue;
      if(el.dataset.udf==="pagebreak"){ bloklar.push(el); continue }
      if(el.tagName==="UL"||el.tagName==="OL"){ for(const li of el.children) if(li.tagName==="LI") bloklar.push(li); continue }
      if(el.tagName==="TABLE"){ for(const tr of el.rows) bloklar.push(tr); continue }
      bloklar.push(el);
    }
  };
  topla(sheet);
  for(const B of bloklar){
    if(B.dataset.udf==="pagebreak"){
      B.style.height="0px";
      const v=y(B.getBoundingClientRect().top);
      B.style.height=Math.max(8,sonraki(v)-v)+"px";
      continue;
    }
    const rb=B.getBoundingClientRect();
    let ust=y(rb.top), ab=y(rb.bottom);
    if(ab<=alt(ust)+0.5) continue;                        // sayfaya sığıyor
    if(B.tagName==="TR"){
      if(ab-ust>ph-mt-mb) continue;                       // sayfadan uzun satır: bölünemez
      const sut=[...B.cells].reduce((t,c)=>t+(c.colSpan||1),0)||1;
      const m=document.createElement("tr");
      m.dataset.udf="sb"; m.contentEditable="false";
      m.innerHTML=`<td colspan="${sut}" style="border:none!important;padding:0;height:${Math.max(0,sonraki(ust)-ust)}px"></td>`;
      B.parentNode.insertBefore(m,B);
      continue;
    }
    // Paragraf: taşan satırı bul, önüne boşluk koy; paragraf birden çok
    // sayfaya yayılıyorsa her sayfa için tekrarla.
    let ch=karakterler(B), bas=0, koruma=0;
    if(!ch.length){ sbKoy(null,0,B); continue }
    while(koruma++<200){
      // ilk satırın sayfası: o satırın alt sınırını aşan ilk karakter
      const ilk=kutu(ch[bas]), sinir=alt(ilk.ust);
      let lo=bas, hi=ch.length;                             // [lo,hi) — alt>sinir olan ilk karakter
      while(lo<hi){ const mid=(lo+hi)>>1; if(kutu(ch[mid]).alt>sinir+0.5) hi=mid; else lo=mid+1 }
      if(lo>=ch.length) break;
      // taşan karakterin satır başı
      const satirUst=kutu(ch[lo]).ust;
      let s=lo; while(s>bas&&Math.abs(kutu(ch[s-1]).ust-satirUst)<2) s--;
      if(s===bas&&bas>0) break;                            // satır tek başına sayfaya sığmıyor
      const [t,i]=ch[s];
      sbKoy(i===0?t:t,i,B);
      ch=karakterler(B); bas=Math.min(s,ch.length-1);    // metin düğümü bölündü: listeyi yenile
      // boşluktan sonraki ilk karakter
      while(bas<ch.length-1&&kutu(ch[bas]).ust<sonraki(satirUst)-2) bas++;
    }
  }
  sheet.style.minHeight="";
  const sayfa=Math.max(1,Math.ceil((sheet.scrollHeight-2)/ph));
  sheet.style.minHeight=(sayfa*ph)+"px";
  secimGeriYukle(k);
  return {ph,sayfa,zoom};
}
window.sayfala=sayfala;
const sayfaSonlari=sayfala;
function sayfaBilgisi(){
  const ss=sayfaSonlari();
  if(ss){
    let simdi=1;
    const el=curPara();
    if(el) simdi=Math.min(ss.sayfa,Math.floor(((el.getBoundingClientRect().top-sheet.getBoundingClientRect().top)/ss.zoom)/ss.ph)+1);
    return Math.max(1,simdi)+" / "+ss.sayfa;
  }
  const p=doc.page,land=p.orient===0;
  const sayfaPt=(land?p.w:p.h)-p.mt-p.mb;      // yazılabilir yükseklik
  const zoom=(doc.zoom||100)/100;
  const icerikPt=((sheet.scrollHeight/zoom)*0.75)-p.mt-p.mb;
  let toplam=Math.max(1,Math.ceil(icerikPt/Math.max(1,sayfaPt)));
  toplam+=sheet.querySelectorAll('[data-udf="pagebreak"]').length;
  // imlecin bulunduğu sayfa
  let simdi=1;
  const el=curPara();
  if(el){
    const ust=(el.offsetTop/zoom)*0.75;
    simdi=Math.min(toplam,Math.max(1,Math.floor(ust/Math.max(1,sayfaPt))+1));
  }
  return simdi+" / "+toplam;
}
function showNotice(h){$("notice").innerHTML=h;$("notice").classList.add("show")}
function hideNotice(){$("notice").classList.remove("show")}

/* Kağıt her zaman tam sayfa görünsün. Boş belgede içeriğe göre büzülüyordu;
   masaüstü editöründe sayfa hep A4 yüksekliğinde duruyor. Yazı görünümünde
   kağıt A4 oranında (1:1,414), sayfa görünümünde gerçek A4 ölçüsünde. */
const A4_ORAN=841.89/595.28;
function fitSheet(){
  if(document.body.dataset.view==="write"){
    const w=sheet.clientWidth||660;
    document.documentElement.style.setProperty("--sh",Math.round(w*A4_ORAN)+"px");
    // Kenar boşlukları kâğıt genişliğiyle orantılı (A4 = 595 nk)
    const land=doc.page.orient===0, sayfaPx=(land?doc.page.h:doc.page.w)*(96/72);
    document.documentElement.style.setProperty("--k",Math.min(1,w/sayfaPx).toFixed(3));
  }
}
function applyPage(){
  const p=doc.page,land=p.orient===0;
  sheet.style.setProperty("--pw",(land?p.h:p.w)+"pt");
  sheet.style.setProperty("--ph",(land?p.w:p.h)+"pt");
  sheet.style.setProperty("--mt",p.mt+"pt");sheet.style.setProperty("--mr",p.mr+"pt");
  sheet.style.setProperty("--mb",p.mb+"pt");sheet.style.setProperty("--ml",p.ml+"pt");
  $("stPaper").textContent=(land?"A4 Yatay":"A4 Kâğıt");
  cetvel();
  applyZoom();
  fitSheet();
}
/* Masaüstü editördeki yatay cetvel: 0 sol kenar boşluğunda, kenar boşlukları gri,
   yarım cm'de kısa, cm'de uzun çizgi ve numara. Yalnızca A4 görünümünde. */
function cetvel(){
  const p=doc.page,land=p.orient===0, gen=land?p.h:p.w, CMPT=28.3465;
  const sol=p.ml, sag=gen-p.mr, y=[];
  y.push(`<rect x="0" y="0" width="${gen}" height="14" fill="#D9D9D9"/>`,
         `<rect x="${sol}" y="0" width="${sag-sol}" height="14" fill="#FFFFFF"/>`);
  for(let c=-Math.floor(sol/CMPT*2)/2; sol+c*CMPT<=gen; c+=.5){
    const x=(sol+c*CMPT).toFixed(2), tam=Number.isInteger(c);
    if(tam&&c!==0) y.push(`<text x="${x}" y="10.5" font-size="7.5" text-anchor="middle" fill="#333">${Math.abs(c)}</text>`);
    else y.push(`<line x1="${x}" x2="${x}" y1="${tam?2:5}" y2="${tam?12:9}" stroke="#555" stroke-width=".6"/>`);
  }
  y.push(`<path d="M${sol-3.5} 0h7l-3.5 4z" fill="#2F3BD6"/><path d="M${sol-3.5} 14h7l-3.5-4z" fill="#555"/>`,
         `<path d="M${sag-3} 14h6l-3-4z" fill="#E0302A"/>`);
  const c=$("cetvel");
  c.innerHTML=`<svg viewBox="0 0 ${gen} 14" width="${gen}pt" height="14pt" xmlns="http://www.w3.org/2000/svg">${y.join("")}</svg>`;
}
function applyZoom(){
  document.documentElement.style.setProperty("--zoom",(doc.zoom/100).toFixed(2));
  $("stZoom").textContent="%"+doc.zoom;$("zoomR").value=doc.zoom;
  layoutTabsGec();
}
function fitPage(){
  const land=doc.page.orient===0,w=(land?doc.page.h:doc.page.w)*(96/72);
  doc.zoom=Math.round(Math.min(100,($("main").clientWidth-16)/w*100));applyZoom();
}
$("zoomR").oninput=e=>{doc.zoom=+e.target.value;applyZoom()};
$("bZoomIn").onclick=()=>{doc.zoom=Math.min(200,doc.zoom+10);applyZoom()};
$("bZoomOut").onclick=()=>{doc.zoom=Math.max(50,doc.zoom-10);applyZoom()};
addEventListener("resize",()=>{if(document.body.dataset.view==="page")fitPage();fitSheet()});


/* ---- Sekme duraklarını uygula ----
   CSS'te keyfi sekme durağı yok; tekdüze tab-size ise belgenin kendi
   duraklarını taşımıyor ve "DOSYA NO : ..." satırlarındaki iki nokta
   üst üsteler aynı kolona gelmiyor. Bu yüzden her sekmenin genişliğini
   ölçüp bir sonraki durağa tam denk gelecek şekilde veriyoruz. */
/* Sekme yerleşimi.
   Gerçek UYAP belgelerinde sekme, CDATA içinde düz \t karakteri olarak duruyor
   ve hizalama tekdüze bir ızgarayla sağlanıyor: yazar kısa etiketten sonra üç,
   uzun etiketten sonra bir sekme koyuyor, ikisi de aynı durağa varıyor.
   Izgara masaüstü çıktısından ölçüldü: 72pt (1 inç) — altı başlık satırının
   tamamı 216pt'ye düşüyor. Bunu CSS tab-size hallediyor, JS'e gerek yok.

   Aşağıdaki kod yalnızca belgede AÇIK sekme durağı (UDF'de TabSet) tanımlıysa
   devreye giriyor; o durumda sekme kendi ögesinde tutulup genişliği ölçülüyor. */
function layoutTabs(){
  const zoom=(doc.zoom||100)/100;
  const paralar=new Set([...sheet.querySelectorAll('[data-udf="tab"]')].map(t=>t.closest("p,li,div,td")).filter(Boolean));
  paralar.forEach(el=>{
    const tabs=[...el.querySelectorAll('[data-udf="tab"]')];
    if(!tabs.length)return;
    const stops=(el.dataset.tabs||"").split(" ").map(parseFloat).filter(v=>!isNaN(v));
    const cs=getComputedStyle(el), padL=parseFloat(cs.paddingLeft)||0;
    const base=el.getBoundingClientRect();
    tabs.forEach(t=>{
      t.style.display="inline-block"; t.style.width="0px";
      const r=t.getBoundingClientRect();
      const x=((r.left-base.left-padL)/zoom)*0.75;
      let hedef=stops.find(v=>v>x+0.5);
      if(hedef===undefined) hedef=(Math.floor((x+0.5)/72)+1)*72;   // varsayılan duraklar: her 72 nk
      t.style.width=Math.max(1,hedef-x)+"pt";
    });
  });
}
window.layoutTabs=layoutTabs;

let tabZaman;
function layoutTabsGec(){ clearTimeout(tabZaman); tabZaman=setTimeout(layoutTabs,60) }

/* ================= SEÇİM ================= */
function curBlock(sel){const s=getSelection();if(!s.rangeCount)return null;
  let n=s.getRangeAt(0).startContainer;if(n.nodeType===3)n=n.parentElement;return n?n.closest(sel):null}
const curPara=()=>curBlock("p,li,div"), curCell=()=>curBlock("td"), curTable=()=>curBlock("table");
/* Pencere veya panel açılınca odak editörden çıkıyor ve seçim kayboluyor.
   Bu yüzden hedef paragrafları AÇILIŞTA yakalayıp saklıyoruz; "Tamam"a
   basıldığında seçime değil bu listeye uyguluyoruz. */
let savedRange=null;
function saveSel(){
  const s=getSelection();
  savedRange=(s.rangeCount&&sheet.contains(s.getRangeAt(0).commonAncestorContainer))
    ? s.getRangeAt(0).cloneRange() : null;
}
function restoreSel(){
  if(!savedRange)return;
  const s=getSelection(); s.removeAllRanges(); s.addRange(savedRange);
}
function paraList(){
  const s=getSelection();
  if(s.rangeCount&&sheet.contains(s.getRangeAt(0).commonAncestorContainer)){
    const r=s.getRangeAt(0);
    const all=[...sheet.querySelectorAll("p,li")].filter(p=>r.intersectsNode(p));
    if(all.length)return all;
  }
  if(savedRange){
    const all=[...sheet.querySelectorAll("p,li")].filter(p=>savedRange.intersectsNode(p));
    if(all.length)return all;
  }
  const p=curPara();
  return (p&&sheet.contains(p))?[p]:[...sheet.querySelectorAll("p,li")].slice(0,1);
}
function eachPara(fn){ paraList().forEach(fn) }

/* ================= KOMUTLAR ================= */
document.execCommand("styleWithCSS",false,true);
try{document.execCommand("defaultParagraphSeparator",false,"p")}catch(_){}
const keep=b=>b.addEventListener("mousedown",e=>e.preventDefault());

document.querySelectorAll("[data-cmd]").forEach(b=>{keep(b);
  b.onclick=()=>{document.execCommand(b.dataset.cmd);sheet.focus();sync();touch()}});
document.querySelectorAll("[data-align]").forEach(b=>{keep(b);
  b.onclick=()=>{eachPara(p=>p.style.textAlign=b.dataset.align);sheet.focus();sync();touch()}});
document.querySelectorAll("[data-list]").forEach(b=>{keep(b);
  b.onclick=()=>{document.execCommand(b.dataset.list);sheet.focus();sync();touch()}});
document.querySelectorAll("[data-indent]").forEach(b=>{keep(b);
  b.onclick=()=>{const d=+b.dataset.indent;
    eachPara(p=>{p.style.marginLeft=Math.max(0,(parseFloat(p.style.marginLeft)||0)+d)+"pt"});
    sheet.focus();touch()}});
document.querySelectorAll("[data-size]").forEach(b=>{keep(b);
  b.onclick=()=>{const i=SIZES.indexOf(curSize());
    const next=i<0?12:SIZES[Math.max(0,Math.min(SIZES.length-1,i+ +b.dataset.size))];
    setSize(next);sheet.focus();sync();touch()}});

function curSize(){const s=getSelection();if(!s.rangeCount)return 12;
  let n=s.getRangeAt(0).startContainer;if(n.nodeType===3)n=n.parentElement;
  while(n&&n!==sheet){if(n.style&&n.style.fontSize){const v=n.style.fontSize;
    return /pt$/.test(v)?parseFloat(v):PT(parseFloat(v))}n=n.parentElement}return 12}
function curFont(){const s=getSelection();if(!s.rangeCount)return "Times New Roman";
  let n=s.getRangeAt(0).startContainer;if(n.nodeType===3)n=n.parentElement;
  while(n&&n!==sheet){if(n.style&&n.style.fontFamily)
    return n.style.fontFamily.split(",")[0].replace(/['"]/g,"").trim();n=n.parentElement}
  return "Times New Roman"}

/* Renk, punto ve yazı tipi uygulaması.
   Eskiden execCommand("fontSize","7") ile <font size=7> üretilip sonra span'e
   çevriliyordu; ama styleWithCSS açıkken tarayıcı <font> DEĞİL <span> ürettiği
   için hiçbir şey bulunamıyor ve biçim sessizce uygulanmıyordu.
   Artık seçimdeki metin düğümleri doğrudan sarılıyor. */
function textNodesInRange(r){
  const out=[];
  const w=document.createTreeWalker(sheet,NodeFilter.SHOW_TEXT);
  let n;
  while((n=w.nextNode())){
    if(!n.nodeValue)continue;
    if(n.parentElement&&n.parentElement.closest('[data-udf="pagebreak"]'))continue;
    if(r.intersectsNode(n))out.push(n);
  }
  return out;
}
function wrapSel(apply){
  restoreSel();
  const sel=getSelection();
  if(!sel.rangeCount)return;
  const r=sel.getRangeAt(0);

  if(r.collapsed){                       // imleç boşsa paragrafın tamamına
    const p=curPara();
    if(p){ const sp=p.querySelectorAll("span");
      if(sp.length)sp.forEach(apply); else apply(p) }
    return;
  }

  const nodes=textNodesInRange(r);
  if(!nodes.length)return;
  const startN=r.startContainer, startO=r.startOffset;
  const endN=r.endContainer,   endO=r.endOffset;
  const wrapped=[];

  nodes.forEach(n=>{
    let node=n;
    // Sınırdaki düğümleri seçim kadarıyla böl
    if(node===endN && endO<node.nodeValue.length) node.splitText(endO);
    if(node===startN && startO>0 && startO<node.nodeValue.length) node=node.splitText(startO);
    if(!node.nodeValue)return;
    const sp=document.createElement("span");
    apply(sp);
    node.parentNode.insertBefore(sp,node);
    sp.appendChild(node);
    wrapped.push(sp);
  });

  if(wrapped.length){                    // seçim korunsun
    const nr=document.createRange();
    nr.setStartBefore(wrapped[0]);
    nr.setEndAfter(wrapped[wrapped.length-1]);
    sel.removeAllRanges(); sel.addRange(nr);
    savedRange=nr.cloneRange();
  }
}
const setSize=pt=>wrapSel(e=>e.style.fontSize=pt+"pt");
const setFont=f=>wrapSel(e=>e.style.fontFamily=f);
const setFore=c=>wrapSel(e=>e.style.color=c);
const setBack=c=>wrapSel(e=>e.style.backgroundColor=c);

// font/boyut açılır listeleri
FONTS.forEach(f=>{const o=document.createElement("option");o.value=o.textContent=f;
  o.style.fontFamily=f;$("selFont").appendChild(o)});
SIZES.forEach(s=>{const o=document.createElement("option");o.value=o.textContent=s;$("selSize").appendChild(o)});
$("selSize").value="12";
$("selFont").onchange=e=>{setFont(e.target.value);sheet.focus();touch()};
$("selSize").onchange=e=>{setSize(+e.target.value);sheet.focus();touch()};
$("bClear").onclick=()=>{document.execCommand("removeFormat");sheet.focus();sync();touch()};


/* ---- Gövde / başlık stilleri (UYAP'taki stil açılır listesi) ---- */
const STYLES={
  "Gövde":       {size:12, bold:false, align:"justify"},
  "Başlık 1":    {size:16, bold:true,  align:"center"},
  "Başlık 2":    {size:14, bold:true,  align:"left"},
  "Başlık 3":    {size:12, bold:true,  align:"left"},
  "Alıntı":      {size:11, bold:false, align:"justify", ml:28.35}
};
Object.keys(STYLES).forEach(k=>{
  const o=document.createElement("option");o.value=o.textContent=k;$("selStyle").appendChild(o)});
$("selStyle").onchange=e=>{
  const st=STYLES[e.target.value]; if(!st)return;
  eachPara(p=>{
    p.style.textAlign=st.align;
    p.style.marginLeft=(st.ml||0)+"pt";
    p.querySelectorAll("span").forEach(sp=>{sp.style.fontSize=st.size+"pt"});
    if(!p.querySelector("span"))p.style.fontSize=st.size+"pt";
    p.style.fontWeight=st.bold?"bold":"";
  });
  sheet.focus();touch();
};

/* ---- Büyük/küçük harf ---- */
$("bCase").onclick=()=>{
  const sel=String(getSelection());
  if(!sel){showNotice('<span class="mk">!</span><span>Önce dönüştürülecek metni seçin.</span>');
    setTimeout(hideNotice,2500);return}
  panel("Büyük/küçük harf",
    `<div class="chips">
       <button data-c="upper">BÜYÜK HARF</button>
       <button data-c="lower">küçük harf</button>
       <button data-c="title">Her Kelime Büyük</button>
       <button data-c="sentence">Cümle düzeni</button>
     </div>`,
    ()=>$("panel").querySelectorAll("[data-c]").forEach(b=>b.onclick=()=>{
      restoreSel();
      const t=String(getSelection());
      let r=t;
      // Türkçe'ye özgü: i→İ, ı→I dönüşümü locale ile doğru çalışır
      if(b.dataset.c==="upper")r=t.toLocaleUpperCase("tr-TR");
      if(b.dataset.c==="lower")r=t.toLocaleLowerCase("tr-TR");
      if(b.dataset.c==="title")r=t.toLocaleLowerCase("tr-TR").replace(/(^|\s)(\S)/g,
        (m,a,c)=>a+c.toLocaleUpperCase("tr-TR"));
      if(b.dataset.c==="sentence"){r=t.toLocaleLowerCase("tr-TR")
        .replace(/(^\s*|[.!?]\s+)(\S)/g,(m,a,c)=>a+c.toLocaleUpperCase("tr-TR"))}
      document.execCommand("insertText",false,r);
      closePanel();sheet.focus();touch();
    }));
};

/* ---- Biçimlendirme işaretleri ---- */
$("bMarks").onclick=()=>{
  const on=sheet.classList.toggle("marks");
  $("bMarks").classList.toggle("on",on);
  sheet.focus();
};

/* ---- Çok düzeyli liste ---- */
$("bMulti").onclick=()=>{
  document.execCommand("insertOrderedList");
  document.execCommand("indent");
  sheet.focus();sync();touch();
  showNotice('<span class="mk">i</span><span>UDF biçimi iç içe listeleri tek düzeye '+
    'indiriyor; kaydettiğinizde alt seviyeler düzleşir.</span>');
  setTimeout(hideNotice,5000);
};

function sync(){
  try{document.querySelectorAll("[data-cmd]").forEach(b=>{
    if(["cut","copy","paste"].includes(b.dataset.cmd))return;
    b.classList.toggle("on",document.queryCommandState(b.dataset.cmd))})}catch(_){}
  const p=curPara(),al=p?(p.style.textAlign||"left"):null;
  document.querySelectorAll("[data-align]").forEach(b=>b.classList.toggle("on",b.dataset.align===al));
  const sz=Math.round(curSize());if(SIZES.includes(sz))$("selSize").value=sz;
  const fn=curFont();if(FONTS.includes(fn))$("selFont").value=fn;
  sheet.querySelectorAll("td.sel").forEach(x=>x.classList.remove("sel"));
  const c=curCell();if(c)c.classList.add("sel");
  // Tablo sekmesi yalnızca tablodayken görünür — UYAP'ın bağlamsal sekme davranışı
  $("tabTablo").hidden=!c;
  if(!c&&document.querySelector('.tabs button.on')?.dataset.tab==="tablo")showTab("giris");
}
document.addEventListener("selectionchange",()=>{if(document.activeElement===sheet)sync()});

let tId;
function touch(){setDirty(true);if(window.imzaDegisti)imzaDegisti();layoutTabsGec();clearTimeout(tId);tId=setTimeout(()=>{stats();saveRecent()},600)}

sheet.addEventListener("input",()=>{
  // DİKKAT: burada DOM'u yeniden yazmıyoruz. Önceki sürümde her tuş vuruşunda
  // <div> yerine yeni bir <p> konuyordu; imleç silinen düğümün içinde kaldığı
  // için Enter'dan sonra alt satıra geçilemiyordu. Serileştirici zaten DIV'i
  // P gibi, <font>'u da satır içi biçim olarak ele alıyor.
  touch();
});

sheet.addEventListener("paste",e=>{e.preventDefault();
  document.execCommand("insertText",false,(e.clipboardData||window.clipboardData).getData("text/plain"))});


/* ---- klavye: Tab sekme eklesin, odak degistirmesin ---- */
function yeniTab(){
  const s=document.createElement("span");
  s.dataset.udf="tab"; s.textContent="\t";
  return s;
}
function insertTab(){ insertNode(document.createTextNode("\t")); layoutTabs() }
sheet.addEventListener("keydown",e=>{
  if(e.key==="Tab"){
    // contentEditable'da Tab varsayilan olarak odagi degistirir; belgede
    // sekme beklenirken bu imleci editorden cikariyor.
    e.preventDefault();
    if(e.shiftKey){ const p=curPara();
      if(p)p.style.marginLeft=Math.max(0,(parseFloat(p.style.marginLeft)||0)-18)+"pt" }
    else insertTab();
    touch();
  }
});

/* ---- kagit her zaman gecerli bir paragrafla baslasin ---- */
function ensurePara(){
  if(sheet.querySelector("p,li,table"))return;
  const p=document.createElement("p");
  while(sheet.firstChild)p.appendChild(sheet.firstChild);
  if(!p.firstChild)p.innerHTML="<br>";
  sheet.appendChild(p);
}
sheet.addEventListener("focus",ensurePara);
sheet.addEventListener("beforeinput",ensurePara);

$("bUndo").onclick=()=>{document.execCommand("undo");sheet.focus();touch()};
$("bRedo").onclick=()=>{document.execCommand("redo");sheet.focus();touch()};
$("bAll").onclick=()=>{sheet.focus();document.execCommand("selectAll")};

/* ---- sekmeler ---- */
function showTab(name){
  document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("on",x.dataset.tab===name));
  document.querySelectorAll(".pane").forEach(t=>t.classList.toggle("on",t.dataset.pane===name));
}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));

/* ================= EKLE ================= */
function insertNode(node){
  const s=getSelection();
  if(s.rangeCount){const r=s.getRangeAt(0);r.deleteContents();r.insertNode(node);
    r.setStartAfter(node);r.collapse(true);s.removeAllRanges();s.addRange(r)}
  else sheet.appendChild(node);
  touch();
}
$("bInsTab").onclick=()=>{insertTab();sheet.focus()};
$("bInsBreak").onclick=()=>{const d=document.createElement("div");
  d.dataset.udf="pagebreak";d.contentEditable="false";d.textContent="— Sayfa sonu —";
  const p=curPara();if(p)p.after(d);else sheet.appendChild(d);
  const np=document.createElement("p");np.innerHTML="<br>";d.after(np);touch();stats()};
$("bInsDate").onclick=()=>{insertNode(document.createTextNode(
  new Date().toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"})));sheet.focus()};
$("bInsImage").onclick=()=>$("fImg").click();
$("fImg").onchange=e=>{const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{const img=new Image();
    img.onload=()=>{const sc=Math.min(1,400/img.naturalWidth);
      const el=document.createElement("img");el.src=r.result;
      el.dataset.wpt=Math.round(img.naturalWidth*sc);el.dataset.hpt=Math.round(img.naturalHeight*sc);
      el.width=+el.dataset.wpt;el.height=+el.dataset.hpt;insertNode(el)};
    img.src=r.result};
  r.readAsDataURL(f);e.target.value=""};

/* ================= TABLO ================= */
function tblOp(op){
  const td=curCell(),tr=td&&td.parentElement,tbl=curTable();if(!td)return;
  const cell='<p><br></p>';
  if(op==="rowAfter"){const n=tr.cloneNode(true);
    n.querySelectorAll("td").forEach(c=>{c.innerHTML=cell;c.removeAttribute("rowspan")});tr.after(n)}
  if(op==="rowDel"&&tbl.querySelectorAll("tr").length>1)tr.remove();
  if(op==="colAfter"){const i=[...tr.children].indexOf(td);
    tbl.querySelectorAll("tr").forEach(r=>{const c=document.createElement("td");
      c.innerHTML=cell;(r.children[i]||r.lastElementChild).after(c)})}
  if(op==="colDel"){const i=[...tr.children].indexOf(td);
    if(tr.children.length>1)tbl.querySelectorAll("tr").forEach(r=>r.children[i]&&r.children[i].remove())}
  if(op==="mergeRight"){const nx=td.nextElementSibling;
    if(nx){td.colSpan=(td.colSpan||1)+(nx.colSpan||1);td.innerHTML+=nx.innerHTML;nx.remove()}}
  if(op==="mergeDown"){const i=[...tr.children].indexOf(td),nr=tr.nextElementSibling;
    if(nr&&nr.children[i]){td.rowSpan=(td.rowSpan||1)+(nr.children[i].rowSpan||1);
      td.innerHTML+=nr.children[i].innerHTML;nr.children[i].remove()}}
  if(op==="split"){const cs=td.colSpan||1,rs=td.rowSpan||1;td.colSpan=1;td.rowSpan=1;
    for(let k=1;k<cs;k++){const c=document.createElement("td");c.innerHTML=cell;td.after(c)}
    if(rs>1){let r=tr;for(let k=1;k<rs;k++){r=r.nextElementSibling;if(!r)break;
      const c=document.createElement("td");c.innerHTML=cell;r.prepend(c)}}}
  if(op==="noBorder"){const off=tbl.dataset.noborder==="1";tbl.dataset.noborder=off?"0":"1";
    tbl.querySelectorAll("td").forEach(c=>{c.style.borderStyle=off?"":"none";
      if(off)delete c.dataset.nb;else c.dataset.nb="1"})}
  sync();touch();
}
document.querySelectorAll("[data-tbl]").forEach(b=>{keep(b);b.onclick=()=>tblOp(b.dataset.tbl)});


/* ================= KLASİK DİYALOG ================= */
/* UYAP Doküman Editörü'nün pencereleri cm kullanıyor; motor ise pt.
   Dönüşüm tek yerde tutuluyor ki yuvarlama hataları dağılmasın. */
const CM=28.3465;
const pt2cm=v=>Math.round((v/CM)*100)/100;
const cm2pt=v=>Math.round(v*CM*100)/100;

function dialog(title,bodyHtml,actionsHtml,onOpen){
  saveSel();
  $("dlg").innerHTML=
    `<div class="bar"><div class="logo">UDE</div><h3>${title}</h3>`+
    `<button id="dlgX" title="Kapat">✕</button></div>`+
    `<div class="body">${bodyHtml}</div><div class="dact">${actionsHtml}</div>`;
  $("dlg").classList.add("on"); $("scrim").classList.add("on");
  $("dlgX").onclick=closeDialog;
  onOpen&&onOpen();
}
function closeDialog(){$("dlg").classList.remove("on");$("scrim").classList.remove("on")}

const ALIGN_BTNS=[
  ["left","<u>S</u>ola Dayalı","M4 6h16M4 11h10M4 16h16M4 21h10"],
  ["center","<u>O</u>rtalanmış","M4 6h16M7 11h10M4 16h16M7 21h10"],
  ["right","<u>S</u>ağa Dayalı","M4 6h16M10 11h10M4 16h16M10 21h10"],
  ["justify","<u>İ</u>ki Yana Dayalı","M4 6h16M4 11h16M4 16h16M4 21h16"]
];

function paragraphDialog(){
  const p=curPara();
  const g=k=>p?(parseFloat(p.style[k])||0):0;
  const cur={
    lh: p?1+(parseFloat(p.style.getPropertyValue("--ls"))||0):1.0,
    before: pt2cm(g("marginTop")), after: pt2cm(g("marginBottom")),
    ml: pt2cm(g("marginLeft")), mr: pt2cm(g("marginRight")),
    ti: pt2cm(g("textIndent")),
    align: p?(p.style.textAlign||"left"):"left"
  };
  const first=cur.ti>0?cur.ti:0;
  const hang =cur.ti<0?-cur.ti:0;

  const body=`
    <div class="cols">
      <fieldset class="fs"><legend>Aralık</legend>
        <div class="frow"><label for="dLh">Satır Aralığı (satır):</label><input id="dLh" value="${cur.lh.toFixed(1)}"></div>
        <div class="frow"><label for="dBf">önce (cm):</label><input id="dBf" value="${cur.before}"></div>
        <div class="frow"><label for="dAf">Sonra (cm):</label><input id="dAf" value="${cur.after}"></div>
      </fieldset>
      <fieldset class="fs"><legend>Girinti (cm):</legend>
        <div class="frow"><label for="dFi">İlk Satır (cm):</label><input id="dFi" value="${first}"></div>
        <div class="frow"><label for="dHa">Asılı (cm):</label><input id="dHa" value="${hang}"></div>
        <div class="frow"><label for="dMl">Sol girinti (cm):</label><input id="dMl" value="${cur.ml}"></div>
        <div class="frow"><label for="dMr">Sağ girinti (cm):</label><input id="dMr" value="${cur.mr}"></div>
      </fieldset>
    </div>
    <div class="alrow"><span>Hizalama::</span>
      ${ALIGN_BTNS.map(([v,lbl,d])=>
        `<button class="ab${v===cur.align?" on":""}" data-al="${v}">
           <svg viewBox="0 0 24 24"><path d="${d}"/></svg>${lbl}</button>`).join("")}
    </div>
    <fieldset class="fs" style="flex:1 1 100%"><legend>önizleme</legend>
      <div class="prev" id="dPrev"></div>
    </fieldset>`;

  const actions=`<button class="dbtn" id="dTab"><u>S</u>ekme</button>
    <span class="sp"></span>
    <button class="dbtn pri" id="dOk"><u>T</u>amam</button>
    <button class="dbtn" id="dNo"><u>V</u>azgeç</button>`;

  dialog("Paragraf",body,actions,()=>{
    let align=cur.align;
    const hedefler=paraList();   // odak pencereye geçmeden önce yakalandı
    const LOREM="abcd abcd abc abcdefghj abcdefg a a a ab ab abcdefgh abcd a abcdefgh abc a a abcd abcdefghjk abcdefghjk abcd abcde abcdefghj ab abcdefgh abc a abcd abcdefghjk ab ab abcdef a abcdef ";
    const prev=()=>{
      const st=readVals();
      $("dPrev").innerHTML=Array.from({length:4},()=>`<p>${LOREM}</p>`).join("");
      [...$("dPrev").children].forEach((el,i)=>{
        el.style.textAlign=align;
        el.style.lineHeight=""; el.style.lineHeight=String(1.168*st.lh);
        el.style.textIndent=(st.ti/CM*3)+"px";
        el.style.marginLeft=(st.ml/CM*3)+"px";
        el.style.marginRight=(st.mr/CM*3)+"px";
        if(i===0)el.style.marginTop=(st.before/CM*3)+"px";
        if(i===3)el.style.marginBottom=(st.after/CM*3)+"px";
      });
    };
    const num=id=>{const v=parseFloat(String($(id).value).replace(",","."));return isFinite(v)?v:0};
    const readVals=()=>{
      const fi=num("dFi"), ha=num("dHa");
      return {lh:Math.max(.5,num("dLh")||1), before:cm2pt(num("dBf")), after:cm2pt(num("dAf")),
              ml:cm2pt(num("dMl")), mr:cm2pt(num("dMr")),
              ti:cm2pt(ha>0?-ha:fi)};   // asılı girinti negatif ilk satır girintisidir
    };
    ["dLh","dBf","dAf","dFi","dHa","dMl","dMr"].forEach(id=>$(id).oninput=prev);
    $("dlg").querySelectorAll("[data-al]").forEach(b=>b.onclick=()=>{
      align=b.dataset.al;
      $("dlg").querySelectorAll("[data-al]").forEach(x=>x.classList.toggle("on",x===b));
      prev();
    });
    prev();

    $("dNo").onclick=closeDialog;
    $("dTab").onclick=()=>{closeDialog();insertTab();sheet.focus()};
    $("dOk").onclick=()=>{
      const v=readVals(), ha=num("dHa");
      hedefler.forEach(el=>{
        el.style.lineHeight=""; el.style.setProperty("--ls",String(+(v.lh-1).toFixed(4)));
        el.style.marginTop=v.before+"pt";
        el.style.marginBottom=v.after+"pt";
        el.style.marginRight=v.mr+"pt";
        el.style.textIndent=v.ti+"pt";
        // Asılı girintide gövde sağa kayar, ilk satır sola taşar
        el.style.marginLeft=(ha>0? v.ml+cm2pt(ha) : v.ml)+"pt";
        el.style.textAlign=align;
      });
      closeDialog(); sheet.focus(); sync(); touch();
    };
  });
}

/* ================= PANELLER ================= */
function panel(title,body,onOpen){
  saveSel();
  $("panel").innerHTML=`<h3>${title}</h3>${body}`;
  $("panel").classList.add("on");$("scrim").classList.add("on");onOpen&&onOpen()}
function closePanel(){$("panel").classList.remove("on");$("scrim").classList.remove("on")}
$("scrim").onclick=()=>{closePanel();closeDialog()};

function colorPanel(title,cur,apply){
  panel(title,`<div class="colors">${PALETTE.map(c=>`<button data-c="${c}" style="background:${c}"></button>`).join("")}</div>
    <div class="fld" style="margin-top:13px"><label>Özel renk</label><input type="color" id="cx" value="${cur}"></div>
    <div class="pact"><button class="wb" id="cNone">Kaldır</button><button class="wb pri" id="cOk">Uygula</button></div>`,
  ()=>{$("panel").querySelectorAll("[data-c]").forEach(b=>b.onclick=()=>{apply(b.dataset.c);closePanel();sheet.focus();touch()});
    $("cOk").onclick=()=>{apply($("cx").value.toUpperCase());closePanel();sheet.focus();touch()};
    $("cNone").onclick=()=>{apply("transparent");closePanel();sheet.focus();touch()}});
}
$("bFore").onclick=()=>colorPanel("Yazı rengi",doc.fore,c=>{doc.fore=c;$("swFore").style.background=c;setFore(c)});
$("bBack").onclick=()=>colorPanel("Vurgu rengi",doc.back,c=>{doc.back=c;$("swBack").style.background=c;setBack(c)});
$("bCellBg").onclick=()=>colorPanel("Hücre rengi","#EEEEEE",c=>{const t=curCell();if(t)t.style.backgroundColor=c==="transparent"?"":c});

$("bSpacing").onclick=()=>panel("Satır aralığı",
  `<div class="chips">${[1,1.15,1.5,2].map(v=>`<button data-v="${v}">${String(v).replace(".",",")}</button>`).join("")}</div>`,
  ()=>$("panel").querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{
    eachPara(p=>{p.style.lineHeight="";p.style.setProperty("--ls",String(+(b.dataset.v-1).toFixed(4)))});closePanel();sheet.focus();touch()}));

$("bParaFmt").onclick=paragraphDialog;
const _oldParaPanel=()=>panel("Paragraf",
  `<div class="fld"><label>Girinti (pt)</label><div class="two">
     <input id="pl" type="number" placeholder="Sol" value="0"><input id="pr" type="number" placeholder="Sağ" value="0"></div></div>
   <div class="fld"><label>Aralık (pt)</label><div class="two">
     <input id="pb" type="number" placeholder="Önce" value="0"><input id="pa" type="number" placeholder="Sonra" value="0"></div></div>
   <div class="pact"><button class="wb" id="pC">Vazgeç</button><button class="wb pri" id="pOk">Uygula</button></div>`,
  ()=>{$("pC").onclick=closePanel;
    $("pOk").onclick=()=>{eachPara(p=>{p.style.marginLeft=(+$("pl").value||0)+"pt";
      p.style.marginRight=(+$("pr").value||0)+"pt";p.style.marginTop=(+$("pb").value||0)+"pt";
      p.style.marginBottom=(+$("pa").value||0)+"pt"});closePanel();sheet.focus();touch()}});

$("bIndentFirst").onclick=()=>panel("İlk satır girintisi",
  `<div class="chips">${[0,12,24,36].map(v=>`<button data-v="${v}">${v} pt</button>`).join("")}<button data-v="-36">Asılı</button></div>`,
  ()=>$("panel").querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{const v=+b.dataset.v;
    eachPara(p=>{p.style.textIndent=v+"pt";if(v<0)p.style.marginLeft=Math.abs(v)+"pt"});
    closePanel();sheet.focus();touch()}));

$("bInsTable").onclick=()=>panel("Tablo ekle",
  `<div class="fld"><div class="two">
   <div style="flex:1"><label>Satır</label><input id="trI" type="number" value="3" min="1" max="30"></div>
   <div style="flex:1"><label>Sütun</label><input id="tcI" type="number" value="3" min="1" max="10"></div></div></div>
   <div class="pact"><button class="wb" id="tC">Vazgeç</button><button class="wb pri" id="tOk">Ekle</button></div>`,
  ()=>{$("tC").onclick=closePanel;
    $("tOk").onclick=()=>{const R=Math.max(1,+$("trI").value||3),C=Math.max(1,+$("tcI").value||3);
      const t=document.createElement("table");
      t.innerHTML=Array.from({length:R},()=>"<tr>"+"<td><p><br></p></td>".repeat(C)+"</tr>").join("");
      const p=curPara();if(p)p.after(t);else sheet.appendChild(t);
      const np=document.createElement("p");np.innerHTML="<br>";t.after(np);
      closePanel();touch();sync()}});

$("bPageFmt").onclick=()=>panel("Sayfa düzeni",
  `<div class="fld"><label>Yönlendirme</label><div class="chips">
     <button data-o="1" class="${doc.page.orient===1?"on":""}">Dikey</button>
     <button data-o="0" class="${doc.page.orient===0?"on":""}">Yatay</button></div></div>
   <div class="fld"><label>Kenar boşlukları (pt)</label><div class="two">
     <input id="mt" type="number" value="${doc.page.mt}"><input id="mb" type="number" value="${doc.page.mb}"></div>
     <div class="two" style="margin-top:8px">
     <input id="ml" type="number" value="${doc.page.ml}"><input id="mr" type="number" value="${doc.page.mr}"></div></div>
   <div class="pact"><button class="wb" id="pgR">2 cm</button><button class="wb pri" id="pgOk">Uygula</button></div>`,
  ()=>{$("panel").querySelectorAll("[data-o]").forEach(b=>b.onclick=()=>{doc.page.orient=+b.dataset.o;
      $("panel").querySelectorAll("[data-o]").forEach(x=>x.classList.toggle("on",x===b))});
    $("pgR").onclick=()=>["mt","mb","ml","mr"].forEach(k=>$(k).value=56.7);
    $("pgOk").onclick=()=>{["mt","mb","ml","mr"].forEach(k=>doc.page[k]=parseFloat($(k).value)||56.7);
      applyPage();closePanel();touch()}});

const findPanel=()=>panel("Bul ve değiştir",
  `<div class="fld"><label>Aranan</label><input id="fq" placeholder="Metin"></div>
   <div class="fld"><label>Yenisi</label><input id="fr" placeholder="Değiştirilecek metin"></div>
   <div class="hits" id="fh"></div>
   <div class="pact"><button class="wb" id="fN">Bul</button><button class="wb pri" id="fA">Tümünü değiştir</button></div>`,
  ()=>{const rx=q=>new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi");
    const count=()=>{const q=$("fq").value;if(!q){$("fh").textContent="";return}
      const n=(sheet.innerText.match(rx(q))||[]).length;$("fh").textContent=n?n+" sonuç":"Sonuç yok"};
    $("fq").oninput=count;
    $("fN").onclick=()=>{const q=$("fq").value;if(!q)return;closePanel();sheet.focus();
      if(window.find)window.find(q,false,false,true)};
    $("fA").onclick=()=>{const q=$("fq").value,r=$("fr").value;if(!q)return;
      const w=document.createTreeWalker(sheet,NodeFilter.SHOW_TEXT);let n,c=0;const hit=[];
      while((n=w.nextNode()))if(rx(q).test(n.nodeValue))hit.push(n);
      hit.forEach(n=>{n.nodeValue=n.nodeValue.replace(rx(q),()=>{c++;return r})});
      $("fh").textContent=c+" değişiklik yapıldı";touch()}});
$("bFind").onclick=findPanel;$("bFind2").onclick=findPanel;

$("bWordInfo").onclick=()=>{const t=(sheet.innerText||"").trim();
  const w=t?t.split(/\s+/).length:0;
  panel("Kelime bilgisi",`<div class="fld">Kelime: <b>${w.toLocaleString("tr-TR")}</b><br>
    Karakter: <b>${t.replace(/\n/g,"").length.toLocaleString("tr-TR")}</b><br>
    Paragraf: <b>${sheet.querySelectorAll("p,li").length}</b></div>
    <div class="pact"><button class="wb pri" onclick="closePanel()">Kapat</button></div>`)};
$("bSelInfo").onclick=()=>{const s=String(getSelection());
  panel("Seçim bilgisi",`<div class="fld">Seçili karakter: <b>${s.length}</b><br>
    Seçili kelime: <b>${s.trim()?s.trim().split(/\s+/).length:0}</b></div>
    <div class="pact"><button class="wb pri" onclick="closePanel()">Kapat</button></div>`)};

/* ---- görünüm / dosya ---- */
$("bView").onclick=()=>{const w=document.body.dataset.view==="write";
  document.body.dataset.view=w?"page":"write";
  $("bView").classList.toggle("on",w);
  if(w)fitPage();else{doc.zoom=125;applyZoom()}
  fitSheet();stats();};
/* PDF çıktısı. Android WebView'da window.print() sessizce hiçbir şey yapmaz;
   uygulama içinde native-bridge bu fonksiyonun üzerine yazıp sistemin
   yazdırma servisini çağırıyor ("PDF olarak kaydet" oradan çıkıyor). */
window.exportPdf=()=>{
  const v=document.body.dataset.view;
  document.body.dataset.view="page";
  document.body.classList.add("printing");
  setTimeout(()=>{
    try{ window.print() }catch(_){}
    setTimeout(()=>{document.body.dataset.view=v;document.body.classList.remove("printing")},400);
  },150);
};
$("bPdf").onclick=()=>window.exportPdf();
$("bSaveAs").onclick=()=>panel("Farklı kaydet",
  `<div class="fld"><label>Dosya adı</label><input id="sn" value="${esc(doc.name.replace(/\.udf$/i,""))}"></div>
   <div class="pact"><button class="wb" id="snC">Vazgeç</button><button class="wb pri" id="snOk">Kaydet</button></div>`,
  ()=>{$("snC").onclick=closePanel;
    $("snOk").onclick=async()=>{const n=$("sn").value.trim()||"belge";
      await (window.saveUdfAs||saveUdf)(n);closePanel()}});

$("bOpen").onclick=$("bOpen2").onclick=()=>$("fUdf").click();
$("fUdf").onchange=e=>{const f=e.target.files[0];if(f)openFile(f);e.target.value=""};
$("bSave").onclick=()=>{if(doc.loaded)saveUdf()};
const newDoc=()=>{hideNotice();doc.kaynakUri=null;doc.imza=null;doc.sayfaHam=null;doc.udfHam=null;doc.kaynakXml=null;doc.page=YENI_SAYFA();
  load('<p><br></p>',"isimsiz.UDF");sheet.focus()};
$("bNew").onclick=newDoc;$("bNew2").onclick=newDoc;

addEventListener("keydown",e=>{
  if(!(e.ctrlKey||e.metaKey))return;
  const k=e.key.toLowerCase();
  if(k==="s"){e.preventDefault();if(doc.loaded)saveUdf()}
  if(k==="f"){e.preventDefault();findPanel()}
  if(k==="o"){e.preventDefault();$("fUdf").click()}
});
addEventListener("beforeunload",e=>{if(doc.dirty){e.preventDefault();e.returnValue=""}});


/* Sınamaların erişebilmesi için: top-level const/let bağlantıları window
   üzerinde görünmüyor (fonksiyon bildirimlerinin aksine). */
window.editorToUdfHtml=editorToUdfHtml;
window.udfHtmlToEditor=udfHtmlToEditor;
window.doc=doc;
window.fitSheet=fitSheet;
window.applyPage=applyPage;

loadRecent();if(document.body.dataset.view==="page")fitPage();else applyZoom();fitSheet();layoutTabs();
