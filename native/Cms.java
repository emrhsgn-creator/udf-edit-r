package __PACKAGE__;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/* UDF'in sign.sgn dosyasını üretir: ayrık (detached) CAdES-BES.

   Yapı gerçek bir UYAP belgesinden çıkarıldı ve openssl ile doğrulandı
   (ayrıntı: docs/e-imza.md):

     ContentInfo(signedData)
       version 1
       digestAlgorithms   { sha256 }        — parametresiz, NULL yok
       encapContentInfo   { pkcs7-data }    — eContent yok, imza ayrık
       certificates [0]   { imzalayan }     — CA zinciri gömülmüyor
       signerInfos        { SignerInfo }
         sid                issuerAndSerialNumber
         signedAttrs        contentType, signingTime, messageDigest,
                            signingCertificateV2
         signatureAlgorithm sha256WithRSAEncryption  — burada NULL var
         signature          RSA-2048

   İmza content.xml'in baytları üzerine değil, signedAttrs'ın DER SET
   kodlamasının SHA-256'sı üzerine atılır (CMS kuralı). content.xml'in
   özeti messageDigest özniteliğinde taşınır.

   Android'e özgü hiçbir şey kullanmıyor: bilgisayarda derlenip openssl ile
   sınanabilsin diye kendi küçük DER yazıcısı ve okuyucusu var. */
public class Cms {

    /* Kartın yaptığı iş: verilen DigestInfo'yu özel anahtarla imzalamak. */
    public interface Imzalayici {
        byte[] imzala(byte[] digestInfo) throws Exception;
    }

    // ---------------- DER yazma ----------------

    static byte[] h(String hex) {
        String t = hex.replace(" ", "");
        byte[] b = new byte[t.length() / 2];
        for (int i = 0; i < b.length; i++)
            b[i] = (byte) Integer.parseInt(t.substring(i * 2, i * 2 + 2), 16);
        return b;
    }

    static byte[] birlestir(byte[]... parcalar) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] p : parcalar) o.write(p, 0, p.length);
        return o.toByteArray();
    }

    static byte[] tlv(int tag, byte[] icerik) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(tag);
        int n = icerik.length;
        if (n < 0x80) {
            o.write(n);
        } else {
            int bayt = (n < 0x100) ? 1 : (n < 0x10000) ? 2 : (n < 0x1000000) ? 3 : 4;
            o.write(0x80 | bayt);
            for (int i = bayt - 1; i >= 0; i--) o.write((n >> (8 * i)) & 0xFF);
        }
        o.write(icerik, 0, icerik.length);
        return o.toByteArray();
    }

    static byte[] dizi(byte[]... p) { return tlv(0x30, birlestir(p)); }
    static byte[] kume(byte[]... p) { return tlv(0x31, birlestir(p)); }
    static byte[] oktet(byte[] v)   { return tlv(0x04, v); }
    static byte[] bosNull()         { return new byte[]{0x05, 0x00}; }

    /* DER'de SET OF ögeleri kodlamalarına göre sıralı olmalı: octet string
       gibi karşılaştırılır, kısa olan sonda sıfırla doldurulmuş sayılır. */
    static byte[] sirala(List<byte[]> ogeler) {
        List<byte[]> k = new ArrayList<>(ogeler);
        Collections.sort(k, new Comparator<byte[]>() {
            @Override
            public int compare(byte[] a, byte[] b) {
                int n = Math.min(a.length, b.length);
                for (int i = 0; i < n; i++) {
                    int f = (a[i] & 0xFF) - (b[i] & 0xFF);
                    if (f != 0) return f;
                }
                return a.length - b.length;
            }
        });
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] x : k) o.write(x, 0, x.length);
        return o.toByteArray();
    }

    static byte[] utcZaman(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return tlv(0x17, f.format(d).getBytes(StandardCharsets.US_ASCII));
    }

    // ---------------- nesne tanımlayıcıları ----------------

    static final byte[] OID_SIGNED_DATA    = h("06 09 2A864886F70D010702");
    static final byte[] OID_DATA           = h("06 09 2A864886F70D010701");
    static final byte[] OID_SHA256         = h("06 09 608648016503040201");
    static final byte[] OID_SHA256_RSA     = h("06 09 2A864886F70D01010B");
    static final byte[] OID_CONTENT_TYPE   = h("06 09 2A864886F70D010903");
    static final byte[] OID_MESSAGE_DIGEST = h("06 09 2A864886F70D010904");
    static final byte[] OID_SIGNING_TIME   = h("06 09 2A864886F70D010905");
    /* 1.2.840.113549.1.9.16.2.47 — id-aa-signingCertificateV2 */
    static final byte[] OID_SIGNING_CERT2  = h("06 0B 2A864886F70D01091002 2F");

    /* SHA-256 için DigestInfo öneki; ardına 32 baytlık özet gelir. */
    public static final byte[] DIGEST_INFO_ONEK = h("30 31 300D 0609 608648016503040201 0500 0420");

    // ---------------- DER okuma (sertifikadan alan çekmek için) ----------------

    /* {etiket, başlangıç, içerikBaşı, uzunluk, son} */
    static int[] tlvOku(byte[] b, int off) throws Exception {
        int p = off;
        if (p + 2 > b.length) throw new Exception("Sertifika bozuk.");
        int tag = b[p++] & 0xFF;
        if ((tag & 0x1F) == 0x1F) while ((b[p++] & 0x80) != 0) { /* çok baytlı etiket */ }
        int l = b[p++] & 0xFF, len;
        if ((l & 0x80) == 0) {
            len = l;
        } else {
            int nb = l & 0x7F;
            if (nb == 0 || nb > 4) throw new Exception("Sertifika bozuk.");
            len = 0;
            for (int i = 0; i < nb; i++) len = (len << 8) | (b[p++] & 0xFF);
        }
        if (p + len > b.length) throw new Exception("Sertifika bozuk.");
        return new int[]{tag, off, p, len, p + len};
    }

    static byte[] kes(byte[] b, int[] t) { return Arrays.copyOfRange(b, t[1], t[4]); }

    /* Sertifikadan issuer ve serialNumber'ı DER'leriyle birlikte çeker.
       TBSCertificate ::= SEQUENCE { [0] version OPTIONAL, serialNumber,
                                     signature, issuer, ... } */
    static byte[][] sertifikaAlanlari(byte[] cert) throws Exception {
        int[] dis = tlvOku(cert, 0);
        int[] tbs = tlvOku(cert, dis[2]);
        int p = tbs[2];
        int[] ilk = tlvOku(cert, p);
        if ((ilk[0] & 0xC0) == 0x80) p = ilk[4];          // bağlam etiketli sürüm alanı varsa atla
        int[] seri  = tlvOku(cert, p);
        int[] alg   = tlvOku(cert, seri[4]);
        int[] veren = tlvOku(cert, alg[4]);
        return new byte[][]{kes(cert, veren), kes(cert, seri)};
    }

    // ---------------- ana iş ----------------

    public static byte[] uret(byte[] icerik, byte[] sertifika, Date zaman, Imzalayici imzalayici)
            throws Exception {

        byte[] icerikOzeti    = MessageDigest.getInstance("SHA-256").digest(icerik);
        byte[] sertifikaOzeti = MessageDigest.getInstance("SHA-256").digest(sertifika);

        byte[][] alanlar = sertifikaAlanlari(sertifika);
        byte[] veren = alanlar[0], seri = alanlar[1];

        /* ESSCertIDv2: özet algoritması SHA-256 olduğunda yazılmaz (DEFAULT). */
        byte[] essCertId = dizi(
            oktet(sertifikaOzeti),
            dizi(dizi(tlv(0xA4, veren)), seri));

        List<byte[]> ozn = new ArrayList<>();
        ozn.add(dizi(OID_CONTENT_TYPE,   kume(OID_DATA)));
        ozn.add(dizi(OID_SIGNING_TIME,   kume(utcZaman(zaman))));
        ozn.add(dizi(OID_MESSAGE_DIGEST, kume(oktet(icerikOzeti))));
        ozn.add(dizi(OID_SIGNING_CERT2,  kume(dizi(dizi(essCertId)))));

        /* Aynı sıralı içerik iki kez kullanılıyor: imzalanırken SET (0x31),
           mesaja konurken örtük [0] (0xA0) etiketiyle. */
        byte[] oznIcerik = sirala(ozn);
        byte[] ozet = MessageDigest.getInstance("SHA-256").digest(tlv(0x31, oznIcerik));
        byte[] imza = imzalayici.imzala(birlestir(DIGEST_INFO_ONEK, ozet));

        byte[] signerInfo = dizi(
            tlv(0x02, new byte[]{0x01}),
            dizi(veren, seri),
            dizi(OID_SHA256),
            tlv(0xA0, oznIcerik),
            dizi(OID_SHA256_RSA, bosNull()),
            oktet(imza));

        byte[] signedData = dizi(
            tlv(0x02, new byte[]{0x01}),
            kume(dizi(OID_SHA256)),
            dizi(OID_DATA),
            tlv(0xA0, sertifika),
            kume(signerInfo));

        return dizi(OID_SIGNED_DATA, tlv(0xA0, signedData));
    }
}
