package __PAKET__;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* UYAP girişi hizmetini (UyapGirisServisi) açar/kapatır. Hizmet uygulamadan
   bağımsız çalışır: kullanıcı Chrome'a geçtiğinde de portalın isteklerini yanıtlar. */
@CapacitorPlugin(name = "UyapGiris")
public class UyapGirisPlugin extends Plugin {

    private JSObject durumu() {
        JSObject r = new JSObject();
        r.put("acik", UyapGirisServisi.calisiyor);
        r.put("hata", UyapGirisServisi.sonHata);
        return r;
    }

    @PluginMethod
    public void durum(PluginCall call) { call.resolve(durumu()); }

    @PluginMethod
    public void ac(PluginCall call) {
        Context c = getContext();
        // Android 13+: kalıcı bildirim (hizmet açık / Kapat) için izin
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED)
            getActivity().runOnUiThread(() -> ActivityCompat.requestPermissions(getActivity(),
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, UyapGirisServisi.PORT));
        UyapGirisServisi.sonHata = null;
        try {
            ContextCompat.startForegroundService(c, new Intent(c, UyapGirisServisi.class));
        } catch (Exception e) {
            call.reject("Hizmet başlatılamadı: " + e.getMessage());
            return;
        }
        // Hizmet portu arka planda açar; sonucu bekle (eklenti çağrıları ana iş parçacığında değil).
        for (int i = 0; i < 50 && !UyapGirisServisi.calisiyor && UyapGirisServisi.sonHata == null; i++) SystemClock.sleep(100);
        call.resolve(durumu());
    }

    @PluginMethod
    public void kapat(PluginCall call) {
        Context c = getContext();
        c.stopService(new Intent(c, UyapGirisServisi.class));
        for (int i = 0; i < 20 && UyapGirisServisi.calisiyor; i++) SystemClock.sleep(100);
        call.resolve(durumu());
    }

    @PluginMethod
    public void gunluk(PluginCall call) {
        JSObject r = new JSObject();
        r.put("metin", UyapGirisServisi.gunlukMetni());
        call.resolve(r);
    }

    @PluginMethod
    public void portaliAc(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(UyapGirisServisi.PORTAL)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Tarayıcı açılamadı: " + e.getMessage());
        }
    }
}
