/* Capacitor'ün ürettiği AndroidManifest.xml'e .udf dosya ilişkilendirmesini ekler.
   Android klasörü derleme sırasında sıfırdan üretildiği için bu yama her seferinde
   yeniden uygulanır. Tekrar çalıştırılırsa hiçbir şey bozmaz. */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "android/app/src/main/AndroidManifest.xml";
let xml = readFileSync(PATH, "utf8");

if (xml.includes("UDF_FILE_ASSOCIATION")) {
  console.log("Manifest zaten yamalı, atlanıyor.");
  process.exit(0);
}

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
if (!xml.includes(LAUNCHER)) {
  console.error("HATA: manifest'te LAUNCHER intent-filter bulunamadı.");
  process.exit(1);
}
xml = xml.replace(LAUNCHER, LAUNCHER + FILTERS);

const INTERNET = '<uses-permission android:name="android.permission.INTERNET" />';
xml = xml.replace(
  INTERNET,
  INTERNET +
    '\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />' +
    '\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />'
);

writeFileSync(PATH, xml);
console.log("Manifest yamalandı: .udf dosya ilişkilendirmesi eklendi.");
