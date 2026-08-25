package __PACKAGE__;

import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;

import java.io.ByteArrayOutputStream;

/* USB CCID taşıma katmanı.

   Android'de PC/SC yok, PKCS#11 yok. Akıllı kart okuyucusuyla doğrudan USB
   üzerinden konuşuyoruz. CCID, kart okuyucular için standart USB sınıfı
   (0x0B): 10 baytlık bir başlık + gövde, bulk uçlardan gidip geliyor.

   Bu sınıf yalnızca taşımayı bilir — hangi kart takılı olduğu, hangi komutun
   ne anlama geldiği onu ilgilendirmez. Kart tarafı Akis.java'da. */
public class Ccid {

    public static final int CLASS_CCID = 11;

    private static final byte PC_TO_RDR_ICC_POWER_ON    = 0x62;
    private static final byte PC_TO_RDR_ICC_POWER_OFF   = 0x63;
    private static final byte PC_TO_RDR_GET_SLOT_STATUS = 0x65;
    private static final byte PC_TO_RDR_XFR_BLOCK       = 0x6F;

    /* Kartta RSA-2048 imza bir saniyeyi bulabiliyor; okuyucu ayrıca zaman
       uzatma isteyebiliyor. Cömert davranıyoruz. */
    private static final int TIMEOUT = 15000;

    private final UsbDeviceConnection conn;
    private final UsbInterface iface;
    private final UsbEndpoint epOut, epIn;
    private byte seq = 0;
    private T1 t1 = null;             // ham TPDU kipinde devreye giriyor

    public static UsbInterface ccidInterface(UsbDevice dev) {
        for (int i = 0; i < dev.getInterfaceCount(); i++) {
            UsbInterface u = dev.getInterface(i);
            if (u.getInterfaceClass() == CLASS_CCID) return u;
        }
        return null;
    }

    public Ccid(UsbManager mgr, UsbDevice dev) throws Exception {
        iface = ccidInterface(dev);
        if (iface == null) throw new Exception("Cihazda CCID arayüzü yok.");

        conn = mgr.openDevice(dev);
        if (conn == null) throw new Exception("USB cihaz açılamadı; izin verilmemiş olabilir.");

        if (!conn.claimInterface(iface, true)) {
            conn.close();
            throw new Exception("USB arayüzü alınamadı; başka bir uygulama kullanıyor olabilir.");
        }

        UsbEndpoint o = null, i = null;
        for (int k = 0; k < iface.getEndpointCount(); k++) {
            UsbEndpoint e = iface.getEndpoint(k);
            if (e.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
            if (e.getDirection() == UsbConstants.USB_DIR_OUT) o = e; else i = e;
        }
        if (o == null || i == null) {
            conn.releaseInterface(iface);
            conn.close();
            throw new Exception("CCID bulk uçları bulunamadı.");
        }
        epOut = o;
        epIn = i;
    }

    /* Karta güç verir ve ATR'yi döndürür. ATR kartın kimlik kartıdır:
       hangi AKİS sürümü olduğunu buradan anlıyoruz.

       Okuyucunun "otomatik" voltaj seçimi her kartla anlaşamıyor; ICC_MUTE
       alırsak 5V / 3V / 1.8V'u sırayla deniyoruz. Her denemeden önce kartı
       kapatıyoruz, çünkü önceki denemeden yarım kalmış bir durumda olabilir. */
    public byte[] powerOn() throws Exception {
        byte[] voltajlar = {0x00, 0x01, 0x02, 0x03};
        String[] adlar = {"otomatik", "5V", "3V", "1.8V"};
        StringBuilder gunluk = new StringBuilder();

        for (int i = 0; i < voltajlar.length; i++) {
            try { rawCommand(PC_TO_RDR_ICC_POWER_OFF, new byte[0], (byte) 0, (byte) 0, (byte) 0); }
            catch (Exception ignored) {}
            try { Thread.sleep(60); } catch (InterruptedException ignored) {}

            try {
                byte[] resp = rawCommand(PC_TO_RDR_ICC_POWER_ON, new byte[0], voltajlar[i], (byte) 0, (byte) 0);
                int status = resp[7] & 0xFF;
                int error  = resp[8] & 0xFF;
                if ((status & 0xC0) == 0x00 && resp.length > 10) {
                    byte[] atr = new byte[resp.length - 10];
                    System.arraycopy(resp, 10, atr, 0, atr.length);
                    return atr;
                }
                if (gunluk.length() > 0) gunluk.append("; ");
                gunluk.append(adlar[i]).append(": ").append(hataMetni(status, error));
            } catch (Exception e) {
                if (gunluk.length() > 0) gunluk.append("; ");
                gunluk.append(adlar[i]).append(": ").append(e.getMessage());
            }
        }
        throw new Exception("Karta güç verilemedi — " + gunluk);
    }

    /* Yuvada kart var mı? Güç verme başarısız olduğunda "kart yok" ile
       "kart yanıt vermiyor" ayrımını yapabilmek için. */
    public String slotDurumu() {
        try {
            byte[] resp = rawCommand(PC_TO_RDR_GET_SLOT_STATUS, new byte[0], (byte) 0, (byte) 0, (byte) 0);
            switch (resp[7] & 0x03) {
                case 0:  return "kart takılı ve etkin";
                case 1:  return "kart takılı, etkin değil";
                case 2:  return "yuvada kart yok";
                default: return "bilinmiyor";
            }
        } catch (Exception e) {
            return "okunamadı (" + e.getMessage() + ")";
        }
    }

    /* CCID hata kodlarının anlamı — ekranda ham sayı yerine ne olduğu yazsın. */
    public static String hataMetni(int status, int error) {
        String kart;
        switch (status & 0x03) {
            case 0:  kart = "kart takılı ve etkin"; break;
            case 1:  kart = "kart takılı ama etkin değil"; break;
            case 2:  kart = "yuvada kart yok"; break;
            default: kart = "kart durumu bilinmiyor";
        }
        String ne;
        switch (error) {
            case 0xFE: ne = "kart yanıt vermiyor (ICC_MUTE)"; break;
            case 0xFD: ne = "eşlik hatası (XFR_PARITY_ERROR)"; break;
            case 0xFC: ne = "kart protokolü desteklenmiyor"; break;
            case 0xFB: ne = "donanım hatası"; break;
            case 0xF8: ne = "kart yanlış voltajda"; break;
            case 0xEF: ne = "kullanıcı iptal etti"; break;
            case 0xE0: ne = "yuva zaten kullanımda"; break;
            case 0x00: ne = "komut kabul edilmedi"; break;
            default:   ne = String.format("hata kodu %02X", error);
        }
        return ne + " — " + kart;
    }

    /* APDU gönderir. Okuyucu APDU düzeyinde çalışıyorsa doğrudan; ham TPDU
       kipindeyse T=1 bloklarına sarılarak. */
    public byte[] transmit(byte[] apdu) throws Exception {
        return t1 != null ? t1.transmit(apdu) : transmitRaw(apdu);
    }

    /* Okuyucuya olduğu gibi gider — T=1 katmanı bloklarını buradan yollar. */
    public byte[] transmitRaw(byte[] blok) throws Exception {
        return command(PC_TO_RDR_XFR_BLOCK, blok, (byte) 0, (byte) 0, (byte) 0);
    }

    /* Güç verdikten sonra çağrılır: okuyucunun APDU düzeyi ile kartın
       protokolüne bakıp aradaki katmanı seçer, ne seçtiğini döndürür. */
    public String protokolSec(byte[] atr) {
        String duzey = exchangeLevel(classDescriptor());
        boolean kartT1 = T1.atrT1(atr);
        boolean apduDuzeyi = duzey.startsWith("kısa");

        if (!apduDuzeyi && kartT1) {
            t1 = new T1(this);
            return "T=1 blokları (okuyucu " + duzey + ", kart T=1)";
        }
        t1 = null;
        return "doğrudan APDU (okuyucu " + duzey + ", kart " + (kartT1 ? "T=1" : "T=0") + ")";
    }

    private byte[] command(byte type, byte[] data, byte b7, byte b8, byte b9) throws Exception {
        byte[] resp = rawCommand(type, data, b7, b8, b9);
        int status = resp[7] & 0xFF;
        int error  = resp[8] & 0xFF;
        if ((status & 0xC0) != 0x00) throw new Exception("CCID: " + hataMetni(status, error));
        byte[] body = new byte[resp.length - 10];
        System.arraycopy(resp, 10, body, 0, body.length);
        return body;
    }

    /* Yanıtı başlığıyla birlikte, durum denetimi yapmadan döndürür. */
    private synchronized byte[] rawCommand(byte type, byte[] data, byte b7, byte b8, byte b9)
            throws Exception {
        int n = data.length;
        byte[] msg = new byte[10 + n];
        msg[0] = type;
        msg[1] = (byte) n;
        msg[2] = (byte) (n >> 8);
        msg[3] = (byte) (n >> 16);
        msg[4] = (byte) (n >> 24);
        msg[5] = 0;               // bSlot — tek yuvalı okuyucular
        msg[6] = seq++;
        msg[7] = b7;
        msg[8] = b8;
        msg[9] = b9;
        System.arraycopy(data, 0, msg, 10, n);

        int sent = conn.bulkTransfer(epOut, msg, msg.length, TIMEOUT);
        if (sent < 0) throw new Exception("Okuyucuya yazılamadı.");

        int packet = epIn.getMaxPacketSize() > 0 ? epIn.getMaxPacketSize() : 64;
        byte[] tmp = new byte[packet];

        /* Okuyucu "biraz daha zaman" diyebiliyor; o yanıtı atlayıp bir
           sonrakini bekliyoruz. */
        for (;;) {
            ByteArrayOutputStream acc = new ByteArrayOutputStream();
            int need = 10;
            while (acc.size() < need) {
                int r = conn.bulkTransfer(epIn, tmp, tmp.length, TIMEOUT);
                if (r < 0) throw new Exception("Okuyucudan yanıt gelmedi (zaman aşımı).");
                acc.write(tmp, 0, r);
                if (acc.size() >= 10) {
                    byte[] h = acc.toByteArray();
                    need = 10 + ((h[1] & 0xFF) | ((h[2] & 0xFF) << 8)
                              | ((h[3] & 0xFF) << 16) | ((h[4] & 0xFF) << 24));
                    if (need < 10 || need > 1 << 20) throw new Exception("Okuyucudan bozuk yanıt.");
                }
            }
            byte[] resp = acc.toByteArray();
            int status = resp[7] & 0xFF;
            if ((status & 0xC0) == 0x80) continue;          // zaman uzatma istendi
            return resp;
        }
    }

    /* CCID sınıf tanımlayıcısı (54 bayt) ham USB tanımlayıcılarının içinde
       gömülü geliyor; Android bunu doğrudan vermediği için elle arıyoruz. */
    public byte[] classDescriptor() {
        byte[] raw = conn.getRawDescriptors();
        if (raw == null) return null;
        int i = 0;
        while (i + 1 < raw.length) {
            int len = raw[i] & 0xFF;
            int typ = raw[i + 1] & 0xFF;
            if (len < 2) break;
            if (typ == 0x21 && len >= 54 && i + len <= raw.length) {
                byte[] d = new byte[len];
                System.arraycopy(raw, i, d, 0, len);
                return d;
            }
            i += len;
        }
        return null;
    }

    /* dwFeatures, okuyucunun APDU'yu kendisinin mi yoksa bizim mi
       parçalamamız gerektiğini söylüyor. Tanı ekranında gösteriyoruz. */
    public static String exchangeLevel(byte[] desc) {
        if (desc == null || desc.length < 44) return "bilinmiyor";
        long f = (desc[40] & 0xFFL) | ((desc[41] & 0xFFL) << 8)
               | ((desc[42] & 0xFFL) << 16) | ((desc[43] & 0xFFL) << 24);
        if ((f & 0x00040000L) != 0) return "kısa ve uzun APDU";
        if ((f & 0x00020000L) != 0) return "kısa APDU";
        if ((f & 0x00010000L) != 0) return "TPDU";
        return "karakter düzeyi";
    }

    public void close() {
        try { command(PC_TO_RDR_ICC_POWER_OFF, new byte[0], (byte) 0, (byte) 0, (byte) 0); }
        catch (Exception ignored) {}
        try { conn.releaseInterface(iface); } catch (Exception ignored) {}
        try { conn.close(); } catch (Exception ignored) {}
    }

    public static String hex(byte[] b) {
        if (b == null) return "";
        StringBuilder s = new StringBuilder(b.length * 3);
        for (int i = 0; i < b.length; i++) {
            if (i > 0) s.append(' ');
            s.append(String.format("%02X", b[i]));
        }
        return s.toString();
    }
}
