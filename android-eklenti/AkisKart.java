package __PAKET__;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/* TÜBİTAK AKİS kartı (TÜRKTRUST, E-Güven, E-Tuğra, Kamu SM nitelikli sertifikaları).
   Komut dizisi, Windows'taki resmî AKİS PKCS#11 sürücüsünün (akisp11.dll) gerçek
   bir kartla konuşması kaydedilerek çıkarıldı:
     SELECT MF → SELECT AID "PKCS-15" (DF 3D01) → EF.ODF 5031 → EF.CDF → sertifika EF'leri
   Kart PKCS#15 dizinini standart yolda (MF/5031) değil, AID'li DF'de tutar. */
public class AkisKart {

    public static class PinHatasi extends Exception {
        public PinHatasi(String m) { super(m); }
    }

    public static class Sertifika {
        public byte[] kimlik, der;
    }

    private static final byte[] AID_PKCS15 = "PKCS-15".getBytes(StandardCharsets.US_ASCII);
    /* Okuyucudan bağımsız APDU kanalı: telefonda CcidOkuyucu, sınamada PC/SC. */
    public interface Kanal { byte[] apdu(byte[] komut) throws Exception; }

    private final Kanal o;

    public AkisKart(Kanal o) { this.o = o; }

    /* ---------- APDU yardımcıları ---------- */
    private static int sw(byte[] y) { return y.length < 2 ? 0 : ((y[y.length - 2] & 0xFF) << 8) | (y[y.length - 1] & 0xFF); }
    private static byte[] veri(byte[] y) { return Arrays.copyOf(y, Math.max(0, y.length - 2)); }

    private byte[] komut(int cla, int ins, int p1, int p2, byte[] d, Integer le) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.write(cla); b.write(ins); b.write(p1); b.write(p2);
        if (d != null && d.length > 0) { b.write(d.length); b.write(d); }
        if (le != null) b.write(le);
        return o.apdu(b.toByteArray());
    }

    private byte[] tamam(byte[] y, String ne) throws Exception {
        int s = sw(y);
        if (s != 0x9000) throw new Exception(String.format("%s başarısız (%04X)", ne, s));
        return veri(y);
    }

    private void kokSec() throws Exception {
        tamam(komut(0x00, 0xA4, 0x00, 0x00, new byte[]{0x3F, 0x00}, 0), "MF seçimi");
        tamam(komut(0x00, 0xA4, 0x04, 0x00, AID_PKCS15, 0), "PKCS#15 uygulaması seçimi");
    }

    /* EF seç, FCP'deki boyutla tamamını oku. */
    private byte[] efOku(byte[] fid) throws Exception {
        byte[] fcp = tamam(komut(0x00, 0xA4, 0x02, 0x00, fid, 0), "dosya seçimi " + hex(fid));
        int boy = fcpBoyut(fcp);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        while (boy < 0 || out.size() < boy) {
            int n = boy < 0 ? 0xE6 : Math.min(0xE6, boy - out.size());
            int ofs = out.size();
            byte[] y = komut(0x00, 0xB0, (ofs >> 8) & 0x7F, ofs & 0xFF, null, n);
            int s = sw(y);
            if (s == 0x6B00 || s == 0x6282 && y.length == 2) break;
            if (s != 0x9000 && s != 0x6282) throw new Exception(String.format("okuma başarısız (%04X)", s));
            byte[] v = veri(y);
            if (v.length == 0) break;
            out.write(v);
            if (boy < 0 && v.length < n) break;
        }
        return out.toByteArray();
    }

    private static int fcpBoyut(byte[] f) {
        Der kok = Der.oku(f, 0);
        if (kok == null) return -1;
        for (Der c : kok.cocuklar(f))
            if (c.etiket == 0x80 || c.etiket == 0x81) {
                int n = 0;
                for (int i = c.ici; i < c.son; i++) n = (n << 8) | (f[i] & 0xFF);
                return n;
            }
        return -1;
    }

    /* ---------- sertifikalar ---------- */
    public List<Sertifika> sertifikalar() throws Exception {
        kokSec();
        byte[] odf = efOku(new byte[]{0x50, 0x31});
        List<Sertifika> l = new ArrayList<>();
        for (Der e : Der.hepsi(odf)) {
            // ODF: [4] sertifikalar, [5] güvenilen, [6] faydalı sertifikalar
            if (e.etiket != 0xA4) continue;
            byte[] yol = ilkYol(odf, e);
            if (yol == null) continue;
            kokSec();
            byte[] cdf = efOku(yol);
            for (Der s : Der.hepsi(cdf)) {
                if (s.etiket != 0x30) continue;
                byte[] kimlik = ilkOctet(cdf, s, false);
                byte[] p = null;
                for (Der c : s.cocuklar(cdf)) if (c.etiket == 0xA1) p = ilkYol(cdf, c);
                if (p == null) continue;
                kokSec();
                Sertifika x = new Sertifika();
                x.kimlik = kimlik != null ? kimlik : p;
                x.der = efOku(p);
                Der kokSert = Der.oku(x.der, 0);     // dosya sonunda dolgu olabilir
                if (kokSert != null) x.der = Arrays.copyOf(x.der, kokSert.son);
                l.add(x);
            }
        }
        return l;
    }

    /* Path: OCTET STRING, 2 bayt (FID) ya da 4 bayt (3D01xxxx gibi) — son iki bayt EF. */
    private static byte[] ilkYol(byte[] b, Der d) {
        byte[] p = ilkOctet(b, d, true);
        if (p == null) return null;
        return Arrays.copyOfRange(p, p.length - 2, p.length);
    }

    private static byte[] ilkOctet(byte[] b, Der d, boolean yol) {
        for (Der c : d.cocuklar(b)) {
            if (c.etiket == 0x04) {
                int n = c.son - c.ici;
                if (yol ? (n == 2 || n == 4 || n == 6) : n > 2) return Arrays.copyOfRange(b, c.ici, c.son);
            }
            if ((c.etiket & 0x20) != 0) {
                byte[] r = ilkOctet(b, c, yol);
                if (r != null) return r;
            }
        }
        return null;
    }

    /* ---------- imza ----------
       VERIFY (PIN) → MSE:SET (anahtar + algoritma) → PSO:CDS.
       RSA'da veri DigestInfo'dur; PKCS#1 v1.5 dolgusunu kart yapar. */
    /* Resmî AKİS sürücüsünün imzada gönderdiği değerler (gerçek kartla kaydedildi):
       VERIFY 00 20 00 81, MSE 00 22 41 B6 [80 01 82][84 01 81], PSO 00 2A 9E 9A. */
    public static int PIN_REF = 0x81, ANAHTAR_REF = 0x81, ALG_RSA = 0x82;

    public byte[] imzala(String kimlikHex, String pin, byte[] veri, boolean ec) throws Exception {
        kokSec();
        // Veri olmadan VERIFY kalan deneme sayısını söyler, hak tüketmez.
        int k = sw(komut(0x00, 0x20, 0x00, PIN_REF, null, null));
        if (k == 0x6983 || k == 0x63C0)
            throw new PinHatasi("PIN bloke. Kartınızı sağlayıcınızın aracıyla açmanız gerekir.");
        byte[] p = pin.getBytes(StandardCharsets.US_ASCII);
        byte[] y = komut(0x00, 0x20, 0x00, PIN_REF, p, null);
        int s = sw(y);
        if ((s & 0xFFF0) == 0x63C0) throw new PinHatasi("PIN hatalı. Kalan deneme: " + (s & 0x0F));
        if (s == 0x6983 || s == 0x6984) throw new PinHatasi("PIN bloke. Kartınızı sağlayıcınızın aracıyla açmanız gerekir.");
        if (s == 0x6700 || s == 0x6A80) throw new PinHatasi("PIN uzunluğu geçersiz.");
        if (s != 0x9000) throw new Exception(String.format("PIN doğrulama başarısız (%04X)", s));

        tamam(komut(0x00, 0x22, 0x41, 0xB6, new byte[]{(byte) 0x80, 0x01, (byte) ALG_RSA, (byte) 0x84, 0x01, (byte) ANAHTAR_REF}, null),
                "imza ortamı");
        return tamam(komut(0x00, 0x2A, 0x9E, 0x9A, veri, 0), "imza");
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02X", x));
        return s.toString();
    }

    /* ---------- küçük DER çözücü ---------- */
    static class Der {
        int etiket, bas, ici, son;

        static Der oku(byte[] b, int i) {
            if (i + 2 > b.length) return null;
            Der d = new Der();
            d.bas = i;
            d.etiket = b[i] & 0xFF;
            int n = b[i + 1] & 0xFF, j = i + 2;
            if ((n & 0x80) != 0) {
                int k = n & 0x7F;
                n = 0;
                for (int t = 0; t < k; t++) n = (n << 8) | (b[j++] & 0xFF);
            }
            d.ici = j;
            d.son = j + n;
            return d.son <= b.length ? d : null;
        }

        static List<Der> hepsi(byte[] b) {
            List<Der> l = new ArrayList<>();
            int i = 0;
            while (i < b.length && b[i] != 0 && b[i] != (byte) 0xFF) {
                Der d = oku(b, i);
                if (d == null) break;
                l.add(d);
                i = d.son;
            }
            return l;
        }

        List<Der> cocuklar(byte[] b) {
            List<Der> l = new ArrayList<>();
            int i = ici;
            while (i < son) {
                Der d = oku(b, i);
                if (d == null || d.son > son) break;
                l.add(d);
                i = d.son;
            }
            return l;
        }
    }
}
