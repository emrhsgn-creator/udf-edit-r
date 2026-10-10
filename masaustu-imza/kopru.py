# /// script
# requires-python = ">=3.10"
# dependencies = ["cryptography>=42", "segno>=1.6"]
# ///
"""UDF Editör — bilgisayar e-imza köprüsü.

Telefondaki UDF Editör, imzayı bu bilgisayara takılı e-imza kartına attırır.
Kartın özel anahtarı karttan hiç çıkmaz; telefon yalnızca imzalanacak özeti
ve PIN'i gönderir, karşılığında ham imzayı alır. CMS (sign.sgn) telefonda kurulur.

Güvenlik:
- Yalnızca HTTPS. Sertifikayı bu bilgisayarda üretilen yerel bir kök imzalar;
  kök yalnızca özel ağ adresleri için geçerli olacak şekilde kısıtlıdır.
- Her istek eşleşme kodunu taşımalı. Yanlış kod 5 denemede adresi 10 dk kilitler.
- /durum, kodla anahtarlanmış bir HMAC ile TLS sertifikasının parmak izini
  kanıtlar; Android uygulaması bunu gördüğü sertifikayla karşılaştırarak araya
  girmeyi (MITM) yakalar. iPhone'da güveni kurulan kök sertifika sağlar.
- PIN diske/günlüğe yazılmaz.

Çalıştırma:  uv run --script kopru.py      (ya da UDF-Imza-Koprusu.cmd)
"""
import base64
import datetime as dt
import hashlib
import hmac
import ipaddress
import json
import os
import queue
import secrets
import socket
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pkcs11  # noqa: E402

SURUM = "1.0.0"
HTTPS_PORT = int(os.environ.get("KOPRU_PORT", "5976"))
KURULUM_PORT = HTTPS_PORT + 1
VERI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "veri")
OZEL_AGLAR = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"]

olaylar = queue.Queue()  # arayüze giden günlük satırları


def gunluk(s):
    satir = time.strftime("%H:%M:%S ") + s
    print(satir, flush=True)
    olaylar.put(satir)


# ---------------------------------------------------------------- ayarlar
def ayar_oku():
    try:
        with open(os.path.join(VERI, "ayar.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def ayar_yaz(a):
    os.makedirs(VERI, exist_ok=True)
    with open(os.path.join(VERI, "ayar.json"), "w", encoding="utf-8") as f:
        json.dump(a, f, ensure_ascii=False, indent=1)


def yeni_kod():
    harf = "ABCDEFGHJKLMNPRSTUVYZ23456789"  # karışan harfler (O/0, I/1) yok
    k = "".join(secrets.choice(harf) for _ in range(12))
    return f"{k[:4]}-{k[4:8]}-{k[8:]}"


def kod_normal(k):
    return "".join(ch for ch in (k or "").upper() if ch.isalnum())


# ---------------------------------------------------------------- ağ
def yerel_adresler():
    adr = set()
    try:
        for bilgi in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            adr.add(bilgi[4][0])
    except Exception:
        pass
    try:  # varsayılan rota hangi arayüzden çıkıyorsa
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        adr.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    ozel = [a for a in adr if any(ipaddress.ip_address(a) in ipaddress.ip_network(n) for n in OZEL_AGLAR[:3])]
    return sorted(ozel) or ["127.0.0.1"]


# ---------------------------------------------------------------- sertifikalar
def _yaz_pem(ad, veri):
    with open(os.path.join(VERI, ad), "wb") as f:
        f.write(veri)


def kok_hazirla():
    os.makedirs(VERI, exist_ok=True)
    kp, ap = os.path.join(VERI, "kok.key"), os.path.join(VERI, "kok.crt")
    if os.path.exists(kp) and os.path.exists(ap):
        with open(kp, "rb") as f:
            anahtar = serialization.load_pem_private_key(f.read(), None)
        with open(ap, "rb") as f:
            return anahtar, x509.load_pem_x509_certificate(f.read())
    anahtar = ec.generate_private_key(ec.SECP256R1())
    ad = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, f"UDF Editör Yerel İmza Köprüsü ({socket.gethostname()})"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "UDF Editör"),
    ])
    simdi = dt.datetime.now(dt.timezone.utc)
    kok = (
        x509.CertificateBuilder()
        .subject_name(ad).issuer_name(ad)
        .public_key(anahtar.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(simdi - dt.timedelta(days=1))
        .not_valid_after(simdi + dt.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
        # Kök yalnızca yerel ağ adreslerine sertifika verebilir: sızsa bile
        # internetteki bir siteyi taklit etmekte kullanılamaz.
        .add_extension(x509.NameConstraints(
            permitted_subtrees=[x509.IPAddress(ipaddress.ip_network(n)) for n in OZEL_AGLAR]
            + [x509.DNSName("local"), x509.DNSName("localhost")],
            excluded_subtrees=None), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(anahtar.public_key()), critical=False)
        .sign(anahtar, hashes.SHA256())
    )
    _yaz_pem("kok.key", anahtar.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                              serialization.NoEncryption()))
    _yaz_pem("kok.crt", kok.public_bytes(serialization.Encoding.PEM))
    gunluk("Yeni yerel kök sertifika üretildi.")
    return anahtar, kok


def sunucu_sertifikasi(kok_anahtar, kok, adresler):
    sp, kp = os.path.join(VERI, "sunucu.crt"), os.path.join(VERI, "sunucu.key")
    if os.path.exists(sp) and os.path.exists(kp):
        with open(sp, "rb") as f:
            mevcut = x509.load_pem_x509_certificate(f.read())
        try:
            san = mevcut.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            ipler = {str(i) for i in san.get_values_for_type(x509.IPAddress)}
            kalan = mevcut.not_valid_after_utc - dt.datetime.now(dt.timezone.utc)
            if set(adresler) <= ipler and kalan.days > 30 and mevcut.issuer == kok.subject:
                return sp, kp, mevcut
        except Exception:
            pass
    anahtar = ec.generate_private_key(ec.SECP256R1())
    simdi = dt.datetime.now(dt.timezone.utc)
    sertifika = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, adresler[0])]))
        .issuer_name(kok.subject)
        .public_key(anahtar.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(simdi - dt.timedelta(days=1))
        .not_valid_after(simdi + dt.timedelta(days=397))  # iOS: en çok 398 gün
        .add_extension(x509.SubjectAlternativeName(
            [x509.IPAddress(ipaddress.ip_address(a)) for a in adresler + ["127.0.0.1"]]
            + [x509.DNSName("localhost")]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), critical=True)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(kok_anahtar.public_key()), critical=False)
        .sign(kok_anahtar, hashes.SHA256())
    )
    _yaz_pem("sunucu.key", anahtar.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                 serialization.NoEncryption()))
    _yaz_pem("sunucu.crt", sertifika.public_bytes(serialization.Encoding.PEM)
             + kok.public_bytes(serialization.Encoding.PEM))
    gunluk("Sunucu sertifikası yenilendi: " + ", ".join(adresler))
    return sp, kp, sertifika


# ---------------------------------------------------------------- kart
class Kart:
    def __init__(self):
        self.p11 = None
        self.hata = None

    def kitaplik(self):
        if self.p11 is None:
            self.p11 = pkcs11.Pkcs11()
        return self.p11

    def sertifikalar(self):
        out = []
        for slot, cid, der in self.kitaplik().sertifikalar():
            out.append({"id": f"{slot}:{cid.hex()}", "der": base64.b64encode(der).decode()})
        return out

    def imzala(self, kimlik, pin, veri, alg):
        slot, cid = kimlik.split(":", 1)
        mek = pkcs11.CKM_ECDSA if alg == "ec" else pkcs11.CKM_RSA_PKCS
        return self.kitaplik().imzala(int(slot), bytes.fromhex(cid), pin, veri, mek)


# ---------------------------------------------------------------- HTTP
class Durum:
    def __init__(self):
        self.ayar = ayar_oku()
        if not self.ayar.get("kod"):
            self.ayar["kod"] = yeni_kod()
            ayar_yaz(self.ayar)
        self.kart = Kart()
        self.parmak_izi = b""
        self.hatalar = {}  # ip -> [zamanlar]
        self.kilit = threading.Lock()
        self.onay_iste = bool(self.ayar.get("onay_iste", False))
        self.onay_kuyrugu = queue.Queue()

    @property
    def kod(self):
        return self.ayar["kod"]

    def kod_dogru(self, ip, k):
        with self.kilit:
            simdi = time.time()
            gecmis = [t for t in self.hatalar.get(ip, []) if simdi - t < 600]
            self.hatalar[ip] = gecmis
            if len(gecmis) >= 5:
                return None  # kilitli
            if hmac.compare_digest(kod_normal(k), kod_normal(self.kod)):
                self.hatalar.pop(ip, None)
                return True
            gecmis.append(simdi)
            return False


D = None


class Isleyici(BaseHTTPRequestHandler):
    server_version = "UDFImzaKoprusu/" + SURUM

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Eslesme")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, kod, govde):
        b = json.dumps(govde, ensure_ascii=False).encode()
        self.send_response(kod)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _yetki(self):
        ip = self.client_address[0]
        r = D.kod_dogru(ip, self.headers.get("X-Eslesme"))
        if r is None:
            self._json(429, {"hata": "Çok fazla hatalı eşleşme kodu. 10 dakika sonra yeniden deneyin."})
            return False
        if not r:
            gunluk(f"Hatalı eşleşme kodu: {ip}")
            self._json(401, {"hata": "Eşleşme kodu yanlış. Bilgisayardaki köprü penceresindeki kodu girin."})
            return False
        return True

    def do_GET(self):
        if self.path == "/":
            return self._json(200, {"ad": "UDF Editör imza köprüsü", "surum": SURUM})
        if self.path.startswith("/durum"):
            # Kodsuz: istemcinin rastgele değeri + TLS sertifikasının parmak izi,
            # eşleşme koduyla HMAC'lenir. İstemci kendi gördüğü sertifikayla
            # karşılaştırır; araya giren biri kodu bilmeden bunu üretemez.
            from urllib.parse import parse_qs, urlparse
            n = (parse_qs(urlparse(self.path).query).get("n") or [""])[0][:64]
            kanit = hmac.new(kod_normal(D.kod).encode(), n.encode() + D.parmak_izi, hashlib.sha256).hexdigest()
            return self._json(200, {"surum": SURUM, "kanit": kanit})
        if not self._yetki():
            return
        if self.path == "/sertifikalar":
            try:
                s = D.kart.sertifikalar()
                gunluk(f"Sertifika listesi istendi ({self.client_address[0]}): {len(s)} sertifika")
                return self._json(200, {"sertifikalar": s})
            except Exception as e:
                return self._json(503, {"hata": f"Kart okunamadı: {e}"})
        self._json(404, {"hata": "yok"})

    def do_POST(self):
        if not self._yetki():
            return
        if self.path != "/imzala":
            return self._json(404, {"hata": "yok"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 65536:
                return self._json(413, {"hata": "istek çok büyük"})
            g = json.loads(self.rfile.read(n))
            veri = base64.b64decode(g["veri"])
            if len(veri) not in (32, 48, 51):  # SHA-256 özeti ya da DigestInfo(SHA-256)
                return self._json(400, {"hata": "imzalanacak veri beklenen biçimde değil"})
            if D.onay_iste:
                cevap = queue.Queue()
                D.onay_kuyrugu.put((self.client_address[0], g.get("belge", ""), cevap))
                if not cevap.get(timeout=120):
                    gunluk("İmza isteği bilgisayarda reddedildi.")
                    return self._json(403, {"hata": "İstek bilgisayarda onaylanmadı."})
            imza = D.kart.imzala(g["id"], str(g["pin"]), veri, g.get("alg", "rsa"))
            gunluk(f"İmza atıldı ({self.client_address[0]}): {g.get('belge') or 'belge'}")
            return self._json(200, {"imza": base64.b64encode(imza).decode()})
        except pkcs11.Hata as e:
            gunluk(f"İmza başarısız: {e}")
            return self._json(400, {"hata": str(e), "pin": e.rv in (0xA0, 0xA1, 0xA2, 0xA4)})
        except queue.Empty:
            return self._json(403, {"hata": "Bilgisayarda onay zaman aşımına uğradı."})
        except Exception as e:
            gunluk(f"İmza başarısız: {e}")
            return self._json(500, {"hata": str(e)})


class KurulumIsleyici(BaseHTTPRequestHandler):
    """Düz HTTP: yalnızca kök sertifikayı ve kurulum yönergesini verir (gizli değil)."""

    def log_message(self, *a):
        pass

    def do_GET(self):
        with open(os.path.join(VERI, "kok.crt"), "rb") as f:
            pem = f.read()
        if self.path.startswith("/kok.mobileconfig"):
            # iOS'un yükleme önerdiği biçim: kök sertifikayı taşıyan yapılandırma profili
            import uuid
            sert = x509.load_pem_x509_certificate(pem)
            der = sert.public_bytes(serialization.Encoding.DER)
            iz = hashlib.sha256(der).hexdigest()
            u1 = str(uuid.uuid5(uuid.NAMESPACE_URL, "udf-editor-kok-" + iz)).upper()
            u2 = str(uuid.uuid5(uuid.NAMESPACE_URL, "udf-editor-profil-" + iz)).upper()
            ad = sert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
            ad_x = ad.replace("&", "&amp;").replace("<", "&lt;")
            plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>PayloadCertificateFileName</key><string>UDF-Imza-Koprusu.cer</string>
<key>PayloadContent</key><data>{base64.b64encode(der).decode()}</data>
<key>PayloadDisplayName</key><string>{ad_x}</string>
<key>PayloadIdentifier</key><string>tr.av.udfeditor.kok.{iz[:16]}</string>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadUUID</key><string>{u1}</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></array>
<key>PayloadDescription</key><string>UDF Editör'ün bu bilgisayardaki e-imza köprüsüne güvenli (HTTPS) bağlanması için. Yalnızca yerel ağ adreslerinde geçerlidir.</string>
<key>PayloadDisplayName</key><string>UDF Editör imza köprüsü</string>
<key>PayloadIdentifier</key><string>tr.av.udfeditor.profil.{iz[:16]}</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>{u2}</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>""".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/x-apple-aspen-config")
            self.send_header("Content-Length", str(len(plist)))
            self.end_headers()
            self.wfile.write(plist)
            gunluk(f"iPhone profili indirildi: {self.client_address[0]}")
            return
        if self.path.startswith("/kok.crt"):
            der = x509.load_pem_x509_certificate(pem).public_bytes(serialization.Encoding.DER)
            self.send_response(200)
            self.send_header("Content-Type", "application/x-x509-ca-cert")
            self.send_header("Content-Disposition", 'attachment; filename="UDF-Imza-Koprusu.crt"')
            self.send_header("Content-Length", str(len(der)))
            self.end_headers()
            self.wfile.write(der)
            gunluk(f"Kök sertifika indirildi: {self.client_address[0]}")
            return
        adres = yerel_adresler()[0]
        html = f"""<!doctype html><html lang=tr><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>İmza köprüsü kurulumu</title>
<style>body{{font:16px -apple-system,Segoe UI,sans-serif;margin:0;padding:16px;color:#222;max-width:640px}}
a.b{{display:block;text-align:center;background:#2C99AE;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:600}}
li{{margin:8px 0}} code{{background:#eee;padding:2px 5px;border-radius:4px}}</style>
<h2>UDF Editör — imza köprüsü</h2>
<p><b>iPhone / iPad</b> için bir kerelik kurulum:</p>
<p><a class=b href="/kok.mobileconfig">1. Profili indir</a></p>
<p style="font-size:14px;color:#666">Bu sayfayı <b>Safari</b>'de açın (Chrome ya da başka bir uygulamanın içinde profil yüklenmez).
Android/Windows için: <a href="/kok.crt">sertifika dosyası</a>.</p>
<ol start=2>
<li>"Bu web sitesi bir yapılandırma profili indirmeye çalışıyor" → <b>İzin Ver</b>.</li>
<li><b>Ayarlar</b> → en üstteki <b>Profil İndirildi</b> (ya da <b>Genel → VPN ve Aygıt Yönetimi</b>) → <b>Yükle</b>. 8 dakika içinde yükleyin.</li>
<li><b>Ayarlar → Genel → Hakkında → Sertifika Güvenilirlik Ayarları</b> → "UDF Editör Yerel İmza Köprüsü" için <b>tam güveni aç</b>.</li>
<li>UDF Editör → <b>Araçlar → İmzala → Bilgisayardaki e-imza</b>: adres <code>{adres}:{HTTPS_PORT}</code> ve köprü penceresindeki eşleşme kodu.</li>
</ol>
<p><b>Android uygulaması</b> için sertifika kurmanız gerekmez; yalnızca adres ve kodu girin.</p>
<p style="color:#666;font-size:14px">Bu sertifika yalnızca yerel ağ adresleri için geçerlidir; internet sitelerini etkilemez.</p>
</html>"""
        b = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


def sunuculari_baslat():
    kok_anahtar, kok = kok_hazirla()
    adresler = yerel_adresler()
    sp, kp, sertifika = sunucu_sertifikasi(kok_anahtar, kok, adresler)
    D.parmak_izi = hashlib.sha256(sertifika.public_bytes(serialization.Encoding.DER)).digest()

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(sp, kp)
    https = ThreadingHTTPServer(("0.0.0.0", HTTPS_PORT), Isleyici)
    https.socket = ctx.wrap_socket(https.socket, server_side=True)
    kurulum = ThreadingHTTPServer(("0.0.0.0", KURULUM_PORT), KurulumIsleyici)
    for s in (https, kurulum):
        threading.Thread(target=s.serve_forever, daemon=True).start()
    return adresler, kok


# ---------------------------------------------------------------- arayüz
def arayuz(adresler, kok):
    import tkinter as tk
    from tkinter import messagebox

    import segno

    pen = tk.Tk()
    pen.title("UDF Editör — İmza Köprüsü")
    pen.configure(bg="#EEEEEE")
    pen.minsize(520, 560)
    f = ("Segoe UI", 11)

    tk.Label(pen, text="Telefondaki UDF Editör'de: Araçlar → İmzala → Bilgisayardaki e-imza",
             bg="#EEEEEE", font=("Segoe UI", 10)).pack(pady=(12, 4))
    kutu = tk.Frame(pen, bg="#fff", bd=1, relief="solid")
    kutu.pack(padx=14, pady=6, fill="x")
    tk.Label(kutu, text="Adres", bg="#fff", fg="#6B7480", font=f).grid(row=0, column=0, sticky="w", padx=10, pady=(8, 0))
    tk.Label(kutu, text="  ".join(f"{a}:{HTTPS_PORT}" for a in adresler), bg="#fff",
             font=("Consolas", 16, "bold")).grid(row=1, column=0, sticky="w", padx=10)
    tk.Label(kutu, text="Eşleşme kodu", bg="#fff", fg="#6B7480", font=f).grid(row=2, column=0, sticky="w", padx=10, pady=(8, 0))
    kod_l = tk.Label(kutu, text=D.kod, bg="#fff", fg="#C00000", font=("Consolas", 22, "bold"))
    kod_l.grid(row=3, column=0, sticky="w", padx=10, pady=(0, 8))

    def kod_yenile():
        if messagebox.askyesno("Yeni kod", "Yeni eşleşme kodu üretilsin mi? Eşleşmiş telefonlar yeni kodu girmek zorunda kalır."):
            D.ayar["kod"] = yeni_kod()
            ayar_yaz(D.ayar)
            kod_l.config(text=D.kod)
            gunluk("Eşleşme kodu yenilendi.")

    tk.Button(kutu, text="Yeni kod", command=kod_yenile).grid(row=3, column=1, padx=10)

    onay = tk.BooleanVar(value=D.onay_iste)

    def onay_degisti():
        D.onay_iste = onay.get()
        D.ayar["onay_iste"] = D.onay_iste
        ayar_yaz(D.ayar)

    tk.Checkbutton(pen, text="Her imza isteğini bu bilgisayarda ayrıca onayla", variable=onay,
                   command=onay_degisti, bg="#EEEEEE", font=("Segoe UI", 10)).pack(anchor="w", padx=14)

    alt = tk.Frame(pen, bg="#EEEEEE")
    alt.pack(padx=14, pady=6, fill="x")
    url = f"http://{adresler[0]}:{KURULUM_PORT}/"
    qr = segno.make(url, error="m")
    import io
    tampon = io.StringIO()
    qr.save(tampon, kind="xbm", scale=4, border=2, name="qr")
    xbm = tampon.getvalue()
    img = tk.BitmapImage(data=xbm, foreground="black", background="white")
    tk.Label(alt, image=img, bg="#EEEEEE").pack(side="left")
    tk.Label(alt, justify="left", bg="#EEEEEE", font=("Segoe UI", 10),
             text=f"iPhone/iPad'de bir kerelik:\nkamerayla kodu okutun ya da\nSafari'de {url} açın\nve yönergeyi izleyin.\n\n"
                  "Android uygulamasında kurulum\ngerekmez.").pack(side="left", padx=12)

    tk.Label(pen, text="Olaylar", bg="#EEEEEE", fg="#6B7480", font=f).pack(anchor="w", padx=14)
    log = tk.Text(pen, height=10, font=("Consolas", 9), state="disabled")
    log.pack(padx=14, pady=(0, 12), fill="both", expand=True)

    def dongu():
        while not olaylar.empty():
            log.config(state="normal")
            log.insert("end", olaylar.get() + "\n")
            log.see("end")
            log.config(state="disabled")
        while not D.onay_kuyrugu.empty():
            ip, belge, cevap = D.onay_kuyrugu.get()
            pen.deiconify()
            pen.lift()
            pen.attributes("-topmost", True)
            cevap.put(messagebox.askyesno("İmza isteği", f"{ip} adresinden imza isteği:\n\n{belge or 'belge'}\n\nİmzalansın mı?"))
            pen.attributes("-topmost", False)
        pen.after(300, dongu)

    dongu()
    pen.mainloop()


def main():
    global D
    D = Durum()
    try:
        adresler, kok = sunuculari_baslat()
    except OSError as e:
        print(f"Köprü başlatılamadı: {e}\nBaşka bir köprü zaten çalışıyor olabilir.")
        input("Kapatmak için Enter...")
        return
    gunluk(f"Köprü hazır: https://{adresler[0]}:{HTTPS_PORT}  kod {D.kod}")
    try:
        D.kart.kitaplik()
        gunluk("E-imza sürücüsü: " + D.kart.p11.yol)
    except Exception as e:
        gunluk(f"UYARI: {e}")
    if "--arayuzsuz" in sys.argv:
        threading.Event().wait()
    else:
        arayuz(adresler, kok)


if __name__ == "__main__":
    main()
