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
