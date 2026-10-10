package __PAKET__;

import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

/* USB CCID akıllı kart okuyucusu (ACS ACR39U, token içindeki okuyucular vb.).
   Android'de PC/SC yok; okuyucuyla USB toplu aktarım (bulk) üzerinden CCID
   iletileriyle konuşulur. Okuyucu "APDU düzeyinde" çalışıyorsa APDU doğrudan
   gider; "TPDU düzeyinde" çalışıyorsa T=1 blok çerçevelemesini burada yaparız. */
public class CcidOkuyucu implements AutoCloseable, AkisKart.Kanal {

    private static final int ZAMAN_ASIMI = 30000;

    private final UsbDeviceConnection bag;
    private final UsbInterface arayuz;
    private UsbEndpoint giris, cikis;
    private byte sira = 0;
    private int ozellikler = 0;           // dwFeatures
    private int enBuyukIleti = 271;       // dwMaxCCIDMessageLength
    private byte[] atr;
    private boolean t1 = false, apduDuzeyi = false;
    private int ifsc = 32;
    private int ns = 0;                   // T=1 gönderme sıra biti
    public final StringBuilder gunluk = new StringBuilder();

    public static UsbInterface ccidArayuzu(UsbDevice d) {
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface a = d.getInterface(i);
            if (a.getInterfaceClass() == 0x0B) return a;   // Smart Card sınıfı
        }
        // Bazı tokenlar sınıfı 0xFF (üreticiye özgü) bildirir ama CCID konuşur
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface a = d.getInterface(i);
            if (a.getInterfaceClass() == 0xFF && a.getEndpointCount() >= 2) return a;
        }
        return null;
    }

    public CcidOkuyucu(UsbManager um, UsbDevice d) throws Exception {
        arayuz = ccidArayuzu(d);
        if (arayuz == null) throw new Exception("Bu USB aygıtı bir kart okuyucu değil.");
        bag = um.openDevice(d);
        if (bag == null) throw new Exception("Okuyucuya bağlanılamadı (USB izni?).");
        if (!bag.claimInterface(arayuz, true)) throw new Exception("Okuyucu başka bir uygulamada açık.");
        for (int i = 0; i < arayuz.getEndpointCount(); i++) {
            UsbEndpoint e = arayuz.getEndpoint(i);
            if (e.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
            if (e.getDirection() == UsbConstants.USB_DIR_IN) giris = e; else cikis = e;
        }
        if (giris == null || cikis == null) throw new Exception("Okuyucunun veri uçları bulunamadı.");
        tanimlayiciOku();
    }

    /* CCID sınıf tanımlayıcısı (tip 0x21): dwFeatures ve en büyük ileti boyu. */
    private void tanimlayiciOku() {
        byte[] t = bag.getRawDescriptors();
        if (t == null) return;
        for (int i = 0; i + 1 < t.length; ) {
            int uz = t[i] & 0xFF;
            if (uz == 0) break;
            if ((t[i + 1] & 0xFF) == 0x21 && uz >= 54) {
                ozellikler = le32(t, i + 40);
                enBuyukIleti = le32(t, i + 44);
                break;
            }
            i += uz;
        }
        apduDuzeyi = (ozellikler & 0x00060000) != 0;   // kısa ya da uzun APDU düzeyi
        gunluk.append(String.format("CCID özellikler=%08X ileti=%d\n", ozellikler, enBuyukIleti));
    }

    private static int le32(byte[] b, int i) {
        return (b[i] & 0xFF) | (b[i + 1] & 0xFF) << 8 | (b[i + 2] & 0xFF) << 16 | (b[i + 3] & 0xFF) << 24;
    }

    /* ---------- CCID iletileri ---------- */
    private byte[] ilet(int tip, byte[] veri, byte p1, byte p2, byte p3) throws Exception {
        if (veri == null) veri = new byte[0];
        byte[] m = new byte[10 + veri.length];
        m[0] = (byte) tip;
        m[1] = (byte) veri.length; m[2] = (byte) (veri.length >> 8);
        m[3] = (byte) (veri.length >> 16); m[4] = (byte) (veri.length >> 24);
        m[5] = 0; m[6] = ++sira; m[7] = p1; m[8] = p2; m[9] = p3;
        System.arraycopy(veri, 0, m, 10, veri.length);
        int n = bag.bulkTransfer(cikis, m, m.length, ZAMAN_ASIMI);
        if (n != m.length) throw new Exception("Okuyucuya yazılamadı.");
        while (true) {
            byte[] y = oku();
            if ((y[6] & 0xFF) != (sira & 0xFF)) continue;           // eski yanıt
            int durum = y[7] & 0xFF;
            if ((durum & 0xC0) == 0x80) continue;                   // zaman uzatma: kart çalışıyor
            if ((durum & 0xC0) == 0x40) {
                int kartDurumu = durum & 0x03;
                if (kartDurumu == 2) throw new KartYok();
                throw new Exception(String.format("Okuyucu hatası %02X", y[8] & 0xFF));
            }
            int uz = le32(y, 1);
            return Arrays.copyOfRange(y, 10, 10 + uz);
        }
    }

    private byte[] oku() throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] tampon = new byte[Math.max(giris.getMaxPacketSize(), Math.min(enBuyukIleti, 65546))];
        int beklenen = -1;
        do {
            int n = bag.bulkTransfer(giris, tampon, tampon.length, ZAMAN_ASIMI);
            if (n < 0) throw new Exception("Okuyucu yanıt vermedi.");
            o.write(tampon, 0, n);
            byte[] s = o.toByteArray();
            if (beklenen < 0 && s.length >= 10) beklenen = 10 + le32(s, 1);
        } while (beklenen < 0 || o.size() < beklenen);
        return o.toByteArray();
    }

    public static class KartYok extends Exception {
        public KartYok() { super("Okuyucuda kart yok."); }
    }

    /* ---------- Kartı başlat ---------- */
    public byte[] baslat() throws Exception {
        try { ilet(0x63, null, (byte) 0, (byte) 0, (byte) 0); } catch (KartYok e) { throw e; } catch (Exception e) { }
        atr = ilet(0x62, null, (byte) 0, (byte) 0, (byte) 0);    // otomatik voltaj
        gunluk.append("ATR ").append(hex(atr)).append('\n');
        atrCoz();
        if (!apduDuzeyi && t1) {
            boolean otomatikParametre = (ozellikler & 0x40) != 0 || (ozellikler & 0x80) != 0;
            if (!otomatikParametre) parametreAyarla();
            ns = 0;
            try { sBlok(0xC1, new byte[]{(byte) 0xFE}); } catch (Exception e) { gunluk.append("IFSD: ").append(e.getMessage()).append('\n'); }
        }
        return atr;
    }

    private int ta1 = 0x11, tb3 = 0x4D, tc1 = 0;

    private void atrCoz() {
        int i = 1, y = (atr[i] & 0xF0) >> 4, tdSayisi = 0;
        i++;
        boolean ilkProtokolT1 = false;
        while (true) {
            tdSayisi++;
            int ta = -1, tb = -1, tc = -1, td = -1;
            if ((y & 1) != 0) ta = atr[i++] & 0xFF;
            if ((y & 2) != 0) tb = atr[i++] & 0xFF;
            if ((y & 4) != 0) tc = atr[i++] & 0xFF;
            if ((y & 8) != 0) td = atr[i++] & 0xFF;
            if (tdSayisi == 1) { if (ta >= 0) ta1 = ta; if (tc >= 0) tc1 = tc; }
            if (tdSayisi >= 3 && ilkProtokolT1) { if (ta >= 0) ifsc = ta; if (tb >= 0) tb3 = tb; }
            if (td < 0) break;
            if ((td & 0x0F) == 1) { t1 = true; ilkProtokolT1 = true; }
            y = (td & 0xF0) >> 4;
            if (i >= atr.length) break;
        }
        gunluk.append("T=").append(t1 ? 1 : 0).append(" IFSC=").append(ifsc).append(" APDU düzeyi=").append(apduDuzeyi).append('\n');
    }

    private void parametreAyarla() throws Exception {
        // PPS yapılmadıysa kart varsayılan hızdadır (Fi/Di = 1/1)
        byte fd = (ozellikler & 0x80) != 0 ? (byte) ta1 : 0x11;
        byte[] p = {fd, 0x10, (byte) tc1, (byte) tb3, 0x00, (byte) ifsc, 0x00};
        ilet(0x61, p, (byte) 1, (byte) 0, (byte) 0);
    }

    /* ---------- APDU ---------- */
    public byte[] apdu(byte[] komut) throws Exception {
        byte[] y = apduDuzeyi || !t1 ? ilet(0x6F, komut, (byte) 0, (byte) 0, (byte) 0) : t1Gonder(komut);
        // 61xx: kalan yanıtı al; 6Cxx: doğru uzunlukla yinele
        int sw1 = y.length >= 2 ? y[y.length - 2] & 0xFF : 0;
        if (sw1 == 0x6C && komut.length >= 5) {
            byte[] k = komut.clone(); k[k.length - 1] = y[y.length - 1];
            return apdu(k);
        }
        if (sw1 == 0x61) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            while (sw1 == 0x61) {
                o.write(y, 0, y.length - 2);
                byte[] g = {0x00, (byte) 0xC0, 0x00, 0x00, y[y.length - 1]};
                y = apduDuzeyi || !t1 ? ilet(0x6F, g, (byte) 0, (byte) 0, (byte) 0) : t1Gonder(g);
                sw1 = y.length >= 2 ? y[y.length - 2] & 0xFF : 0;
            }
            o.write(y, 0, y.length);
            return o.toByteArray();
        }
        return y;
    }

    /* ---------- T=1 (ISO 7816-3) ---------- */
    private static byte lrc(byte[] b, int n) { byte x = 0; for (int i = 0; i < n; i++) x ^= b[i]; return x; }

    private static String kisa(byte[] b) {
        String h = hex(b);
        return h.length() > 40 ? h.substring(0, 40) + "…(" + b.length + ")" : h;
    }

    /* Tek blok gönder, yanıtı al. LRC hatasında yinele. */
    private byte[] hamBlok(int pcb, byte[] inf) throws Exception {
        byte[] b = new byte[4 + inf.length];
        b[0] = 0; b[1] = (byte) pcb; b[2] = (byte) inf.length;
        System.arraycopy(inf, 0, b, 3, inf.length);
        b[b.length - 1] = lrc(b, b.length - 1);
        for (int deneme = 0; deneme < 3; deneme++) {
            byte[] y = ilet(0x6F, b, (byte) 0, (byte) 0, (byte) 0);
            if (gunluk.length() < 6000) gunluk.append("  > ").append(kisa(b)).append("  < ").append(kisa(y)).append('\n');
            if (y.length >= 4 && lrc(y, y.length - 1) == y[y.length - 1] && (y[2] & 0xFF) == y.length - 4) return y;
        }
        throw new Exception("Kartla iletişim bozuk (T=1).");
    }

    /* Blok gönder; kartın araya soktuğu S-isteklerini (IFS, WTX, ABORT)
       burada yanıtla. Çağıran yalnızca I- ya da R-blok görür. */
    private byte[] blok(int pcb, byte[] inf) throws Exception {
        byte[] y = hamBlok(pcb, inf);
        for (int t = 0; t < 64; t++) {
            int p = y[1] & 0xFF;
            if ((p & 0xE0) != 0xC0) return y;                  // S-istek değil
            byte[] yInf = Arrays.copyOfRange(y, 3, 3 + (y[2] & 0xFF));
            switch (p & 0x1F) {
                case 0x01:                                     // IFS isteği: kartın yeni IFSC'si
                    if (yInf.length == 1) ifsc = yInf[0] & 0xFF;
                    y = hamBlok(0xE1, yInf);
                    break;
                case 0x03:                                     // WTX: kart daha fazla süre istiyor
                    y = hamBlok(0xE3, yInf);
                    break;
                case 0x02:                                     // ABORT
                    hamBlok(0xE2, yInf);
                    throw new Exception("Kart işlemi durdurdu (T=1 ABORT).");
                default:                                       // RESYNCH vb.
                    y = hamBlok(p | 0x20, yInf);
                    ns = 0;
            }
        }
        throw new Exception("Kart yanıt vermiyor (T=1).");
    }

    private void sBlok(int pcb, byte[] inf) throws Exception {
        byte[] y = hamBlok(pcb, inf);
        if ((y[1] & 0xFF) != (pcb | 0x20)) throw new Exception(String.format("S-blok yanıtı beklenmedik %02X", y[1]));
    }

    private byte[] t1Gonder(byte[] apdu) throws Exception {
        ByteArrayOutputStream yanit = new ByteArrayOutputStream();
        int i = 0;
        // Komutu IFSC boyunda parçalara bölüp zincirle gönder
        while (true) {
            int n = Math.min(ifsc, apdu.length - i);
            boolean dahaVar = i + n < apdu.length;
            byte[] inf = Arrays.copyOfRange(apdu, i, i + n);
            int pcb = (ns << 6) | (dahaVar ? 0x20 : 0);
            byte[] y = blok(pcb, inf);
            // R-blok: kart bloğu alamadı ya da sonrakini istiyor
            int yineleme = 0;
            while ((y[1] & 0xC0) == 0x80) {
                int nr = (y[1] >> 4) & 1;
                if (dahaVar && nr != ns) break;                // zincir: sonraki parça istendi
                if (++yineleme > 3) throw new Exception(String.format("T=1 alındı onayı yok (%02X)", y[1]));
                y = blok(pcb, inf);                            // aynı bloğu yinele
            }
            if (dahaVar) {
                if ((y[1] & 0xC0) != 0x80) throw new Exception(String.format("T=1 zincirleme hatası %02X", y[1]));
                ns ^= 1; i += n;
                continue;
            }
            ns ^= 1;
            // Yanıt (gerekirse zincirli) I-blokları
            while (true) {
                if ((y[1] & 0x80) != 0) throw new Exception(String.format("T=1 beklenmedik blok %02X", y[1]));
                yanit.write(y, 3, y[2] & 0xFF);
                if ((y[1] & 0x20) == 0) return yanit.toByteArray();
                int nr = ((y[1] >> 6) & 1) ^ 1;
                y = blok(0x80 | (nr << 4), new byte[0]);
            }
        }
    }

    public static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02X", x));
        return s.toString();
    }

    @Override
    public void close() {
        try { ilet(0x63, null, (byte) 0, (byte) 0, (byte) 0); } catch (Exception e) { }
        try { bag.releaseInterface(arayuz); } catch (Exception e) { }
        bag.close();
    }
}
