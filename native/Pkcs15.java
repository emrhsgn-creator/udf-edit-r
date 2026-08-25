package __PACKAGE__;

import java.io.ByteArrayInputStream;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;

/* Kart üzerindeki PKCS#15 yapısını gezer.

   AKİS'in OpenSC'de ayrı bir pkcs15 sürücüsü yok — standart bir PKCS#15
   kartı. Yani anahtar referansını, sertifika yolunu ve PIN referansını
   tahmin etmiyoruz, karttan okuyoruz:

       EF(DIR) 2F00 → ODF 5031 → PrKDF / CDF / AODF

   Bu sınıf tanı aşaması için yazıldı: bulduğunu yorumluyor ama ham
   onaltılık dökümü de saklıyor. Cihazdan gelen gerçek çıktıyla imzalama
   katmanı yazılacak, o yüzden yorum yanlışsa dökümden görülebilsin. */
public class Pkcs15 {

    /* PKCS#15 uygulamasının standart AID'i ("...PKCS-15") */
    public static final byte[] AID = {
        (byte) 0xA0, 0x00, 0x00, 0x00, 0x63,
        0x50, 0x4B, 0x43, 0x53, 0x2D, 0x31, 0x35
    };

    // ---------------- küçük bir DER okuyucu ----------------

    public static class Der {
        public int tag, tagNum, tagClass;
        public boolean cons;
        public byte[] value;
        public int start, end;
    }

    public static Der read(byte[] b, int off) {
        if (b == null || off + 2 > b.length) return null;
        int p = off;
        int t = b[p++] & 0xFF;
        int tagNum = t & 0x1F;
        if (tagNum == 0x1F) {
            tagNum = 0;
            int c;
            do {
                if (p >= b.length) return null;
                c = b[p++] & 0xFF;
                tagNum = (tagNum << 7) | (c & 0x7F);
            } while ((c & 0x80) != 0);
        }
        if (p >= b.length) return null;
        int l = b[p++] & 0xFF;
        int len;
        if ((l & 0x80) == 0) {
            len = l;
        } else {
            int nb = l & 0x7F;
            if (nb == 0 || nb > 4 || p + nb > b.length) return null;
            len = 0;
            for (int i = 0; i < nb; i++) len = (len << 8) | (b[p++] & 0xFF);
        }
        if (len < 0 || p + len > b.length) return null;

        Der d = new Der();
        d.tag = t;
        d.tagClass = t & 0xC0;
        d.cons = (t & 0x20) != 0;
        d.tagNum = tagNum;
        d.start = off;
        d.end = p + len;
        d.value = new byte[len];
        System.arraycopy(b, p, d.value, 0, len);
        return d;
    }

    public static List<Der> children(byte[] v) {
        List<Der> out = new ArrayList<>();
        int p = 0;
        while (p < v.length) {
            Der d = read(v, p);
            if (d == null || d.end <= p) break;
            out.add(d);
            p = d.end;
        }
        return out;
    }

    /* Verilen dallarda belirtilen uzunlukta ilk OCTET STRING'i bulur.
       PKCS#15'te dosya yolları 2 ya da 4 bayttır. */
    public static byte[] firstPath(byte[] v) {
        for (Der d : children(v)) {
            if (!d.cons && d.tag == 0x04 && (d.value.length == 2 || d.value.length == 4))
                return d.value;
            if (d.cons) {
                byte[] r = firstPath(d.value);
                if (r != null) return r;
            }
        }
        return null;
    }

    public static List<Integer> integers(byte[] v) {
        List<Integer> out = new ArrayList<>();
        for (Der d : children(v)) {
            if (!d.cons && d.tag == 0x02 && d.value.length >= 1 && d.value.length <= 2) {
                int n = 0;
                for (byte x : d.value) n = (n << 8) | (x & 0xFF);
                out.add(n);
            } else if (d.cons) {
                out.addAll(integers(d.value));
            }
        }
        return out;
    }

    public static String text(byte[] v) {
        for (Der d : children(v)) {
            if (!d.cons && (d.tag == 0x0C || d.tag == 0x13)) {
                try { return new String(d.value, "UTF-8").trim(); } catch (Exception e) { return null; }
            }
            if (d.cons) {
                String s = text(d.value);
                if (s != null && !s.isEmpty()) return s;
            }
        }
        return null;
    }

    public static X509Certificate parseCert(byte[] der) {
        if (der == null || der.length < 64 || (der[0] & 0xFF) != 0x30) return null;
        try {
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            return (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(der));
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------- kartı gezme ----------------

    /* ODF girişleri, PKCS#15'te tür numarasıyla etiketlenir. */
    public static String odfLabel(int tagNum) {
        switch (tagNum) {
            case 0: return "PrKDF (özel anahtarlar)";
            case 1: return "PuKDF (açık anahtarlar)";
            case 2: return "PuKDF (güvenilir açık anahtarlar)";
            case 3: return "SKDF (gizli anahtarlar)";
            case 4: return "CDF (sertifikalar)";
            case 5: return "CDF (güvenilir sertifikalar)";
            case 6: return "CDF (yararlı sertifikalar)";
            case 7: return "DODF (veri nesneleri)";
            case 8: return "AODF (kimlik doğrulama / PIN)";
            default: return "tür " + tagNum;
        }
    }

    public static class Dosya {
        public String ad;
        public byte[] yol;
        public byte[] icerik;
    }

    public static class Sonuc {
        public byte[] efDir;
        public byte[] odf;
        public byte[] odfYolu;
        public final List<Dosya> dosyalar = new ArrayList<>();
        public final List<X509Certificate> sertifikalar = new ArrayList<>();
        public final List<byte[]> sertifikaDer = new ArrayList<>();
        public final List<Integer> anahtarRef = new ArrayList<>();
        public final List<Integer> pinRef = new ArrayList<>();
        public final List<String> notlar = new ArrayList<>();
    }

    public static Sonuc gez(Akis kart) throws Exception {
        Sonuc s = new Sonuc();

        kart.selectId(0x3F00);

        s.efDir = kart.readFile(new byte[]{0x2F, 0x00});
        if (s.efDir == null || s.efDir.length == 0) s.notlar.add("EF(DIR) okunamadı.");

        /* PKCS#15 uygulamasına gir: önce EF(DIR)'deki yol, olmazsa AID ile
           ada göre seçme, olmazsa geleneksel 5015. */
        boolean girdi = false;
        if (s.efDir != null) {
            byte[] yol = firstPath(s.efDir);
            if (yol != null) {
                kart.selectId(0x3F00);
                girdi = kart.select(yol);
                if (girdi) s.notlar.add("PKCS#15 dizinine EF(DIR)'deki yolla girildi: " + Ccid.hex(yol));
            }
        }
        if (!girdi) {
            girdi = kart.selectAid(AID);
            if (girdi) s.notlar.add("PKCS#15 dizinine AID ile girildi.");
        }
        if (!girdi) {
            kart.selectId(0x3F00);
            girdi = kart.selectId(0x5015);
            if (girdi) s.notlar.add("PKCS#15 dizinine 5015 ile girildi.");
        }
        if (!girdi) s.notlar.add("PKCS#15 dizinine girilemedi; dosyalar taranacak.");

        s.odf = kart.readFile(new byte[]{0x50, 0x31});
        if (s.odf == null || s.odf.length == 0) {
            s.notlar.add("ODF (5031) okunamadı.");
        } else {
            for (Der e : children(s.odf)) {
                if (e.tagClass != 0xA0 && e.tagClass != 0x80) continue;
                byte[] yol = firstPath(e.value);
                if (yol == null) continue;

                Dosya f = new Dosya();
                f.ad = odfLabel(e.tagNum);
                f.yol = yol;
                f.icerik = kart.readFile(yol);
                s.dosyalar.add(f);

                if (f.icerik == null || f.icerik.length == 0) continue;

                if (e.tagNum == 0) s.anahtarRef.addAll(integers(f.icerik));
                if (e.tagNum == 8) s.pinRef.addAll(integers(f.icerik));
                if (e.tagNum == 4 || e.tagNum == 5 || e.tagNum == 6) {
                    for (Der kayit : children(f.icerik)) {
                        byte[] cy = firstPath(kayit.value);
                        if (cy == null) continue;
                        byte[] der = kart.readFile(cy);
                        X509Certificate c = parseCert(der);
                        if (c != null) { s.sertifikalar.add(c); s.sertifikaDer.add(der); }
                    }
                }
            }
        }

        /* Hiç sertifika bulunamadıysa kartın dizinini tarayıp okunabilen her
           dosyayı sertifika sanıp deniyoruz. Yavaş ama tanıda işe yarıyor. */
        if (s.sertifikalar.isEmpty()) {
            List<Integer> ids = kart.listFiles();
            if (!ids.isEmpty()) s.notlar.add("Dizin taraması: " + ids.size() + " dosya.");
            for (int id : ids) {
                if (!kart.selectId(id)) continue;
                byte[] der = kart.readBinary();
                X509Certificate c = parseCert(der);
                if (c != null) { s.sertifikalar.add(c); s.sertifikaDer.add(der); }
            }
        }

        return s;
    }
}
