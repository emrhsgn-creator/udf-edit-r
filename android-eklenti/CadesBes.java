package __PAKET__;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;

/* UYAP girişindeki imza: ayrık (detached) CAdES-BES, SHA-256 + RSA.
   Bilgisayardaki "Adalet E-imza" programı (ESYA kütüphanesi) giriş içeriğini
   BaseSignedData.addContent(içerik, false) + ESignatureType.TYPE_BES ile, ek
   öznitelik vermeden imzalar. BES'in kendi eklediği imzalı öznitelikler:
   contentType, messageDigest, signingCertificateV2 (signingTime YOK).
   Kodlama src/imza.js'deki sign.sgn üreticisiyle aynıdır (o, UYAP editörünün
   ESYA çıktısıyla bayt bayt eşleşti); tek fark signingTime'ın olmaması.

   Kart yalnızca ham imza verir; CMS burada kurulur. Android'e bağımlı değildir,
   bilgisayarda da derlenip sınanabilir. */
public final class CadesBes {

    /* Kart: DigestInfo(SHA-256) alır, PKCS#1 v1.5 imzasını döndürür. */
    public interface Imzaci { byte[] imzala(byte[] digestInfo) throws Exception; }

    /* Portalın beklediği sertifika bilgileri (Adalet E-imza'nın CertificateDto'su). */
    public static final class Sertifika {
        public byte[] der, seriDer, yayinciDer;
        public String kimlik;        // certificateId: SHA-1(RSA modülü), büyük harf hex
        public String seriHex;       // certSerial: seri numarasının DER içeriği, hex
        public String ad, yayinci, tckn, ulke, eposta, imzaAlg, anahtarAlg;
        public Date baslangic, bitis;
        public boolean rsa;

        public boolean gecerli() {
            Date simdi = new Date();
            return simdi.after(baslangic) && simdi.before(bitis);
        }
    }

    private static final String DATA = "1.2.840.113549.1.7.1", SIGNED_DATA = "1.2.840.113549.1.7.2",
            CONTENT_TYPE = "1.2.840.113549.1.9.3", MESSAGE_DIGEST = "1.2.840.113549.1.9.4",
            SIG_CERT_V2 = "1.2.840.113549.1.9.16.2.47", SHA256 = "2.16.840.1.101.3.4.2.1",
            SHA256_RSA = "1.2.840.113549.1.1.11",
            CN = "2.5.4.3", SERI = "2.5.4.5", ULKE = "2.5.4.6", KURUM = "2.5.4.10", EPOSTA = "1.2.840.113549.1.9.1";

    private static final byte[] DIGESTINFO_SHA256 = {0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, (byte) 0x86, 0x48, 0x01,
            0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20};

    private CadesBes() { }

    /* ---------------- sertifika ---------------- */
    public static Sertifika coz(byte[] der) throws Exception {
        X509Certificate x = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(der));
        Sertifika s = new Sertifika();
        s.der = der;

        AkisKart.Der kok = AkisKart.Der.oku(der, 0);
        List<AkisKart.Der> tbs = kok.cocuklar(der).get(0).cocuklar(der);
        if (tbs.get(0).etiket == 0xA0) tbs = tbs.subList(1, tbs.size());     // sürüm
        AkisKart.Der seri = tbs.get(0), yayinci = tbs.get(2), konu = tbs.get(4);
        s.seriDer = Arrays.copyOfRange(der, seri.bas, seri.son);
        s.yayinciDer = Arrays.copyOfRange(der, yayinci.bas, yayinci.son);
        s.seriHex = AkisKart.hex(Arrays.copyOfRange(der, seri.ici, seri.son));

        String[] konuAd = adCoz(der, konu, CN, SERI, ULKE, EPOSTA);
        String[] yayinciAd = adCoz(der, yayinci, CN, KURUM);
        s.ad = konuAd[0];
        s.tckn = konuAd[1];
        s.ulke = konuAd[2];
        s.eposta = konuAd[3] != null ? konuAd[3] : "";
        s.yayinci = yayinciAd[0] != null ? yayinciAd[0] : yayinciAd[1];

        s.baslangic = x.getNotBefore();
        s.bitis = x.getNotAfter();
        s.imzaAlg = x.getSigAlgName();
        s.anahtarAlg = x.getPublicKey().getAlgorithm();
        s.rsa = x.getPublicKey() instanceof RSAPublicKey;
        if (s.rsa) {
            // Adalet E-imza: SHA-1(işaretsiz modül baytları)
            byte[] m = ((RSAPublicKey) x.getPublicKey()).getModulus().toByteArray();
            if (m.length > 1 && m[0] == 0) m = Arrays.copyOfRange(m, 1, m.length);
            s.kimlik = AkisKart.hex(MessageDigest.getInstance("SHA-1").digest(m));
        } else {
            s.kimlik = AkisKart.hex(MessageDigest.getInstance("SHA-1").digest(x.getPublicKey().getEncoded()));
        }
        return s;
    }

    /* Name içinden istenen özniteliklerin değerleri (yoksa null), istenen sırayla. */
    private static String[] adCoz(byte[] b, AkisKart.Der ad, String... oidler) {
        String[] r = new String[oidler.length];
        for (AkisKart.Der rdn : ad.cocuklar(b))
            for (AkisKart.Der at : rdn.cocuklar(b)) {
                List<AkisKart.Der> tv = at.cocuklar(b);
                if (tv.size() < 2) continue;
                String oid = oidYazi(Arrays.copyOfRange(b, tv.get(0).ici, tv.get(0).son));
                for (int i = 0; i < oidler.length; i++)
                    if (oidler[i].equals(oid) && r[i] == null) r[i] = metin(b, tv.get(1));
            }
        return r;
    }

    private static String metin(byte[] b, AkisKart.Der d) {
        byte[] v = Arrays.copyOfRange(b, d.ici, d.son);
        if (d.etiket == 0x1E) return new String(v, Charset.forName("UTF-16BE"));      // BMPString
        if (d.etiket == 0x14) return new String(v, StandardCharsets.ISO_8859_1);       // TeletexString
        return new String(v, StandardCharsets.UTF_8);
    }

    private static String oidYazi(byte[] b) {
        StringBuilder s = new StringBuilder().append((b[0] & 0xFF) / 40).append('.').append((b[0] & 0xFF) % 40);
        long v = 0;
        for (int i = 1; i < b.length; i++) {
            v = (v << 7) | (b[i] & 0x7F);
            if ((b[i] & 0x80) == 0) { s.append('.').append(v); v = 0; }
        }
        return s.toString();
    }

    /* ---------------- CAdES-BES ---------------- */
    public static byte[] olustur(byte[] icerik, Sertifika s, Imzaci imzaci) throws Exception {
        if (!s.rsa) throw new Exception("Bu sertifikanın anahtarı RSA değil; şimdilik yalnızca RSA destekleniyor.");
        byte[] ozet = sha256(icerik), sertOzet = sha256(s.der);
        List<byte[]> nitelikler = new ArrayList<>();
        nitelikler.add(seq(oid(CONTENT_TYPE), set(oid(DATA))));
        nitelikler.add(seq(oid(MESSAGE_DIGEST), set(tlv(0x04, ozet))));
        nitelikler.add(seq(oid(SIG_CERT_V2), set(seq(seq(seq(tlv(0x04, sertOzet),
                seq(seq(tlv(0xA4, s.yayinciDer)), s.seriDer)))))));
        byte[][] sirali = derSirala(nitelikler);

        // İmza, nitelikler SET etiketiyle kodlanmışken atılır; CMS'e [0] etiketiyle girer.
        byte[] imza = imzaci.imzala(birlestir(DIGESTINFO_SHA256, sha256(tlv(0x31, sirali))));

        byte[] imzaciBilgisi = seq(
                new byte[]{0x02, 0x01, 0x01},
                seq(s.yayinciDer, s.seriDer),
                seq(oid(SHA256)),
                tlv(0xA0, sirali),
                seq(oid(SHA256_RSA), new byte[]{0x05, 0x00}),
                tlv(0x04, imza));
        byte[] signedData = seq(
                new byte[]{0x02, 0x01, 0x01},
                set(seq(oid(SHA256))),
                seq(oid(DATA)),
                tlv(0xA0, s.der),
                set(imzaciBilgisi));
        return seq(oid(SIGNED_DATA), tlv(0xA0, signedData));
    }

    static byte[] sha256(byte[] b) throws Exception { return MessageDigest.getInstance("SHA-256").digest(b); }

    /* ---------------- DER ---------------- */
    private static byte[] birlestir(byte[]... parcalar) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] p : parcalar) o.write(p, 0, p.length);
        return o.toByteArray();
    }

    private static byte[] tlv(int etiket, byte[]... icerik) {
        byte[] c = birlestir(icerik);
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(etiket);
        int n = c.length;
        if (n < 0x80) o.write(n);
        else {
            byte[] u = BigInteger.valueOf(n).toByteArray();
            int bas = u[0] == 0 ? 1 : 0;
            o.write(0x80 | (u.length - bas));
            o.write(u, bas, u.length - bas);
        }
        o.write(c, 0, c.length);
        return o.toByteArray();
    }

    private static byte[] seq(byte[]... x) { return tlv(0x30, x); }
    private static byte[] set(byte[]... x) { return tlv(0x31, x); }

    private static byte[] oid(String s) {
        String[] p = s.split("\\.");
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(40 * Integer.parseInt(p[0]) + Integer.parseInt(p[1]));
        for (int i = 2; i < p.length; i++) {
            long v = Long.parseLong(p[i]);
            byte[] t = new byte[10];
            int n = 0;
            t[n++] = (byte) (v & 0x7F);
            while ((v >>= 7) > 0) t[n++] = (byte) ((v & 0x7F) | 0x80);
            for (int j = n - 1; j >= 0; j--) o.write(t[j]);
        }
        return tlv(0x06, o.toByteArray());
    }

    /* DER: SET OF öğeleri kodlanmış hâllerine göre sıralı. */
    private static byte[][] derSirala(List<byte[]> l) {
        byte[][] a = l.toArray(new byte[0][]);
        Arrays.sort(a, (x, y) -> {
            for (int i = 0; i < Math.min(x.length, y.length); i++)
                if (x[i] != y[i]) return (x[i] & 0xFF) - (y[i] & 0xFF);
            return x.length - y.length;
        });
        return a;
    }
}
