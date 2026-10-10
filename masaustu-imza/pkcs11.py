"""Windows'ta e-imza sürücüsünün PKCS#11 kitaplığına doğrudan ctypes ile erişim.

PyKCS11, AKİS sürücüsünde C_Initialize'a argüman verdiği için CKR_ARGUMENTS_BAD
alıyor; burada C_Initialize(NULL) çağrılıyor. Yalnızca gereken işlevler var:
sertifikaları listelemek ve kartta CKM_RSA_PKCS ile imzalamak.

Windows'ta PKCS#11 yapıları 1 bayt hizalıdır ve CK_ULONG 32 bittir.
"""
import ctypes
import os
import threading

CKR_OK = 0
CKO_CERTIFICATE = 1
CKO_PRIVATE_KEY = 3
CKA_CLASS = 0x0
CKA_LABEL = 0x3
CKA_VALUE = 0x11
CKA_ID = 0x102
CKU_USER = 1
CKF_SERIAL_SESSION = 0x4
CKM_RSA_PKCS = 0x1
CKM_ECDSA = 0x1041
CKA_KEY_TYPE = 0x100
CKK_EC = 3

HATALAR = {
    0x6: "işlem başarısız",
    0x30: "aygıt hatası",
    0x32: "aygıt çıkarıldı",
    0xA0: "PIN hatalı",
    0xA1: "PIN geçersiz",
    0xA2: "PIN uzunluğu geçersiz",
    0xA3: "PIN'in süresi dolmuş",
    0xA4: "PIN bloke — kartı sağlayıcınızın aracıyla açmanız gerekir",
    0xE0: "kart takılı değil",
    0xE1: "kart tanınmadı",
    0x100: "kullanıcı zaten giriş yapmış",
    0x101: "giriş yapılmadı",
}

ULONG = ctypes.c_ulong
HANDLE = ULONG


class Hata(Exception):
    def __init__(self, islem, rv):
        self.rv = rv
        super().__init__(f"{islem}: {HATALAR.get(rv, 'PKCS#11 hatası 0x%X' % rv)}")


class Attr(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("type", ULONG), ("pValue", ctypes.c_void_p), ("ulValueLen", ULONG)]


class Mech(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("mechanism", ULONG), ("pParameter", ctypes.c_void_p), ("ulParameterLen", ULONG)]


ADAYLAR = [
    r"C:\Windows\System32\akisp11.dll",       # TÜBİTAK AKİS (TÜRKTRUST, E-Güven, Kamu SM ...)
    r"C:\Windows\System32\eTPKCS11.dll",      # SafeNet eToken
    r"C:\Windows\System32\etpkcs11.dll",
]


def kitaplik_bul():
    for yol in [os.environ.get("EIMZA_PKCS11", "")] + ADAYLAR:
        if yol and os.path.exists(yol):
            return yol
    raise RuntimeError("E-imza sürücüsü (PKCS#11) bulunamadı. AKİS kart sürücüsünü kurun "
                       "ya da EIMZA_PKCS11 ortam değişkeniyle yolu verin.")


class Pkcs11:
    """Tek bir kitaplık örneği; çağrılar kilitle sıraya sokulur (kart aynı anda tek iş yapar)."""

    def __init__(self, yol=None):
        self.yol = yol or kitaplik_bul()
        self.dll = ctypes.CDLL(self.yol)
        self.kilit = threading.Lock()
        rv = self.dll.C_Initialize(None)
        if rv not in (CKR_OK, 0x191):  # 0x191: zaten başlatılmış
            raise Hata("C_Initialize", rv)

    def _c(self, ad, *args):
        rv = getattr(self.dll, ad)(*args)
        if rv != CKR_OK:
            raise Hata(ad, rv)

    def slotlar(self):
        n = ULONG(0)
        self._c("C_GetSlotList", ctypes.c_ubyte(1), None, ctypes.byref(n))
        dizi = (ULONG * max(n.value, 1))()
        self._c("C_GetSlotList", ctypes.c_ubyte(1), dizi, ctypes.byref(n))
        return list(dizi[: n.value])

    def _oturum(self, slot):
        h = HANDLE()
        self._c("C_OpenSession", ULONG(slot), ULONG(CKF_SERIAL_SESSION), None, None, ctypes.byref(h))
        return h

    def _bul(self, h, sinif):
        deger = ULONG(sinif)
        sablon = (Attr * 1)(Attr(CKA_CLASS, ctypes.cast(ctypes.byref(deger), ctypes.c_void_p), ctypes.sizeof(deger)))
        self._c("C_FindObjectsInit", h, sablon, ULONG(1))
        sonuc = []
        try:
            while True:
                tek = (HANDLE * 16)()
                n = ULONG(0)
                self._c("C_FindObjects", h, tek, ULONG(16), ctypes.byref(n))
                if not n.value:
                    break
                sonuc += list(tek[: n.value])
        finally:
            self.dll.C_FindObjectsFinal(h)
        return sonuc

    def _ozn(self, h, nesne, tip):
        a = (Attr * 1)(Attr(tip, None, 0))
        self._c("C_GetAttributeValue", h, HANDLE(nesne), a, ULONG(1))
        if a[0].ulValueLen in (0, 0xFFFFFFFF):
            return b""
        tampon = ctypes.create_string_buffer(a[0].ulValueLen)
        a[0].pValue = ctypes.cast(tampon, ctypes.c_void_p)
        self._c("C_GetAttributeValue", h, HANDLE(nesne), a, ULONG(1))
        return tampon.raw[: a[0].ulValueLen]

    def sertifikalar(self):
        """[(slot, ckaId, der)] — PIN gerekmez."""
        with self.kilit:
            cikti = []
            for slot in self.slotlar():
                h = self._oturum(slot)
                try:
                    for o in self._bul(h, CKO_CERTIFICATE):
                        cikti.append((slot, self._ozn(h, o, CKA_ID), self._ozn(h, o, CKA_VALUE)))
                finally:
                    self.dll.C_CloseSession(h)
            return cikti

    def imzala(self, slot, cka_id, pin, veri, mekanizma=CKM_RSA_PKCS):
        """Kartta ham imza. RSA için `veri` DigestInfo'dur (PKCS#1 v1.5 dolgusunu kart yapar)."""
        with self.kilit:
            h = self._oturum(slot)
            try:
                p = pin.encode("utf-8")
                rv = self.dll.C_Login(h, ULONG(CKU_USER), ctypes.c_char_p(p), ULONG(len(p)))
                if rv not in (CKR_OK, 0x100):
                    raise Hata("PIN", rv)
                try:
                    anahtar = None
                    for o in self._bul(h, CKO_PRIVATE_KEY):
                        if self._ozn(h, o, CKA_ID) == cka_id:
                            anahtar = o
                            break
                    if anahtar is None:
                        raise RuntimeError("Bu sertifikanın özel anahtarı kartta bulunamadı")
                    m = Mech(mekanizma, None, 0)
                    self._c("C_SignInit", h, ctypes.byref(m), HANDLE(anahtar))
                    n = ULONG(0)
                    self._c("C_Sign", h, veri, ULONG(len(veri)), None, ctypes.byref(n))
                    imza = ctypes.create_string_buffer(n.value)
                    self._c("C_Sign", h, veri, ULONG(len(veri)), imza, ctypes.byref(n))
                    return imza.raw[: n.value]
                finally:
                    self.dll.C_Logout(h)
            finally:
                self.dll.C_CloseSession(h)
