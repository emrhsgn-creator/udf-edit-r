/* E-imza köprüsü — tanı aşaması.

   Bu sürüm imza atmıyor, PIN sormuyor. Yaptığı tek şey USB'ye takılı
   okuyucuyu bulup kartın ne olduğunu raporlamak. Kartın kilitlenme riski
   yok, çünkü hiç PIN denemesi yapılmıyor.

   Raporun amacı imzalama katmanını gerçek kartın çıktısına bakarak
   yazmak — ATR, PKCS#15 ağacı ve sertifika buradan öğrenilecek.
   Ayrıntı: docs/e-imza.md */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function yerli() {
    return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  }

  var KUTU = "font:11.5px ui-monospace,Menlo,Consolas,monospace;background:#fff;" +
             "border:1px solid #D9D5D2;border-radius:3px;padding:7px;margin:4px 0 0;" +
             "white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:auto";

  function alan(ad, deger) {
    if (deger === undefined || deger === null || deger === "") return "";
    return '<div style="margin:0 0 6px"><span style="color:#5A6470">' + esc(ad) +
           ':</span> <b>' + esc(deger) + "</b></div>";
  }

  function kutu(ad, hex) {
    if (!hex) return "";
    return '<div style="margin:0 0 9px"><span style="color:#5A6470">' + esc(ad) +
           '</span><div style="' + KUTU + '">' + esc(hex) + "</div></div>";
  }

  function bolum(baslik, icerik) {
    if (!icerik) return "";
    return '<fieldset class="fs" style="flex:1 1 100%"><legend>' + esc(baslik) +
           "</legend>" + icerik + "</fieldset>";
  }

  /* Raporu metne çevirir — geliştiriciye kopyalayıp göndermek için. */
  function duzMetin(r) {
    var s = [];
    s.push("cihaz: " + r.cihaz + "  (VID " + r.vid + " / PID " + r.pid + ")");
    s.push("ccid: " + r.ccidDuzey);
    s.push("protokol: " + (r.protokol || "-"));
    s.push("ccid tanımlayıcı: " + r.ccidTanim);
    s.push("yuva: " + (r.kartDurumu || "-"));
    if (r.hata) s.push("HATA: " + r.hata);
    s.push("ATR: " + (r.atr || "-"));
    s.push("seri: " + (r.seri || "-"));
    s.push("EF(DIR): " + (r.efDir || "-"));
    s.push("ODF: " + (r.odf || "-"));
    (r.dosyalar || []).forEach(function (f) {
      s.push("--- " + f.ad + "  yol=" + f.yol + "  (" + f.uzunluk + " bayt)");
      s.push(f.hex || "-");
    });
    s.push("anahtar referansları: " + (r.anahtarRef || []).join(", "));
    s.push("PIN referansları: " + (r.pinRef || []).join(", "));
    (r.sertifikalar || []).forEach(function (c, i) {
      s.push("--- sertifika " + (i + 1));
      s.push("konu: " + c.konu);
      s.push("veren: " + c.veren);
      s.push("geçerlilik: " + c.baslangic + " – " + c.bitis + (c.gecerli ? "" : " (SÜRESİ GEÇMİŞ)"));
      s.push("anahtar: " + c.anahtar + ", imza: " + c.imzaAlgoritmasi);
    });
    (r.tarama || []).forEach(function (f) {
      s.push("--- tarama " + f.ad + "  (" + f.uzunluk + " bayt)");
      s.push(f.hex || "-");
    });
    (r.pinSorgu || []).forEach(function (v) { s.push("pin " + v); });
    (r.denemeler || []).forEach(function (d) {
      s.push("deneme " + d.ad + "  [" + d.komut + "] -> " + (d.cevap || "(boş)"));
    });
    (r.notlar || []).forEach(function (n) { s.push("not: " + n); });
    return s.join("\n");
  }

  function goster(r) {
    var h = '<div class="cols">';

    h += bolum("Okuyucu",
      alan("Cihaz", r.cihaz) +
      alan("VID / PID", r.vid + " / " + r.pid) +
      alan("APDU düzeyi", r.ccidDuzey) +
      alan("Kullanılan katman", r.protokol));

    h += bolum("Kart",
      alan("Yuva durumu", r.kartDurumu) +
      (r.hata ? '<div style="color:#A8121C;margin:0 0 6px"><b>' + esc(r.hata) + "</b></div>" : "") +
      kutu("ATR", r.atr) +
      alan("Seri numarası", r.seri));

    var sert = (r.sertifikalar || []).map(function (c) {
      return alan("Sahibi", c.konu) +
             alan("Veren", c.veren) +
             alan("Geçerlilik", c.baslangic + " – " + c.bitis + (c.gecerli ? "" : "  ⚠ süresi geçmiş")) +
             alan("Anahtar", c.anahtar) +
             alan("İmza algoritması", c.imzaAlgoritmasi);
    }).join('<hr style="border:0;border-top:1px solid #E2DEDB;margin:9px 0">');
    h += bolum("Sertifika", sert || '<i style="color:#7A828C">Kartta okunabilir sertifika bulunamadı.</i>');

    var p15 = "";
    if ((r.anahtarRef || []).length) p15 += alan("Anahtar referansları", r.anahtarRef.join(", "));
    if ((r.pinRef || []).length) p15 += alan("PIN referansları", r.pinRef.map(function (v) {
      return "0x" + ("0" + v.toString(16).toUpperCase()).slice(-2);
    }).join(", "));
    p15 += kutu("EF(DIR) 2F00", r.efDir);
    p15 += kutu("ODF 5031", r.odf);
    (r.dosyalar || []).forEach(function (f) {
      p15 += kutu(f.ad + "  ·  yol " + f.yol + "  ·  " + f.uzunluk + " bayt", f.hex);
    });
    h += bolum("PKCS#15", p15);

    var tar = (r.tarama || []).map(function (f) {
      return kutu(f.ad + "  ·  " + f.uzunluk + " bayt", f.hex || "(okunamadı)");
    }).join("");
    if (tar) h += bolum("Dizin taraması", tar);

    if ((r.pinSorgu || []).length) {
      h += bolum("PIN sorgusu", '<div style="' + KUTU + '">' +
        esc(r.pinSorgu.join("\n")) + "</div>");
    }

    var den = (r.denemeler || []).map(function (d) {
      return kutu(d.ad + "  ·  " + d.komut, d.cevap || "(boş)");
    }).join("");
    if (den) h += bolum("Ham denemeler", den);

    if ((r.notlar || []).length) {
      h += bolum("Notlar", r.notlar.map(function (n) {
        return '<div style="margin:0 0 4px">• ' + esc(n) + "</div>";
      }).join(""));
    }

    h += "</div>";

    dialog("Token tanı", h,
      '<button class="wb" id="taniKopya">Raporu kopyala</button>' +
      '<span class="sp"></span>' +
      '<button class="wb pri" onclick="closeDialog()">Kapat</button>',
      function () {
        document.getElementById("taniKopya").onclick = function () {
          var t = duzMetin(r);
          var bitti = function () { showNotice('<span class="mk">✓</span><span>Rapor panoya kopyalandı.</span>'); setTimeout(hideNotice, 2500); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(bitti, function () { yedekKopya(t, bitti); });
          } else {
            yedekKopya(t, bitti);
          }
        };
      });
  }

  function yedekKopya(t, bitti) {
    var ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); bitti(); } catch (e) {}
    ta.remove();
  }

  /* Okuyucu bulunamadığında ham USB listesi: token'ın CCID olarak görünüp
     görünmediğini gösterir. */
  async function cihazListesi() {
    try {
      var r = await Capacitor.Plugins.Imza.cihazlar();
      if (!r.cihazlar || !r.cihazlar.length) return "Takılı hiçbir USB aygıtı görünmüyor.";
      return r.cihazlar.map(function (d) {
        return d.ad + " (VID " + d.vid + " / PID " + d.pid + ")" +
               (d.ccid ? " — CCID" : " — CCID değil");
      }).join("\n");
    } catch (e) {
      return null;
    }
  }

  async function tani() {
    if (!yerli()) {
      showNotice('<span class="mk">!</span><span><b>Token yalnızca uygulamada okunabilir.</b><br>' +
        "Tarayıcı sürümünde USB donanımına erişilemiyor.</span>");
      return;
    }
    var Imza = Capacitor.Plugins.Imza;
    if (!Imza) {
      showNotice('<span class="mk">!</span><span>İmza bileşeni bulunamadı. ' +
        "Uygulamayı yeni sürümle güncelleyin.</span>");
      return;
    }

    showNotice('<span class="mk">⋯</span><span>Token okunuyor…</span>');
    try {
      var r = await Imza.tani();
      hideNotice();
      goster(r);
    } catch (e) {
      var m = String((e && e.message) || e);
      var liste = await cihazListesi();
      showNotice('<span class="mk">!</span><span><b>Token okunamadı.</b><br>' + esc(m) +
        (liste ? "<br><br>Takılı USB aygıtları:<br>" + esc(liste).replace(/\n/g, "<br>") : "") +
        "</span>");
    }
  }

  // ---------------- imzalama ----------------

  function blobB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(",")[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  function pinSor() {
    return new Promise(function (res) {
      dialog("E-imza",
        '<div class="fld"><label>Kart PIN kodu</label>' +
        '<input type="password" id="imzaPin" inputmode="numeric" autocomplete="off"></div>' +
        '<div style="font-size:12px;color:#5A6470;line-height:1.5">' +
        'PIN kartta doğrulanır, cihazda saklanmaz.<br>' +
        '<b style="color:#A8121C">Yanlış PIN deneme hakkı eksiltir;</b> haklar bitince ' +
        'kart bloke olur ve PUK gerekir.</div>',
        '<button class="wb" id="imzaVaz">Vazgeç</button><span class="sp"></span>' +
        '<button class="wb pri" id="imzaTamam">İmzala</button>',
        function () {
          var giris = document.getElementById("imzaPin");
          giris.focus();
          document.getElementById("imzaVaz").onclick = function () { closeDialog(); res(null); };
          document.getElementById("imzaTamam").onclick = function () {
            var v = giris.value;
            closeDialog();
            res(v || null);
          };
          giris.onkeydown = function (e) {
            if (e.key === "Enter") document.getElementById("imzaTamam").click();
          };
        });
    });
  }

  async function imzala() {
    if (!yerli()) {
      showNotice('<span class="mk">!</span><span><b>İmzalama yalnızca uygulamada yapılabilir.</b><br>' +
        "Tarayıcı sürümünde USB donanımına erişilemiyor.</span>");
      return;
    }
    var Imza = Capacitor.Plugins.Imza, Dosya = Capacitor.Plugins.Dosya;
    if (!Imza || !Dosya) {
      showNotice('<span class="mk">!</span><span>İmza bileşeni bulunamadı. ' +
        "Uygulamayı yeni sürümle güncelleyin.</span>");
      return;
    }
    if (!doc.loaded) {
      showNotice('<span class="mk">!</span><span>Önce bir belge açın.</span>');
      return;
    }

    /* Kaydetmedeki doğrulamanın aynısı: eksik belge imzalanmasın. */
    var uretim = await window.udfUret();
    if (!uretim.ok) {
      showNotice('<span class="mk">!</span><span><b>Belge eksik üretildi, imzalama durduruldu.</b><br>' +
        "Editörde " + uretim.beklenen + " karakter var, dosyaya " + uretim.gelen +
        " karakter yazılıyor.</span>");
      return;
    }

    var pin = await pinSor();
    if (!pin) return;

    showNotice('<span class="mk">⋯</span><span>Kartta imzalanıyor…</span>');
    var sonuc;
    try {
      sonuc = await Imza.imzala({ udf: await blobB64(uretim.blob), pin: pin });
    } catch (e) {
      showNotice('<span class="mk">!</span><span><b>İmzalanamadı.</b><br>' +
        esc(String((e && e.message) || e)) + "</span>");
      return;
    }

    var ad = String(doc.name || "belge").replace(/\.udf$/i, "")
      .replace(/[\/\\:*?"<>|]/g, "_") + "-imzali.udf";
    try {
      await Dosya.farkliKaydet({ ad: ad, veri: sonuc.udf });
      showNotice('<span class="mk">✓</span><span><b>' + esc(ad) + '</b> imzalandı ve kaydedildi.' +
        "<br>İmza " + sonuc.imza + " bayt.</span>");
      setTimeout(hideNotice, 5000);
    } catch (e) {
      if (String(e && e.message) === "iptal") { hideNotice(); return; }
      showNotice('<span class="mk">!</span><span><b>İmza atıldı ama dosya kaydedilemedi.</b><br>' +
        esc(String((e && e.message) || e)) + "</span>");
    }
  }

  window.tokenTani = tani;
  window.udfImzala = imzala;

  var b = document.getElementById("bTokenTani");
  if (b) b.onclick = tani;
  var bi = document.getElementById("bImzala");
  if (bi) bi.onclick = imzala;
})();
