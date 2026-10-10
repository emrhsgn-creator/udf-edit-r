# /// script
# requires-python = ">=3.10"
# dependencies = ["cryptography>=42", "segno>=1.6", "pystray>=0.19", "pillow>=10"]
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

Görev çubuğunda (saatin yanında) simge olarak durur; pencereyi kapatmak
köprüyü kapatmaz, simgeye küçültür. "Windows açılınca başlat" seçilirse
oturum açılınca pencere göstermeden başlar.

Çalıştırma:  UDF-Imza-Koprusu.cmd   (ya da: uv run --script kopru.py [--tepside])
Uyap Asistan kuruluysa köprü onun içinde de çalışır; ikisi aynı anda açılmaz.
"""
import io
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kopru_cekirdek as K  # noqa: E402

BASLANGIC = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup",
                         "UDF Imza Koprusu.vbs")


# ---------------------------------------------------------------- Windows açılışı
def otomatik_mi():
    return os.path.exists(BASLANGIC)


def otomatik_ayarla(acik):
    """Başlangıç klasörüne konsolsuz başlatan küçük bir .vbs koyar/kaldırır."""
    if not acik:
        try:
            os.remove(BASLANGIC)
        except FileNotFoundError:
            pass
        return
    betik = os.path.abspath(__file__)
    vbs = ('Set s = CreateObject("WScript.Shell")\r\n'
           f's.CurrentDirectory = "{os.path.dirname(betik)}"\r\n'
           f's.Run "uv run --gui-script ""{betik}"" --tepside", 0, False\r\n')
    os.makedirs(os.path.dirname(BASLANGIC), exist_ok=True)
    with open(BASLANGIC, "w", encoding="utf-16") as f:   # WSH UTF-16 (BOM) okur: Türkçe yollar için
        f.write(vbs)


# ---------------------------------------------------------------- simge
def simge_resmi():
    from PIL import Image, ImageDraw
    r = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(r)
    d.ellipse((2, 2, 62, 62), fill=(44, 153, 174, 255))
    d.polygon([(40, 12), (52, 24), (28, 48), (14, 52), (18, 38)], fill=(255, 255, 255, 255))
    d.line([(16, 54), (48, 54)], fill=(255, 210, 80, 255), width=4)
    return r


# ---------------------------------------------------------------- pencere
def arayuz(adresler, gizli):
    import tkinter as tk
    from tkinter import messagebox

    import pystray
    import segno

    pen = tk.Tk()
    pen.title("UDF Editör — İmza Köprüsü")
    pen.configure(bg="#EEEEEE")
    pen.minsize(520, 600)
    try:
        from PIL import ImageTk
        _ikon = ImageTk.PhotoImage(simge_resmi())
        pen.iconphoto(True, _ikon)
    except Exception:
        pass
    f = ("Segoe UI", 11)
    D = K.D

    tk.Label(pen, text="Telefondaki UDF Editör'de: Araçlar → İmzala → Bilgisayardaki e-imza",
             bg="#EEEEEE", font=("Segoe UI", 10)).pack(pady=(12, 4))
    kutu = tk.Frame(pen, bg="#fff", bd=1, relief="solid")
    kutu.pack(padx=14, pady=6, fill="x")
    tk.Label(kutu, text="Adres", bg="#fff", fg="#6B7480", font=f).grid(row=0, column=0, sticky="w", padx=10, pady=(8, 0))
    tk.Label(kutu, text="  ".join(f"{a}:{K.HTTPS_PORT}" for a in adresler), bg="#fff",
             font=("Consolas", 16, "bold")).grid(row=1, column=0, sticky="w", padx=10)
    tk.Label(kutu, text="Eşleşme kodu", bg="#fff", fg="#6B7480", font=f).grid(row=2, column=0, sticky="w", padx=10, pady=(8, 0))
    kod_l = tk.Label(kutu, text=D.kod, bg="#fff", fg="#C00000", font=("Consolas", 22, "bold"))
    kod_l.grid(row=3, column=0, sticky="w", padx=10, pady=(0, 8))

    def kod_yenile():
        if messagebox.askyesno("Yeni kod", "Yeni eşleşme kodu üretilsin mi? Eşleşmiş telefonlar yeni kodu girmek zorunda kalır."):
            kod_l.config(text=K.kodu_yenile())

    tk.Button(kutu, text="Yeni kod", command=kod_yenile).grid(row=3, column=1, padx=10)

    onay = tk.BooleanVar(value=D.onay_iste)

    def onay_degisti():
        D.onay_iste = onay.get()
        D.ayar["onay_iste"] = D.onay_iste
        K.ayar_yaz(D.ayar)

    tk.Checkbutton(pen, text="Her imza isteğini bu bilgisayarda ayrıca onayla", variable=onay,
                   command=onay_degisti, bg="#EEEEEE", font=("Segoe UI", 10)).pack(anchor="w", padx=14)
    oto = tk.BooleanVar(value=otomatik_mi())

    def oto_degisti():
        try:
            otomatik_ayarla(oto.get())
            K.gunluk("Windows açılınca başlatma " + ("açıldı." if oto.get() else "kapatıldı."))
        except OSError as e:
            messagebox.showerror("Windows açılışı", str(e))
            oto.set(otomatik_mi())

    tk.Checkbutton(pen, text="Windows açılınca başlat (görev çubuğunda simge olarak)", variable=oto,
                   command=oto_degisti, bg="#EEEEEE", font=("Segoe UI", 10)).pack(anchor="w", padx=14)

    alt = tk.Frame(pen, bg="#EEEEEE")
    alt.pack(padx=14, pady=6, fill="x")
    url = K.kurulum_adresi()
    t = io.StringIO()
    segno.make(url, error="m").save(t, kind="xbm", scale=4, border=2, name="qr")
    img = tk.BitmapImage(data=t.getvalue(), foreground="black", background="white")
    tk.Label(alt, image=img, bg="#EEEEEE").pack(side="left")
    tk.Label(alt, justify="left", bg="#EEEEEE", font=("Segoe UI", 10),
             text=f"iPhone/iPad'de bir kerelik:\nkamerayla kodu okutun ya da\nSafari'de {url} açın\nve yönergeyi izleyin.\n\n"
                  "Android uygulamasında kurulum\ngerekmez.").pack(side="left", padx=12)

    tk.Label(pen, text="Olaylar", bg="#EEEEEE", fg="#6B7480", font=f).pack(anchor="w", padx=14)
    log = tk.Text(pen, height=10, font=("Consolas", 9), state="disabled")
    log.pack(padx=14, pady=(0, 6), fill="both", expand=True)
    tk.Label(pen, text="Pencereyi kapatmak köprüyü kapatmaz; saatin yanındaki simgeden yeniden açılır.",
             bg="#EEEEEE", fg="#6B7480", font=("Segoe UI", 9)).pack(pady=(0, 10))

    # ---- görev çubuğu simgesi
    def goster(*_):
        pen.after(0, lambda: (pen.deiconify(), pen.lift(), pen.focus_force()))

    def cik(*_):
        simge.stop()
        pen.after(0, pen.destroy)

    def oto_menu(*_):
        oto.set(not otomatik_mi())
        pen.after(0, oto_degisti)

    simge = pystray.Icon("udf-imza-koprusu", simge_resmi(), "UDF Editör imza köprüsü",
                         menu=pystray.Menu(
                             pystray.MenuItem("Köprüyü göster", goster, default=True),
                             pystray.MenuItem("Windows açılınca başlat", oto_menu, checked=lambda i: otomatik_mi()),
                             pystray.MenuItem("Çıkış (köprüyü kapat)", cik)))
    simge.run_detached()
    pen.protocol("WM_DELETE_WINDOW", pen.withdraw)
    if gizli:
        pen.withdraw()

    def dongu():
        while not K.olaylar.empty():
            log.config(state="normal")
            log.insert("end", K.olaylar.get() + "\n")
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
    try:
        adresler = K.baslat()
    except OSError:
        # Port dolu: köprü zaten çalışıyor (bu pencere, Uyap Asistan ya da başka bir kopya)
        if "--tepside" in sys.argv:
            return
        try:
            import tkinter as tk
            from tkinter import messagebox
            r = tk.Tk(); r.withdraw()
            messagebox.showinfo("UDF Editör imza köprüsü",
                                "İmza köprüsü zaten çalışıyor (Uyap Asistan içinde ya da saatin yanındaki simgede).")
        except Exception:
            print("İmza köprüsü zaten çalışıyor.")
        return
    if "--arayuzsuz" in sys.argv:
        threading.Event().wait()
    else:
        arayuz(adresler, gizli="--tepside" in sys.argv)


if __name__ == "__main__":
    main()
