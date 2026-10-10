package __PAKET__;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/* Telefona USB OTG ile takılı e-imza kartıyla imza.
   Kartın özel anahtarı karttan çıkmaz: PIN karta gider, kart ham imzayı verir.
   CMS (sign.sgn) JavaScript tarafında kurulur. */
@CapacitorPlugin(name = "Eimza")
public class EimzaPlugin extends Plugin {

    private static final String IZIN = "__PAKET__.USB_IZIN";
    private final ExecutorService is = Executors.newSingleThreadExecutor();   // kart aynı anda tek iş yapar

    private UsbManager um() { return (UsbManager) getContext().getSystemService(Context.USB_SERVICE); }

    private UsbDevice okuyucuBul() {
        for (UsbDevice d : um().getDeviceList().values())
            if (CcidOkuyucu.ccidArayuzu(d) != null) return d;
        return null;
    }

    interface Is { void calis(CcidOkuyucu o) throws Exception; }

    /* Okuyucuyu bul, gerekirse USB izni iste, kartı başlat, işi yap. */
    private void kartla(final PluginCall call, final Is iş) {
        final UsbDevice d = okuyucuBul();
        if (d == null) {
            call.reject("Kart okuyucu bulunamadı. E-imza okuyucusunu/tokenını OTG adaptörüyle telefona takın.");
            return;
        }
        Runnable yap = () -> is.execute(() -> {
            CcidOkuyucu o = null;
            try {
                o = new CcidOkuyucu(um(), d);
                o.baslat();
                iş.calis(o);
            } catch (CcidOkuyucu.KartYok e) {
                call.reject("Okuyucuda kart yok. Kartı okuyucuya takın.");
            } catch (AkisKart.PinHatasi e) {
                JSObject v = new JSObject();
                v.put("pin", true);
                call.reject(e.getMessage(), "PIN", e, v);
            } catch (Exception e) {
                String g = o != null ? o.gunluk.toString() : "";
                call.reject((e.getMessage() != null ? e.getMessage() : e.toString())
                        + (g.isEmpty() ? "" : "\n\nAyrıntı:\n" + g));
            } finally {
                if (o != null) o.close();
            }
        });
        if (um().hasPermission(d)) { yap.run(); return; }

        final Context c = getContext();
        BroadcastReceiver alici = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent i) {
                try { c.unregisterReceiver(this); } catch (Exception e) { }
                if (i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) yap.run();
                else call.reject("Kart okuyucuya erişim izni verilmedi.");
            }
        };
        ContextCompat.registerReceiver(c, alici, new IntentFilter(IZIN), ContextCompat.RECEIVER_NOT_EXPORTED);
        Intent niyet = new Intent(IZIN).setPackage(c.getPackageName());
        int bayrak = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        um().requestPermission(d, PendingIntent.getBroadcast(c, 0, niyet, bayrak));
    }

    @PluginMethod
    public void durum(PluginCall call) {
        UsbDevice d = okuyucuBul();
        JSObject r = new JSObject();
        r.put("okuyucu", d != null ? (d.getProductName() != null ? d.getProductName() : "kart okuyucu") : null);
        call.resolve(r);
    }

    @PluginMethod
    public void sertifikalar(final PluginCall call) {
        kartla(call, o -> {
            AkisKart k = new AkisKart(o);
            List<AkisKart.Sertifika> l = k.sertifikalar();
            JSArray a = new JSArray();
            for (AkisKart.Sertifika s : l) {
                JSObject x = new JSObject();
                x.put("id", CcidOkuyucu.hex(s.kimlik));
                x.put("der", Base64.encodeToString(s.der, Base64.NO_WRAP));
                a.put(x);
            }
            JSObject r = new JSObject();
            r.put("sertifikalar", a);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void imzala(final PluginCall call) {
        final String id = call.getString("id", "");
        final String pin = call.getString("pin", "");
        final byte[] veri = Base64.decode(call.getString("veri", ""), Base64.DEFAULT);
        final boolean ec = "ec".equals(call.getString("alg"));
        if (pin.isEmpty()) { call.reject("PIN girin."); return; }
        kartla(call, o -> {
            AkisKart k = new AkisKart(o);
            byte[] imza = k.imzala(id, pin, veri, ec);
            JSObject r = new JSObject();
            r.put("imza", Base64.encodeToString(imza, Base64.NO_WRAP));
            call.resolve(r);
        });
    }
}
