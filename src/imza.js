"use strict";
/* E-imza çekirdeği: UYAP'ın sign.sgn dosyasını üretir ve okur.

   Gerçek bir UYAP imzalı belgesinden çıkarılan biçim:
   - sign.sgn = CAdES-BES, AYRIK (detached) CMS SignedData, DER
   - imzalanan veri: arşivdeki content.xml'in HAM baytları
   - özet SHA-256; imzalı öznitelikler: contentType, signingTime (UTCTime),
     messageDigest, signingCertificateV2 (hashAlgorithm yok = SHA-256)
   - sertifikalar alanında yalnızca imzacının sertifikası
   - arşivde yalnızca content.xml + sign.sgn

   Kart/köprü yalnızca "ham imza" verir; CMS yapısı burada kurulur. Böylece
   USB kart ve bilgisayar köprüsü aynı çıktıyı üretir. */
(function(){

const te=new TextEncoder();

/* ---------------- DER ---------------- */
function birlestir(parcalar){
  let n=0; for(const p of parcalar) n+=p.length;
  const o=new Uint8Array(n); let i=0;
  for(const p of parcalar){ o.set(p,i); i+=p.length }
  return o;
}
function uzunluk(n){
  if(n<0x80) return Uint8Array.of(n);
  const b=[]; while(n>0){ b.unshift(n&255); n=Math.floor(n/256) }
  return Uint8Array.from([0x80|b.length,...b]);
}
function tlv(etiket,...icerik){
  const c=birlestir(icerik.map(x=>x instanceof Uint8Array?x:Uint8Array.from(x)));
  return birlestir([Uint8Array.of(etiket),uzunluk(c.length),c]);
}
const SEQ=(...x)=>tlv(0x30,...x), SET=(...x)=>tlv(0x31,...x);
function OID(s){
  const p=s.split(".").map(Number), o=[40*p[0]+p[1]];
  for(const v of p.slice(2)){
    const b=[v&127]; let k=Math.floor(v/128);
    while(k>0){ b.unshift((k&127)|128); k=Math.floor(k/128) }
    o.push(...b);
  }
  return tlv(0x06,o);
}
const INT=n=>tlv(0x02,[n]), NULL=Uint8Array.of(5,0), OCTET=b=>tlv(0x04,b);

/* Tek bir DER öğesini çözer: {etiket, bas (öğe başı), ici (içerik başı), son} */
function oku(b,i){
  i=i||0;
  const etiket=b[i]; let n=b[i+1], ici=i+2;
  if(n&0x80){ const k=n&127; n=0; for(let j=0;j<k;j++) n=n*256+b[ici+j]; ici+=k }
  if(ici+n>b.length) throw new Error("DER bozuk");
  return {etiket,bas:i,ici,son:ici+n};
}
function cocuklar(b,o){
  const c=[]; let i=o.ici;
  while(i<o.son){ const x=oku(b,i); c.push(x); i=x.son }
  return c;
}
const ham=(b,o)=>b.subarray(o.bas,o.son), icerik=(b,o)=>b.subarray(o.ici,o.son);

function oidYazi(b){
  const p=[Math.floor(b[0]/40),b[0]%40]; let v=0;
  for(let i=1;i<b.length;i++){ v=v*128+(b[i]&127); if(!(b[i]&128)){ p.push(v); v=0 } }
  return p.join(".");
}
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
function esit(a,b){ if(a.length!==b.length) return false; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return false; return true }

const O={
  data:"1.2.840.113549.1.7.1", signedData:"1.2.840.113549.1.7.2",
  contentType:"1.2.840.113549.1.9.3", messageDigest:"1.2.840.113549.1.9.4",
  signingTime:"1.2.840.113549.1.9.5", sigCertV2:"1.2.840.113549.1.9.16.2.47",
  sha256:"2.16.840.1.101.3.4.2.1", rsa:"1.2.840.113549.1.1.1",
  sha256Rsa:"1.2.840.113549.1.1.11", ec:"1.2.840.10045.2.1",
  ecdsaSha256:"1.2.840.10045.4.3.2", p256:"1.2.840.10045.3.1.7", p384:"1.3.132.0.34",
  cn:"2.5.4.3", seri:"2.5.4.5", unvan:"2.5.4.12", kurum:"2.5.4.10", il:"2.5.4.7"
};

/* ---------------- Sertifika ---------------- */
function adCoz(b,o){
  const r={};
  for(const rdn of cocuklar(b,o)) for(const at of cocuklar(b,rdn)){
    const [t,v]=cocuklar(b,at);
    const oid=oidYazi(icerik(b,t)), deger=new TextDecoder().decode(icerik(b,v));
    r[oid]=deger;
  }
  return r;
}
function zamanCoz(b,o){
  const s=new TextDecoder().decode(icerik(b,o));
  const yil = o.etiket===0x17 ? (+s.slice(0,2) < 50 ? 2000 : 1900) + +s.slice(0,2) : +s.slice(0,4);
  const r = o.etiket===0x17 ? s.slice(2) : s.slice(4);
  return new Date(Date.UTC(yil,+r.slice(0,2)-1,+r.slice(2,4),+r.slice(4,6),+r.slice(6,8),+r.slice(8,10)||0));
}
function sertifikaCoz(der){
  der=der instanceof Uint8Array?der:new Uint8Array(der);
  const kok=oku(der,0), [tbs]=cocuklar(der,kok);
  let a=cocuklar(der,tbs);
  if(a[0].etiket===0xA0) a=a.slice(1);              // sürüm
  const [seri,,yayinci,gecerlilik,konu,spki]=a;
  const [bas,bit]=cocuklar(der,gecerlilik);
  const anahtarAlg=cocuklar(der,cocuklar(der,spki)[0]);
  const algOid=oidYazi(icerik(der,anahtarAlg[0]));
  const konuAd=adCoz(der,konu), yayinciAd=adCoz(der,yayinci);
  return {
    der, seriDer:ham(der,seri), yayinciDer:ham(der,yayinci), spki:ham(der,spki),
    anahtar: algOid===O.ec ? "ec" : "rsa",
    egri: algOid===O.ec ? oidYazi(icerik(der,anahtarAlg[1])) : null,
    ad: konuAd[O.cn]||"", unvan: konuAd[O.unvan]||"", tckn: konuAd[O.seri]||"",
    yayinci: yayinciAd[O.cn]||yayinciAd[O.kurum]||"",
    baslangic: zamanCoz(der,bas), bitis: zamanCoz(der,bit)
  };
}

/* ---------------- Özet ---------------- */
async function sha256(veri){ return new Uint8Array(await crypto.subtle.digest("SHA-256",veri)) }
const DIGESTINFO_SHA256=Uint8Array.from([0x30,0x31,0x30,0x0d,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x02,0x01,0x05,0x00,0x04,0x20]);

/* ECDSA: kart r||s verir, CMS DER SEQUENCE{r,s} ister (ve tersi). */
function intDer(x){
  let i=0; while(i<x.length-1&&x[i]===0) i++;
  x=x.subarray(i);
  return tlv(0x02, x[0]&0x80 ? birlestir([Uint8Array.of(0),x]) : x);
}
function rsDer(rs){ const h=rs.length/2; return SEQ(intDer(rs.subarray(0,h)),intDer(rs.subarray(h))) }
function derRs(der,boy){
  const [r,s]=cocuklar(der,oku(der,0)), o=new Uint8Array(boy*2);
  const koy=(x,at)=>{ x=icerik(der,x); if(x.length>boy) x=x.subarray(x.length-boy); o.set(x,at+boy-x.length) };
  koy(r,0); koy(s,boy); return o;
}

/* ---------------- CAdES-BES üret ----------------
   imzaci(veri) → Promise<Uint8Array> ham imza.
   RSA: veri = DigestInfo(SHA-256), kart PKCS#1 v1.5 dolgusunu yapar.
   EC : veri = SHA-256 özeti, dönüş r||s. */
function utcZaman(t){
  const p=n=>String(n).padStart(2,"0");
  return tlv(0x17,te.encode(p(t.getUTCFullYear()%100)+p(t.getUTCMonth()+1)+p(t.getUTCDate())+
    p(t.getUTCHours())+p(t.getUTCMinutes())+p(t.getUTCSeconds())+"Z"));
}
function derSirala(ogeler){            // DER: SET OF öğeleri kodlanmış hâllerine göre sıralı
  return ogeler.slice().sort((a,b)=>{
    for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]!==b[i]) return a[i]-b[i];
    return a.length-b.length;
  });
}
async function cadesOlustur(icerikBaytlari, sertDer, imzaci, zaman){
  const s=sertifikaCoz(sertDer);
  const ozet=await sha256(icerikBaytlari), sertOzet=await sha256(s.der);
  const nitelikler=derSirala([
    SEQ(OID(O.contentType), SET(OID(O.data))),
    SEQ(OID(O.signingTime), SET(utcZaman(zaman||new Date()))),
    SEQ(OID(O.messageDigest), SET(OCTET(ozet))),
    SEQ(OID(O.sigCertV2), SET(SEQ(SEQ(SEQ(OCTET(sertOzet), SEQ(SEQ(tlv(0xA4,s.yayinciDer)), s.seriDer))))))
  ]);
  const imzalanacak=SET(...nitelikler);        // imza SET etiketli DER üzerinden atılır
  const nOzet=await sha256(imzalanacak);
  let imza, imzaAlg;
  if(s.anahtar==="ec"){
    imza=rsDer(await imzaci(nOzet, s));
    imzaAlg=SEQ(OID(O.ecdsaSha256));
  }else{
    imza=await imzaci(birlestir([DIGESTINFO_SHA256,nOzet]), s);
    imzaAlg=SEQ(OID(O.sha256Rsa),NULL);
  }
  if(!(imza instanceof Uint8Array)) imza=new Uint8Array(imza);
  const imzaciBilgisi=SEQ(
    INT(1),
    SEQ(s.yayinciDer, s.seriDer),
    SEQ(OID(O.sha256)),
    tlv(0xA0, ...nitelikler),
    imzaAlg,
    OCTET(imza)
  );
  const signedData=SEQ(
    INT(1),
    SET(SEQ(OID(O.sha256))),
    SEQ(OID(O.data)),
    tlv(0xA0, s.der),
    SET(imzaciBilgisi)
  );
  return SEQ(OID(O.signedData), tlv(0xA0, signedData));
}

/* ---------------- sign.sgn oku + doğrula ---------------- */
async function imzaOku(sgn, icerikBaytlari){
  const b=sgn instanceof Uint8Array?sgn:new Uint8Array(sgn);
  const kok=oku(b,0), [tur,sarma]=cocuklar(b,kok);
  if(oidYazi(icerik(b,tur))!==O.signedData) throw new Error("sign.sgn SignedData değil");
  const sd=cocuklar(b,cocuklar(b,sarma)[0]);
  const sertler=[]; let imzacilar=null;
  for(const x of sd){
    if(x.etiket===0xA0) for(const c of cocuklar(b,x)) sertler.push(b.slice(c.bas,c.son));
    if(x.etiket===0x31) imzacilar=x;
  }
  const sonuc=[];
  for(const si of cocuklar(b,imzacilar)){
    const a=cocuklar(b,si);
    const sid=a[1], nit=a.find(x=>x.etiket===0xA0);
    const imzaAlg=a[a.indexOf(nit)+1], imzaO=a[a.indexOf(nit)+2];
    // imzacının sertifikası: seri numarası eşleşen
    const sidSeri=ham(b,cocuklar(b,sid)[1]);
    const sert=sertler.map(sertifikaCoz).find(c=>esit(c.seriDer,sidSeri))||(sertler[0]&&sertifikaCoz(sertler[0]));
    let zaman=null, ozet=null;
    for(const at of cocuklar(b,nit)){
      const [t,v]=cocuklar(b,at), oid=oidYazi(icerik(b,t)), d=cocuklar(b,v)[0];
      if(oid===O.signingTime) zaman=zamanCoz(b,d);
      if(oid===O.messageDigest) ozet=icerik(b,d);
    }
    const r={sertifika:sert, zaman, belgeDegismemis:null, imzaGecerli:null};
    if(icerikBaytlari) r.belgeDegismemis=esit(ozet,await sha256(icerikBaytlari));
    try{
      const imzalanan=b.slice(nit.bas,nit.son); imzalanan[0]=0x31;
      const algOid=oidYazi(icerik(b,cocuklar(b,imzaAlg)[0]));
      const imzaB=icerik(b,imzaO);
      if(sert.anahtar==="ec"){
        const egri=sert.egri===O.p384?"P-384":"P-256", boy=egri==="P-384"?48:32;
        const k=await crypto.subtle.importKey("spki",sert.spki,{name:"ECDSA",namedCurve:egri},false,["verify"]);
        r.imzaGecerli=await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},k,derRs(imzaB,boy),imzalanan);
      }else{
        const h=algOid.endsWith(".12")?"SHA-384":algOid.endsWith(".13")?"SHA-512":"SHA-256";
        const k=await crypto.subtle.importKey("spki",sert.spki,{name:"RSASSA-PKCS1-v1_5",hash:h},false,["verify"]);
        r.imzaGecerli=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",k,imzaB,imzalanan);
      }
    }catch(_){ r.imzaGecerli=null }
    sonuc.push(r);
  }
  return sonuc;
}

window.Imza={cadesOlustur, imzaOku, sertifikaCoz, sha256, hex, _der:{oku,cocuklar,oidYazi}};
})();
