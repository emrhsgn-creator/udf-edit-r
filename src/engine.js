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

const doc={name:"isimsiz.UDF",dirty:false,loaded:false,fore:"#FF1B0F",back:"#FFFF00",zoom:125,
  page:{w:595.28,h:841.89,mt:56.7,mr:56.7,mb:56.7,ml:56.7,orient:1}};

const store={
  async get(k){try{const r=await window.storage.get(k);return r?JSON.parse(r.value):null}catch(_){return null}},
  async set(k,v){try{await window.storage.set(k,JSON.stringify(v))}catch(_){}},
  async list(p){try{const r=await window.storage.list(p);return r?r.keys:[]}catch(_){return []}}
};

/* ================= UDF <-> EDİTÖR ================= */
function udfHtmlToEditor(html){
  const d=document.createElement("div"); d.innerHTML=html;
  d.querySelectorAll("tab").forEach(t=>{const s=document.createElement("span");
    s.dataset.udf="tab"; s.textContent="\u00A0\u00A0\u00A0\u00A0"; t.replaceWith(s)});
  d.querySelectorAll("page-break").forEach(t=>{const s=document.createElement("div");
    s.dataset.udf="pagebreak"; s.contentEditable="false"; s.textContent="— Sayfa sonu —"; t.replaceWith(s)});
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
  return o.length?` style="${o.join(";")}"`:"";
}

function blocksHtml(root){
  const out=[];
  for(const el of root.children){
    const T=el.tagName;
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
  return out.join("");
}
const editorToUdfHtml=()=>blocksHtml(sheet)||"<p></p>";

/* ================= DOSYA ================= */
async function openFile(file){
  hideNotice();
  try{
    const html=await window.UDF.toHtml(await file.arrayBuffer());
    load(udfHtmlToEditor(html),file.name);
  }catch(e){
    showNotice(`<span class="mk">!</span><span><b>Dosya açılamadı.</b> ${esc(String(e.message||e))}</span>`);
  }
}
function load(html,name){
  doc.name=name;doc.loaded=true;sheet.innerHTML=html;
  $("empty").hidden=true;$("wrap").hidden=false;
  $("fname").textContent="Doküman Editörü — "+name;
  applyPage();setDirty(false);stats();saveRecent();
}
async function saveUdf(asName){
  const name=String(asName||doc.name).replace(/\.udf$/i,"")+".udf";
  const blob=await window.UDF.toUdf(editorToUdfHtml());
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  doc.name=name;$("fname").textContent="Doküman Editörü — "+name;setDirty(false);saveRecent();
}
async function saveRecent(){await store.set("recent:"+doc.name,{name:doc.name,html:sheet.innerHTML,at:Date.now(),page:doc.page})}
async function loadRecent(){
  const keys=await store.list("recent:");if(!keys.length)return;
  const items=(await Promise.all(keys.map(k=>store.get(k)))).filter(Boolean).sort((a,b)=>b.at-a.at).slice(0,6);
  if(!items.length)return;
  $("recent").hidden=false;$("recentList").innerHTML="";
  items.forEach(it=>{const b=document.createElement("button");
    b.innerHTML=`${esc(it.name)}<span>${new Date(it.at).toLocaleDateString("tr-TR")}</span>`;
    b.onclick=()=>{if(it.page)doc.page=it.page;load(it.html,it.name)};
    $("recentList").appendChild(b)});
}

/* ================= DURUM ================= */
function setDirty(v){doc.dirty=v;$("stMode").textContent=v?"Değişti":"Ekle"}
function stats(){
  const txt=sheet.innerText||"";
  $("stPara").textContent="Paragraf : "+sheet.querySelectorAll("p,li").length;
  $("stChar").textContent="Karakter : "+txt.replace(/\n/g,"").length.toLocaleString("tr-TR");
  const pages=1+sheet.querySelectorAll('[data-udf="pagebreak"]').length;
  $("stPage").textContent=`Sayfa : 1 / ${pages}`;
}
function showNotice(h){$("notice").innerHTML=h;$("notice").classList.add("show")}
function hideNotice(){$("notice").classList.remove("show")}

function applyPage(){
  const p=doc.page,land=p.orient===0;
  sheet.style.setProperty("--pw",(land?p.h:p.w)+"pt");
  sheet.style.setProperty("--mt",p.mt+"pt");sheet.style.setProperty("--mr",p.mr+"pt");
  sheet.style.setProperty("--mb",p.mb+"pt");sheet.style.setProperty("--ml",p.ml+"pt");
  $("stPaper").textContent=(land?"A4 Yatay":"A4 Kâğıt");
  applyZoom();
}
function applyZoom(){
  document.documentElement.style.setProperty("--zoom",(doc.zoom/100).toFixed(2));
  $("stZoom").textContent="%"+doc.zoom;$("zoomR").value=doc.zoom;
}
function fitPage(){
  const land=doc.page.orient===0,w=(land?doc.page.h:doc.page.w)*(96/72);
  doc.zoom=Math.round(Math.min(100,($("main").clientWidth-16)/w*100));applyZoom();
}
$("zoomR").oninput=e=>{doc.zoom=+e.target.value;applyZoom()};
$("bZoomIn").onclick=()=>{doc.zoom=Math.min(200,doc.zoom+10);applyZoom()};
$("bZoomOut").onclick=()=>{doc.zoom=Math.max(50,doc.zoom-10);applyZoom()};
addEventListener("resize",()=>{if(document.body.dataset.view==="page")fitPage()});

/* ================= SEÇİM ================= */
function curBlock(sel){const s=getSelection();if(!s.rangeCount)return null;
  let n=s.getRangeAt(0).startContainer;if(n.nodeType===3)n=n.parentElement;return n?n.closest(sel):null}
const curPara=()=>curBlock("p,li,div"), curCell=()=>curBlock("td"), curTable=()=>curBlock("table");
function eachPara(fn){
  const s=getSelection();
  if(!s.rangeCount){const p=curPara();if(p)fn(p);return}
  const r=s.getRangeAt(0);
  const all=[...sheet.querySelectorAll("p,li")].filter(p=>r.intersectsNode(p));
  (all.length?all:[curPara()].filter(Boolean)).forEach(fn);
}

/* ================= KOMUTLAR ================= */
document.execCommand("styleWithCSS",false,true);
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

function wrapSel(apply){
  const s=getSelection();if(!s.rangeCount)return;
  if(s.getRangeAt(0).collapsed){const p=curPara();
    if(p){if(!p.querySelector("span"))apply(p);else p.querySelectorAll("span").forEach(apply)}return}
  document.execCommand("fontSize",false,"7");
  sheet.querySelectorAll('font[size="7"]').forEach(f=>{
    const sp=document.createElement("span");apply(sp);
    while(f.firstChild)sp.appendChild(f.firstChild);f.replaceWith(sp)});
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
function touch(){setDirty(true);clearTimeout(tId);tId=setTimeout(()=>{stats();saveRecent()},600)}

sheet.addEventListener("input",()=>{
  sheet.querySelectorAll("div:not([data-udf])").forEach(d=>{
    if(d.closest("td"))return;
    const p=document.createElement("p");p.style.cssText=d.style.cssText;
    while(d.firstChild)p.appendChild(d.firstChild);d.replaceWith(p)});
  sheet.querySelectorAll("font").forEach(f=>{
    const s=document.createElement("span");
    if(f.color)s.style.color=f.color;if(f.face)s.style.fontFamily=f.face;
    while(f.firstChild)s.appendChild(f.firstChild);f.replaceWith(s)});
  touch();
});
sheet.addEventListener("paste",e=>{e.preventDefault();
  document.execCommand("insertText",false,(e.clipboardData||window.clipboardData).getData("text/plain"))});

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
$("bInsTab").onclick=()=>{const s=document.createElement("span");
  s.dataset.udf="tab";s.textContent="\u00A0\u00A0\u00A0\u00A0";insertNode(s);sheet.focus()};
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

/* ================= PANELLER ================= */
function panel(title,body,onOpen){
  $("panel").innerHTML=`<h3>${title}</h3>${body}`;
  $("panel").classList.add("on");$("scrim").classList.add("on");onOpen&&onOpen()}
function closePanel(){$("panel").classList.remove("on");$("scrim").classList.remove("on")}
$("scrim").onclick=closePanel;

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
    eachPara(p=>p.style.lineHeight=b.dataset.v);closePanel();sheet.focus();touch()}));

$("bParaFmt").onclick=()=>panel("Paragraf",
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
  if(w)fitPage();else{doc.zoom=125;applyZoom()}};
$("bPdf").onclick=()=>{const v=document.body.dataset.view;document.body.dataset.view="page";
  setTimeout(()=>{print();document.body.dataset.view=v},120)};
$("bSaveAs").onclick=()=>panel("Farklı kaydet",
  `<div class="fld"><label>Dosya adı</label><input id="sn" value="${esc(doc.name.replace(/\.udf$/i,""))}"></div>
   <div class="pact"><button class="wb" id="snC">Vazgeç</button><button class="wb pri" id="snOk">Kaydet</button></div>`,
  ()=>{$("snC").onclick=closePanel;
    $("snOk").onclick=async()=>{await saveUdf($("sn").value.trim()||"belge");closePanel()}});

$("bOpen").onclick=$("bOpen2").onclick=()=>$("fUdf").click();
$("fUdf").onchange=e=>{const f=e.target.files[0];if(f)openFile(f);e.target.value=""};
$("bSave").onclick=()=>{if(doc.loaded)saveUdf()};
const newDoc=()=>{hideNotice();doc.page={w:595.28,h:841.89,mt:56.7,mr:56.7,mb:56.7,ml:56.7,orient:1};
  load('<p style="text-align:justify"><br></p>',"isimsiz.UDF");sheet.focus()};
$("bNew").onclick=newDoc;$("bNew2").onclick=newDoc;

addEventListener("keydown",e=>{
  if(!(e.ctrlKey||e.metaKey))return;
  const k=e.key.toLowerCase();
  if(k==="s"){e.preventDefault();if(doc.loaded)saveUdf()}
  if(k==="f"){e.preventDefault();findPanel()}
  if(k==="o"){e.preventDefault();$("fUdf").click()}
});
addEventListener("beforeunload",e=>{if(doc.dirty){e.preventDefault();e.returnValue=""}});

loadRecent();applyZoom();
