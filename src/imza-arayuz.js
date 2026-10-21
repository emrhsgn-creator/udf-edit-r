"use strict";
/* E-imza arayüzü: imzalı belgeyi tanıma, İmzala penceresi, imza kaynakları.

   Kaynaklar yalnızca ham imza verir; sign.sgn burada (imza.js) kurulur.
   - USB: Android uygulamasında telefona OTG ile takılı kart okuyucu (Eimza eklentisi)
   - Bilgisayar: aynı ağdaki Windows bilgisayarda çalışan imza köprüsü
     (masaustu-imza/kopru.py). Android uygulamasında istekler yerel eklentiyle,
     sertifika parmak izi eşleşme koduyla doğrulanarak; tarayıcıda/iPhone'da
     fetch ile (köprünün kök sertifikası bir kez kurulur) gider. */

const yerel=()=>!!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform());
const eklenti=ad=>yerel()&&Capacitor.Plugins&&Capacitor.Plugins[ad];
const b64=u=>{let s="";for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)};
const b64Coz=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const tarih=d=>d?d.toLocaleDateString("tr-TR"):"—";
const tarihSaat=d=>d?d.toLocaleString("tr-TR",{dateStyle:"short",timeStyle:"short"}):"—";

/* ---------------- imzalı UDF ---------------- */
async function imzaliMi(ab){
  try{
    const z=await JSZip.loadAsync(ab), s=z.file("sign.sgn"), c=z.file("content.xml");
    doc.kaynakXml=c?await c.async("uint8array"):null;
    if(!s||!c) return null;
    const sgn=await s.async("uint8array"), xml=doc.kaynakXml;
    const bilgi=await Imza.imzaOku(sgn,xml);
    return {zip:new Uint8Array(ab), bilgi};
  }catch(e){ return null }
}

/* Masaüstü editördeki gibi: imzalı belgede sayfanın sağ üstünde mühür ve
   imzacı adı. Kağıdın içine değil üstüne çizilir; belge içeriğine karışmaz. */
const muhur=document.createElement("div");
muhur.className="muhur"; muhur.hidden=true;
muhur.innerHTML=`<svg viewBox="0 0 40 52" aria-hidden="true"><path d="M10 26 4 50l9-5 5 7 4-22zM30 26l6 24-9-5-5 7-4-22z" fill="#D9442E"/><circle cx="20" cy="18" r="15" fill="#F2B632" stroke="#C98912" stroke-width="2"/><circle cx="20" cy="18" r="10" fill="none" stroke="#FFE08A" stroke-width="1.5"/></svg><span></span>`;
$("wrap").appendChild(muhur);
muhur.onclick=()=>imzaBilgisi();
function muhurKonum(){
  const i=doc.imza, r=i&&i.bilgi[0];
  muhur.hidden=!(r&&r.imzaGecerli&&r.belgeDegismemis&&!doc.dirty)||$("wrap").hidden;
  if(muhur.hidden) return;
  muhur.querySelector("span").textContent=(r.sertifika&&r.sertifika.ad)||"";
  const w=$("wrap").getBoundingClientRect(), k=sheet.getBoundingClientRect();
  muhur.style.top=(k.top-w.top+10)+"px";
  muhur.style.right=(w.right-k.right+10)+"px";
}
addEventListener("resize",muhurKonum);
{ const eski=window.applyZoom; window.applyZoom=function(){ eski.apply(this,arguments); muhurKonum() } }
{ const eski=window.fitSheet; window.fitSheet=function(){ eski.apply(this,arguments); muhurKonum() } }

function imzaDurumu(){
  muhurKonum();
  const st=$("stImza"); if(!st) return;
  const i=doc.imza;
  if(!i){ st.hidden=true; return }
  st.hidden=false;
  const r=i.bilgi[0];
  const gecerli=r&&r.imzaGecerli&&r.belgeDegismemis&&!doc.dirty;
  st.className="imz "+(gecerli?"ok":"no");
  st.textContent=doc.dirty?"İmza kalkacak":gecerli?"İmzalı":"İmza geçersiz";
}

function imzaOzeti(r){
  if(!r) return "İmza okunamadı";
  const s=r.sertifika||{};
  const durum = r.imzaGecerli===false ? "<b style='color:#C00000'>İMZA GEÇERSİZ</b>"
    : r.belgeDegismemis===false ? "<b style='color:#C00000'>Belge imzadan sonra değiştirilmiş</b>"
    : r.imzaGecerli ? "<b style='color:#1E7B34'>İmza matematiksel olarak geçerli</b>" : "İmza doğrulanamadı";
  return `${durum}<br><b>${esc(s.ad||"")}</b>${s.unvan?" — "+esc(s.unvan):""}<br>`+
    `İmza zamanı: ${tarihSaat(r.zaman)}<br>Sertifika: ${esc(s.yayinci||"")} (geçerlilik ${tarih(s.bitis)})`;
}

/* openFile çağırır: belge imzalıysa bilgiyi göster, imzayı (değişmezse) koru. */
async function imzaYukle(ab){
  doc.imza=await imzaliMi(ab);
  doc.imzaUyarildi=false;
  imzaDurumu();
  if(doc.imza){
    showNotice(`<span class="mk" style="color:#1E7B34">✎</span><span>Bu belge e-imzalı. ${imzaOzeti(doc.imza.bilgi[0])}<br>`+
      `Değişiklik yapmadan kaydederseniz imza korunur; değiştirirseniz imza kalkar ve yeniden imzalamanız gerekir.</span>`);
  }
}

/* Kaydetmeden önce: imzalı ve değişmemişse asıl dosyayı aynen ver. */
async function kaydedilecek(){
  if(doc.imza&&!doc.dirty) return {ok:true, blob:new Blob([doc.imza.zip],{type:"application/octet-stream"})};
  if(doc.imza){ doc.imza=null; imzaDurumu() }
  return udfUret();
}
window.kaydedilecek=kaydedilecek;

/* Belgede ilk değişiklikte bir kez uyar. */
function imzaDegisti(){
  imzaDurumu();
  if(doc.imza&&!doc.imzaUyarildi){
    doc.imzaUyarildi=true;
    showNotice('<span class="mk">!</span><span>İmzalı belgede değişiklik yaptınız. Kaydederken <b>imza kaldırılacak</b>. '+
      'Yeniden imzalamak için <b>Araçlar → İmzala</b>.</span>');
  }
}

/* ---------------- kaynaklar ---------------- */
const KOPRU_ANAHTAR="imzaKoprusu";
function kopruAyar(){ try{ return JSON.parse(localStorage.getItem(KOPRU_ANAHTAR))||{} }catch(_){ return {} } }
function kopruKaydet(a){ try{ localStorage.setItem(KOPRU_ANAHTAR,JSON.stringify(a)) }catch(_){} }
const kodNormal=k=>String(k||"").toUpperCase().replace(/[^A-Z0-9]/g,"");

async function hmacHex(anahtar,veri){
  const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(anahtar),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return Imza.hex(new Uint8Array(await crypto.subtle.sign("HMAC",k,veri)));
}

/* Bilgisayar köprüsüne istek. */
async function kopruIstek(yol,yontem,govde){
  const a=kopruAyar();
  if(!a.adres||!a.kod) throw new Error("Köprü adresi ve eşleşme kodu girilmedi.");
  const adres=a.adres.includes(":")?a.adres:a.adres+":5976";
  const K=eklenti("Kopru");
  let durum, metin;
  if(K){
    const r=await K.istek({url:`https://${adres}${yol}`,yontem,govde:govde?JSON.stringify(govde):null,
      kod:a.kod,parmakIzi:a.parmakIzi||null});
    durum=r.durum; metin=r.govde;
  }else{
    let y;
    try{
      y=await fetch(`https://${adres}${yol}`,{method:yontem,cache:"no-store",
        headers:Object.assign({"X-Eslesme":a.kod},govde?{"Content-Type":"application/json"}:{}),
        body:govde?JSON.stringify(govde):undefined});
    }catch(e){
      throw new Error("Bilgisayardaki köprüye ulaşılamadı. Köprü açık mı, telefon aynı Wi-Fi'de mi? "+
        "iPhone/iPad'de köprünün sertifikası kurulu ve tam güven açık olmalı (köprü penceresindeki kare kod).");
    }
    durum=y.status; metin=await y.text();
  }
  let j={}; try{ j=JSON.parse(metin) }catch(_){}
  if(durum<200||durum>=300){ const e=new Error(j.hata||("Köprü hatası "+durum)); e.pin=j.pin; throw e }
  return j;
}

/* Android: ilk bağlantıda sunucu sertifikasını eşleşme koduyla doğrula ve sabitle. */
async function kopruEsles(){
  const a=kopruAyar(), K=eklenti("Kopru");
  if(!K) return;                              // tarayıcıda güveni sistem/kurulu kök sağlar
  const adres=a.adres.includes(":")?a.adres:a.adres+":5976";
  const nonce=Imza.hex(crypto.getRandomValues(new Uint8Array(16)));
  const r=await K.istek({url:`https://${adres}/durum?n=${nonce}`,yontem:"GET",govde:null,kod:null,parmakIzi:null});
  let j={}; try{ j=JSON.parse(r.govde) }catch(_){}
  if(!j.kanit||!r.parmakIzi) throw new Error("Köprü yanıtı tanınmadı. Köprü sürümünü güncelleyin.");
  const fp=Uint8Array.from(r.parmakIzi.match(/../g).map(h=>parseInt(h,16)));
  const beklenen=await hmacHex(kodNormal(a.kod),birlesik(new TextEncoder().encode(nonce),fp));
  if(beklenen!==j.kanit) throw new Error("Eşleşme kodu yanlış ya da ağda araya giren biri var. Kodu bilgisayardaki pencereden yeniden okuyun.");
  a.parmakIzi=r.parmakIzi; kopruKaydet(a);
}
function birlesik(a,b){ const o=new Uint8Array(a.length+b.length); o.set(a); o.set(b,a.length); return o }

const KAYNAKLAR={
  usb:{
    ad:"Telefona takılı e-imza (USB)",
    mevcut:()=>!!eklenti("Eimza"),
    async sertifikalar(){ return (await eklenti("Eimza").sertifikalar()).sertifikalar },
    async imzala(id,pin,veri,alg){
      try{ return b64Coz((await eklenti("Eimza").imzala({id,pin,veri:b64(veri),alg})).imza) }
      catch(e){ const h=new Error(String(e.message||e)); h.pin=/PIN/i.test(h.message); throw h }
    }
  },
  pc:{
    ad:"Bilgisayardaki e-imza",
    mevcut:()=>true,
    async sertifikalar(){ await kopruEsles(); return (await kopruIstek("/sertifikalar","GET")).sertifikalar },
    async imzala(id,pin,veri,alg){
      const r=await kopruIstek("/imzala","POST",{id,pin,veri:b64(veri),alg,belge:doc.name});
      return b64Coz(r.imza);
    }
  }
};

/* "APDU Etkin": açıkken imza bu telefona takılı kartla (APDU), kapalıyken
   bilgisayardaki e-imzayla. Masaüstü editördeki düğmenin karşılığı. */
function kaynakSecili(){
  let k=null; try{ k=localStorage.getItem("imzaKaynak") }catch(_){}
  if(!k) k=KAYNAKLAR.usb.mevcut()?"usb":"pc";
  return KAYNAKLAR[k]&&KAYNAKLAR[k].mevcut()?k:"pc";
}
function kaynakYaz(k){ try{ localStorage.setItem("imzaKaynak",k) }catch(_){} apduDurumu() }
function apduDurumu(){ const b=$("bApdu"); if(b) b.classList.toggle("on",kaynakSecili()==="usb") }

/* ---------------- İmzala penceresi ----------------
   ayar.dosyalar: Toplu İmzala için [{ad, xml}] — verilmezse açık belge.
   ayar.liste: yalnızca sertifikaları göster (Araçlar → Sertifikalar). */
function imzalaPenceresi(ayar){
  ayar=ayar||{};
  if(!ayar.liste&&!ayar.dosyalar&&!doc.loaded){ showNotice('<span class="mk">!</span><span>Önce bir belge açın.</span>'); return }
  const kayit=kopruAyar();
  let kaynak=kaynakSecili();
  let sertler=[], secili=0;

  const body=`
    <div class="imzw">
      <fieldset class="fs"><legend>İmza aracı</legend>
        <div class="chips" id="iKay">${Object.entries(KAYNAKLAR).filter(([,k])=>k.mevcut()).map(([a,k])=>
          `<button data-k="${a}" class="${a===kaynak?"on":""}">${k.ad}</button>`).join("")}</div>
        <div id="iPc" class="ipc">
          <div class="frow"><label for="iAdr">Bilgisayar adresi:</label><input id="iAdr" placeholder="192.168.1.20:5976" value="${esc(kayit.adres||"")}" autocapitalize="off" autocomplete="off" inputmode="url"></div>
          <div class="frow"><label for="iKod">Eşleşme kodu:</label><input id="iKod" placeholder="ABCD-EFGH-JKLM" value="${esc(kayit.kod||"")}" autocapitalize="characters" autocomplete="off"></div>
          <div class="ipuc">Adres ve kod bilgisayarda <b>Uyap Asistan → Ayarlar → Telefondan e-imza</b> bölümünde yazar. Ofis dışındaysanız Tailscale açıkken <b>…ts.net</b> adresini girin.</div>
        </div>
      </fieldset>
      <fieldset class="fs"><legend>Sertifika</legend>
        <div id="iSert" class="isert"><div class="ipuc">Sertifikalar okunuyor…</div></div>
      </fieldset>
      ${ayar.dosyalar?`<fieldset class="fs"><legend>İmzalanacak belgeler (${ayar.dosyalar.length})</legend>
        <div class="ipuc">${ayar.dosyalar.map(d=>esc(d.ad)).join("<br>")}</div></fieldset>`:""}
      <div class="frow ipin"${ayar.liste?" hidden":""}><label for="iPin">PIN (şifre):</label><input id="iPin" type="password" inputmode="numeric" autocomplete="off" maxlength="16"></div>
      <div class="idurum" id="iDurum"></div>
    </div>`;
  const actions=`<button class="dbtn" id="iYen">Yenile</button><span class="sp"></span>`+
    (ayar.liste?`<button class="dbtn pri" id="iNo">Kapat</button><button id="iOk" hidden></button>`
               :`<button class="dbtn pri" id="iOk"><u>İ</u>mzala</button><button class="dbtn" id="iNo"><u>V</u>azgeç</button>`);

  dialog(ayar.liste?"Sertifikalar":ayar.dosyalar?"Toplu İmzala":"E-İmza",body,actions,()=>{
    const durum=(h,hata)=>{ $("iDurum").innerHTML=h; $("iDurum").classList.toggle("hata",!!hata) };
    const goster=()=>{
      $("iPc").hidden=kaynak!=="pc";
      $("dlg").querySelectorAll("[data-k]").forEach(b=>b.classList.toggle("on",b.dataset.k===kaynak));
    };
    const listele=async()=>{
      sertler=[]; secili=0; $("iOk").disabled=true;
      $("iSert").innerHTML='<div class="ipuc">Sertifikalar okunuyor…</div>'; durum("");
      if(kaynak==="pc"){
        const a=kopruAyar(), adr=$("iAdr").value.trim(), kod=$("iKod").value.trim();
        if(!adr||!kod){ $("iSert").innerHTML='<div class="ipuc">Adres ve eşleşme kodunu girip <b>Yenile</b>\'ye dokunun.</div>'; return }
        if(a.adres!==adr||kodNormal(a.kod)!==kodNormal(kod)) kopruKaydet({adres:adr,kod});
      }
      try{
        const liste=await KAYNAKLAR[kaynak].sertifikalar();
        sertler=liste.map(x=>Object.assign({id:x.id},Imza.sertifikaCoz(b64Coz(x.der))))
          .filter(s=>!/CA|Kök|Root/i.test(s.ad)||s.unvan);  // kök/ara sertifikaları gösterme
        if(!sertler.length){ $("iSert").innerHTML='<div class="ipuc">Kartta imza sertifikası bulunamadı.</div>'; return }
        const simdi=new Date();
        secili=Math.max(0,sertler.findIndex(s=>s.bitis>simdi));
        $("iSert").innerHTML=sertler.map((s,i)=>{
          const bitti=s.bitis<simdi;
          return `<label class="sopt${bitti?" bitti":""}"><input type="radio" name="iS" value="${i}" ${i===secili?"checked":""}>
            <span><b>${esc(s.ad)}</b>${s.unvan?" — "+esc(s.unvan):""}<br>
            <small>${esc(s.yayinci)} · ${bitti?"SÜRESİ DOLMUŞ ":"geçerli: "}${tarih(s.bitis)}</small></span></label>`}).join("");
        $("iSert").querySelectorAll("input").forEach(r=>r.onchange=()=>secili=+r.value);
        $("iOk").disabled=false; if(!ayar.liste) $("iPin").focus();
      }catch(e){
        $("iSert").innerHTML=`<div class="ipuc hata">${esc(String(e.message||e))}</div>`;
      }
    };
    $("dlg").querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{
      kaynak=b.dataset.k; kaynakYaz(kaynak); goster(); listele();
    });
    $("iYen").onclick=listele;
    $("iNo").onclick=closeDialog;
    $("iPin").onkeydown=e=>{ if(e.key==="Enter") $("iOk").click() };
    $("iOk").onclick=async()=>{
      const s=sertler[secili], pin=$("iPin").value;
      if(!s) return;
      if(!pin){ durum("PIN girin.",true); $("iPin").focus(); return }
      if(s.bitis<new Date()&&!confirm("Bu sertifikanın süresi dolmuş. UYAP kabul etmeyebilir. Yine de imzalansın mı?")) return;
      $("iOk").disabled=true; durum("İmzalanıyor… Kart işlem yaparken okuyucuyu çıkarmayın.");
      try{
        if(ayar.dosyalar) await topluImzala(KAYNAKLAR[kaynak],s,pin,ayar.dosyalar,durum);
        else await belgeyiImzala(KAYNAKLAR[kaynak],s,pin);
        $("iPin").value="";
        closeDialog();
      }catch(e){
        $("iPin").value="";
        durum(esc(String(e.message||e)),true);
        $("iOk").disabled=false;
        if(e.pin) $("iPin").focus();
      }
    };
    goster(); listele();
  });
}

/* content.xml'i imzala, UYAP'ın imzalı arşivini (content.xml + sign.sgn) üret.
   Kendi ürettiğimiz imza doğrulanmadan dosyaya yazılmaz. */
async function xmlImzala(kaynak,sert,pin,xml){
  const sgn=await Imza.cadesOlustur(xml,sert.der,(veri,s)=>kaynak.imzala(sert.id,pin,veri,s.anahtar));
  const kontrol=await Imza.imzaOku(sgn,xml);
  if(!kontrol[0]||!kontrol[0].imzaGecerli||!kontrol[0].belgeDegismemis)
    throw new Error("Kartın verdiği imza doğrulanamadı; belge imzalanmadı.");
  const yeni=new JSZip();
  yeni.file("content.xml",xml); yeni.file("sign.sgn",sgn);
  return {zip:await yeni.generateAsync({type:"uint8array",compression:"DEFLATE"}), kontrol};
}

async function belgeyiImzala(kaynak,sert,pin){
  // Açıldığından beri değişmemiş belgede asıl content.xml aynen imzalanır
  // (masaüstü editörün yaptığı gibi); değiştiyse editörden yeniden üretilir.
  let xml=!doc.dirty&&doc.kaynakXml;
  if(!xml){
    const r=await udfUret();
    if(!r.ok){ kayipUyar(r); throw new Error("Belge doğrulanamadı, imzalanmadı.") }
    const z=await JSZip.loadAsync(await r.blob.arrayBuffer());
    xml=await z.file("content.xml").async("uint8array");
  }
  const {zip,kontrol}=await xmlImzala(kaynak,sert,pin,xml);
  doc.kaynakXml=xml;
  doc.imza={zip,bilgi:kontrol}; doc.imzaUyarildi=false;
  setDirty(false); imzaDurumu();
  showNotice(`<span class="mk" style="color:#1E7B34">✓</span><span><b>Belge imzalandı.</b> ${imzaOzeti(kontrol[0])}</span>`);
  await (window.saveUdf||saveUdf)();
}

async function topluImzala(kaynak,sert,pin,dosyalar,durum){
  const cikti=[];
  for(let i=0;i<dosyalar.length;i++){
    durum(`İmzalanıyor (${i+1}/${dosyalar.length}): ${esc(dosyalar[i].ad)}…`);
    const {zip}=await xmlImzala(kaynak,sert,pin,dosyalar[i].xml);
    cikti.push({ad:dosyalar[i].ad.replace(/\.udf$/i,"")+".udf", blob:new Blob([zip],{type:"application/octet-stream"})});
  }
  await teslimEt(cikti);
  showNotice(`<span class="mk" style="color:#1E7B34">✓</span><span><b>${cikti.length} belge imzalandı.</b></span>`);
}

/* Birden çok dosyayı kullanıcıya ver: uygulamada paylaşım sayfası,
   tarayıcıda (iOS dahil) paylaşım; desteklenmiyorsa tek tek indirme. */
async function teslimEt(dosyalar){
  if(window.paylas) return window.paylas(dosyalar);
  const f=dosyalar.map(d=>new File([d.blob],d.ad,{type:"application/octet-stream"}));
  if(navigator.canShare&&navigator.canShare({files:f})){
    try{ await navigator.share({files:f}); return }catch(e){ if(e&&e.name==="AbortError") return }
  }
  for(const d of dosyalar){
    const a=document.createElement("a"); a.href=URL.createObjectURL(d.blob); a.download=d.ad;
    document.body.appendChild(a); a.click(); a.remove();
    await new Promise(r=>setTimeout(r,400));
  }
}

const topluGirdi=document.createElement("input");
topluGirdi.type="file"; topluGirdi.multiple=true; topluGirdi.accept=".udf,application/zip,application/octet-stream";
topluGirdi.onchange=async()=>{
  const dosyalar=[], atlanan=[];
  for(const f of topluGirdi.files){
    try{
      const z=await JSZip.loadAsync(await f.arrayBuffer()), c=z.file("content.xml");
      if(!c) throw 0;
      dosyalar.push({ad:f.name, xml:await c.async("uint8array")});
    }catch(_){ atlanan.push(f.name) }
  }
  topluGirdi.value="";
  if(atlanan.length) showNotice(`<span class="mk">!</span><span>UDF olmadığı için atlandı: ${atlanan.map(esc).join(", ")}</span>`);
  if(dosyalar.length) imzalaPenceresi({dosyalar});
};

function imzaBilgisi(){
  if(!doc.imza){ panel("İmza bilgisi",`<p>Bu belge imzalı değil.</p><div class="pact"><button class="wb" id="ibK">Kapat</button><button class="wb pri" id="ibI">İmzala</button></div>`,
    ()=>{ $("ibK").onclick=closePanel; $("ibI").onclick=()=>{closePanel();imzalaPenceresi()} }); return }
  panel("İmza bilgisi",`${doc.imza.bilgi.map(r=>`<p style="line-height:1.6">${imzaOzeti(r)}${r.sertifika&&r.sertifika.tckn?"<br>Seri no: "+esc(r.sertifika.tckn):""}</p>`).join("")||"<p>İmza okunamadı.</p>"}
    ${doc.dirty?"<p><b>Belgede kaydedilmemiş değişiklik var; kaydederken imza kalkacak.</b></p>":""}
    <div class="pact"><button class="wb" id="ibK">Kapat</button></div>`,()=>$("ibK").onclick=closePanel);
}

$("bSign").onclick=()=>imzalaPenceresi();
$("bCerts").onclick=()=>imzalaPenceresi({liste:true});
$("bBulkSign").onclick=()=>topluGirdi.click();
$("bApdu").onclick=()=>{
  if(!KAYNAKLAR.usb.mevcut()){
    showNotice('<span class="mk">!</span><span>Telefona takılı kartla imza (APDU) yalnızca Android uygulamasında var. '+
      'Burada bilgisayardaki e-imza kullanılır.</span>');
    return;
  }
  kaynakYaz(kaynakSecili()==="usb"?"pc":"usb");
};
apduDurumu();
$("bSignInfo").onclick=imzaBilgisi;
$("stImza").onclick=imzaBilgisi;
window.topluImzala=topluImzala;
window.imzaYukle=imzaYukle;
window.imzaDegisti=imzaDegisti;
window.imzaDurumu=imzaDurumu;
window.imzalaPenceresi=imzalaPenceresi;
window.imzaKaynaklari=KAYNAKLAR;
