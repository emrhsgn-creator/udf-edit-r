/* Android köprüsü.
   Tarayıcıda hiçbir şey yapmaz — yalnızca uygulama içinde devreye girer.
   İki işi var: UYAP'tan gelen .udf dosyasını açmak, ve düzenlenen belgeyi
   tarayıcı indirmesi yerine cihaza gerçekten kaydedip paylaşım sayfasına vermek. */
(function () {
  "use strict";
  if (!window.Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;

  var P = Capacitor.Plugins,
      Filesystem = P.Filesystem, Share = P.Share, App = P.App;

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

  /* ---- Gelen dosyayı aç ---- */
  var lastUri = null;
  async function openUri(uri) {
    if (!uri || uri === lastUri) return;
    if (/^https?:/i.test(uri)) return;          // derin bağlantı, dosya değil
    lastUri = uri;
    try {
      var r = await Filesystem.readFile({ path: uri });
      var file = new File([b64ToBytes(r.data)], nameFromUri(uri), {
        type: "application/octet-stream"
      });
      await openFile(file);                      // editörün kendi açma akışı
    } catch (e) {
      showNotice('<span class="mk">!</span><span><b>Dosya okunamadı.</b><br>' +
        'Dosya yöneticisi izin vermemiş olabilir. Dosyayı uygulamaya "Paylaş" ile ' +
        'göndermeyi ya da uygulama içinden <b>Aç</b> ile seçmeyi deneyin.</span>');
    }
  }

  if (App) {
    App.getLaunchUrl().then(function (r) { if (r && r.url) openUri(r.url); }).catch(function () {});
    App.addListener("appUrlOpen", function (d) { if (d && d.url) openUri(d.url); });

    // Geri tuşu: önce açık paneli kapat, sonra belgeden çık, sonra uygulamayı arkaya al
    App.addListener("backButton", function () {
      var panel = document.getElementById("panel");
      if (panel && panel.classList.contains("on")) { closePanel(); return; }
      if (doc.dirty) {
        showNotice('<span class="mk">!</span><span>Kaydedilmemiş değişiklik var. ' +
          'Çıkmadan önce <b>Kaydet</b>e dokunun.</span>');
        doc.dirty = false;                        // ikinci geri tuşu çıkarsın
        return;
      }
      App.exitApp();
    });
  }

  /* ---- Cihaza kaydet ---- */
  window.saveUdf = async function (asName) {
    var name = String(asName || doc.name).replace(/\.udf$/i, "").replace(/[\/\\:*?"<>|]/g, "_") + ".udf";
    try {
      var blob = await window.UDF.toUdf(editorToUdfHtml());
      var w = await Filesystem.writeFile({
        path: name,
        data: await blobToB64(blob),
        directory: "DOCUMENTS",
        recursive: true
      });
      doc.name = name;
      document.getElementById("fname").textContent = name;
      setDirty(false);
      saveRecent();
      showNotice('<span class="mk">✓</span><span><b>' + name + '</b> Belgeler klasörüne kaydedildi.</span>');
      setTimeout(hideNotice, 4000);
      if (Share) {
        try {
          await Share.share({ title: name, url: w.uri, dialogTitle: "UDF dosyasını gönder" });
        } catch (e) { /* paylaşımdan vazgeçildi — dosya yine de kayıtlı */ }
      }
    } catch (e) {
      showNotice('<span class="mk">!</span><span><b>Kaydedilemedi.</b><br>' +
        String(e && e.message || e) + '</span>');
    }
  };
})();
