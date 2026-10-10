"use strict";
/* Masaüstü UYAP Doküman Editörü'nün şerit düzenine eklenen düğmeler.
   Masaüstünde gri olan ya da telefonda karşılığı olmayan öğeler kabukta
   pasif bırakıldı; burada yalnızca çalışan öğeler bağlanıyor. */

const tikla=id=>()=>$(id).click();

/* ---- hızlı erişim çubuğu ---- */
$("qUndo").onclick=tikla("bUndo");
$("qRedo").onclick=tikla("bRedo");
$("qOpen").onclick=tikla("bOpen");
$("qSave").onclick=tikla("bSave");
$("qPrint").onclick=tikla("bPrint");
$("qSign").onclick=tikla("bSign");
["qUndo","qRedo"].forEach(id=>keep($(id)));
$("qFind").onkeydown=e=>{
  if(e.key!=="Enter")return;
  const q=e.target.value.trim(); if(!q)return;
  e.preventDefault(); sheet.focus();
  if(!(window.find&&window.find(q,false,false,true))) findPanel();
};

/* ---- Dosya ---- */
$("bBackups").onclick=async()=>{
  const keys=await store.list("recent:");
  const items=(await Promise.all(keys.map(k=>store.get(k)))).filter(Boolean).sort((a,b)=>b.at-a.at).slice(0,20);
  panel("Yedekleri aç",items.length
    ? `<div class="recent pnl">${items.map((it,i)=>`<button data-i="${i}">${esc(it.name)}<span>${new Date(it.at).toLocaleString("tr-TR",{dateStyle:"short",timeStyle:"short"})}</span></button>`).join("")}</div>
       <div class="pact"><button class="wb" id="ykK">Kapat</button></div>`
    : `<p>Kayıtlı yedek yok. Editör, üzerinde çalıştığınız belgeyi her değişiklikte bu cihaza yedekler.</p><div class="pact"><button class="wb" id="ykK">Kapat</button></div>`,
    ()=>{ $("ykK").onclick=closePanel;
      $("panel").querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{
        const it=items[+b.dataset.i]; closePanel(); hideNotice();
        if(it.page)doc.page=it.page; doc.imza=null; doc.kaynakXml=null; doc.kaynakUri=null; doc.udfHam=it.udfHam||null; load(it.html,it.name);
      })});
};
$("bSaveAll").onclick=tikla("bSaveAs");
$("bPrint").onclick=()=>window.exportPdf();
$("bPreview").onclick=tikla("bView");
$("bSend").onclick=async()=>{
  if(!doc.loaded)return;
  const r=await window.kaydedilecek();
  if(!r.ok){ kayipUyar(r); return }
  const ad=String(doc.name).replace(/\.udf$/i,"")+".udf";
  if(window.paylas) return window.paylas([{ad,blob:r.blob}]);
  const f=new File([r.blob],ad,{type:"application/octet-stream"});
  if(navigator.canShare&&navigator.canShare({files:[f]})){
    try{ await navigator.share({files:[f],title:ad}) }catch(_){}
  }else showNotice('<span class="mk">!</span><span>Bu cihaz dosya paylaşımını desteklemiyor; <b>Kaydet</b>i kullanın.</span>');
};

/* ---- Giriş: biçim kopyala ----
   Seçimin biçimini alır; ardından seçilen ilk metne uygular (masaüstündeki gibi tek seferlik). */
let bicimKopya=null;
$("bFmtCopy").onclick=()=>{
  const s=getSelection(); if(!s.rangeCount)return;
  let el=s.getRangeAt(0).startContainer; if(el.nodeType===3) el=el.parentElement;
  if(!sheet.contains(el))return;
  const c=getComputedStyle(el);
  bicimKopya={fontFamily:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,fontStyle:c.fontStyle,
    textDecoration:c.textDecorationLine,color:c.color,backgroundColor:c.backgroundColor};
  $("bFmtCopy").classList.add("on");
  showNotice('<span class="mk">✎</span><span>Biçim kopyalandı. Uygulamak istediğiniz metni seçin.</span>');
};
const bicimUygula=()=>{
  if(!bicimKopya)return;
  const s=getSelection(); if(!s.rangeCount||s.isCollapsed||!sheet.contains(s.anchorNode))return;
  const k=bicimKopya; bicimKopya=null; $("bFmtCopy").classList.remove("on"); hideNotice();
  saveSel();
  wrapSel(sp=>{
    sp.style.fontFamily=k.fontFamily; sp.style.fontSize=k.fontSize; sp.style.fontWeight=k.fontWeight;
    sp.style.fontStyle=k.fontStyle; sp.style.textDecoration=k.textDecoration; sp.style.color=k.color;
    if(k.backgroundColor&&!/rgba\(0, 0, 0, 0\)|transparent/.test(k.backgroundColor)) sp.style.backgroundColor=k.backgroundColor;
  });
  sync(); touch();
};
sheet.addEventListener("mouseup",()=>setTimeout(bicimUygula,0));
sheet.addEventListener("touchend",()=>setTimeout(bicimUygula,250));

/* ---- Ekle ---- */
$("bParaAdd").onclick=()=>{
  const p=curPara(), np=document.createElement("p");
  np.innerHTML="<br>"; if(p) np.style.cssText=p.style.cssText;
  if(p) p.after(np); else sheet.appendChild(np);
  const r=document.createRange(); r.setStart(np,0); r.collapse(true);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); sheet.focus(); touch(); stats();
};
$("bGoto").onclick=()=>panel("Sayfaya git",
  `<div class="fld"><label>Sayfa numarası</label><input id="gN" type="number" inputmode="numeric" min="1" value="1"></div>
   <div class="pact"><button class="wb" id="gK">Vazgeç</button><button class="wb pri" id="gT">Git</button></div>`,
  ()=>{ $("gK").onclick=closePanel; $("gN").focus();
    $("gT").onclick=()=>{
      const n=Math.max(1,parseInt($("gN").value)||1); closePanel();
      if(document.body.dataset.view!=="page") $("bView").click();
      setTimeout(()=>{
        const ph=parseFloat(getComputedStyle(sheet).getPropertyValue("--ph"))||sheet.offsetHeight;
        const z=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom"))||1;
        $("main").scrollTop=sheet.offsetTop+(n-1)*ph*z;
      },120);
    }});
const SEMBOLLER="§ ₺ € $ £ ° ± × ÷ ≤ ≥ ≠ ≈ ‰ % « » “ ” ‘ ’ „ • · – — … ← → ↑ ↓ ⇒ ✓ ✗ © ® ™ ½ ¼ ¾ ¹ ² ³ µ Ω α β π Σ √ ∞ ¶ † ‡ Ç ç Ğ ğ İ ı Ö ö Ş ş Ü ü Â â Î î Û û".split(" ");
$("bSymbol").onclick=()=>panel("Sembol ekle",
  `<div class="semb">${SEMBOLLER.map(c=>`<button data-c="${c}">${c}</button>`).join("")}</div>
   <div class="pact"><button class="wb" id="smK">Kapat</button></div>`,
  ()=>{ $("smK").onclick=closePanel;
    $("panel").querySelectorAll("[data-c]").forEach(b=>{ keep(b); b.onclick=()=>{
      restoreSel(); insertNode(document.createTextNode(b.dataset.c)); saveSel();
    }})});

/* ---- Biçim ---- */
$("bFontDlg").onclick=()=>{
  const f=$("selFont"), z=$("selSize");
  dialog("Yazı Özellikleri",
    `<div class="cols"><fieldset class="fs"><legend>Yazı</legend>
       <div class="frow"><label for="yfF">Yazı tipi:</label><select id="yfF">${f.innerHTML}</select></div>
       <div class="frow"><label for="yfS">Boyut:</label><select id="yfS">${z.innerHTML}</select></div>
     </fieldset></div>
     <fieldset class="fs"><legend>önizleme</legend><div class="prev" id="yfP" style="font-size:16px;padding:10px">AaBbÇçĞğİıÖöŞşÜü 123</div></fieldset>`,
    `<span class="sp"></span><button class="dbtn pri" id="yfOk"><u>T</u>amam</button><button class="dbtn" id="yfNo"><u>V</u>azgeç</button>`,
    ()=>{
      $("yfF").value=f.value; $("yfS").value=z.value;
      const on=()=>{ $("yfP").style.fontFamily=$("yfF").value; $("yfP").style.fontSize=Math.min(36,+$("yfS").value*1.33)+"px" };
      $("yfF").onchange=$("yfS").onchange=on; on();
      $("yfNo").onclick=closeDialog;
      $("yfOk").onclick=()=>{
        closeDialog(); restoreSel();
        if(f.value!==$("yfF").value){ f.value=$("yfF").value; f.dispatchEvent(new Event("change")) }
        if(z.value!==$("yfS").value){ restoreSel(); z.value=$("yfS").value; z.dispatchEvent(new Event("change")) }
      };
    });
};
const harfAyar=()=>{
  sheet.spellcheck=$("cSpell").checked;
  sheet.setAttribute("autocapitalize",$("cAutoCap").checked?"sentences":"off");
  try{ localStorage.setItem("harfDenetimi",JSON.stringify({s:$("cSpell").checked,a:$("cAutoCap").checked,b:$("cInitCap").checked})) }catch(_){}
};
try{ const h=JSON.parse(localStorage.getItem("harfDenetimi")); if(h){ $("cSpell").checked=h.s; $("cAutoCap").checked=h.a; $("cInitCap").checked=h.b } }catch(_){}
["cSpell","cAutoCap","cInitCap"].forEach(id=>$(id).onchange=harfAyar); harfAyar();
$("bSpell").onclick=()=>{
  $("cSpell").checked=true; harfAyar(); sheet.focus();
  showNotice('<span class="mk">✓</span><span>Yazım denetimi açık: hatalı kelimelerin altı çizilir. Öneri için kelimeye uzun dokunun.</span>');
  setTimeout(hideNotice,4000);
};

/* ---- Araçlar ---- */
$("bUpdate").onclick=async()=>{
  showNotice('<span class="mk">↻</span><span>Güncelleme denetleniyor…</span>');
  try{
    const r=navigator.serviceWorker&&await navigator.serviceWorker.getRegistration();
    if(r) await r.update();
  }catch(_){}
  if(doc.dirty){ showNotice('<span class="mk">!</span><span>Önce belgeyi kaydedin; sonra <b>Editörü Güncelle</b>ye yeniden dokunun.</span>'); return }
  location.reload();
};

/* ---- Görünüm / Yardım ---- */
const SURUM="1.1.0";
$("bNotes").onclick=()=>panel("Sürüm notları",
  `<div class="fld" style="line-height:1.6"><b>${SURUM}</b><br>
   • E-imza: telefona OTG ile takılı e-imza kartıyla ya da bilgisayardaki e-imzayla belge imzalama<br>
   • Toplu imzalama; imzalı belgeyi tanıma ve doğrulama (Araçlar → İmzalar)<br>
   • Şerit, masaüstü UYAP Doküman Editörü ile aynı sekme ve gruplara getirildi<br>
   • Sembol ekle, sayfaya git, biçim kopyala, yazı özellikleri</div>
   <div class="pact"><button class="wb pri" onclick="closePanel()">Kapat</button></div>`);
$("bHelp").onclick=()=>panel("Yardım",
  `<div class="fld" style="line-height:1.6">
   <b>İmzalama</b> — Araçlar → İmzala. <b>APDU Etkin</b> açıkken imza telefona takılı kartla atılır
   (USB-C/OTG adaptörü + kart okuyucu ya da token). Kapalıyken bilgisayardaki e-imza kullanılır:
   bilgisayarda <b>UDF-Imza-Koprusu</b>'nu açın, penceresindeki adres ve eşleşme kodunu girin.<br>
   <b>İmzalı belge</b> — Değiştirmeden kaydederseniz imza korunur. Değiştirirseniz imza kalkar;
   yeniden imzalamanız gerekir.<br>
   <b>Toplu İmzala</b> — Dosya → Toplu İmzala: birden çok UDF'yi tek PIN girişiyle imzalar.</div>
   <div class="pact"><button class="wb pri" onclick="closePanel()">Kapat</button></div>`);
