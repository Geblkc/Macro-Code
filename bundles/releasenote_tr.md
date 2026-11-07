# MacroCode v0.2.3 — Sürüm Notları

**Tarih:** 7 Kasım 2026  
**Önceki Sürüm:** v0.2.2

---

## 🎯 Genel Bakış

v0.2.3 sürümü; **uzun süren komutların güvenilirliği**, **bağlam yönetimi** ve **kullanım görünürlüğü** üzerine odaklanmaktadır. Kabuk komutları artık canlı çıktı akışı (streaming) sağlamakta, komut türüne duyarlı zaman aşımları kullanmakta ve tüm süreç ağaçlarıyla birlikte iptal edilebilmektedir. Durum çubuğundaki bağlam göstergesi artık son gerçek API isteğini baz almakta, sıkıştırma (compaction) öngörülebilir bir eşik kullanmakta ve yeni İstatistik ekranı maliyet, token, oturum ve önbellek tasarrufunu takip etmektedir.

---

## ✨ Yeni Özellikler

### ⚡ Canlı komut akışı, zaman aşımı ve iptal
- `exec_cmd_stream` + Tauri `Channel<ExecEvent>`: stdout/stderr çıktıları canlı akar; araç kartı komut çalışırken otomatik açılır.
- Komut türüne duyarlı zaman aşımları: normal **30 sn**, test/check/lint **120 sn**, derleme/kurulum **300 sn**.
- Çağrı başına `timeoutMs` ve Ayarlar > Sohbet altında **1–600 sn** genel üst sınır (varsayılan 300 sn).
- Çalışan `exec` kartında **durdur** butonu; `exec_cancel` ile iptal.
- İptal ve zaman aşımı artık **tüm süreç ağacını** sonlandırır:
  - Unix: ayrı süreç grubu + `SIGKILL` (güvenli PGID kontrolü).
  - Windows: Job Object + `KILL_ON_JOB_CLOSE`, `TerminateJobObject`; `taskkill /T /F` yedeği.
- Sıfır dışı çıkış kodları, iptal ve zaman aşımı durumları artık `tool_result ok:false` olarak bildirilir; ajan düzeltme turu yapabilir.
- Mevcut `exec_cmd` / `ExecOut` sözleşmesi geriye dönük uyumludur; eski komut yolu da süreç ağacını temizler.

### 🧠 Bağlam ve sıkıştırma (compaction)
- Sıkıştırma eşiği pencere kullanımından türetilir; yanıt için 16k token ayrılır.
- Durum çubuğu bağlam göstergesi **son API isteğinin** gerçek kullanımını (`lastRequest`) gösterir; oturum toplamları ayrı sunulur.
- Otomatik sıkıştırma yüzdesi (örn. “%75'te otomatik sıkıştır”) göstergede görünür.
- `/compact` ve otomatik sıkıştırma aynı sınırı kullanır.

### 🛡️ Sağlayıcı dayanıklılığı
- Üstel geri çekilme yerine `Retry-After` başlığı (saniye veya HTTP tarihi) kullanılır.
- Yeniden deneme öncesi görünür geri sayım: “⟳ deneme 2/3 · 4 sn”.
- Kısmi metin veya araç çağrıları zaten aktarılmışsa aynı istek tekrar denenmez (`shouldRetry`).

### 📊 Kullanım istatistikleri
- Yeni **İstatistikler** ekranı: toplam maliyet, token, oturum, istek, önbellek tasarrufu ve oturum başına ortalama.
- Zaman serisi grafikleri (maliyet/token/istek) ve model bazlı dağılım.
- 7/30/90 günlük, proje, model ve sağlayıcı filtreleri.
- Her API adımı `usage_events` tablosuna kaydedilir (fiyat tablosundan maliyet; fiyat yoksa tahmini olarak işaretlenir).

### 🎨 Arayüz ve Kullanıcı Deneyimi
- Oturum yeniden adlandırma: **F2** kısayolu, Enter/Esc ve boş ad uyarısı.
- Kenar çubuğunda oturum modeli ve mod rozeti (build/plan/ask).
- Efor seçicide hız/maliyet ipuçları ve `max` değeri.
- `/help` çıktısında grup başlıkları vurgulanmıştır.

---

## 🔒 Güvenlik

- Çalışma alanı kısıtlaması (jail), izin verilenler listesi, tehlikeli bayraklar (`-exec`, `--pre`), gizli/engelli dosya kontrolleri ve onay/denetim akışı korunmaktadır.
- Süreç ağacı sonlandırması yalnızca çağıran tarafından başlatılan alt sürece uygulanır; Unix'te PGID doğrulanmadıkça gruba sinyal gönderilmez.

---

## 🧪 Test ve Doğrulama

| Kontrol | Sonuç |
|-------|--------|
| `npx tsc --noEmit` | ✅ |
| `npm test` | 698 geçti / 0 kaldı |
| `npm run build` | ✅ |
| `cargo test --lib` | 97 geçti / 0 kaldı |
| `cargo clippy --all-targets --all-features -- -D warnings` | ✅ |
| `cargo fmt --check` | ✅ |
| Windows `proc_tree.rs` derleme kontrolü (`x86_64-pc-windows-gnu`) | ✅ |

---

## 📦 Dağıtım Paketleri

| Platform / Biçim | Dosya |
| :--- | :--- |
| 🐧 Linux (AppImage) | `MacroCode_0.2.3_amd64.AppImage` |
| 🐧 Debian / Ubuntu (.deb) | `MacroCode_0.2.3_amd64.deb` |
| 🐧 Fedora / RHEL (.rpm) | `MacroCode-0.2.3-1.x86_64.rpm` |
| 🪟 Windows (NSIS) | `MacroCode_0.2.3_x64-setup.exe` |
| 🪟 Windows (MSI) | `MacroCode_0.2.3_x64_en-US.msi` |

> Paketler GitHub Actions sürüm iş akışı tarafından derlenip eklenmektedir.

---

## 📝 Notlar

- Windows'ta `KILL_ON_JOB_CLOSE` nedeniyle, komut normal çıksa bile iş nesnesi içindeki alt süreçler temizlenir. Unix'te normal çıkışta alt süreçlere dokunulmaz; grup yalnızca iptal/zaman aşımı/hata durumunda kapatılır.
- İlk otomatik güncelleyici v0.2.2 ile geldiğinden, v0.2.2 ve sonraki sürümler otomatik güncellenebilir.
- `Security.md` değiştirilmemiştir.
- `auto-edit` modu onaysız yazar; engellenen dizinler kapalı kalmaya devam eder.

---

**MacroCode v0.2.3** — Canlı kabuk akışı, süreç ağacı iptali, güvenilir bağlam ve kullanım istatistikleri.
