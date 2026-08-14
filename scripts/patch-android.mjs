/* Capacitor'ün ürettiği Android projesini tamamlar:
     1) .udf dosya ilişkilendirmesi (manifest)
     2) YazdirPlugin — WebView window.print() desteklemediği için PrintManager
     3) DosyaPlugin  — Android 11+ ortak klasörlere yazmaya izin vermiyor (EACCES),
                       bu yüzden kaydetme Storage Access Framework üzerinden
   android/ klasörü her derlemede sıfırdan üretildiği için bu betik her seferinde
   çalışır ve tekrar çalıştırıldığında hiçbir şeyi bozmaz. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const appId = JSON.parse(readFileSync("capacitor.config.json", "utf8")).appId;
const javaDir = "android/app/src/main/java/" + appId.replace(/\./g, "/");
const MANIFEST = "android/app/src/main/AndroidManifest.xml";

/* ---------------- 1) Manifest ---------------- */
let xml = readFileSync(MANIFEST, "utf8");

if (xml.includes("UDF_FILE_ASSOCIATION")) {
  console.log("Manifest zaten yamalı.");
} else {
  // UDF'nin kayıtlı MIME türü yok; dosya yöneticileri onu octet-stream ya da
  // bilinmeyen olarak verir. Hem MIME hem uzantı deseniyle yakalıyoruz.
  // Android'in pathPattern'i nokta içeren yollarda tökezlediği için kaçışlı
  // varyantlar da gerekli.
  const FILTERS = `
            <!-- UDF_FILE_ASSOCIATION -->
            <intent-filter android:priority="100">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:mimeType="*/*" />
                <data android:pathPattern=".*\\\\.udf" />
                <data android:pathPattern=".*\\\\..*\\\\.udf" />
                <data android:pathPattern=".*\\\\..*\\\\..*\\\\.udf" />
                <data android:pathPattern=".*\\\\..*\\\\..*\\\\..*\\\\.udf" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/zip" />
            </intent-filter>
`;
  const LAUNCHER = `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
`;
  if (!xml.includes(LAUNCHER)) {
    console.error("HATA: manifest'te LAUNCHER intent-filter bulunamadı.");
    process.exit(1);
  }
  xml = xml.replace(LAUNCHER, LAUNCHER + FILTERS);
  writeFileSync(MANIFEST, xml);
  console.log("Manifest yamalandı: .udf dosya ilişkilendirmesi eklendi.");
}

/* ---------------- 2) Java eklentileri ---------------- */
mkdirSync(javaDir, { recursive: true });

writeFileSync(javaDir + "/YazdirPlugin.java", `package ${appId};

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* WebView window.print() uygulamıyor; gerçek çıktı sistemin PrintManager'ından
   alınır. Açılan ekrandaki "PDF olarak kaydet" dosyayı cihaza yazar. */
@CapacitorPlugin(name = "Yazdir")
public class YazdirPlugin extends Plugin {

    @PluginMethod
    public void yazdir(final PluginCall call) {
        final String ad = call.getString("ad", "belge");
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    PrintManager pm = (PrintManager) getContext()
                            .getSystemService(Context.PRINT_SERVICE);
                    PrintDocumentAdapter adapter =
                            getBridge().getWebView().createPrintDocumentAdapter(ad);
                    PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();
                    pm.print(ad, adapter, attrs);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            }
        });
    }
}
`);

writeFileSync(javaDir + "/DosyaPlugin.java", `package ${appId};

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/* Android 11+ kapsamlı depolama nedeniyle /storage/emulated/0/Documents gibi
   ortak klasörlere doğrudan yazmak EACCES veriyor. Kaydetme bu yüzden Storage
   Access Framework üzerinden yapılıyor: klasörü kullanıcı seçiyor, ayrıca
   depolama izni istemeye gerek kalmıyor. */
@CapacitorPlugin(name = "Dosya")
public class DosyaPlugin extends Plugin {

    /* Daha önce açılmış / seçilmiş bir belgenin üzerine yazar. */
    @PluginMethod
    public void yazUri(PluginCall call) {
        try {
            yaz(Uri.parse(call.getString("uri")), call.getString("veri"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /* Sistemin "Farklı Kaydet" penceresini açar. */
    @PluginMethod
    public void farkliKaydet(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/octet-stream");
        i.putExtra(Intent.EXTRA_TITLE, call.getString("ad", "belge.udf"));
        startActivityForResult(call, i, "kaydetSonuc");
    }

    @ActivityCallback
    private void kaydetSonuc(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("iptal");
            return;
        }
        try {
            Uri uri = result.getData().getData();
            yaz(uri, call.getString("veri"));
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void yaz(Uri uri, String base64) throws Exception {
        OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt");
        if (os == null) throw new Exception("Dosya yazmaya açılamadı.");
        os.write(Base64.decode(base64, Base64.DEFAULT));
        os.flush();
        os.close();
    }
}
`);

writeFileSync(javaDir + "/MainActivity.java", `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(YazdirPlugin.class);
        registerPlugin(DosyaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

console.log("Java eklentileri yazıldı: YazdirPlugin, DosyaPlugin.");
