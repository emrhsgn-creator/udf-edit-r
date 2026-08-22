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
scripts/patch-android.mjs   + Ccid.java      CCID/USB taşıma katmanı
                            + Akis.java      APDU komutları
                            + Pkcs15.java    kart üzerindeki nesneleri okur
                            + Cms.java       BouncyCastle ile CAdES-BES
                            + ImzaPlugin.java  Capacitor köprüsü
                            + manifest yamaları, build.gradle bağımlılığı
www/imza-bridge.js          şerit düğmesi, PIN diyaloğu, tanı ekranı
src/shell.html              Araçlar sekmesine "E-İmzala" ve "Token Tanı"
```

İmzalayıcı arayüzü sağlayıcıdan bağımsız tasarlanacak (`Token`,
`MobilImza`, `Test`) — mobil imza sonradan eklenebilsin diye.

### İlk kilometre taşı: PIN'siz tanı ekranı

Kartı kilitleme riski olmadan denenebilecek ilk adım. **PIN sormaz.**

1. Takılı USB cihazları listele, CCID arayüzünü bul
2. Karta güç ver, **ATR'yi ekrana bas** — kartın gerçek sürümü böyle öğrenilir
3. PKCS#15 ağacını gez: anahtar referansları, PIN referansı, sertifika yolları
4. Sertifikayı oku, sahibini ve geçerlilik tarihini göster

Bu çalıştığı anda geri kalanı (PIN → `22 C3` → `2A 9E 9A` → CMS) düz yol.

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
