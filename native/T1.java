package __PACKAGE__;

import java.io.ByteArrayOutputStream;

/* T=1 blok protokolü (ISO 7816-3).

   Okuyucu ham TPDU kipindeyse APDU'yu doğrudan göndermek işe yaramaz;
   kart cevap vermez (ICC_MUTE). APDU'nun bir T=1 bloğuna sarılması gerekir:

       NAD | PCB | LEN | INF… | EDC

   AKİS kartları T=1 kullanıyor (ATR'deki TD baytlarından anlaşılıyor).
   EDC, ATR'de TC3 verilmediği sürece LRC'dir — tüm baytların XOR'u. */
public class T1 {

    private final Ccid ccid;
    private int ns = 0;               // bizim gönderme sıra numaramız

    public T1(Ccid ccid) { this.ccid = ccid; }

    /* Kartın tek blokta kabul edebileceği en büyük veri. ATR'deki TA3 bunu
       bildiriyor; kullandığımız APDU'ların hepsi bunun çok altında. */
    private static final int IFSC = 254;

    public byte[] transmit(byte[] apdu) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        /* Gönderme zincirlemesi: APDU IFSC'den uzunsa parçalara bölünüp
           M biti kurulu I-bloklarıyla yollanır, kart her parçayı bir
           R-bloğuyla onaylar. Dolgulu 256 baytlık PKCS#1 bloğu bunu
           gerektiriyor. */
        byte[] son = null;
        byte[] cevap = null;
        int off = 0;
        while (true) {
            int n = Math.min(IFSC, apdu.length - off);
            boolean devam = (off + n) < apdu.length;
            byte[] parca = new byte[n];
            System.arraycopy(apdu, off, parca, 0, n);
            son = blok((ns << 6) | (devam ? 0x20 : 0), parca);
            cevap = ccid.transmitRaw(son);
            ns ^= 1;
            off += n;
            if (!devam) break;
            if (cevap == null || cevap.length < 4) throw new Exception("T=1: bozuk blok geldi.");
            int pcb = cevap[1] & 0xFF;
            if ((pcb & 0xC0) != 0x80)
                throw new Exception(String.format("T=1: zincirleme onaylanmadı (%02X).", pcb));
        }

        for (int adim = 0; adim < 64; adim++) {
            if (cevap == null || cevap.length < 4) throw new Exception("T=1: bozuk blok geldi.");

            int pcb = cevap[1] & 0xFF;
            int len = cevap[2] & 0xFF;
            if (3 + len > cevap.length) throw new Exception("T=1: blok uzunluğu tutmuyor.");
            byte[] inf = new byte[len];
            System.arraycopy(cevap, 3, inf, 0, len);

            if ((pcb & 0x80) == 0) {                       // I-bloğu: veri
                out.write(inf);
                int kartNs = (pcb >> 6) & 1;
                if ((pcb & 0x20) != 0) {                   // devamı var
                    cevap = ccid.transmitRaw(blok(0x80 | ((1 - kartNs) << 4), new byte[0]));
                    continue;
                }
                return out.toByteArray();
            }

            if ((pcb & 0xC0) == 0xC0) {                    // S-bloğu
                int tur = pcb & 0x3F;
                if (tur == 0x01 || tur == 0x03) {          // IFS ya da süre uzatma isteği
                    cevap = ccid.transmitRaw(blok(pcb | 0x20, inf));
                    continue;
                }
                throw new Exception(String.format("T=1: beklenmeyen S-bloğu %02X.", pcb));
            }

            /* R-bloğu: kart bloğu beğenmedi, aynısını bir daha yolla. */
            cevap = ccid.transmitRaw(son);
        }
        throw new Exception("T=1: karttan sonuç alınamadı.");
    }

    private static byte[] blok(int pcb, byte[] inf) {
        byte[] b = new byte[4 + inf.length];
        b[0] = 0x00;                        // NAD — tek yuvalı okuyucuda hep sıfır
        b[1] = (byte) pcb;
        b[2] = (byte) inf.length;
        System.arraycopy(inf, 0, b, 3, inf.length);
        byte lrc = 0;
        for (int i = 0; i < b.length - 1; i++) lrc ^= b[i];
        b[b.length - 1] = lrc;
        return b;
    }

    /* ATR'deki TD baytlarını gezip kartın T=1 destekleyip desteklemediğine
       bakar. Yapı: TS T0 [TA1 TB1 TC1 TD1] [TA2 …] … */
    public static boolean atrT1(byte[] atr) {
        if (atr == null || atr.length < 2) return false;
        int i = 2;                          // TS ve T0 geçildi
        int y = (atr[1] & 0xFF) >> 4;
        while (true) {
            if ((y & 1) != 0) i++;          // TA
            if ((y & 2) != 0) i++;          // TB
            if ((y & 4) != 0) i++;          // TC
            if ((y & 8) == 0) return false; // TD yok, protokol T=0
            if (i >= atr.length) return false;
            int td = atr[i++] & 0xFF;
            if ((td & 0x0F) == 1) return true;
            y = td >> 4;
        }
    }
}
