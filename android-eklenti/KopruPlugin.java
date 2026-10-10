package __PAKET__;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/* Bilgisayardaki imza köprüsüne HTTPS istekleri.
   Köprünün sertifikasını yerel bir kök imzalar; telefonun güven deposunda yok.
   Bu yüzden sistem doğrulaması yerine sertifika parmak izi kullanılır:
   - ilk istek (/durum) parmak izini döndürür; JS bunu eşleşme koduyla
     HMAC'lenmiş kanıtla karşılaştırır (köprü kodu bilmeden kanıt üretemez)
   - sonraki istekler yalnızca o parmak izine sahip sunucuya gider.
   WebView'deki fetch bu sertifikayı kabul etmediği için istek burada yapılır. */
@CapacitorPlugin(name = "Kopru")
public class KopruPlugin extends Plugin {

    private static final TrustManager[] HEPSI = new TrustManager[]{new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] c, String a) { }
        public void checkServerTrusted(X509Certificate[] c, String a) { }   // parmak izi aşağıda denetleniyor
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }};

    @PluginMethod
    public void istek(final PluginCall call) {
        new Thread(() -> {
            HttpsURLConnection b = null;
            try {
                String beklenenIz = call.getString("parmakIzi");
                String kod = call.getString("kod");
                // Eşleşme kodu yalnızca sabitlenmiş bir sunucuya gönderilir
                if (kod != null && (beklenenIz == null || beklenenIz.isEmpty()))
                    throw new Exception("Köprü önce doğrulanmalı.");

                SSLContext ssl = SSLContext.getInstance("TLS");
                ssl.init(null, HEPSI, null);
                b = (HttpsURLConnection) new URL(call.getString("url")).openConnection();
                b.setSSLSocketFactory(ssl.getSocketFactory());
                b.setHostnameVerifier((h, s) -> true);
                b.setConnectTimeout(6000);
                b.setReadTimeout(150000);           // bilgisayarda onay beklenebilir
                b.setRequestMethod(call.getString("yontem", "GET"));
                b.setUseCaches(false);
                if (kod != null) b.setRequestProperty("X-Eslesme", kod);
                String govde = call.getString("govde");
                if (govde != null) {
                    b.setDoOutput(true);
                    b.setRequestProperty("Content-Type", "application/json");
                }
                b.connect();

                Certificate[] zincir = b.getServerCertificates();
                byte[] iz = MessageDigest.getInstance("SHA-256").digest(zincir[0].getEncoded());
                String izHex = hex(iz);
                if (beklenenIz != null && !beklenenIz.isEmpty() && !beklenenIz.equalsIgnoreCase(izHex))
                    throw new Exception("Bilgisayarın sertifikası değişmiş. Köprüyü yeniden eşleştirin (adres/kodu yeniden girin).");

                if (govde != null) {
                    OutputStream os = b.getOutputStream();
                    os.write(govde.getBytes(StandardCharsets.UTF_8));
                    os.close();
                }
                int durum = b.getResponseCode();
                InputStream is = durum >= 400 ? b.getErrorStream() : b.getInputStream();
                ByteArrayOutputStream o = new ByteArrayOutputStream();
                if (is != null) {
                    byte[] t = new byte[8192];
                    int n;
                    while ((n = is.read(t)) > 0) o.write(t, 0, n);
                    is.close();
                }
                JSObject r = new JSObject();
                r.put("durum", durum);
                r.put("govde", o.toString("UTF-8"));
                r.put("parmakIzi", izHex);
                call.resolve(r);
            } catch (java.net.ConnectException | java.net.SocketTimeoutException | java.net.NoRouteToHostException e) {
                call.reject("Bilgisayardaki köprüye ulaşılamadı. Köprü açık mı, telefon aynı Wi-Fi'de mi?");
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                if (b != null) b.disconnect();
            }
        }).start();
    }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }
}
