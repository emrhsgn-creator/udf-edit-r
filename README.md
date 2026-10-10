# UDF Editör

UYAP Doküman Formatı (`.udf`) için **düzenleme ve e-imza** yapabilen Android
uygulaması ve iPhone/iPad'de çalışan web sürümü.
Dönüşüm tamamen cihazda çalışır — belge hiçbir sunucuya gönderilmez.

Metin biçimlendirme, tablolar, listeler, görseller, sayfa düzeni, bul-değiştir,
PDF çıktısı. UYAP'tan indirdiğiniz `.udf` dosyasına dokunduğunuzda uygulama açılır.

Arayüz UYAP Doküman Editörü v5.4.17'ye göre kurgulandı: aynı şerit sekmeleri ve
grupları, aynı renkler, Paragraf penceresi cm birimiyle ve canlı önizlemeli.

## E-imza

Belgeyi **Araçlar → İmzala** ile (ya da hızlı erişim çubuğundaki kalem simgesi)
nitelikli elektronik sertifikanızla imzalarsınız. Üretilen dosya, masaüstü UYAP
Doküman Editörü'nün ürettiğiyle aynı biçimdedir:

- `sign.sgn` = CAdES-BES, ayrık CMS SignedData; imzalanan veri arşivdeki
  `content.xml`'in ham baytları; SHA-256; imzalı öznitelikler contentType,
  signingTime, messageDigest, signingCertificateV2. Gerçek bir UYAP imzalı
  belgesindeki sertifika, içerik ve imza zamanıyla yeniden üretildiğinde
  `sign.sgn` **bayt bayt aynı** çıkıyor.
- Kart yalnızca ham imzayı verir; CMS yapısı telefonda kurulur. İki imza aracı
  aynı çıktıyı üretir:

| İmza aracı | Nerede | Nasıl |
|---|---|---|
| **Telefona takılı kart** ("APDU Etkin" açık) | Android uygulaması | E-imza kartı okuyucusu ya da token, USB-C/OTG adaptörüyle telefona takılır. Uygulama okuyucuyla CCID üzerinden, kartla APDU ile konuşur. |
| **Bilgisayardaki e-imza** ("APDU Etkin" kapalı) | Android uygulaması, iPhone/iPad, her tarayıcı | Kart bilgisayarda takılı kalır; aynı Wi-Fi'deki bilgisayarda `masaustu-imza/UDF-Imza-Koprusu.cmd` çalışır. |

Desteklenen kartlar: TÜBİTAK **AKİS** (TÜRKTRUST, E-Güven, E-Tuğra, Kamu SM).
AKİS komut dizisi, Windows'taki resmî AKİS PKCS#11 sürücüsünün gerçek bir kartla
konuşması kaydedilerek çıkarıldı. Bilgisayar köprüsü kartın kendi sürücüsünü
(PKCS#11) kullandığı için SafeNet eToken gibi başka kartlarla da çalışır.

İmzalı belge açıldığında durum çubuğunda **İmzalı** (yeşil) görünür ve imza
doğrulanır (**Araçlar → İmzalar**). Değiştirmeden kaydederseniz dosya bayt bayt
korunur; değiştirirseniz imza kalkar, yeniden imzalamanız gerekir. Birden çok
belgeyi tek PIN girişiyle imzalamak için **Dosya → Toplu İmzala**.

### Bilgisayar köprüsü (`masaustu-imza/`)

1. Bilgisayarda [uv](https://docs.astral.sh/uv/) ve e-imza sürücünüz kurulu olsun.
2. `UDF-Imza-Koprusu.cmd`'yi çift tıklayın. Pencerede **adres** ve **eşleşme
   kodu** yazar. İlk açılışta Windows güvenlik duvarı sorarsa yalnızca
   **özel ağlar**a izin verin.
3. Telefonda **İmzala** → "Bilgisayardaki e-imza" → adres ve kodu girin.

**iPhone/iPad için bir kerelik:** köprü penceresindeki kare kodu kamerayla okutun
(ya da Safari'de `http://<adres>:5977/` açın), sertifikayı indirip yükleyin ve
**Ayarlar → Genel → Hakkında → Sertifika Güvenilirlik Ayarları**'ndan tam güveni
açın. Bu kök sertifika yalnızca yerel ağ adresleri için geçerli olacak şekilde
kısıtlıdır (X.509 name constraints). Android uygulamasında bu adım gerekmez.

Güvenlik: kartın özel anahtarı karttan çıkmaz; PIN diske ya da günlüğe yazılmaz.
Köprü yalnızca HTTPS konuşur, her istek eşleşme kodunu taşır, 5 hatalı kodda
adres 10 dakika kilitlenir. Android uygulaması köprünün sertifikasını eşleşme
koduyla HMAC'lenmiş bir kanıtla doğrulayıp sabitler; kod ağa hiç açık gitmez.
İsterseniz köprü penceresinden "her imza isteğini bilgisayarda onayla" açılabilir.

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

## Web sürümü (iPhone / iPad / her tarayıcı)

Depoda `.github/workflows/pages.yml` var; `main` dalına her gönderimde
arayüzü derleyip GitHub Pages'e yayınlar. Açmak için: depoda
**Settings → Pages → Source: GitHub Actions** seçin. Adres
`https://<kullanıcı>.github.io/<depo>/` olur.

Uygulama gibi kullanmak için:

- **iPhone / iPad:** Safari'de adresi açın → Paylaş → **Ana Ekrana Ekle**.
  Adres çubuğu olmadan, kendi simgesiyle açılır.
- **Android:** Chrome'da → menü → **Uygulamayı yükle**.

Servis çalışanı sayesinde ilk açılıştan sonra **internetsiz** çalışır.
Kaydetme, destekleyen cihazlarda paylaşım sayfası üzerinden yapılır
(iOS'ta "Dosyalara Kaydet"); desteklenmiyorsa normal indirme olur.

iOS'ta ayrı bir uygulama derlemek için Mac, Xcode ve Apple Developer
hesabı gerekir; web sürümü bu gereksinimlerin hiçbirini istemez.

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
src/udf.js              UDF okuyucu/yazıcı (masaüstüyle birebir)
src/imza.js             CAdES-BES (sign.sgn) üretimi ve doğrulaması
src/imza-arayuz.js      İmzala / Toplu İmzala / İmzalar pencereleri, imza araçları
src/serit.js            Masaüstü editörün şeridindeki ek düğmeler
src/build.mjs           Hepsini tek dosyada birleştirir → www/index.html
android-eklenti/        USB e-imza (CCID + AKİS) ve köprü istemcisi Java eklentileri
masaustu-imza/          Bilgisayar e-imza köprüsü (Python, PKCS#11)
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

## Masaüstüyle birebirlik

UDF okuma/yazma `src/udf.js` ile yapılır; kurallar masaüstü UYAP Doküman
Editörü v5.4.20'de oluşturulup kaydedilen belgelerden çıkarıldı ve
`scripts/test-masaustu.mjs` ile sınanır (örnekler `scripts/masaustu/`):

| Durum | Sonuç |
|---|---|
| Masaüstünde oluşturulan belge açılıp değiştirilmeden kaydedilir | `content.xml` bayt bayt aynı |
| Aynı düzenleme (paragrafı ortala, tümünü kalın yap) iki editörde yapılır | iki `content.xml` bayt bayt aynı |
| Yeni boş belge | masaüstünün boş belgesiyle bayt bayt aynı (1,5 cm kenar boşlukları) |

Uygulanan masaüstü kuralları: öznitelik sırası (biçim önce, ofset sonra; yeni
biçim mevcutların sonuna), varsayılanların yazılmaması, Java sayı biçimi
(`6.0`, `28.35`, `0.20000005` korunur), aynı biçimli parçaların birleşmesi,
satır sonunun kendi biçimi, yalnızca boşluk parçası için `<space>`, sekmenin
metin içinde kalması, `strikethrough`/`subscript`/`superscript` adları, liste
öznitelikleri (`ListId`, `ListLevel="1"`, `LeftIndent="25.0"`), `<page-break>`
biçimi, üst/alt yazının (antet) aynen korunması, prolog ve boşluklar.

Görünüm de masaüstüne göre ayarlandı: tek satır aralığı 1,15 (Swing),
`LineSpacing` bunun üzerine ek oran, sekmeler bir sonraki duraka ya da her
72 nk'ya, liste metni 25 nk içeride. Masaüstü alt simgeyi yukarıda, üst simgeyi
normal satırda çiziyor; aynı dosya iki editörde aynı görünsün diye burada da öyle.

**Sayfalama:** sayfa görünümünde içerik masaüstündeki gibi sayfalara bölünür:
yazılabilir alanı aşan satır bir sonraki sayfanın üst kenar boşluğundan devam
eder (uzun paragraflar satır ortasından bölünür), tablolar satır satır, elle
eklenen sayfa sonu kalan sayfayı doldurur. Araya konan boşluklar yalnızca
görünümdedir; dosyaya yazılmaz. Satır yüksekliği masaüstünden ölçüldü
(1,168 × punto); 120 satırlık belgede sayfa geçişleri masaüstüyle aynı satırda
(54 / 108). Android'de Times New Roman ve Arial olmadığından ölçüce birebir
eşdeğerleri Tinos ve Arimo gömülü (SIL OFL 1.1, `www/fonts/`, derlemede
`@fontsource`'tan kopyalanır); cihazda asıl yazı tipi varsa o kullanılır.

Bilinen fark: masaüstü, açtığı belgeyi kaydederken metnin sonuna paragraf dışı
bir satır sonu ekleyip eklememesini belgenin geçmişine göre değiştiriyor; burada
yaygın durum (çok paragraflı belgede ekler) uygulanıyor. Bu satır sonu hiçbir
paragrafa ait değildir, görünümü etkilemez.

## Sınamalar

`npm test` beş takım çalıştırır:

- `test-codec.mjs` — codec'i tarayıcı ortamını taklit ederek (Buffer global
  değilken) sınar.
- `test-editor.mjs` — editörü jsdom içinde ayağa kaldırıp "hiçbir düğmeye
  basmadan doğrudan yaz ve kaydet" akışını dener.
- `test-fidelity.mjs` — `scripts/ornek-dilekce.udf` belgesini editörden geçirip
  metni, karakter bazında biçimi, paragraf özniteliklerini ve sayfa düzenini
  orijinaliyle karşılaştırır. Örnek belge kişisel veri içermez.
- `test-imza.mjs` — geçici bir test sertifikasıyla `sign.sgn` üretir, OpenSSL
  `cms -verify` ile doğrular; imzalı belgenin editörde tanınmasını, değişmeden
  bayt bayt korunmasını, değişince imzanın kalkmasını sınar.
- `test-masaustu.mjs` — masaüstünde oluşturulan belgelerle birebirliği sınar.

Geçmişteki hataların çoğu tam olarak bu noktalardaydı.

## Bilinen sınırlar

- **E-imza:** Mobil imza (GSM) ve iPhone'a doğrudan kart takarak imza yok;
  iPhone'da imza bilgisayar köprüsüyle atılır. Telefondaki USB yolu yalnızca
  AKİS kartları tanır.
- **İç içe listeler:** Codec bunları tek düzeye indiriyor; çok düzeyli liste
  düğmesi kullanıldığında uygulama uyarı gösterir.
- Uygulama gerçek cihazda denenmedi. Dosya açma ve kaydetme yolları Android
  sürümüne ve dosya yöneticisine göre ayar isteyebilir.

## Lisans

UDF dönüşümü [udf-cli](https://github.com/saidsurucu/udf-cli) (MIT) ile yapılır.
