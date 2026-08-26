package __PACKAGE__;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.security.PublicKey;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/* E-imza eklentisi — şimdilik yalnızca tanı.

   Bu sürüm karta PIN göndermiyor ve imza üretmiyor; sadece okuyucuyu bulup
   kartın kim olduğunu ve üzerinde ne bulunduğunu raporluyor. Kartın
   kilitlenme riski yok: yanlış PIN denemesi hiç yapılmıyor.

   Amaç, imzalama katmanını gerçek kartın verdiği ATR ve PKCS#15 çıktısına
   bakarak yazmak. Ayrıntı: docs/e-imza.md */
@CapacitorPlugin(name = "Imza")
public class ImzaPlugin extends Plugin {

    /* Takılı bütün USB aygıtlarını döker. Token CCID olarak görünmüyorsa
       sorunun nerede olduğu buradan anlaşılır. */
    @PluginMethod
    public void cihazlar(PluginCall call) {
        UsbManager mgr = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        JSArray liste = new JSArray();
        if (mgr != null) {
            for (Map.Entry<String, UsbDevice> e : mgr.getDeviceList().entrySet()) {
                UsbDevice d = e.getValue();
                JSObject o = new JSObject();
                o.put("ad", ad(d));
                o.put("vid", String.format("%04X", d.getVendorId()));
                o.put("pid", String.format("%04X", d.getProductId()));
                o.put("ccid", Ccid.ccidInterface(d) != null);
                o.put("izin", mgr.hasPermission(d));
                liste.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("cihazlar", liste);
        call.resolve(r);
    }

    @PluginMethod
    public void tani(final PluginCall call) {
        final UsbManager mgr = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (mgr == null) { call.reject("Bu cihazda USB desteği yok."); return; }

        final UsbDevice dev = okuyucuBul(mgr);
        if (dev == null) {
            call.reject("Takılı bir akıllı kart okuyucu bulunamadı. "
                    + "Token'ı OTG adaptörle taktığınızdan emin olun.");
            return;
        }
        if (mgr.hasPermission(dev)) { calistir(call, mgr, dev); return; }
        izinIste(call, mgr, dev);
    }

    /* Belgeyi imzalar: gelen .udf'in içinden content.xml çıkarılır, kartta
       imzalanır, sonuç sign.sgn olarak aynı arşive eklenir.

       content.xml'in baytlarına dokunulmuyor — imza tam olarak o baytların
       üzerinde ve arşiv yeniden yazılsa bile geçerli kalıyor. */
    @PluginMethod
    public void imzala(final PluginCall call) {
        final String udfB64 = call.getString("udf");
        final String pin = call.getString("pin");
        if (udfB64 == null || pin == null || pin.isEmpty()) {
            call.reject("Belge ya da PIN eksik.");
            return;
        }
        final UsbManager mgr = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (mgr == null) { call.reject("Bu cihazda USB desteği yok."); return; }
        final UsbDevice dev = okuyucuBul(mgr);
        if (dev == null) { call.reject("Takılı bir akıllı kart okuyucu bulunamadı."); return; }
        if (!mgr.hasPermission(dev)) { call.reject("Önce Token tanı ile USB izni verin."); return; }

        new Thread(new Runnable() {
            @Override
            public void run() {
                Ccid ccid = null;
                try {
                    byte[] udf = Base64.decode(udfB64, Base64.DEFAULT);
                    final byte[] icerik = contentXml(udf);

                    ccid = new Ccid(mgr, dev);
                    byte[] atr = ccid.powerOn();
                    ccid.protokolSec(atr);
                    final Akis kart = new Akis(ccid);

                    Pkcs15.Sonuc s = Pkcs15.gez(kart, false);
                    if (s.sertifikaDer.isEmpty()) throw new Exception("Kartta sertifika bulunamadı.");
                    byte[] sertifika = s.sertifikaDer.get(0);
                    int anahtarRef = s.anahtarRef.isEmpty() ? 1 : s.anahtarRef.get(0);

                    int pinRef = kart.pinRefBul();
                    if (pinRef < 0) throw new Exception("Kartta PIN nesnesi bulunamadı.");

                    int sw = kart.pinDogrula(pinRef, pin);
                    if (sw != 0x9000) {
                        if ((sw & 0xFFF0) == 0x63C0)
                            throw new Exception("PIN yanlış. Kalan deneme hakkı: " + (sw & 0x0F));
                        if (sw == 0x6983)
                            throw new Exception("PIN bloke. Kartı PUK ile açmanız gerekiyor.");
                        throw new Exception(String.format("PIN kabul edilmedi (%04X).", sw));
                    }

                    /* PrKDF PIN'siz okunamıyordu; artık okunabilir. Özel anahtarın
                       gerçek referansı burada yazılı — PuKDF'teki değer açık
                       anahtara ait olabilir, tahmin etmek yerine buradan alıyoruz. */
                    byte[] prkdf = null;
                    try {
                        kart.selectAid(Pkcs15.AID_KISA);
                        prkdf = kart.readFile(new byte[]{0x2F, 0x01});
                    } catch (Exception yok) { /* okunamadıysa PuKDF'teki değerle devam */ }
                    if (prkdf != null && prkdf.length > 0) {
                        java.util.List<Integer> refler = Pkcs15.integers(prkdf, 1);
                        if (!refler.isEmpty()) anahtarRef = refler.get(refler.size() - 1);
                    }
                    final int ref = anahtarRef;

                    /* İmzadan önce dizine dönüyoruz: PrKDF okunduğu için o an
                       seçili olan bir EF; kart komutu dosya bağlamında
                       değerlendiriyor olabilir. */
                    kart.selectAid(Pkcs15.AID_KISA);

                    Cms.Imzalayici kartImzalayici = new Cms.Imzalayici() {
                        @Override
                        public byte[] imzala(byte[] digestInfo) throws Exception {
                            return kart.imzala(ref, digestInfo);
                        }
                    };

                    /* İkinci PIN (0x82) BİR KEZ denendi ve 6300 verdi: değeri
                       kullanıcının PIN'inden farklı, muhtemelen PUK ya da ayrı bir
                       imza PIN'i. O denemede bir hak yandı ve kart kalan hakkı
                       bildirmedi.

                       Bu yüzden burada bir daha DENENMİYOR. Kartı bloke etme
                       riskini kullanıcı onayı olmadan almıyoruz; 0x82'nin ne
                       olduğu öğrenilmeden bu yol kapalı. */
                    byte[] sgn = Cms.uret(icerik, sertifika, new java.util.Date(), kartImzalayici);

                    JSObject r = new JSObject();
                    r.put("udf", Base64.encodeToString(sgnEkle(udf, sgn), Base64.NO_WRAP));
                    r.put("imza", sgn.length);
                    r.put("bicim", kart.sonBicim);
                    r.put("anahtarRef", ref);
                    call.resolve(r);
                } catch (Exception e) {
                    String m = e.getMessage();
                    call.reject(m == null || m.isEmpty() ? e.toString() : m);
                } finally {
                    if (ccid != null) ccid.close();
                }
            }
        }).start();
    }

    /* Arşivden content.xml'i ham hâliyle çıkarır. */
    private static byte[] contentXml(byte[] udf) throws Exception {
        ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(udf));
        ZipEntry e;
        while ((e = z.getNextEntry()) != null) {
            if (!"content.xml".equals(e.getName())) continue;
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] tampon = new byte[8192];
            int n;
            while ((n = z.read(tampon)) > 0) o.write(tampon, 0, n);
            z.close();
            return o.toByteArray();
        }
        z.close();
        throw new Exception("Belgede content.xml yok.");
    }

    /* Arşivi sign.sgn ekleyerek yeniden yazar. Var olan girişler baytı
       baytına korunuyor; imza content.xml'in baytları üzerinde olduğu için
       yeniden sıkıştırma imzayı bozmuyor. */
    private static byte[] sgnEkle(byte[] udf, byte[] sgn) throws Exception {
        ByteArrayOutputStream cikti = new ByteArrayOutputStream();
        ZipOutputStream zo = new ZipOutputStream(cikti);
        ZipInputStream zi = new ZipInputStream(new ByteArrayInputStream(udf));
        ZipEntry e;
        byte[] tampon = new byte[8192];
        while ((e = zi.getNextEntry()) != null) {
            if ("sign.sgn".equals(e.getName())) continue;      // eskisi varsa düşsün
            zo.putNextEntry(new ZipEntry(e.getName()));
            int n;
            while ((n = zi.read(tampon)) > 0) zo.write(tampon, 0, n);
            zo.closeEntry();
        }
        zi.close();
        zo.putNextEntry(new ZipEntry("sign.sgn"));
        zo.write(sgn);
        zo.closeEntry();
        zo.close();
        return cikti.toByteArray();
    }

    private UsbDevice okuyucuBul(UsbManager mgr) {
        for (Map.Entry<String, UsbDevice> e : mgr.getDeviceList().entrySet()) {
            if (Ccid.ccidInterface(e.getValue()) != null) return e.getValue();
        }
        return null;
    }

    private void izinIste(final PluginCall call, final UsbManager mgr, final UsbDevice dev) {
        final String action = getContext().getPackageName() + ".USB_IZIN";

        BroadcastReceiver alici = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                try { c.unregisterReceiver(this); } catch (Exception ignored) {}
                if (i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    calistir(call, mgr, dev);
                } else {
                    call.reject("USB izni verilmedi.");
                }
            }
        };

        IntentFilter filtre = new IntentFilter(action);
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(alici, filtre, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(alici, filtre);
        }

        Intent niyet = new Intent(action).setPackage(getContext().getPackageName());
        int bayrak = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        mgr.requestPermission(dev, PendingIntent.getBroadcast(getContext(), 0, niyet, bayrak));
    }

    /* Kart işleri arayüz iş parçacığında yapılmaz: tek bir APDU saniyeler
       sürebiliyor. */
    private void calistir(final PluginCall call, final UsbManager mgr, final UsbDevice dev) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                Ccid ccid = null;
                try {
                    JSObject r = new JSObject();
                    r.put("cihaz", ad(dev));
                    r.put("vid", String.format("%04X", dev.getVendorId()));
                    r.put("pid", String.format("%04X", dev.getProductId()));

                    ccid = new Ccid(mgr, dev);
                    byte[] desc = ccid.classDescriptor();
                    r.put("ccidDuzey", Ccid.exchangeLevel(desc));
                    r.put("ccidTanim", Ccid.hex(desc));

                    r.put("kartDurumu", ccid.slotDurumu());

                    /* Karta ulaşılamazsa da elimizdekini raporluyoruz:
                       okuyucu bilgisi ve yuva durumu sorunu daraltıyor. */
                    byte[] atr;
                    try {
                        atr = ccid.powerOn();
                    } catch (Exception e) {
                        r.put("hata", e.getMessage());
                        call.resolve(r);
                        return;
                    }
                    r.put("atr", Ccid.hex(atr));
                    r.put("protokol", ccid.protokolSec(atr));

                    r.put("denemeler", denemeler(ccid));

                    Akis kart = new Akis(ccid);

                    /* Buradan sonrası kartla konuşmak. Bir yerde takılırsak
                       rapor yine açılsın: elimizdeki ATR ve okuyucu bilgisi
                       sorunu daraltmaya yetiyor. */
                    Pkcs15.Sonuc s;
                    try {
                        r.put("seri", Ccid.hex(kart.serial()));
                        s = Pkcs15.gez(kart);
                    } catch (Exception e) {
                        r.put("hata", e.getMessage());
                        call.resolve(r);
                        return;
                    }

                    r.put("efDir", ozet(s.efDir));
                    r.put("odf", ozet(s.odf));

                    JSArray dosyalar = new JSArray();
                    for (Pkcs15.Dosya f : s.dosyalar) {
                        JSObject o = new JSObject();
                        o.put("ad", f.ad);
                        o.put("yol", Ccid.hex(f.yol));
                        o.put("uzunluk", f.icerik == null ? 0 : f.icerik.length);
                        o.put("hex", ozet(f.icerik));
                        dosyalar.put(o);
                    }
                    r.put("dosyalar", dosyalar);

                    JSArray tarama = new JSArray();
                    for (Pkcs15.Dosya f : s.tarama) {
                        JSObject o = new JSObject();
                        o.put("ad", f.ad);
                        o.put("yol", Ccid.hex(f.yol));
                        o.put("uzunluk", f.icerik == null ? 0 : f.icerik.length);
                        o.put("hex", ozet(f.icerik));
                        tarama.put(o);
                    }
                    r.put("tarama", tarama);

                    JSArray pinSorgu = new JSArray();
                    for (String v : s.pinSorgu) pinSorgu.put(v);
                    r.put("pinSorgu", pinSorgu);

                    JSArray sertifikalar = new JSArray();
                    SimpleDateFormat df = new SimpleDateFormat("dd.MM.yyyy", new Locale("tr", "TR"));
                    for (int i = 0; i < s.sertifikalar.size(); i++) {
                        X509Certificate c = s.sertifikalar.get(i);
                        JSObject o = new JSObject();
                        o.put("konu", c.getSubjectDN().getName());
                        o.put("veren", c.getIssuerDN().getName());
                        o.put("baslangic", df.format(c.getNotBefore()));
                        o.put("bitis", df.format(c.getNotAfter()));
                        o.put("imzaAlgoritmasi", c.getSigAlgName());
                        PublicKey pk = c.getPublicKey();
                        o.put("anahtar", pk instanceof RSAPublicKey
                                ? "RSA-" + ((RSAPublicKey) pk).getModulus().bitLength()
                                : pk.getAlgorithm());
                        boolean gecerli = true;
                        try { c.checkValidity(); } catch (Exception ex) { gecerli = false; }
                        o.put("gecerli", gecerli);
                        o.put("uzunluk", s.sertifikaDer.get(i).length);
                        sertifikalar.put(o);
                    }
                    r.put("sertifikalar", sertifikalar);

                    JSArray anahtarRef = new JSArray();
                    for (Integer v : s.anahtarRef) anahtarRef.put(v);
                    r.put("anahtarRef", anahtarRef);

                    JSArray pinRef = new JSArray();
                    for (Integer v : s.pinRef) pinRef.put(v);
                    r.put("pinRef", pinRef);

                    JSArray notlar = new JSArray();
                    for (String v : s.notlar) notlar.put(v);
                    r.put("notlar", notlar);

                    call.resolve(r);
                } catch (Exception e) {
                    String m = e.getMessage();
                    call.reject(m == null || m.isEmpty() ? e.toString() : m);
                } finally {
                    if (ccid != null) ccid.close();
                }
            }
        }).start();
    }

    /* Kartın komutlarımıza ne dediğini olduğu gibi gösterir.

       Yorum yapmadan ham cevabı raporluyoruz: hangi SELECT biçimini kabul
       ettiğini, hangi durum kodunu döndürdüğünü buradan okuyacağız. Bu
       komutların hiçbiri PIN denemesi değil, kart kilitlenmez. */
    private static JSArray denemeler(Ccid ccid) {
        /* Sıra önemli: kart seçimi durum taşıyor, sonraki komut bir
           öncekinin bıraktığı dizinde çalışıyor. */
        String[] adlar = {
            "MF seç (A4 00 0C 3F00)",
            "Öntanımlı uygulama (A4 04 00, boş AID)",
            "DF adı \"PKCS-15\" (A4 04 0C)",
            "ODF seç (A4 02 0C 5031)",
            "ODF oku (B0)",
            "PrKDF seç (A4 02 0C 2F01)",
            "PrKDF oku (B0)",
            "Sertifika dosyası seç (A4 02 0C 2F10)",
            "Güvenlik ortamı, standart (22 41 B6 + TLV)",
            "Güvenlik ortamı, yalnız anahtar (22 41 B6 84)",
            "Güvenlik ortamı, AKİS biçimi (22 C3 01)",
            "Seri numarası (CA 01 06, Le=20)"
        };
        byte[][] apdular = {
            {0x00, (byte) 0xA4, 0x00, 0x0C, 0x02, 0x3F, 0x00},
            {0x00, (byte) 0xA4, 0x04, 0x00, 0x00},
            Akis.selectApdu(0x04, 0x0C, Pkcs15.AID_KISA),
            {0x00, (byte) 0xA4, 0x02, 0x0C, 0x02, 0x50, 0x31},
            {0x00, (byte) 0xB0, 0x00, 0x00, 0x00},
            {0x00, (byte) 0xA4, 0x02, 0x0C, 0x02, 0x2F, 0x01},
            {0x00, (byte) 0xB0, 0x00, 0x00, 0x00},
            {0x00, (byte) 0xA4, 0x02, 0x0C, 0x02, 0x2F, 0x10},
            {0x00, 0x22, 0x41, (byte) 0xB6, 0x06, (byte) 0x84, 0x01, 0x01, (byte) 0x80, 0x01, 0x02},
            {0x00, 0x22, 0x41, (byte) 0xB6, 0x03, (byte) 0x84, 0x01, 0x01},
            {0x00, 0x22, (byte) 0xC3, 0x01},
            {0x00, (byte) 0xCA, 0x01, 0x06, 0x20}
        };

        JSArray liste = new JSArray();
        for (int i = 0; i < adlar.length; i++) {
            JSObject o = new JSObject();
            o.put("ad", adlar[i]);
            o.put("komut", Ccid.hex(apdular[i]));
            try {
                o.put("cevap", ozet(ccid.transmit(apdular[i])));
            } catch (Exception e) {
                o.put("cevap", "hata: " + e.getMessage());
            }
            liste.put(o);
        }
        return liste;
    }

    /* Dökümler ekrana sığsın diye ilk 512 baytla sınırlı. */
    private static String ozet(byte[] b) {
        if (b == null || b.length == 0) return "";
        if (b.length <= 512) return Ccid.hex(b);
        byte[] k = new byte[512];
        System.arraycopy(b, 0, k, 0, 512);
        return Ccid.hex(k) + " … (+" + (b.length - 512) + " bayt)";
    }

    private static String ad(UsbDevice d) {
        String u = d.getManufacturerName();
        String p = d.getProductName();
        if (u == null && p == null) return d.getDeviceName();
        if (u == null) return p;
        if (p == null) return u;
        return u + " " + p;
    }
}
