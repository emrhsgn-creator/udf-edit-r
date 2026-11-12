/* Capacitor'ün ürettiği Android projesini tamamlar:
     1) .udf dosya ilişkilendirmesi (manifest)
     2) YazdirPlugin — WebView window.print() desteklemediği için PrintManager
     3) DosyaPlugin  — Android 11+ ortak klasörlere yazmaya izin vermiyor (EACCES),
                       bu yüzden kaydetme Storage Access Framework üzerinden
     4) EimzaPlugin  — USB OTG ile takılı e-imza kartıyla imza (android-eklenti/)
     5) KopruPlugin  — bilgisayardaki imza köprüsüne parmak izi sabitlemeli HTTPS
     6) UyapGirisPlugin + UyapGirisServisi — tablette UYAP Avukat Portal'a e-imzayla giriş
   android/ klasörü her derlemede sıfırdan üretildiği için bu betik her seferinde
   çalışır ve tekrar çalıştırıldığında hiçbir şeyi bozmaz. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";

const appId = JSON.parse(readFileSync("capacitor.config.json", "utf8")).appId;
const javaDir = "android/app/src/main/java/" + appId.replace(/\./g, "/");
const MANIFEST = "android/app/src/main/AndroidManifest.xml";

/* ---------------- 1) Manifest ---------------- */
let xml = readFileSync(MANIFEST, "utf8");

/* UDF'nin kayıtlı MIME türü yok; uygulamalar onu octet-stream, zip ya da türsüz
   verir. content:// adresi de çoğu zaman dosya adını taşımaz (…/document/msf:123),
   yani uzantıya bakmak tek başına yetmez: MIME türü de, uzantı da denenir.
   mimeType'sız filtre yalnızca türü olmayan niyetleri, mimeType'lı da yalnızca
   türü olanları karşılar; bu yüzden uzantı filtresi iki kez yazılır.
   pathSuffix API 31+. Eskilerde pathPattern ilk noktada takıldığı için noktalı
   adlara kaçışlı varyantlar gerekir. */
const veri = (ozellik, deger) => `                <data android:${ozellik}="${deger}" />`;
const goruntule = (...satirlar) => `            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
${satirlar.join("\n")}
            </intent-filter>`;
const MIME = ["application/octet-stream", "application/zip", "application/x-zip", "application/x-zip-compressed"]
  .map(t => veri("mimeType", t));
const UZANTI = [
  veri("host", "*"),
  ...["udf", "UDF", "Udf"].map(u => veri("pathSuffix", "." + u)),
  ...["udf", "UDF"].flatMap(u => [1, 2, 3, 4].map(n => veri("pathPattern", ".*\\\\.".repeat(n) + u))),
];
const FILTERS = `
            <!-- UDF_FILE_ASSOCIATION -->
${goruntule(...MIME)}

${goruntule(veri("mimeType", "*/*"), ...UZANTI)}

${goruntule(...UZANTI)}

            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
${MIME.join("\n")}
            </intent-filter>
`;
const LAUNCHER = `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
`;
if (!xml.includes(LAUNCHER)) {
  console.error("HATA: manifest'te LAUNCHER intent-filter bulunamadı.");
  process.exit(1);
}
// android/ klasörü silinmeden de yenilensin: varsa önceki yamanın filtreleri çıkarılır.
xml = xml.replace(/\n[ \t]*<!-- UDF_FILE_ASSOCIATION -->[\s\S]*?<\/intent-filter>\n(?=\s*<\/activity>)/, "");
xml = xml.replace(LAUNCHER, LAUNCHER + FILTERS);
writeFileSync(MANIFEST, xml);
console.log("Manifest yamalandı: .udf dosya ilişkilendirmesi.");

/* USB kart okuyucu: telefonda USB ana makine (OTG) desteği. Zorunlu değil —
   OTG'siz telefonlar da uygulamayı kurabilsin, bilgisayar köprüsünü kullansın. */
if (!xml.includes("android.hardware.usb.host")) {
  const izin = xml.includes("android.permission.INTERNET") ? "" :
    `<uses-permission android:name="android.permission.INTERNET" />
    `;
  xml = xml.replace("<application", `<uses-feature android:name="android.hardware.usb.host" android:required="false" />
    ${izin}<application`);
  writeFileSync(MANIFEST, xml);
  console.log("Manifest yamalandı: USB ana makine özelliği.");
}

/* UYAP girişi hizmeti: tablette Chrome'daki Avukat Portal'a localhost:5975'ten
   e-imza verir (bilgisayardaki Adalet E-imza programının yerine). Kullanıcı
   Chrome'dayken de çalışması için ön plan hizmeti; tür "connectedDevice"
   (USB kart okuyucu). Android 14+ bu tür için CHANGE_NETWORK_STATE gibi bir
   önkoşul izni ister. */
if (!xml.includes("UyapGirisServisi")) {
  const izinler = ["FOREGROUND_SERVICE", "FOREGROUND_SERVICE_CONNECTED_DEVICE", "CHANGE_NETWORK_STATE", "POST_NOTIFICATIONS"]
    .filter(i => !xml.includes(`android.permission.${i}"`))
    .map(i => `<uses-permission android:name="android.permission.${i}" />\n    `).join("");
  xml = xml.replace("<application", izinler + "<application");
  xml = xml.replace("</application>", `    <service android:name="${appId}.UyapGirisServisi" android:exported="false"
            android:foregroundServiceType="connectedDevice" />
    </application>`);
  writeFileSync(MANIFEST, xml);
  console.log("Manifest yamalandı: UYAP girişi hizmeti.");
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
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/* Android 11+ kapsamlı depolama nedeniyle /storage/emulated/0/Documents gibi
   ortak klasörlere doğrudan yazmak EACCES veriyor. Kaydetme bu yüzden Storage
   Access Framework üzerinden yapılıyor: klasörü kullanıcı seçiyor, ayrıca
   depolama izni istemeye gerek kalmıyor. */
@CapacitorPlugin(name = "Dosya")
public class DosyaPlugin extends Plugin {

    /* Birlikte aç listesine MIME türüyle de girildiği için UDF olmayan büyük bir
       arşiv de gelebilir; belleği doldurmasın. */
    private static final int OKUMA_SINIRI = 50 * 1024 * 1024;

    /* Birlikte aç (VIEW) ya da Paylaş (SEND) ile gelen dosyayı arayüze bildirir.
       Soğuk başlangıçta arayüz henüz dinlemiyorsa olay, dinleyici eklenene kadar bekler. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        JSObject r = new JSObject();
        r.put("uri", uri.toString());
        notifyListeners("dosyaGeldi", r, true);
    }

    /* Gelen dosyayı adıyla birlikte okur. */
    @PluginMethod
    public void oku(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            JSObject r = new JSObject();
            r.put("ad", dosyaAdi(uri));
            r.put("veri", Base64.encodeToString(baytlar(uri), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /* content:// adresi çoğu zaman dosya adını taşımaz: ad sağlayıcıdan sorulur. */
    private String dosyaAdi(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            int sutun = c == null ? -1 : c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
            if (sutun >= 0 && c.moveToFirst() && !c.isNull(sutun)) return c.getString(sutun);
        } catch (Exception e) {
            // Bazı sağlayıcılar sorguyu desteklemez; ad adresten çıkarılır.
        }
        return uri.getLastPathSegment();
    }

    private byte[] baytlar(Uri uri) throws Exception {
        try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
            if (is == null) throw new Exception("Dosya okumaya açılamadı.");
            ByteArrayOutputStream cikti = new ByteArrayOutputStream();
            byte[] tampon = new byte[64 * 1024];
            int n;
            while ((n = is.read(tampon)) != -1) {
                cikti.write(tampon, 0, n);
                if (cikti.size() > OKUMA_SINIRI) throw new Exception("Dosya çok büyük.");
            }
            return cikti.toByteArray();
        }
    }

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
        registerPlugin(EimzaPlugin.class);
        registerPlugin(KopruPlugin.class);
        registerPlugin(UyapGirisPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

/* Ayrı dosyalarda tutulan eklentiler (e-imza): paket adı yerine konur. */
const ekler = readdirSync("android-eklenti").filter(f => f.endsWith(".java"));
for (const f of ekler)
  writeFileSync(javaDir + "/" + f,
    readFileSync("android-eklenti/" + f, "utf8").replace(/__PAKET__/g, appId));

console.log("Java eklentileri yazıldı: YazdirPlugin, DosyaPlugin, " + ekler.join(", ") + ".");
