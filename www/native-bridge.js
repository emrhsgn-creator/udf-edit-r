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
  function nameFromUri(uri) {
    try {
      var n = decodeURIComponent(String(uri).split("?")[0].split("/").pop() || "");
      n = n.replace(/[\/\\:*?"<>|]/g, "_");
      if (n && /\.udf$/i.test(n)) return n;
      if (n) return n.replace(/\.[^.]*$/, "") + ".udf";
    } catch (e) {}
    return "belge.udf";
  }
  function bildir(html, ms) {
    showNotice(html);
    if (ms) setTimeout(hideNotice, ms);
  }

  /* ---- Gelen dosyayı aç ---- */
  var lastUri = null;
  async function openUri(uri) {
    if (!uri || uri === lastUri || /^https?:/i.test(uri)) return;
    lastUri = uri;
    try {
      var r = await Filesystem.readFile({ path: uri });
      await openFile(new File([b64ToBytes(r.data)], nameFromUri(uri),
        { type: "application/octet-stream" }));
      doc.kaynakUri = uri;          // Kaydet aynı dosyanın üzerine yazmayı denesin
    } catch (e) {
      bildir('<span class="mk">!</span><span><b>Dosya okunamadı.</b><br>' +
        'Dosyayı uygulamaya "Paylaş" ile göndermeyi ya da uygulama içinden ' +
        '<b>Aç</b> ile seçmeyi deneyin.</span>');
    }
  }

  if (App) {
    App.getLaunchUrl().then(function (r) { if (r && r.url) openUri(r.url); }).catch(function () {});
    App.addListener("appUrlOpen", function (d) { if (d && d.url) openUri(d.url); });

    App.addListener("backButton", function () {
      var dlg = document.getElementById("dlg"), pnl = document.getElementById("panel");
      if (dlg && dlg.classList.contains("on")) { closeDialog(); return; }
      if (pnl && pnl.classList.contains("on")) { closePanel(); return; }
      if (doc.dirty) {
        bildir('<span class="mk">!</span><span>Kaydedilmemiş değişiklik var. ' +
          'Çıkmadan önce <b>Kaydet</b>e dokunun.</span>', 4000);
        doc.dirty = false;                     // ikinci geri tuşu çıkarsın
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
    var r = await window.udfUret();
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
