package __PAKET__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/* Tabletten UYAP Avukat Portal'a "Adalet E-İmza ile Giriş".

   Bilgisayarda bu işi Adalet Bakanlığı'nın "Adalet E-imza" programı yapar:
   http://localhost:5975'te küçük bir sunucu; portal (tarayıcıdaki sayfa) ondan
   sertifika listesini ve giriş imzasını ister. Bu hizmet aynı adresi aynı
   biçimde yanıtlar, kartla USB OTG üzerinden konuşur. Portalın girişte
   kullandığı uçlar (avukat.uyap.gov.tr/static/js/main.*.js):
     GET  /api/v1/signature/getCertificates
     POST /api/v1/signature/sign     {certificateId, password, content}
     GET  /api/v1/usb-stream         (SSE, "usb-event" gelince liste yenilenir)

   İmzalanan, portalın gönderdiği "content" DEĞİL: Adalet E-imza gibi önce
   bedesten.adalet.gov.tr/imza'dan sertifikayla içerik + işlem numarası (txId)
   alınır, imza o içeriğe atılır. Yani bu hizmet keyfî veri imzalamaz.
   PIN yalnızca karta gider; hiçbir yere yazılmaz, günlüğe girmez. */
public class UyapGirisServisi extends Service {

    public static final int PORT = 5975;
    public static final String PORTAL = "https://avukat.uyap.gov.tr/giris";
    private static final String SUNUCU = "https://bedesten.adalet.gov.tr/imza";
    private static final String KANAL = "uyap_giris";
    private static final int BILDIRIM = 5975;
    private static final String KAPAT = "__PAKET__.UYAP_GIRIS_KAPAT";
    private static final String IZIN = "__PAKET__.USB_IZIN_GIRIS";
    private static final String TAG = "UyapGiris";
    /* Adalet E-imza'nın izin verdiği kökenler (application.properties: cors.allowed-origin-patterns). */
    private static final String[] KOKENLER = {".uyap.gov.tr", ".adalet.gov.tr", ".yargitay.gov.tr", ".danistay.gov.tr"};

    static volatile boolean calisiyor = false;
    static volatile String sonHata = null;

    /* Son işlemler: uygulamadaki "Günlük" penceresi için. PIN, imza ve
       sunucunun verdiği içerik yazılmaz; yalnızca ne olduğu ve hata iletileri. */
    private static final ArrayDeque<String> GUNLUK = new ArrayDeque<>();
    private static String sonSatir = "";
    private static int tekrar = 0;
    /* Aynı satırlar uygulamanın özel klasöründe de tutulur (files/uyap-giris-gunluk.txt):
       uygulama arka plandayken geliştirici `adb shell run-as` ile okuyabilsin.
       Bazı üreticiler (Honor) logcat'te Log.i satırlarını göstermiyor. */
    private static volatile File gunlukDosyasi;

    static void gunluk(String s) {
        Log.i(TAG, s);
        String saat = new SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(new Date());
        synchronized (GUNLUK) {
            dosyayaYaz(new SimpleDateFormat("yyyy-MM-dd ", Locale.ROOT).format(new Date()) + saat + "  " + s);
            if (s.equals(sonSatir) && !GUNLUK.isEmpty()) {          // portal 5 sn'de bir yokluyor: tekrarları birleştir
                GUNLUK.removeLast();
                GUNLUK.addLast(saat + "  " + s + "  (×" + (++tekrar) + ")");
                return;
            }
            sonSatir = s;
            tekrar = 1;
            GUNLUK.addLast(saat + "  " + s);
            while (GUNLUK.size() > 100) GUNLUK.removeFirst();
        }
    }

    private static void dosyayaYaz(String satir) {
        File f = gunlukDosyasi;
        if (f == null) return;
        try {
            if (f.length() > 128 * 1024) f.renameTo(new File(f.getPath() + ".1"));
            try (FileOutputStream o = new FileOutputStream(f, true)) {
                o.write((satir + "\n").getBytes(StandardCharsets.UTF_8));
            }
        } catch (IOException e) { }
    }

    static String gunlukMetni() {
        StringBuilder b = new StringBuilder();
        synchronized (GUNLUK) {
            for (String s : GUNLUK) b.append(s).append('\n');
        }
        return b.toString();
    }

    private UsbManager um;
    private ExecutorService havuz;
    private ScheduledExecutorService zamanlayici;
    private final List<ServerSocket> dinleyiciler = new ArrayList<>();
    private final List<Socket> akislar = new CopyOnWriteArrayList<>();      // usb-stream (SSE)
    private final Set<String> izinIstenen = new HashSet<>();

    /* Sertifika listesi önbelleği: portal pencereyi açınca listeyi art arda birkaç kez ister.
       Kısa ömürlü, çünkü aynı türden iki AKİS kartının ATR'si aynıdır: okuyucudaki kart
       değiştirilince bunu ATR'den anlayamayız. İmzada kart her zaman yeniden okunur. */
    private static final long ONBELLEK_SURESI = 5000;
    private String onbellekAnahtar;
    private long onbellekZamani;
    private List<CadesBes.Sertifika> onbellek;

    /* Kullanıcıya gösterilecek hata (portal metadata.MESSAGE olarak gösterir). */
    static class Hata extends Exception {
        Hata(String m) { super(m); }
    }

    /* ================= yaşam döngüsü ================= */
    @Override
    public void onCreate() {
        super.onCreate();
        gunlukDosyasi = new File(getFilesDir(), "uyap-giris-gunluk.txt");
        um = (UsbManager) getSystemService(Context.USB_SERVICE);
        IntentFilter f = new IntentFilter();
        f.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        f.addAction(IZIN);
        ContextCompat.registerReceiver(this, usbAlici, f, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && KAPAT.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            ServiceCompat.startForeground(this, BILDIRIM, bildirim(),
                    Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE : 0);
        } catch (Exception e) {
            sonHata = "Hizmet ön planda başlatılamadı: " + e.getMessage();
            gunluk(sonHata);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (havuz == null) {
            havuz = Executors.newCachedThreadPool();
            zamanlayici = Executors.newSingleThreadScheduledExecutor();
            havuz.execute(this::dinlemeyeBasla);
            zamanlayici.scheduleWithFixedDelay(this::nabiz, 25, 25, TimeUnit.SECONDS);
        }
        UsbDevice d = okuyucuBul();
        if (d != null && !um.hasPermission(d)) izinIste(d);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (calisiyor) gunluk("hizmet kapatıldı");
        calisiyor = false;
        try { unregisterReceiver(usbAlici); } catch (Exception e) { }
        for (ServerSocket s : dinleyiciler) try { s.close(); } catch (IOException e) { }
        dinleyiciler.clear();
        for (Socket s : akislar) try { s.close(); } catch (IOException e) { }
        akislar.clear();
        if (havuz != null) havuz.shutdownNow();
        if (zamanlayici != null) zamanlayici.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification bildirim() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26)
            nm.createNotificationChannel(new NotificationChannel(KANAL, "UYAP girişi", NotificationManager.IMPORTANCE_LOW));
        PendingIntent portal = PendingIntent.getActivity(this, 0,
                new Intent(Intent.ACTION_VIEW, Uri.parse(PORTAL)), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent kapat = PendingIntent.getService(this, 0,
                new Intent(this, UyapGirisServisi.class).setAction(KAPAT), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, KANAL)
                .setSmallIcon(android.R.drawable.ic_secure)
                .setContentTitle("UYAP e-imza girişi açık")
                .setContentText("Avukat Portal → Adalet E-İmza ile Giriş")
                .setContentIntent(portal)
                .addAction(0, "Kapat", kapat)
                .setOngoing(true)
                .build();
    }

    /* ================= USB ================= */
    private UsbDevice okuyucuBul() {
        for (UsbDevice d : um.getDeviceList().values())
            if (CcidOkuyucu.ccidArayuzu(d) != null) return d;
        return null;
    }

    /* İzin penceresi okuyucu başına bir kez açılır (okuyucu çıkarılıp takılınca yeniden). */
    private void izinIste(UsbDevice d) {
        synchronized (izinIstenen) {
            if (!izinIstenen.add(d.getDeviceName())) return;
        }
        Intent i = new Intent(IZIN).setPackage(getPackageName());
        int bayrak = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        um.requestPermission(d, PendingIntent.getBroadcast(this, 1, i, bayrak));
    }

    private final BroadcastReceiver usbAlici = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            UsbDevice d = i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            String a = i.getAction();
            if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(a)) {
                onbellegiSil();
                if (d != null) synchronized (izinIstenen) { izinIstenen.remove(d.getDeviceName()); }
                if (d != null && CcidOkuyucu.ccidArayuzu(d) != null) gunluk("kart okuyucu çıkarıldı");
                usbOlayi("cikarildi");
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(a)) {
                if (d == null || CcidOkuyucu.ccidArayuzu(d) == null) return;
                gunluk("kart okuyucu takıldı: " + okuyucuAdi(d));
                if (!um.hasPermission(d)) izinIste(d);
                usbOlayi("takildi");
            } else if (IZIN.equals(a)) {
                boolean verildi = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                gunluk(verildi ? "kart okuyucu izni verildi" : "kart okuyucu izni VERİLMEDİ");
                if (verildi) usbOlayi("izin");
            }
        }
    };

    private synchronized void onbellegiSil() { onbellek = null; onbellekAnahtar = null; }

    interface KartIsi<T> { T yap(CcidOkuyucu o, byte[] atr) throws Exception; }

    /* Kart aynı anda tek iş yapar: belge imzası (EimzaPlugin) da aynı kilidi kullanır. */
    private <T> T kartla(UsbDevice d, KartIsi<T> is) throws Exception {
        synchronized (CcidOkuyucu.KILIT) {
            try (CcidOkuyucu o = new CcidOkuyucu(um, d)) {
                return is.yap(o, o.baslat());
            }
        }
    }

    private static List<CadesBes.Sertifika> sertifikalariOku(CcidOkuyucu o) throws Exception {
        List<CadesBes.Sertifika> l = new ArrayList<>();
        for (AkisKart.Sertifika x : new AkisKart(o).sertifikalar()) {
            try { l.add(CadesBes.coz(x.der)); } catch (Exception e) { gunluk("karttaki bir sertifika çözülemedi: " + e.getMessage()); }
        }
        return l;
    }

    private List<CadesBes.Sertifika> sertifikalar(UsbDevice d) throws Exception {
        return kartla(d, (o, atr) -> {
            String anahtar = d.getDeviceName() + "/" + AkisKart.hex(atr);
            synchronized (this) {
                if (anahtar.equals(onbellekAnahtar) && onbellek != null
                        && SystemClock.elapsedRealtime() - onbellekZamani < ONBELLEK_SURESI) return onbellek;
            }
            List<CadesBes.Sertifika> l = sertifikalariOku(o);
            synchronized (this) { onbellek = l; onbellekAnahtar = anahtar; onbellekZamani = SystemClock.elapsedRealtime(); }
            return l;
        });
    }

    /* ================= HTTP ================= */
    private void dinlemeyeBasla() {
        String hata = null;
        StringBuilder acilan = new StringBuilder();
        // Tarayıcı "localhost"u hem 127.0.0.1 hem ::1 olarak deneyebilir.
        for (String adres : new String[]{"127.0.0.1", "::1"}) {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(InetAddress.getByName(adres), PORT), 50);
                synchronized (dinleyiciler) { dinleyiciler.add(ss); }
                havuz.execute(() -> dinle(ss));
                acilan.append(acilan.length() > 0 ? ", " : "").append(adres);
            } catch (Exception e) {
                if (hata == null && adres.startsWith("127")) hata = "5975 numaralı port açılamadı (" + e.getMessage() + ").";
            }
        }
        sonHata = hata;
        calisiyor = hata == null;
        if (hata != null) { gunluk(hata); stopSelf(); }
        else gunluk("hizmet açıldı: localhost:" + PORT + " (" + acilan + ")");
    }

    private void dinle(ServerSocket ss) {
        while (!ss.isClosed()) {
            try {
                Socket s = ss.accept();
                havuz.execute(() -> baglanti(s));
            } catch (Exception e) {
                if (ss.isClosed()) return;
            }
        }
    }

    private void baglanti(Socket s) {
        boolean acikKalsin = false;
        try {
            s.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            String ilk = satir(in);
            if (ilk == null) return;
            String[] p = ilk.split(" ");
            if (p.length < 2) return;
            String yontem = p[0], yol = p[1];
            int q = yol.indexOf('?');
            if (q >= 0) yol = yol.substring(0, q);
            Map<String, String> b = new HashMap<>();
            for (String l; (l = satir(in)) != null && !l.isEmpty() && b.size() < 100; ) {
                int i = l.indexOf(':');
                if (i > 0) b.put(l.substring(0, i).trim().toLowerCase(Locale.ROOT), l.substring(i + 1).trim());
            }
            int n = 0;
            try { n = Integer.parseInt(b.containsKey("content-length") ? b.get("content-length") : "0"); } catch (NumberFormatException e) { }
            if (n < 0 || n > 256 * 1024) { yanit(s, 413, null, null, new byte[0]); return; }
            byte[] govde = new byte[n];
            for (int o = 0; o < n; ) {
                int r = in.read(govde, o, n - o);
                if (r < 0) return;
                o += r;
            }

            // Portal başka kökenden çağırdığı için tarayıcı Origin'i her istekte gönderir.
            // Kökensiz istekler (tabletteki başka uygulamalar, DNS yeniden bağlama) reddedilir:
            // sertifika listesinde ad ve TC kimlik numarası var.
            String koken = b.get("origin");
            if (koken == null || !kokenIzinli(koken)) {
                gunluk("reddedildi: " + yontem + " " + yol + " (köken: " + koken + ")");
                yanit(s, 403, null, "text/plain", "Invalid CORS request".getBytes(StandardCharsets.UTF_8));
                return;
            }
            if ("OPTIONS".equals(yontem)) {
                if (b.containsKey("access-control-request-private-network") || b.containsKey("access-control-request-local-network"))
                    gunluk("tarayıcı yerel ağ izni sordu (" + yol + "): izin verildi");
                onUcus(s, koken, b);
                return;
            }

            switch (yol) {
                case "/api/v1/usb-stream":
                    acikKalsin = akisAc(s, koken);
                    return;
                case "/api/v1/signature/getCertificates":
                    json(s, koken, sertifikaListesi());
                    return;
                case "/api/v1/signature/getCertificate":
                    json(s, koken, tekSertifika(govde));
                    return;
                case "/api/v1/signature/sign":
                    if (!"POST".equals(yontem)) { json(s, koken, hatali("İzin verilmeyen istek.")); return; }
                    json(s, koken, imzaIstegi(govde));
                    return;
                default:
                    gunluk("desteklenmeyen istek: " + yontem + " " + yol);
                    yanit(s, 404, koken, "application/json", hatali("Bu adres tablette desteklenmiyor: " + yol));
            }
        } catch (Exception e) {
            Log.w(TAG, "bağlantı: " + e);
        } finally {
            if (!acikKalsin) try { s.close(); } catch (IOException e) { }
        }
    }

    private static boolean kokenIzinli(String koken) {
        try {
            URI u = new URI(koken);
            if (!"https".equals(u.getScheme()) || u.getHost() == null || (u.getPort() != -1 && u.getPort() != 443)) return false;
            String h = u.getHost().toLowerCase(Locale.ROOT);
            for (String k : KOKENLER) if (h.endsWith(k)) return true;
        } catch (Exception e) { }
        return false;
    }

    private static String satir(InputStream in) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') o.write(c);
            if (o.size() > 8192) throw new IOException("satır çok uzun");
        }
        if (c == -1 && o.size() == 0) return null;
        return o.toString("ISO-8859-1");
    }

    private static String corsBasliklari(String koken) {
        return koken == null ? "" : "Access-Control-Allow-Origin: " + koken + "\r\nAccess-Control-Allow-Credentials: true\r\nVary: Origin\r\n";
    }

    private static void yanit(Socket s, int kod, String koken, String tur, byte[] govde) throws IOException {
        String b = "HTTP/1.1 " + kod + (kod == 200 ? " OK" : kod == 404 ? " Not Found" : kod == 403 ? " Forbidden" : " Error") + "\r\n"
                + corsBasliklari(koken)
                + (tur != null ? "Content-Type: " + tur + "\r\n" : "")
                + "Content-Length: " + govde.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        OutputStream o = s.getOutputStream();
        o.write(b.getBytes(StandardCharsets.ISO_8859_1));
        o.write(govde);
        o.flush();
    }

    private static void json(Socket s, String koken, byte[] govde) throws IOException {
        yanit(s, 200, koken, "application/json", govde);
    }

    /* CORS ön uçuşu. Chrome, açık siteden yerel adrese istekte "özel ağ" iznini de sorar. */
    private static void onUcus(Socket s, String koken, Map<String, String> b) throws IOException {
        String yontem = b.containsKey("access-control-request-method") ? b.get("access-control-request-method") : "GET, POST";
        String bas = b.get("access-control-request-headers");
        String h = "HTTP/1.1 200 OK\r\n" + corsBasliklari(koken)
                + "Access-Control-Allow-Methods: " + yontem + "\r\n"
                + (bas != null ? "Access-Control-Allow-Headers: " + bas + "\r\n" : "")
                + ("true".equals(b.get("access-control-request-private-network")) ? "Access-Control-Allow-Private-Network: true\r\n" : "")
                + ("true".equals(b.get("access-control-request-local-network")) ? "Access-Control-Allow-Local-Network: true\r\n" : "")
                + "Access-Control-Max-Age: 600\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        OutputStream o = s.getOutputStream();
        o.write(h.getBytes(StandardCharsets.ISO_8859_1));
        o.flush();
    }

    /* ---------- usb-stream (SSE) ---------- */
    private boolean akisAc(Socket s, String koken) {
        try {
            String h = "HTTP/1.1 200 OK\r\n" + corsBasliklari(koken)
                    + "Content-Type: text/event-stream;charset=UTF-8\r\nCache-Control: no-cache\r\n\r\n:ok\n\n";
            OutputStream o = s.getOutputStream();
            o.write(h.getBytes(StandardCharsets.UTF_8));
            o.flush();
            s.setSoTimeout(0);
            akislar.add(s);
            gunluk("portal bağlandı (kart takip akışı)");
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private void akisaYaz(String metin) {
        byte[] b = metin.getBytes(StandardCharsets.UTF_8);
        for (Socket s : akislar) {
            try {
                synchronized (s) {
                    OutputStream o = s.getOutputStream();
                    o.write(b);
                    o.flush();
                }
            } catch (IOException e) {
                akislar.remove(s);
                try { s.close(); } catch (IOException x) { }
            }
        }
    }

    private void usbOlayi(String ne) {
        if (havuz != null && !havuz.isShutdown()) havuz.execute(() -> akisaYaz("event:usb-event\ndata:" + ne + "\n\n"));
    }

    private void nabiz() { akisaYaz(":\n\n"); }

    /* ================= uçlar ================= */
    private static byte[] basarili(Object veri) {
        try {
            JSONObject m = new JSONObject();
            m.put("STATUS", "SUCCESS");
            m.put("MESSAGE", "İşlem başarıyla gerçekleştirildi!");
            JSONObject r = new JSONObject();
            r.put("data", veri);
            r.put("metadata", m);
            return r.toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException e) {
            throw new RuntimeException(e);
        }
    }

    private static byte[] hatali(String mesaj) {
        try {
            JSONObject m = new JSONObject();
            m.put("STATUS", "ERROR");
            m.put("MESSAGE", mesaj);
            JSONObject r = new JSONObject();
            r.put("data", JSONObject.NULL);
            r.put("metadata", m);
            return r.toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException e) {
            throw new RuntimeException(e);
        }
    }

    private static String mesaj(Exception e) {
        if (e instanceof Hata || e instanceof AkisKart.PinHatasi || e instanceof CcidOkuyucu.KartYok) return e.getMessage();
        return "E-imza işlemi başarısız: " + (e.getMessage() != null ? e.getMessage() : e.toString());
    }

    /* Adalet E-imza'nın CardReaderDto listesi: [{terminal, serialNumber, certificates, ready}] */
    private byte[] sertifikaListesi() {
        try {
            JSONArray liste = new JSONArray();
            UsbDevice d = okuyucuBul();
            if (d == null) {
                gunluk("sertifika listesi istendi: kart okuyucu takılı değil");
                return basarili(liste);
            }
            if (!um.hasPermission(d)) {
                izinIste(d);
                gunluk("sertifika listesi istendi: kart okuyucu izni bekleniyor");
                return hatali("Kart okuyucuya erişim izni gerekiyor: tablette açılan pencerede UDF Editör'e izin verin.");
            }
            List<CadesBes.Sertifika> l;
            try {
                l = sertifikalar(d);
            } catch (CcidOkuyucu.KartYok e) {
                onbellegiSil();
                gunluk("sertifika listesi istendi: okuyucuda kart yok");
                return basarili(liste);
            }
            gunluk("sertifika listesi gönderildi: " + l.size() + " sertifika");
            String okuyucu = okuyucuAdi(d), seri = okuyucuSeri(d, l);
            JSONArray sertler = new JSONArray();
            for (CadesBes.Sertifika s : l) sertler.put(sertifikaJson(s, okuyucu, seri));
            JSONObject o = new JSONObject();
            o.put("terminal", okuyucu);
            o.put("serialNumber", seri);
            o.put("certificates", sertler);
            o.put("ready", true);
            liste.put(o);
            return basarili(liste);
        } catch (Exception e) {
            gunluk("sertifika listesi HATA: " + mesaj(e));
            return hatali(mesaj(e));
        }
    }

    private static String okuyucuAdi(UsbDevice d) {
        String u = d.getManufacturerName(), p = d.getProductName();
        String ad = p == null ? (u != null ? u : "Kart Okuyucu") : (u == null || p.startsWith(u) ? p : u + " " + p);
        return ad.trim() + " 0";
    }

    private static String okuyucuSeri(UsbDevice d, List<CadesBes.Sertifika> l) {
        String s = null;
        try { s = d.getSerialNumber(); } catch (SecurityException e) { }
        if (s != null && !s.isEmpty()) return s;
        return l.isEmpty() ? "0000000000000000" : l.get(0).kimlik.substring(0, 16);
    }

    private static JSONObject sertifikaJson(CadesBes.Sertifika s, String okuyucu, String seri) throws JSONException {
        // Adalet E-imza tarihleri Jackson'ın varsayılanıyla yazar: 2024-01-26T09:10:12.000+00:00
        SimpleDateFormat t = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'+00:00'", Locale.ROOT);
        t.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject o = new JSONObject();
        o.put("certificateId", s.kimlik);
        o.put("subject", s.ad != null ? s.ad : JSONObject.NULL);
        o.put("issuer", s.yayinci != null ? s.yayinci : JSONObject.NULL);
        o.put("notBefore", t.format(s.baslangic));
        o.put("notAfter", t.format(s.bitis));
        o.put("certSerial", s.seriHex);
        o.put("subjectSerial", s.tckn != null ? s.tckn : JSONObject.NULL);
        o.put("subjectCountry", s.ulke != null ? s.ulke : JSONObject.NULL);
        o.put("subjectEmail", s.eposta);
        o.put("cardReaderSerial", seri);
        o.put("cardReaderName", okuyucu);
        o.put("sigAlgorithm", s.imzaAlg);
        o.put("pubKeyAlgorithm", s.anahtarAlg);
        o.put("digestAlgorithm", "SHA-256");
        o.put("default", false);
        o.put("valid", s.gecerli());
        return o;
    }

    /* getCertificate: {certificateId} → base64 sertifika */
    private byte[] tekSertifika(byte[] govde) {
        try {
            String id = new JSONObject(new String(govde, StandardCharsets.UTF_8)).optString("certificateId", "");
            UsbDevice d = okuyucuBul();
            if (d == null || !um.hasPermission(d)) throw new Hata("Takılı Kart Bulunamadı.");
            for (CadesBes.Sertifika s : sertifikalar(d))
                if (s.kimlik.equalsIgnoreCase(id)) return basarili(Base64.encodeToString(s.der, Base64.NO_WRAP));
            throw new Hata("Sertifika bulunamadı.");
        } catch (Exception e) {
            return hatali(mesaj(e));
        }
    }

    /* sign: sunucudan içerik al → kartla CAdES-BES → {signedData, txId} */
    private byte[] imzaIstegi(byte[] govde) {
        try {
            JSONObject g = new JSONObject(new String(govde, StandardCharsets.UTF_8));
            String id = g.optString("certificateId", ""), pin = g.optString("password", "");
            gunluk("giriş imzası istendi");
            if (id.isEmpty()) throw new Hata("Kart bilgilerini seçiniz!");
            if (pin.isEmpty()) throw new Hata("Pin Kodu Giriniz.");
            UsbDevice d = okuyucuBul();
            if (d == null) throw new Hata("Takılı Kart Bulunamadı.");
            if (!um.hasPermission(d)) { izinIste(d); throw new Hata("Kart okuyucuya erişim izni gerekiyor."); }

            // Kart portal listeyi aldıktan sonra değişmiş olabilir: sertifikayı karttan yeniden oku.
            CadesBes.Sertifika sert = null;
            for (CadesBes.Sertifika s : kartla(d, (o, atr) -> sertifikalariOku(o)))
                if (s.kimlik.equalsIgnoreCase(id)) sert = s;
            if (sert == null) throw new Hata("Seçilen sertifika takılı kartta yok. Listeyi yenileyin.");
            if (!sert.gecerli()) throw new Hata("Sertifikanın Geçerlilik Tarihleri Uygun Değildir.");

            JSONObject icerik = imzalanacakIcerik(sert.der);
            final String txId = icerik.getString("txId");
            final byte[] veri = icerik.getString("content").getBytes(StandardCharsets.UTF_8);
            gunluk("Bakanlık sunucusundan imzalanacak içerik alındı (" + veri.length + " bayt)");
            final CadesBes.Sertifika s = sert;
            byte[] sgn = kartla(d, (o, atr) ->
                    CadesBes.olustur(veri, s, di -> new AkisKart(o).imzala(s.kimlik, pin, di, false)));

            JSONObject r = new JSONObject();
            r.put("signedData", Base64.encodeToString(sgn, Base64.NO_WRAP));
            r.put("txId", txId);
            r.put("signedECorrespondenceData", JSONObject.NULL);
            gunluk("giriş imzası atıldı, portala gönderildi (portal sonucu kendisi doğrular)");
            return basarili(r);
        } catch (Exception e) {
            gunluk("giriş imzası HATA: " + mesaj(e));
            return hatali(mesaj(e));
        }
    }

    /* Adalet E-imza'nın ServerApiService.getContentToBeSigned karşılığı:
       POST {SUNUCU}/api/v1/signature/getContentToBeSigned  {"pubKey": base64(sertifika)}
       → {"data": {"txId", "content"}, "metadata": {...}} */
    private static JSONObject imzalanacakIcerik(byte[] sertDer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(SUNUCU + "/api/v1/signature/getContentToBeSigned").openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Accept", "application/json");
            JSONObject g = new JSONObject();
            g.put("pubKey", Base64.encodeToString(sertDer, Base64.NO_WRAP));
            try (OutputStream o = c.getOutputStream()) {
                o.write(g.toString().getBytes(StandardCharsets.UTF_8));
            }
            int kod = c.getResponseCode();
            InputStream in = kod >= 400 ? c.getErrorStream() : c.getInputStream();
            String metin = in == null ? "" : oku(in);
            JSONObject y;
            try {
                y = new JSONObject(metin);
            } catch (JSONException e) {
                throw new Hata("E-İmza Sunucusunda Hata Oluştu. (HTTP " + kod + ")");
            }
            JSONObject v = y.optJSONObject("data");
            if (v != null && v.has("content") && v.has("txId")) return v;
            JSONObject m = y.optJSONObject("metadata");
            String msj = m != null ? m.optString("MESSAGE", "") : "";
            throw new Hata(msj.isEmpty() ? "E-İmza Sunucusunda Hata Oluştu. (HTTP " + kod + ")" : msj);
        } finally {
            c.disconnect();
        }
    }

    private static String oku(InputStream in) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] t = new byte[8192];
        for (int n; (n = in.read(t)) > 0; ) {
            o.write(t, 0, n);
            if (o.size() > 1024 * 1024) throw new IOException("yanıt çok büyük");
        }
        in.close();
        return o.toString("UTF-8");
    }
}
