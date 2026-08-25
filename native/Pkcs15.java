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

    /* PKCS#15 uygulamasının standart AID'i */
    public static final byte[] AID_UZUN = {
        (byte) 0xA0, 0x00, 0x00, 0x00, 0x63,
        0x50, 0x4B, 0x43, 0x53, 0x2D, 0x31, 0x35
    };

    /* TÜRKTRUST/AKİS kartında dizinin adı düpedüz "PKCS-15" metni; kartın
       kendi FCI'si böyle bildiriyor (84 07 50 4B 43 53 2D 31 35). */
    public static final byte[] AID_KISA = {
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

    /* Anahtar referansı tek baytlık bir INTEGER; modül uzunluğu (2048) iki
       bayt olduğu için uzunluğu sınırlayarak onu dışarıda bırakıyoruz. */
    public static List<Integer> integers(byte[] v, int enFazlaBayt) {
        List<Integer> out = new ArrayList<>();
        for (Der d : children(v)) {
            if (!d.cons && d.tag == 0x02 && d.value.length >= 1 && d.value.length <= enFazlaBayt) {
                int n = 0;
                for (byte x : d.value) n = (n << 8) | (x & 0xFF);
                out.add(n);
            } else if (d.cons) {
                out.addAll(integers(d.value, enFazlaBayt));
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
        public final List<Dosya> tarama = new ArrayList<>();
        public final List<String> pinSorgu = new ArrayList<>();
    }

    public static Sonuc gez(Akis kart) throws Exception {
        Sonuc s = new Sonuc();

        kart.selectId(0x3F00);

        /* EF(DIR) her kartta yok — TÜRKTRUST/AKİS kartında bulunmuyor.
           Varsa yolu oradan alıyoruz, yoksa sorun değil. */
        s.efDir = kart.readFile(new byte[]{0x2F, 0x00});
        if (s.efDir == null || s.efDir.length == 0) s.notlar.add("Kartta EF(DIR) yok.");

        /* PKCS#15 dizinine girmenin yolları, işe yarama olasılığına göre.
           Kart FCI'sinde dizinin adını "PKCS-15" diye bildiriyor; standart
           12 baytlık AID bu kartta 6A 82 (dosya yok) veriyor. */
        String nasil = null;
        if (s.efDir != null && s.efDir.length > 0) {
            byte[] yol = firstPath(s.efDir);
            if (yol != null) {
                kart.selectId(0x3F00);
                if (kart.select(yol)) nasil = "EF(DIR)'deki yol " + Ccid.hex(yol);
            }
        }
        if (nasil == null && kart.selectAid(AID_KISA))     nasil = "DF adı \"PKCS-15\"";
        if (nasil == null && kart.selectAid(AID_UZUN))     nasil = "standart 12 baytlık AID";
        if (nasil == null && kart.selectVarsayilan())      nasil = "öntanımlı uygulama (boş AID)";
        if (nasil == null) { kart.selectId(0x3F00); if (kart.selectId(0x3D01)) nasil = "dosya kimliği 3D01"; }
        if (nasil == null) { kart.selectId(0x3F00); if (kart.selectId(0x5015)) nasil = "dosya kimliği 5015"; }

        if (nasil != null) s.notlar.add("PKCS#15 dizinine girildi: " + nasil);
        else s.notlar.add("PKCS#15 dizinine girilemedi.");

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

                /* PrKDF PIN korumalı olabiliyor (bu kartta boş dönüyor);
                   PuKDF aynı anahtarı aynı referansla tarif ettiği için
                   oradan da topluyoruz. */
                if (e.tagNum == 0 || e.tagNum == 1) s.anahtarRef.addAll(integers(f.icerik, 1));
                if (e.tagNum == 8) s.pinRef.addAll(integers(f.icerik, 1));
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
           dosyayı sertifika sanıp deniyoruz. Bu kartta 80 18 desteklenmiyor
           (6D 00), o zaman liste boş döner ve tarama atlanır. */
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

        /* Kartta AODF listelenmemiş. Önce dizini tarıyoruz: SELECT hiçbir hak
           tüketmediği için bu tamamen güvenli ve AODF varsa ortaya çıkarır. */
        int[] taranacak = {
            0x2F01, 0x2F02, 0x2F03, 0x2F04, 0x2F05, 0x2F06, 0x2F07, 0x2F08,
            0x2F09, 0x2F0A, 0x2F0B, 0x2F0C, 0x2F0D, 0x2F0E, 0x2F0F, 0x2F10,
            0x2F11, 0x2F12, 0x5031, 0x5032, 0x5033, 0x5034, 0x5035
        };
        for (int fid : taranacak) {
            try {
                if (!kart.varMi(fid)) continue;
                byte[] icerik = kart.readBinary();
                Dosya f = new Dosya();
                f.ad = String.format("tarama %04X", fid);
                f.yol = new byte[]{(byte) (fid >> 8), (byte) fid};
                f.icerik = icerik;
                s.tarama.add(f);
            } catch (Exception ignored) {}
        }

        /* PIN referansı: veri alanı olmayan VERIFY ile sayaç sorulur, PIN
           gönderilmez, hak eksilmez. Kartın ham cevabını rapora yazıyoruz —
           tanıyamadığımız bir kod gelirse ona bakarak karar vereceğiz.
           Hem PKCS#15 dizininde hem MF'te deniyoruz; PIN genel olabilir. */
        int[] adaylar = {0x01, 0x81, 0x02, 0x82, 0x00, 0x83, 0x03};
        for (int yer = 0; yer < 2; yer++) {
            String nerede;
            if (yer == 0) {
                nerede = "PKCS#15 dizininde";
            } else {
                nerede = "MF'te";
                kart.selectId(0x3F00);
            }
            for (int ref : adaylar) {
                int sw;
                try { sw = kart.pinSw(ref); } catch (Exception e) { continue; }
                String durum = Akis.pinDurum(sw);
                s.pinSorgu.add(String.format("%s ref %02X -> %04X  (%s)", nerede, ref, sw, durum));
                if ((sw & 0xFFF0) == 0x63C0 || sw == 0x9000 || sw == 0x6983) s.pinRef.add(ref);
            }
        }

        return s;
    }
}
