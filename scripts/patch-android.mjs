/* Capacitor'ün ürettiği AndroidManifest.xml'e .udf dosya ilişkilendirmesini ekler.
   Android klasörü derleme sırasında sıfırdan üretildiği için bu yama her seferinde
   yeniden uygulanır. Tekrar çalıştırılırsa hiçbir şey bozmaz. */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "android/app/src/main/AndroidManifest.xml";
let xml = readFileSync(PATH, "utf8");

const alreadyPatched = xml.includes("UDF_FILE_ASSOCIATION");
if (alreadyPatched) console.log("Manifest zaten yamalı, atlanıyor.");

// UDF'nin kayıtlı bir MIME türü yok; dosya yöneticileri onu octet-stream ya da
// bilinmeyen olarak verir. Bu yüzden hem MIME hem uzantı deseniyle yakalıyoruz.
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

            <!-- "Paylaş" ile gönderilen belgeler -->
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
if (!alreadyPatched && !xml.includes(LAUNCHER)) {
  console.error("HATA: manifest'te LAUNCHER intent-filter bulunamadı.");
  process.exit(1);
}
if (!alreadyPatched) xml = xml.replace(LAUNCHER, LAUNCHER + FILTERS);

const INTERNET = '<uses-permission android:name="android.permission.INTERNET" />';
xml = xml.replace(
  INTERNET,
  INTERNET +
    '\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />' +
    '\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />'
);

if (!alreadyPatched) {
  writeFileSync(PATH, xml);
  console.log("Manifest yamalandı: .udf dosya ilişkilendirmesi eklendi.");
}
/* ---- Yazdırma / PDF eklentisi -------------------------------------------
   Android WebView'da window.print() hiçbir şey yapmaz. Gerçek çıktı için
   sistemin PrintManager'ını kullanmak gerekiyor; oradaki "PDF olarak kaydet"
   seçeneği dosyayı cihaza yazar. Eklentiyi burada üretip MainActivity'ye
   kaydediyoruz, çünkü android/ klasörü her derlemede sıfırdan oluşuyor. */
import { mkdirSync, existsSync } from "node:fs";

const appId = JSON.parse(readFileSync("capacitor.config.json", "utf8")).appId;
const javaDir = "android/app/src/main/java/" + appId.replace(/\./g, "/");
mkdirSync(javaDir, { recursive: true });

const PLUGIN = `package ${appId};

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
`;
writeFileSync(javaDir + "/YazdirPlugin.java", PLUGIN);

const MAIN = javaDir + "/MainActivity.java";
let main = readFileSync(MAIN, "utf8");
if (!main.includes("YazdirPlugin")) {
  main = `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(YazdirPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
  writeFileSync(MAIN, main);
}
console.log("Yazdırma eklentisi eklendi ve MainActivity'ye kaydedildi.");

