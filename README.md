# UDF Editör

UYAP Doküman Formatı (`.udf`) için **düzenleme** yapabilen Android uygulaması.
Dönüşüm tamamen cihazda çalışır — belge hiçbir sunucuya gönderilmez.

Metin biçimlendirme, tablolar, listeler, görseller, sayfa düzeni, bul-değiştir,
PDF çıktısı. UYAP'tan indirdiğiniz `.udf` dosyasına dokunduğunuzda uygulama açılır.

Arayüz UYAP Doküman Editörü v5.4.17'ye göre kurgulandı: aynı şerit sekmeleri ve
grupları, aynı renkler, Paragraf penceresi cm birimiyle ve canlı önizlemeli.

## APK nasıl alınır (bilgisayara kurulum gerekmez)

Android Studio kurmanıza gerek yok; derlemeyi GitHub yapar.

1. Bu dosyaları bir GitHub deposuna yükleyin (**private** olabilir).
2. Depodaki **Actions** sekmesini açın. Derleme kendiliğinden başlar;
   başlamazsa **APK derle → Run workflow** deyin.
3. İş bitince (5–10 dk) sayfanın altındaki **Artifacts** bölümünden
   `udf-editor-apk` dosyasını indirin. İçinden `app-debug.apk` çıkar.
4. APK'yı telefona kopyalayıp açın. Android "bilinmeyen kaynak" uyarısı
   verirse bu dosyaya bir kereliğine izin verin.

> İlk açılışta Actions "Workflows aren't running" derse, sekmedeki
> **I understand my workflows, go ahead and enable them** düğmesine basın.

## Kendi bilgisayarınızda derlemek

**Node.js 22 veya üstü** gerekir — Capacitor 8 bunu şart koşuyor ve daha eski
bir sürümde `cap add android` adımı hata verir. Kontrol: `node -v`.
Ayrıca JDK 21 ve Android SDK gerekir (Android Studio ikisini de getirir):

```bash
npm install
npm run android:build
# çıktı: android/app/build/outputs/apk/debug/app-debug.apk
```

Telefon USB ile bağlıysa: `cd android && ./gradlew installDebug`

## Dosyalar

```
src/shell.html          Arayüz — şerit, sekmeler, durum çubuğu (UYAP renkleri)
src/engine.js           Editör motoru — UDF dönüşümü, biçimlendirme, tablo
src/udf.browser.js      UDF codec'i, tarayıcı için paketlenmiş
src/build.mjs           Üçünü tek dosyada birleştirir → www/index.html
www/native-bridge.js    Android tarafı: dosya açma, cihaza kaydetme, geri tuşu
scripts/patch-android.mjs   .udf dosya ilişkilendirmesini manifest'e ekler
.github/workflows/      APK'yı derleyen GitHub Actions işi
```

`www/index.html` ve `android/` klasörü depoda tutulmaz; ikisi de derleme
sırasında üretilir. Arayüzde değişiklik yaptıktan sonra `npm run build`
çalıştırın — tarayıcıda denemek için `www/index.html` yeterli.

## Görünüm

Renkler UYAP Doküman Editörü v5.4.17 ekran görüntülerinden doğrudan
örneklendi: çalışma alanı `#2C99AE`, şerit ve durum çubuğu `#EEEEEE`,
grup panelleri `#FAFAFA→#DDE6F0` degrade, vurgu `#FF1B0F`. Sekme düzeni de
aynı: Dosya, Giriş, Düzenle, Ekle, Biçim, Araçlar, Görünüm — Tablo sekmesi
masaüstündeki gibi yalnızca imleç bir tablodayken beliriyor. Cetvel yok.

## Kaydetme

Android 11 ile gelen kapsamlı depolama, uygulamaların ortak klasörlere doğrudan
yazmasını engelliyor (`EACCES`). Bu yüzden kaydetme, sistemin Storage Access
Framework'ü üzerinden yapılır — `DosyaPlugin`:

- **Kaydet:** belge bir `.udf` dosyasına dokunarak açıldıysa aynı dosyanın
  üzerine yazmayı dener. Dosya yöneticisi yalnızca okuma izni verdiyse
  otomatik olarak aşağıdaki yola düşer.
- **Farklı kaydet:** sistemin kaydetme penceresi açılır, klasörü siz seçersiniz.
  Depolama izni istenmez.

## Yazdırma

Android WebView `window.print()` desteklemediği için PDF çıktısı, `scripts/patch-android.mjs`
tarafından üretilen küçük bir Java eklentisi (`YazdirPlugin`) üzerinden sistemin
`PrintManager` servisine veriliyor. Açılan yazdırma ekranındaki "PDF olarak kaydet"
seçeneği dosyayı cihaza yazar.

## Sınamalar

`npm test` iki takım çalıştırır: `test-codec.mjs` codec'i tarayıcı ortamını taklit
ederek (Buffer global değilken) sınar, `test-editor.mjs` ise editörü jsdom içinde
ayağa kaldırıp "hiçbir düğmeye basmadan doğrudan yaz ve kaydet" akışını dener.
Geçmişteki hataların çoğu tam olarak bu iki noktadaydı.

## Bilinen sınırlar

- **E-imza:** İmzalı bir belgeyi düzenleyip kaydetmek imzayı geçersiz kılar.
  Bu, formatın doğası gereğidir; imzalı asıl UYAP'taki kayıttır.
- **İç içe listeler:** Codec bunları tek düzeye indiriyor; çok düzeyli liste
  düğmesi kullanıldığında uygulama uyarı gösterir.
- Uygulama gerçek cihazda denenmedi. Dosya açma ve kaydetme yolları Android
  sürümüne ve dosya yöneticisine göre ayar isteyebilir.

## Lisans

UDF dönüşümü [udf-cli](https://github.com/saidsurucu/udf-cli) (MIT) ile yapılır.
