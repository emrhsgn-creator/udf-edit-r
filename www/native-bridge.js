/* Android köprüsü.
   Tarayıcıda hiçbir şey yapmaz — yalnızca uygulama içinde devreye girer.
   Üç işi var: gelen .udf dosyasını açmak, belgeyi cihaza kaydetmek,
   PDF çıktısını sistemin yazdırma servisine vermek. */
(function () {
  "use strict";
  if (!window.Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;

  var P = Capacitor.Plugins,
      Filesystem = P.Filesystem, App = P.App, Dosya = P.Dosya, Yazdir = P.Yazdir;

  function b64ToBytes(b64) {
    var bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(",")[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  function dosyaAdi(ham) {
    var n = String(ham || "").split(/[\/\\]/).pop().replace(/[:*?"<>|]/g, "_");
    if (!n) return "belge.udf";
    return /\.udf$/i.test(n) ? n : n.replace(/\.[^.]*$/, "") + ".udf";
  }
  function bildir(html, ms) {
    showNotice(html);
    if (ms) setTimeout(hideNotice, ms);
  }

  /* ---- Gelen dosyayı aç ----
     Birlikte aç ve Paylaş aynı yoldan gelir (DosyaPlugin.handleOnNewIntent). */
  async function openUri(uri) {
    if (!uri) return;
    if (doc.dirty && !confirm('"' + doc.name + '" belgesinde kaydedilmemiş değişiklik var. ' +
      'Yeni dosya açılsın mı?')) return;
    try {
      var r = await Dosya.oku({ uri: uri });
      var acildi = await openFile(new File([b64ToBytes(r.veri)], dosyaAdi(r.ad),
        { type: "application/octet-stream" }));
      if (acildi) doc.kaynakUri = uri;   // Kaydet aynı dosyanın üzerine yazmayı denesin
    } catch (e) {
      bildir('<span class="mk">!</span><span><b>Dosya okunamadı.</b> ' +
        esc(String(e && e.message || e)) + '<br>Uygulama içinden <b>Aç</b> ile ' +
        'seçmeyi deneyin.</span>');
    }
  }

  if (Dosya) Dosya.addListener("dosyaGeldi", function (d) { return openUri(d && d.uri); });

  if (App) {
    var sonGeri = 0;
    App.addListener("backButton", function () {
      var dlg = document.getElementById("dlg"), pnl = document.getElementById("panel");
      if (dlg && dlg.classList.contains("on")) { closeDialog(); return; }
      if (pnl && pnl.classList.contains("on")) { closePanel(); return; }
      // İlk basışta uyarı, 4 sn içinde ikincide çıkış. "değişti" bayrağına
      // dokunulmaz: sıfırlanınca Kaydet, imzalı belgenin eski hâlini yazıyordu.
      if (doc.dirty && Date.now() - sonGeri > 4000) {
        sonGeri = Date.now();
        bildir('<span class="mk">!</span><span>Kaydedilmemiş değişiklik var. ' +
          'Çıkmadan önce <b>Kaydet</b>e dokunun; çıkmak için yeniden <b>Geri</b>ye basın.</span>', 4000);
        return;
      }
      App.exitApp();
    });
  }

  /* ---- Cihaza kaydet ----
     Android 11+ ortak klasörlere doğrudan yazmaya izin vermiyor (EACCES).
     Bu yüzden ya belgenin geldiği adrese yazıyoruz, ya da sistemin
     "Farklı Kaydet" penceresini açıp klasörü kullanıcıya seçtiriyoruz. */
  async function kaydet(ad, hepYeniYer) {
    var isim = String(ad || doc.name || "belge")
      .replace(/\.udf$/i, "").replace(/[\/\\:*?"<>|]/g, "_") + ".udf";
    // Kaydetmeden önce doğrula: üretilen dosya editördeki metnin tamamını
    // içermiyorsa sessizce eksik kaydetmek yerine durup uyarıyoruz.
    var r = await window.kaydedilecek();
    if (!r.ok) {
      bildir('<span class="mk">!</span><span><b>Belge eksik kaydedilecekti, ' +
        'kaydetme durduruldu.</b><br>Editörde ' + r.beklenen + ' karakter var, ' +
        'dosyaya ' + r.gelen + ' karakter yazılıyor. Lütfen bu ekranın ' +
        'görüntüsünü geliştiriciye iletin.</span>');
      return;
    }
    var veri = await blobToB64(r.blob);

    if (!Dosya) {
      bildir('<span class="mk">!</span><span>Kaydetme bileşeni bulunamadı. ' +
        'Uygulamayı yeni sürümle güncelleyin.</span>');
      return;
    }

    // 1) Aynı dosyanın üzerine yaz
    if (!hepYeniYer && doc.kaynakUri) {
      try {
        await Dosya.yazUri({ uri: doc.kaynakUri, veri: veri });
        doc.name = isim;
        document.getElementById("fname").textContent = "Doküman Editörü — " + isim;
        setDirty(false); saveRecent();
        bildir('<span class="mk">✓</span><span><b>' + isim + '</b> kaydedildi.</span>', 3500);
        return;
      } catch (e) {
        // Çoğu dosya yöneticisi yalnızca okuma izni veriyor; yeni yer soralım.
      }
    }

    // 2) Klasörü kullanıcı seçsin
    try {
      var r = await Dosya.farkliKaydet({ ad: isim, veri: veri });
      doc.name = isim;
      if (r && r.uri) doc.kaynakUri = r.uri;
      document.getElementById("fname").textContent = "Doküman Editörü — " + isim;
      setDirty(false); saveRecent();
      bildir('<span class="mk">✓</span><span><b>' + isim + '</b> kaydedildi.</span>', 3500);
    } catch (e) {
      if (String(e && e.message) === "iptal") return;   // kullanıcı vazgeçti
      bildir('<span class="mk">!</span><span><b>Kaydedilemedi.</b><br>' +
        String(e && e.message || e) + '</span>');
    }
  }

  /* ---- Birden çok dosyayı paylaş (Toplu İmzala, Gönder) ----
     Dosyalar önbellek klasörüne yazılır, sistemin paylaşım sayfası açılır:
     Dosyalar'a kaydet, Drive, WhatsApp, e-posta... */
  window.paylas = async function (dosyalar) {
    var Share = P.Share;
    if (!Share || !Filesystem) {
      for (var i = 0; i < dosyalar.length; i++) {
        var v = await blobToB64(dosyalar[i].blob);
        await Dosya.farkliKaydet({ ad: dosyalar[i].ad, veri: v }).catch(function () {});
      }
      return;
    }
    var uris = [];
    for (var j = 0; j < dosyalar.length; j++) {
      var w = await Filesystem.writeFile({ path: "paylas/" + dosyalar[j].ad,
        data: await blobToB64(dosyalar[j].blob), directory: "CACHE", recursive: true });
      uris.push(w.uri);
    }
    try { await Share.share({ files: uris, dialogTitle: "İmzalı belgeler" }); }
    catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
  };

  window.saveUdf = function (asName) { return kaydet(asName, false); };
  window.saveUdfAs = function (asName) { return kaydet(asName, true); };

  /* ---- PDF / yazdırma ----
     WebView window.print()'i uygulamıyor; sistemin PrintManager'ı çağrılınca
     çıkan ekrandaki "PDF olarak kaydet" dosyayı cihaza yazıyor. */
  window.exportPdf = function () {
    var ad = String(doc.name || "belge").replace(/\.udf$/i, "");
    var eski = document.body.dataset.view;
    document.body.dataset.view = "page";
    setTimeout(function () {
      if (!Yazdir) {
        document.body.dataset.view = eski;
        bildir('<span class="mk">!</span><span>Yazdırma bileşeni bulunamadı. ' +
          'Uygulamayı yeni sürümle güncelleyin.</span>');
        return;
      }
      Yazdir.yazdir({ ad: ad })
        .catch(function (e) {
          bildir('<span class="mk">!</span><span><b>Yazdırma açılamadı.</b><br>' +
            String(e && e.message || e) + '</span>');
        })
        .then(function () { document.body.dataset.view = eski; });
    }, 150);
  };
})();
