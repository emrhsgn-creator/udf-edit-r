# E-imza — araştırma notları

Amaç: Android cihazda USB'ye takılı TÜRKTRUST e-imza token'ı ile `.udf`
belgesini imzalamak.

Bu not, uygulama kodu yazılmadan önce yapılan çözümleme çalışmasının
sonuçlarını taşır. İki ayrı problem var ve **birincisi çözüldü**:

1. `sign.sgn` nedir, nasıl üretilir → **çözüldü, aşağıda**
2. Android'de token ile nasıl konuşulur → komut seti çıkarıldı, cihazda
   denenmedi (OTG aparatı gerekiyor)

---

## 1. İmzalı UDF'in yapısı — çözüldü

Gerçek bir UYAP belgesi (avukat evrak kaydı) çözümlendi ve imzası
`openssl` ile **kriptografik olarak doğrulandı** (`Verification successful`).

### Arşiv

İmzalı `.udf`, iki girişli bir ZIP (deflate):

```
content.xml     belgenin kendisi
sign.sgn        imza
```

İmzasız belgelerde yalnızca `content.xml` bulunur. `documentproperties.xml`
bazı belgelerde görülüyor, incelenen örnekte yoktu.

### `sign.sgn`

Standart, özel olmayan bir yapı: **DER kodlu CMS SignedData (PKCS#7),
CAdES-BES seviyesinde.**

| Alan | Değer |
|---|---|
| ContentInfo | `pkcs7-signedData` |
| version | 1 |
| digestAlgorithms | `sha256` |
| encapContentInfo | `pkcs7-data`, **eContent yok → detached** |
| certificates | yalnızca imzalayan sertifikası (CA zinciri **gömülü değil**) |
| SignerInfo.sid | `issuerAndSerialNumber` |
| signatureAlgorithm | `sha256WithRSAEncryption` (RSA-2048, imza 256 bayt) |
| unsignedAttrs | **yok** — zaman damgası içermiyor |

İmzalı öznitelikler (signedAttrs), bu sırayla:

- `contentType` = `pkcs7-data`
- `signingTime` (UTCTime)
- `messageDigest`
- `id-smime-aa-signingCertificateV2` (ESS, sertifikanın SHA-256 özeti +
  issuerSerial) — CAdES-BES'i BES yapan öznitelik budur

### En kritik bulgu: neyin imzalandığı

`messageDigest`, **`content.xml`'in ham (açılmış) baytlarının SHA-256
özetine birebir eşitti.** Yani:

- İmza yalnızca `content.xml` üzerinedir
- ZIP'in kendisi, sıkıştırılmış hâli veya `sign.sgn` imzaya dahil değildir
- RSA imzası ise (CMS kuralı gereği) signedAttrs'ın DER SET OF kodlamasının
  SHA-256'sı üzerine atılır

Doğrulama komutu:

```bash
unzip -o belge.udf content.xml sign.sgn
openssl smime -verify -inform DER -in sign.sgn -content content.xml \
        -binary -noverify -out /dev/null
```

### Sertifika (örnekten, genel bilgi)

- Sağlayıcı: TÜRKTRUST Nitelikli Elektronik Sertifika Hizmetleri H7
- Anahtar: RSA-2048; kök sertifikanın imza algoritması ECDSA-SHA384
- Konu alanında `title = AVUKAT` ve `serialNumber` (TC kimlik no) bulunuyor
- `qcStatements` uzantısı var → 5070 sayılı Kanun anlamında nitelikli imza
- OCSP: `http://ocsp.turktrust.com.tr`

### Üretim tarafı

BouncyCastle bu yapıyı hazır üretiyor: `CMSSignedDataGenerator` +
`JcaSignerInfoGeneratorBuilder`, `signingCertificateV2` özniteliği
`ESSCertIDv2` ile eklenir, `encapsulate=false` ile detached alınır.
Karta yalnızca "şu özeti RSA ile imzala" işi düşer — bunun için özel bir
`ContentSigner` yazılır.

Kaydederken `sign.sgn`, `content.xml` ile aynı ZIP'e ikinci giriş olarak
deflate ile eklenir.

---

## 2. Karta erişim — AKİS APDU komut seti

Kart **AKİS** (TÜBİTAK UEKAE). OpenSC'nin AKİS sürücüsü 0.24'te bakımsız
diye kaldırıldı; komut seti `0.23.0` etiketindeki
`src/libopensc/card-akis.c` dosyasından çıkarıldı.

| İşlem | APDU | Not |
|---|---|---|
| Kart tanıma | ATR `3B BA 11 00 81 31 FE 4D 55 45 4B 41 45 20 56 31 2E 30 AE` | AKİS **v1.0**'a ait; yeni sürümlerde farklı olabilir |
| Dosya seçme | `00 A4 <mode> 00` | mode: path 2 bayt ise `00`, değilse `08`; olmazsa `02` ve `00` denenir |
| PIN doğrulama | `00 20 00 <pinRef>` | standart ISO 7816 |
| **Güvenlik ortamı** | **`00 22 C3 <keyRef>`** | **AKİS'e özgü, veri alanı yok.** Standart `00 22 41 B6 + TLV` **değil** — en kolay tökezlenen yer |
| İmza üretme | `00 2A 9E 9A <DigestInfo>`, Le=256 | standart ISO PSO: COMPUTE DIGITAL SIGNATURE |
| Oturum kapatma | `80 1A 00 00` | |
| Seri numarası | `00 CA 01 <id>` | |
| Dosya listesi | `80 18 00 00` | |
| PIN değiştirme | `00 24 <p1> <p2>` | AKİS'e özgü veri formatı |

OpenSC'de ayrı bir `pkcs15-akis.c` **yok** → AKİS standart bir PKCS#15
kartı. Anahtar referansı, sertifika yolu ve PIN referansı tahmin edilmez,
karttan okunur:

```
EF(DIR) 2F00 → ODF 5031 → PrKDF / CDF / AODF
```

---

## 3. Android tarafı — CCID

Android'de PC/SC ve PKCS#11 yok. NDK'ya da gerek yok: `UsbManager` ile saf
Java, yaklaşık 300 satır.

Akış: arayüz sınıfı `0x0B` olan USB interface'i bul → bulk in/out
endpoint'lerini al → `PC_to_RDR_IccPowerOn` ile ATR'yi çek →
`PC_to_RDR_XfrBlock` ile APDU gönder → T=0 için `GET RESPONSE` zincirini
yönet.

Referans implementasyonlar (açık kaynak, çalışan kod):

- [Yubico yubioath-android — `UsbIso7816Connection.java`](https://github.com/Yubico/yubioath-android/blob/master/app/src/main/java/com/yubico/yubikitold/transport/usb/UsbIso7816Connection.java) — en temiz CCID/USB örneği
- [egelke/eIDSuite — `CCID.java`](https://github.com/egelke/eIDSuite/blob/master/app/src/main/java/net/egelke/android/eid/usb/CCID.java) — Belçika eID'si, aynı senaryo
- [ctt-gob-es/jmulticard](https://github.com/ctt-gob-es/jmulticard) — İspanya DNIe; Android CCID + PKCS#15 + imza, mimari olarak birebir örnek
- [springcard/android-pcsclike](https://github.com/springcard/android-pcsclike) — USB ve BLE okuyucular

Manifest'e eklenecekler (`scripts/patch-android.mjs` üretecek):
`<uses-feature android:name="android.hardware.usb.host">`,
`USB_DEVICE_ATTACHED` intent-filter ve `res/xml/device_filter.xml`.

---

## 4. Uygulama planı

`android/` klasörü her derlemede sıfırdan üretildiği için tüm native kod
`scripts/patch-android.mjs` tarafından yazılacak — mevcut `YazdirPlugin`
ve `DosyaPlugin` ile aynı desen.

```
native/Ccid.java            CCID/USB taşıma katmanı            ✓
native/Akis.java            AKİS APDU komutları                ✓
native/Pkcs15.java          kart üzerindeki nesneleri okur     ✓
native/ImzaPlugin.java      Capacitor köprüsü                  ✓
native/T1.java              T=1 blok protokolü                 ✓
native/Cms.java             CAdES-BES üretimi (kendi DER'i)    ✓
scripts/patch-android.mjs   native/*.java kopyalar, manifest    ✓
www/imza-bridge.js          tanı ekranı (PIN diyaloğu sırada)   ✓
src/shell.html              Araçlar → "Token tanı"              ✓
```

`YazdirPlugin` ve `DosyaPlugin` `patch-android.mjs` içine gömülü kalmaya
devam ediyor; kısalar. CCID ve PKCS#15 katmanları bir JS şablon dizesine
sığdırılamayacak kadar uzun olduğu için `native/` altında ayrı dosyalar
hâlinde duruyor, betik yalnızca paket adını yerine oturtup kopyalıyor.

İmzalayıcı arayüzü sağlayıcıdan bağımsız tasarlanacak (`Token`,
`MobilImza`, `Test`) — mobil imza sonradan eklenebilsin diye.

### İlk kilometre taşı: PIN'siz tanı ekranı — **yazıldı**

Kartı kilitleme riski olmadan denenebilecek ilk adım. **PIN sormaz**, imza
üretmez; yalnızca okur.

Şerit: **Araçlar → Token tanı**. Rapor ekranda çıkar, "Raporu kopyala"
düğmesiyle metin olarak alınabilir.

Yaptıkları:

1. Takılı USB aygıtlarını tarar, CCID arayüzü olanı seçer, izin ister
2. Karta güç verir ve **ATR'yi gösterir** — kartın gerçek sürümü buradan
3. Okuyucunun APDU düzeyini (kısa / uzun / TPDU) CCID tanımlayıcısından okur
4. Kart seri numarasını alır (`00 CA 01 06`)
5. PKCS#15 ağacını gezer: EF(DIR) → ODF → PrKDF / CDF / AODF; her dosyanın
   onaltılık dökümünü saklar
6. Sertifikaları okuyup `CertificateFactory` ile çözer: sahibi, veren,
   geçerlilik, anahtar uzunluğu
7. Bulamazsa AKİS dizin komutuyla (`80 18`) bütün dosyaları tarayıp
   sertifika arar

Rapor yorumlanmış alanların yanında **ham dökümü de** taşıyor. Amaç bu:
imzalama katmanı, tahmine değil cihazdan gelen gerçek çıktıya bakılarak
yazılacak.

## Karttan öğrenilenler

Cihazdaki tanı turlarının sonucu. Buradaki her değer gerçek kartın
cevabından geldi, hiçbiri varsayım değil.

| | |
|---|---|
| Okuyucu | ACS ACR39U, `dwFeatures = 0x000100B2` → **ham TPDU** kipi |
| Kart | T=1; ATR `3B 9F 97 81 31 FE 45 80 65 54 43 D2 21 08 31 C0 73 F6 21 80 81 05 5B` |
| PKCS#15 dizini | DF adı **`"PKCS-15"`** (7 bayt ASCII), dosya kimliği `3D01` |
| EF(DIR) | **yok** (`6A 82`) — kartta bulunmuyor, gerek de kalmadı |
| ODF | `5031`: PrKDF `2F01`, PuKDF `2F02`, SKDF `2F03`, CDF `2F04`, DODF `2F05` |
| AODF | ODF'te **listelenmemiş** |
| Sertifika | `2F10`, 1528 bayt |
| Anahtar referansı | **1** (PuKDF'ten; PrKDF `69 82` veriyor, PIN korumalı) |
| PIN referansı | **`0x81`** (PKCS#15 dizinine yerel; `0x82` de var) |
| Güvenlik ortamı | `00 22 41 B6 06 84 01 01 80 01 02` → `90 00` |
| SELECT biçimi | `P2 = 0x0C` ve `P2 = 0x00` ikisi de kabul ediliyor |

Çalışmayanlar — denemeye değmez:

- `00 22 C3 <ref>` (OpenSC'deki AKİS v1.0 biçimi) → `6A 86`
- `80 18` (AKİS dizin komutu) → `6D 00`
- 12 baytlık standart PKCS#15 AID → `6A 82`

### PIN referansı nasıl bulundu

Kartta AODF olmadığı için referans yazılı değil. Veri alanı olmayan VERIFY
(`00 20 00 <ref>`) ile tarandı — bu komut PIN göndermez ve deneme hakkı
tüketmez. Ayrım net:

- `67 00` → nesne **var**, kart yalnızca sayaç sorgusunu desteklemiyor
- `6A 88` → böyle bir nesne **yok**

`0x81` ve `0x82` `67 00` verdi, diğer bütün adresler `6A 88`. MF'te ise
`0x81` de `6A 88` veriyor; yani PIN'ler PKCS#15 dizinine yerel.

## İmzalama

`native/Cms.java` `sign.sgn`'ı üretiyor. BouncyCastle kullanılmadı: yapı
zaten belli olduğu için kendi DER yazıcısı yazıldı, böylece Android
derlemesine bağımlılık eklenmedi ve **bilgisayarda sınanabiliyor**.

Doğrulama (`javac` + `openssl`, cihaz gerekmeden):

1. Üretilen imza `openssl smime -verify` ile geçiyor.
2. Gerçek UYAP imzasıyla yapı karşılaştırması: `openssl asn1parse` çıktısı
   **178 satır / 178 satır, tek fark imza zamanı**. Toplam boyut da aynı.

### İmza komutu — elenenler

Kartın imza komutunun tam biçimi belgesiz ve cihazda tek tek deneniyor.
Şu ana kadar kesin olarak elenenler:

| Denenen | Sonuç |
|---|---|
| Veri uzunluğu 20 / 32 / 51 bayt | hepsi `6A80` |
| Algoritma göstergesinin 19 değeri (`02`, `10`–`14`, `20`–`25`, `30`, `40`–`46`, `00`, algoritmasız) | hepsi `6A80` |
| Anahtar etiketi `84` / `83`, referans `01` / `81` | hepsi `6A80` |
| `INTERNAL AUTHENTICATE` (`00 22 41 A4` + `00 88`) | `6A87` |
| `PSO: HASH` (`00 2A 90 A0`) | `6A86` — kart desteklemiyor |
| 256 baytlık dolgulu PKCS#1 bloğu | kart gönderme zincirlemesini onaylamıyor |
| `Le` olmadan gönderim | `6700` — `Le` zorunlu |

Bu arada öğrenilen iki şey:

- **MSE hiçbir şeyi doğrulamıyor.** `00 22 41 B6` her içeriğe `90 00` diyor —
  anlamsız anahtar referansına bile. Doğrulamayı PSO'ya bırakıyor.
- **Kartın PKCS#15 üstverisi güvenilmez.** PrKDF'te `usage` bit dizisi
  tamamen sıfır (hiçbir kullanım izni yok) ve `accessFlags` anahtarı
  "çıkarılabilir" gösteriyor. Nitelikli imza anahtarı için ikisi de
  saçma; üstveri süs.

Sıradaki hipotez: `6A87` ("Lc, P1-P2 ile tutarsız") bu kartın komut
parametreleriyle veri alanı arasındaki ilişkiye titiz olduğunu gösteriyor.
PSO şimdiye kadar hep `P2 = 9A` ile denendi; ISO 7816-8 ayrıca `AC` (dolgu
göstergesi + veri) ve `BC` (hazır DSI) tanımlıyor.

Kart tarafındaki sıra:

```
PKCS#15 dizinine gir  →  sertifikayı oku (2F10)
00 20 00 81 <PIN>            PIN doğrula
00 22 41 B6 06 84 01 01 80 01 02   anahtarı seç
00 2A 9E 9A 33 <DigestInfo> 00     kartta imzala → 256 bayt
```

İmzalanan şey content.xml'in baytları değil, **signedAttrs'ın DER SET
kodlamasının SHA-256'sı** (CMS kuralı). content.xml'in özeti messageDigest
özniteliğinde taşınıyor.

PIN ele alışı:

- Cihazda saklanmıyor, her imzada soruluyor.
- `67 00` (uzunluk beğenilmedi) karşılaştırmadan önce dönüyor, hak
  tüketmiyor; yalnızca o durumda dolgulu biçimler deneniyor.
- `63 CX` geldiğinde **hak gitmiştir**; kod asla kendiliğinden tekrar
  denemiyor, kalan hakkı yazıp duruyor.

---

## 5. Bekleyen işler

- **Donanım:** USB-C erkek → USB-A dişi OTG adaptör. Alınmadan cihazda
  hiçbir şey denenemez.
- Kartın gerçek ATR'si okunmalı; yukarıdaki ATR AKİS v1.0'a ait.
- PIN yönetimi: asla saklanmayacak, her imzada sorulacak. **3 yanlış
  denemede kart PUK'a düşer** — arayüzde açık uyarı gerekiyor.
- UYAP'ın, dışarıda imzalanmış bir `.udf`'i kabul edip etmediği teyit
  edilmeli. Etmiyorsa özellik yine değerli olur (cihazda arşivlik imzalı
  belge üretimi) ama hedef değişir.
- `README.md`'deki sadakat farkları (metin parçalarının bölünmesi, sondaki
  boş paragrafın düşmesi) imzalı belgede de test edilmeli.

## 6. Mobil imza (ikinci seçenek)

Donanım gerektirmez; hash operatörün MSSP servisine gider, kullanıcı
telefonda PIN ile onaylar, PKCS#7 geri gelir. Teknik engel yok, **ticari**
engel var: operatör ya da aracı (ESINA, Etikimza vb.) ile sözleşme
gerekiyor. Sağlayıcı arayüzü hazır olduğunda birkaç günlük iş.
