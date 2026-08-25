package __PACKAGE__;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.PublicKey;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.Map;

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

                    byte[] atr = ccid.powerOn();
                    r.put("atr", Ccid.hex(atr));

                    Akis kart = new Akis(ccid);
                    r.put("seri", Ccid.hex(kart.serial()));

                    Pkcs15.Sonuc s = Pkcs15.gez(kart);
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
