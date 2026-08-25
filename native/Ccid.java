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

    private static final byte PC_TO_RDR_ICC_POWER_ON  = 0x62;
    private static final byte PC_TO_RDR_ICC_POWER_OFF = 0x63;
    private static final byte PC_TO_RDR_XFR_BLOCK     = 0x6F;

    /* Kartta RSA-2048 imza bir saniyeyi bulabiliyor; okuyucu ayrıca zaman
       uzatma isteyebiliyor. Cömert davranıyoruz. */
    private static final int TIMEOUT = 15000;

    private final UsbDeviceConnection conn;
    private final UsbInterface iface;
    private final UsbEndpoint epOut, epIn;
    private byte seq = 0;

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
       hangi AKİS sürümü olduğunu buradan anlıyoruz. */
    public byte[] powerOn() throws Exception {
        return command(PC_TO_RDR_ICC_POWER_ON, new byte[0], (byte) 0, (byte) 0, (byte) 0);
    }

    /* Ham APDU gönderir, ham yanıtı (SW dahil) döndürür. */
    public byte[] transmit(byte[] apdu) throws Exception {
        return command(PC_TO_RDR_XFR_BLOCK, apdu, (byte) 0, (byte) 0, (byte) 0);
    }

    private synchronized byte[] command(byte type, byte[] data, byte b7, byte b8, byte b9)
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
            int error  = resp[8] & 0xFF;

            if ((status & 0xC0) == 0x80) continue;          // zaman uzatma istendi
            if ((status & 0xC0) != 0x00) {
                if ((status & 0x03) == 0x02)
                    throw new Exception("Okuyucuda kart yok. Token'ı tam oturtup tekrar deneyin.");
                throw new Exception(String.format("CCID hatası (durum %02X, hata %02X).", status, error));
            }
            byte[] body = new byte[resp.length - 10];
            System.arraycopy(resp, 10, body, 0, body.length);
            return body;
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
