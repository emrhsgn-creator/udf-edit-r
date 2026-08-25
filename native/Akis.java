package __PACKAGE__;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/* AKİS kartının komut katmanı.

   Komut seti OpenSC 0.23.0'daki src/libopensc/card-akis.c dosyasından
   çıkarıldı (sürücü 0.24'te bakımsız diye kaldırıldı). Ayrıntı ve kaynak
   için docs/e-imza.md.

   Dikkat edilecek tek aykırılık: güvenlik ortamı komutu AKİS'e özgü
   (00 22 C3 <keyRef>, veri alanı yok) — standart 00 22 41 B6 + TLV değil. */
public class Akis {

    private final Ccid ccid;

    public Akis(Ccid ccid) { this.ccid = ccid; }

    public static class R {
        public final byte[] data;
        public final int sw;
        R(byte[] data, int sw) { this.data = data; this.sw = sw; }
        public boolean ok() { return sw == 0x9000; }
        public String swHex() { return String.format("%04X", sw); }
    }

    /* APDU gönderir. T=0 kartlarda okuyucu 61xx ("veri hazır, gel al") ve
       6Cxx ("Le yanlış, doğrusu şu") döndürebiliyor; ikisini de burada
       çözüyoruz ki üst katman düz bir yanıt görsün. */
    public R send(byte[] apdu) throws Exception {
        R r = split(ccid.transmit(apdu));

        if ((r.sw & 0xFF00) == 0x6C00 && apdu.length >= 5) {
            byte[] a = apdu.clone();
            a[a.length - 1] = (byte) (r.sw & 0xFF);
            r = split(ccid.transmit(a));
        }

        if ((r.sw & 0xFF00) != 0x6100) return r;

        ByteArrayOutputStream acc = new ByteArrayOutputStream();
        acc.write(r.data);
        int guard = 0;
        while ((r.sw & 0xFF00) == 0x6100 && guard++ < 64) {
            r = split(ccid.transmit(new byte[]{0x00, (byte) 0xC0, 0x00, 0x00, (byte) (r.sw & 0xFF)}));
            acc.write(r.data);
        }
        return new R(acc.toByteArray(), r.sw);
    }

    private static R split(byte[] raw) throws Exception {
        if (raw == null || raw.length < 2) throw new Exception("Karttan geçersiz yanıt geldi.");
        int sw = ((raw[raw.length - 2] & 0xFF) << 8) | (raw[raw.length - 1] & 0xFF);
        byte[] d = new byte[raw.length - 2];
        System.arraycopy(raw, 0, d, 0, d.length);
        return new R(d, sw);
    }

    /* SELECT APDU'su kurar.

       P2 = 0x00 kart FCI döndürsün demek (Le gerekiyor), P2 = 0x0C ise
       "hiçbir şey döndürme" (Le yok). Eski kartlar 0x00 ile çalışıyor,
       yeni kartların çoğu 0x0C bekliyor — ikisini de deniyoruz. */
    public static byte[] selectApdu(int p1, int p2, byte[] data) {
        boolean le = (p2 == 0x00);
        byte[] apdu = new byte[(le ? 6 : 5) + data.length];
        apdu[0] = 0x00;
        apdu[1] = (byte) 0xA4;
        apdu[2] = (byte) p1;
        apdu[3] = (byte) p2;
        apdu[4] = (byte) data.length;
        System.arraycopy(data, 0, apdu, 5, data.length);
        if (le) apdu[apdu.length - 1] = 0x00;
        return apdu;
    }

    /* AKİS'te seçme kipi yol uzunluğuna göre değişiyor ve kartlar arasında
       oynuyor; OpenSC de sırayla deniyor. Biz ayrıca P2'yi de deniyoruz.
       SELECT hiçbir deneme hakkı tüketmiyor, güvenli. */
    public boolean select(byte[] path) throws Exception {
        int[] p1ler = (path.length == 2) ? new int[]{0x00, 0x02, 0x08} : new int[]{0x08, 0x02, 0x00};
        int[] p2ler = {0x0C, 0x00};
        for (int p1 : p1ler)
            for (int p2 : p2ler)
                if (send(selectApdu(p1, p2, path)).ok()) return true;
        return false;
    }

    public boolean selectId(int fid) throws Exception {
        return select(new byte[]{(byte) (fid >> 8), (byte) fid});
    }

    /* Uygulamayı adına (AID) göre seçer -- P1=04. PKCS#15 dizinine girmenin
       yol bilmeye gerek bırakmayan yolu. */
    public boolean selectAid(byte[] aid) throws Exception {
        return send(selectApdu(0x04, 0x0C, aid)).ok()
            || send(selectApdu(0x04, 0x00, aid)).ok();
    }

    /* Boş AID ile seçim: kart öntanımlı uygulamasını açar. TÜRKTRUST/AKİS
       kartında bu doğrudan PKCS#15 dizinine düşüyor. */
    public boolean selectVarsayilan() throws Exception {
        return send(new byte[]{0x00, (byte) 0xA4, 0x04, 0x00, 0x00}).ok();
    }

    /* Seçili dosyayı baştan sona okur. Dosya boyunu bilmiyoruz; kart
       "dosya sonu" diyene kadar 255'er bayt istiyoruz. */
    public byte[] readBinary() throws Exception {
        ByteArrayOutputStream acc = new ByteArrayOutputStream();
        int off = 0;
        while (off < 0x7FFF) {
            R r = send(new byte[]{0x00, (byte) 0xB0, (byte) (off >> 8), (byte) off, 0x00});
            if (!r.ok() || r.data.length == 0) break;
            acc.write(r.data);
            off += r.data.length;
            if (r.data.length < 255) break;
        }
        return acc.toByteArray();
    }

    public byte[] readFile(byte[] path) throws Exception {
        return select(path) ? readBinary() : null;
    }

    /* PIN'in kalan deneme hakkını sorar — PIN GÖNDERMEDEN.

       Veri alanı olmayan VERIFY (ISO 7816-4), kartın sayacını okumanın
       standart yolu: kart 63 CX ile X hak kaldığını söyler, hak eksilmez.
       Kartta AODF olmadığı için PIN referansını böyle buluyoruz.

       Ham durum kodunu döndürüyoruz, yorumu üst katmana bırakıyoruz: kartın
       ne dediğini görmeden PIN referansı hakkında karar vermiyoruz. */
    public int pinSw(int ref) throws Exception {
        return send(new byte[]{0x00, 0x20, 0x00, (byte) ref}).sw;
    }

    /* Durum kodunun okunabilir karşılığı. */
    public static String pinDurum(int sw) {
        if (sw == 0x9000) return "zaten doğrulanmış";
        if ((sw & 0xFFF0) == 0x63C0) return "kalan deneme: " + (sw & 0x0F);
        if (sw == 0x6983) return "BLOKE";
        if (sw == 0x6A88 || sw == 0x6A82) return "böyle bir PIN yok";
        if (sw == 0x6700) return "veri alanı zorunlu, sayaç sorulamıyor";
        if (sw == 0x6D00) return "komut desteklenmiyor";
        if (sw == 0x6A86) return "P1/P2 kabul edilmedi";
        return "?";
    }

    /* PIN doğrular. Dönüş: ham durum kodu.

       6700 (uzunluk beğenilmedi) karşılaştırma yapılmadan önce dönen bir
       biçim hatası, deneme hakkı tüketmez; o yüzden dolgulu biçimleri
       denemek güvenli. 63 CX geldiğinde ise DENEME HAKKI GİTMİŞTİR,
       kesinlikle tekrar denemiyoruz — kararı kullanıcı verir. */
    public int pinDogrula(int ref, String pin) throws Exception {
        byte[] ham = pin.getBytes("US-ASCII");
        R r = send(verifyApdu(ref, ham));
        if (r.sw == 0x6700 && ham.length < 8) {
            r = send(verifyApdu(ref, dolgula(ham, (byte) 0xFF)));
            if (r.sw == 0x6700) r = send(verifyApdu(ref, dolgula(ham, (byte) 0x00)));
        }
        return r.sw;
    }

    private static byte[] verifyApdu(int ref, byte[] veri) {
        byte[] apdu = new byte[5 + veri.length];
        apdu[0] = 0x00;
        apdu[1] = 0x20;
        apdu[2] = 0x00;
        apdu[3] = (byte) ref;
        apdu[4] = (byte) veri.length;
        System.arraycopy(veri, 0, apdu, 5, veri.length);
        return apdu;
    }

    private static byte[] dolgula(byte[] pin, byte dolgu) {
        byte[] b = new byte[8];
        java.util.Arrays.fill(b, dolgu);
        System.arraycopy(pin, 0, b, 0, Math.min(pin.length, 8));
        return b;
    }

    /* Kartın tanıdığı PIN referansını bulur. 6A88 "böyle bir nesne yok"
       demek; başka her cevap nesnenin var olduğunu gösteriyor. */
    public int pinRefBul() throws Exception {
        int[] adaylar = {0x81, 0x01, 0x82, 0x02};
        for (int ref : adaylar) {
            int sw = pinSw(ref);
            if (sw != 0x6A88 && sw != 0x6A86) return ref;
        }
        return -1;
    }

    /* İmzalanacak anahtarı seçer: 00 22 41 <şablon> <veri>.
       B6 = dijital imza, A4 = iç kimlik doğrulama. */
    public boolean guvenlikOrtami(int sablon, byte[] veri) throws Exception {
        byte[] apdu = new byte[5 + veri.length];
        apdu[0] = 0x00;
        apdu[1] = 0x22;
        apdu[2] = 0x41;
        apdu[3] = (byte) sablon;
        apdu[4] = (byte) veri.length;
        System.arraycopy(veri, 0, apdu, 5, veri.length);
        return send(apdu).ok();
    }

    /* PSO: COMPUTE DIGITAL SIGNATURE. P2 veri alanının ne taşıdığını
       söylüyor (ISO 7816-8): 9A imzalanacak veri, AC dolgu göstergesi +
       veri, BC hazır DSI. */
    private R pso(int p2, byte[] veri) throws Exception {
        byte[] apdu = new byte[6 + veri.length];
        apdu[0] = 0x00;
        apdu[1] = 0x2A;
        apdu[2] = (byte) 0x9E;
        apdu[3] = (byte) p2;
        apdu[4] = (byte) veri.length;
        System.arraycopy(veri, 0, apdu, 5, veri.length);
        apdu[apdu.length - 1] = 0x00;                 // Le zorunlu
        return send(apdu);
    }

    /* Kullanılan imza biçimi — çalışan kombinasyon bulununca doldurulur,
       rapora yazılıp belgelensin diye. */
    public String sonBicim = "";

    /* İmzayı kart atıyor; özel anahtar kartı hiç terk etmiyor.

       Elenenler (hepsi cihazda denendi, hepsi 6A80):
         - Veri uzunluğu 20 / 32 / 51 bayt
         - Algoritma göstergesinin 19 değeri
         - Anahtar etiketi 84/83, referans 01/81
       Ayrıca: INTERNAL AUTHENTICATE 6A87, PSO: HASH 6A86, P2 = AC ve BC
       6A86 (yani 9E 9A doğru parametre), 256 baytlık blok gönderilemiyor.

       Semantiği tahmin etmeyi bırakıp kısıtı ölçüyoruz: veri alanının
       uzunluğunu tarayıp kartın hangisini kabul ettiğine bakıyoruz. 6A80
       "veri alanı yanlış" demek; doğru uzunluk başka bir kod döndürecek.
       Gönderilen veri anlamsız dolgu, çıkan imza kullanılmıyor — bu bir
       ölçüm turu. PIN doğrulandıktan sonra hiçbir hak tüketilmiyor. */
    public byte[] imzala(int anahtarRef, byte[] digestInfo) throws Exception {
        byte[] mse = {(byte) 0x84, 0x01, (byte) anahtarRef};

        /* Deterministik dolgu; içeriğin anlamı yok, uzunluk ölçülüyor. */
        byte[] havuz = new byte[255];
        for (int i = 0; i < havuz.length; i++) havuz[i] = (byte) (i + 1);

        StringBuilder farkli = new StringBuilder();
        int say6A80 = 0, denenen = 0;

        for (int n = 1; n <= 255; n++) {
            if (n > 128 && (n % 8) != 0) continue;          // 128 üstünde seyrek tara
            byte[] veri = new byte[n];
            System.arraycopy(havuz, 0, veri, 0, n);

            R r;
            try {
                if (!guvenlikOrtami(0xB6, mse)) {
                    ekle(farkli, "MSE reddedildi (n=" + n + ")");
                    break;
                }
                r = pso(0x9A, veri);
            } catch (Exception e) {
                ekle(farkli, n + ":hata");
                continue;
            }
            denenen++;

            if (r.ok() && r.data.length > 0) {
                ekle(farkli, n + ":KABUL(" + r.data.length + " bayt)");
                continue;                                   // ölçüm turu, imza kullanılmıyor
            }
            if (r.sw == 0x6982) throw new Exception(
                    "Kart PIN doğrulamasını düşürdü (6982) n=" + n + ". Bulunanlar: " + farkli);
            if (r.sw == 0x6A80) say6A80++;
            else ekle(farkli, n + ":" + r.swHex());
        }

        throw new Exception("Uzunluk taraması bitti. Denenen: " + denenen
                + ", 6A80 veren: " + say6A80
                + ". Farklı davrananlar: " + (farkli.length() > 0 ? farkli : "hiçbiri"));
    }

    private static void ekle(StringBuilder b, String s) {
        if (b.length() > 0) b.append("; ");
        b.append(s);
    }

    /* Dosya var mı diye bakar. SELECT hiçbir hak tüketmez, güvenli. */
    public boolean varMi(int fid) throws Exception {
        return send(selectApdu(0x02, 0x0C, new byte[]{(byte) (fid >> 8), (byte) fid})).ok();
    }

    /* AKİS'e özgü dizin komutu: 20 baytlık kayıtlar, her kaydın 2. ve 3.
       baytı dosya kimliği. */
    public List<Integer> listFiles() throws Exception {
        List<Integer> ids = new ArrayList<>();
        R r = send(new byte[]{(byte) 0x80, 0x18, 0x00, 0x00, 0x00});
        if (!r.ok()) return ids;
        byte[] d = r.data;
        for (int p = 0; p + 20 <= d.length; p += 20) {
            int kind = d[p] & 0xFF;
            if (kind != 0x2F && kind != 0x3D) break;
            ids.add(((d[p + 1] & 0xFF) << 8) | (d[p + 2] & 0xFF));
        }
        return ids;
    }

    /* Kart seri numarası. OpenSC eski AKİS'te 77 bayt okuyup 55. bayttan
       itibaren 12 baytı alıyordu; yeni kartlar daha kısa yanıt veriyor
       (6C 20 ile "32 bayt iste" diyorlar). Yorumlamak yerine ne verirse
       onu döndürüyoruz — send() zaten doğru uzunlukla tekrar deniyor. */
    public byte[] serial() throws Exception {
        R r = send(new byte[]{0x00, (byte) 0xCA, 0x01, 0x06, 0x00});
        return r.ok() && r.data.length > 0 ? r.data : null;
    }
}
