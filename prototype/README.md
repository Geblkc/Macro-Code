# MacroCode — Görsel Yeniden Tasarım Prototipi

Bu klasör, MacroCode arayüzünün **yeni tasarımını** tek dosyalık, tıklanabilir bir
prototip olarak içerir. Uygulamanın mevcut kaynak koduna **dokunmaz** — `src/`
diziniyle ilgisi yoktur ve `npm run build` çıktısına girmez.

## Açma

**Yöntem 1 — doğrudan tarayıcı (önerilen, çevrimdışı çalışır):**

```
file:///home/efeb/Masaüstü/MacroCode/prototype/index.html
```

**Yöntem 2 — yerel sunucu üzerinden:**

```bash
cd /home/efeb/Masaüstü/MacroCode
python3 -m http.server 8080 --directory prototype
# → http://localhost:8080
```

## İçindekiler

Üstteki **"Tasarım önizleme — ürüne dahil değil"** çubuğu tasarım incelemesi içindir;
gerçek üründe bulunmayacak.

| Kontrol | İşlev |
|---|---|
| **Karşılama** | Yeni onboarding ekranı (logo, 3 adımlı kurulum, komut paleti ipuçları) |
| **Sohbet** | User kartı, AI sol rayı, reasoning bloğu, markdown + sözdizimi renklendirme, kod bloğu, tablo, görev listesi, streaming caret |
| **Ajan** | Gruplanmış tool kartları (süre + durum + çıktı), onay kartı, görev checklist paneli |
| **Ayarlar** | 880px modal, ikonlu sekme rayı, sağlayıcı kartları, model tablosu, Sohbet / Dil / Hakkında sekmeleri, **mark varyantları galerisi** |
| **Normal / Yüksek kontrast** | Yeni kontrast paletini değiştirir |
| **Mono / Inter** | Arayüz kabuğunun fontunu değiştirir (içerik akışı da değişir) |

Sağ üstteki **model rozetine** tıklayarak model açılır listesini görebilirsiniz.
`Esc` listeyi kapatır.

## Kaynak

Tam tasarım kararı ve uygulama fazları:
`~/.opencode/plan/macrocode-gorsel-yeniden-tasarim.md`

Prototipin `<style>` bloğu **doğrulanmış** CSS'tir; uygulamaya taşırken birebir
kopyalanır. Hangi bloğun hangi dosyaya gittiği için plan belgesindeki
**"Prototip CSS → Gerçek Dosya portlama haritası"** bölümüne bakın.

## Notlar

- Tek dosya, harici bağımlılık yok. Yalnızca Google Fonts (Inter + JetBrains Mono)
  isteğe bağlıdır; çevrimdışı çalışırken sistem fontlarına düşer.
- `inline style` yalnızca "Mark varyantları" galerisi gibi tek seferlik demo
  bölümlerinde kullanılır — gerçek kodda token sınıfları kullanılır.
- HTML etiket dengesine dikkat: `</div>` sayıları eşleşmiyorsa düzen bozulur.
