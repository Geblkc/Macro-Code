# MacroCode — Değişiklik Raporu

> Bu dosya, MacroCode projesinde **yapılan tüm işlemlerin tarihli kaydıdır**.
> Güncel mimari için bkz. `ARCHITECTURE.md` (o dosya tarihsiz, sadece mevcut durumu anlatır).
> Son güncelleme: 2026-10-21

**Kural:** Koda dokunan her işlem buraya tarih + kapsam + doğrulama ile eklenir.
`ARCHITECTURE.md`'ye sadece mimari sonucu yansıtılır.

---

## 2026-10-21 — Faz 13 · Kaydet Geri Bildirimi (toast) + Sürüm Tek Kaynak (Faz 4 + 5)

> Kullanıcı talebi: "Faz 4 ve 5'i aynı anda yap". Bu kayıt iki fazı kapsar:
> **(4)** Kaydet geri bildirimi + keystore hata yutmayı bırakma,
> **(5)** Sürüm tek kaynak + Hakkında sekmesi tam.

### A. Toast bildirim kanalı (Faz 4)

- **`src/lib/toast.ts`** (yeni): sıfır bağımlılık, React dışı modüllerden de
  çağrılabilir — `showToast(msg, kind)` · `toast.ok/err/info` · `dismissToast(id)` ·
  `subscribeToasts(listener)` · `toastItems()` · `clearToasts()`.
  Süre: başarı 3 sn / hata 6 sn / `0` = elle kapanır. **Flood koruması:** en fazla 4.
- **`src/components/Toast.tsx`** (yeni): `ToastHost` — uygulama kökünde bir kez
  mount (`App.tsx`). `role="status"` + `aria-live="polite"` (ekran okuyucu).
  Konum: sağ alt, durum çubuğunun üstünde (`styles/toast.css`).
- **Kritik düzeltme — `save()` artık hata yutmuyor:**
  Önceden tüm keystore yazmaları `.catch(() => {})` ile sessizce yutuluyordu;
  kullanıcı "kaydettim" sanıp **API anahtarını kaybedebiliyordu**.
  Artık: her iş `Promise.allSettled` ile toplanır, başarısız olanlar **etiketiyle**
  (hangi sağlayıcı) hata toast'ında gösterilir ve **modal açık kalır** (tekrar
  deneyebilir). Başarılıysa "Ayarlar kaydedildi" toast'ı + modal kapanır.
- Hakkında sekmesindeki pano kopyalama da toast ile bildiriliyor.

### B. Sürüm tek kaynak (Faz 5)

- **`vite.config.ts`** → `package.json` okunur, `define` ile gömülür:
  `__APP_VERSION__` · `__REPO_URL__` (repository.url veya homepage).
- **`src/vite-env.d.ts`** → global bildirimler (`declare const`).
- **`src/lib/appInfo.ts`** (yeni): `APP_VERSION` · `REPO_URL` · `LICENSE` ·
  `PLATFORMS` · `APP_NAME`. Uygulama içinde **sabit sürüm yazılmaz** —
  `AboutTab.tsx`'deki `const APP_VERSION = '0.1.0'` kaldırıldı.
- **`src/lib/version.test.ts`** (yeni): package.json ↔ tauri.conf.json sürüm
  senkronu + ürün adı + bundle telif hakkı + gömülen sürüm eşleşmesi.
- `package.json` → `license` · `homepage` · `repository` alanları eklendi
  (repo URL'si kullanıcı tarafından doldurulacak — bağlantı boşsa Hakkında'da
  "Kaynak kod" butonu **gizlenir**).

### C. Hakkında sekmesi tamamlandı

- **Logo** artık inline SVG kopya değil → `public/macrocode-logo.svg` (tek kaynak).
- **Bilgi ızgarası:** Sürüm · Lisans (MIT) · Platform · Model kataloğu
  (43 model · 7 sağlayıcı — `settings.about.modelCount` **ölü anahtardan canlıya**).
- **Veri konumları:** Rust `get_app_paths` komutu (`commands/paths.rs`, yeni) →
  `app_data_dir` + `keys.json` + `sessions.db` yollarını döndürür; About
  sekmesinde **kopyalanabilir** olarak gösterilir. Tarayıcı-dev'de konum yoksa
  açıklama satırı gösterilir.
- **Kaynak kod** bağlantısı (`REPO_URL` doluysa) + **Lisans · MIT** bağlantısı.
- **Ölü UI kaldırıldı:** devre dışı "Güncelleme yok" butonu (updater altyapısı yok).
- **Ölü i18n anahtarları silindi** (6 × 5 dil): `settings.about.title` ·
  `noUpdate` · `noUpdateTitle` · `noUpdateNote` · `licenseValue` · `privacyTitle`.

### D. i18n

- 11 yeni anahtar × 5 dil (`settings.save.ok` · `settings.save.failed` ·
  `settings.about.*`).
- `settings.save.failed` `{count}` taşıyor → İngilizcede **çoğul nesnesi**
  (i18n sözleşmesi) — 5 dilde çoğul biçim.

### E. Test & doğrulama

- `src/lib/toast.test.ts` (yeni, 9 test): ekleme · abonelik · dismiss · flood
  koruması · süreler · otomatik kapanma · kısa yollar.
- `src/lib/version.test.ts` (yeni, 8 test): sürüm senkronu / ürün adı / telif /
  gömülen sürüm / repo URL biçimi.
- `npm run test` → **65 dosya / 495 test geçti** (Faz 3'den sonra 63 / 478).
- `npm run build` → temiz · `cargo fmt/clippy/test` → temiz.
- **Playwright + Firefox:** Kaydet → "Settings saved." toast'ı · modal kapandı ·
  Hakkında sürüm rozeti `v0.1.0` · 4 bilgi hücresi · logo `<img>` ·
  sürüm kopyalama toast'ı · toast 3 sn sonra kapandı · konsol hatası yok.
- README'ye **yayın öncesi kontrol listesi** eklendi (sürüm senkronu + repo URL).

---

## 2026-10-21 — Faz 13 · Sekme İçeriklerinin Ayrıntılandırılması (Faz 3)

> Faz 2'de bölünen sekmelerin içi bu fazda dolduruldu: sağlayıcı kartlarına
> konsol bağlantısı + toplu test, MCP sekmesi native checkbox yerine `Switch` +
> maskeli env + araç listesi, shell allowlist doğrulaması.

### A. Sağlayıcılar

- **4 bölüm:** Bulut sağlayıcıları (6 kart) · Yerel sağlayıcı (Ollama) ·
  Özel taban URL · Özel uçlar. (Önceden hepsi tek ızgara + alt alta listeydi.)
- **`PROVIDER_DEFS` zenginleştirildi** (7 sağlayıcı): `keyUrl` (konsol bağlantısı) ·
  `keyUrlLabel` (görünen alan adı) · `defaultBaseUrl` (fabrika adresi).
  → Her kartta **"Anahtar al · console.anthropic.com"** gibi bir dış bağlantı.
- **"Tümünü test et"** butonu: 7 sağlayıcıyı sırayla test eder (test sırasında
  buton "test ediliyor…" durumuna geçer).
- **Aktif sağlayıcı rozeti:** kayıtlı `currentProvider` ile eşleşen kartta
  yeşil "aktif" çipi.
- **Base URL override:** placeholder artık **fabrika adresini** gösteriyor;
  dolu olduğunda **"sıfırla"** butonu çıkıyor (kaydetmede de temizleniyor).
- **Durum rozeti ipucu:** "bağlı / anahtar geçersiz (kopyalarken boşluk olmasın) /
  ağ hatası (internet bağlantısı)".
- **Erişilebilirlik:** her alan `id` + `<label htmlFor>` ile eşleşiyor;
  `SecretCard.fieldId` ölü prop'u kaldırıldı.
- Ollama etiketi "Ollama URL" → **"Ollama"** (sağlayıcı adı; adres ayrı alanda).

### B. MCP

- Native `<input type="checkbox">` → **`Switch`** bileşeni (uygulama ile tutarlı).
- **Env değerleri maskeleniyor:** `maskEnvText()` (8 karakterlik `•`) — alan
  varsayılan **salt-okunur ve gizli**, "Göster/Gizle" butonu ile açılır.
- **Keşif artık araç listesi döndürüyor:** `McpDiscovery.tools` (ad + açıklama).
  Keşif yapıldıysa "İzinli araçlar" **çoklu seçim** listesine dönüşüyor;
  keşif yoksa serbest metin alanı kalıyor.

### C. Sohbet

- **Shell allowlist doğrulaması:** geçersiz satırlar kırmızı uyarı olarak
  gösteriliyor ("1 satır geçersiz ve yok sayılıyor: rm -rf /").
  Kural **motorla aynı** — `engine/policy.ts` → `parseCustomLine` tek kaynak;
  `rm` hiçbir tabloda gevşemez.

### D. i18n

- 17 yeni anahtar × 5 dil (`settings.providers.*` · `settings.mcp.*` ·
  `settings.chat.allowListInvalid`).
- `settings.chat.allowListInvalid` `{count}` taşıyor → **İngilizcede çoğul nesnesi**
  (i18n sözleşmesi) — 5 dilde çoğul biçime alındı.

### E. Test & doğrulama

- `SettingsModal/env.test.ts` (yeni, 15 test): `maskEnvText` (maske/gizleme) ·
  `allowListIssues` (rm/geçersiz komut/boş-yorum) · `parseEnvText`/`serializeEnv`
  gidiş-dönüş.
- `npm run test` → **63 dosya / 478 test geçti** (Faz 2'den sonra 62 / 463).
- `npm run build` → temiz · `cargo fmt/clippy/test` → temiz.
- **Playwright + Firefox:** 4 sağlayıcı bölümü · 7 "Anahtar al" bağlantısı ·
  "Test all" butonu · base URL "sıfırla" çalışıyor · MCP'de 0 native checkbox ·
  env alanı varsayılan salt-okunur ve maskeli (`API_KEY=••••••••`) ·
  allowlist uyarısı görünüyor · konsol hatası yok.

---

## 2026-10-21 — Faz 13 · Ayarlar Kabuğu: Kullanıcı Dostu Modal (Faz 1)

> Kullanıcı talebi: "ayarları detaylıca düzenleyelim, daha kullanıcı dostu hale
> getirelim, yayına hazır hale getirelim". Kararlar: **7 sekme + iç alt sekmeler**,
> sürüm `0.1.0` (ilk halka yayını), yayın kapsamı = sürüm tek kaynak + Hakkında
> sekmesi + Kaydet geri bildirimi (toast). Bu kayıt **Faz 1'i** (modal kabuğu) kapsar.

### A. Kaydedilmemiş değişiklikle kapatma

- `Escape` · overlay tıklaması · **yeni X butonu** · "Vazgeç" → hepsi `requestClose()`
  üzerinden geçer; `dirty` ise `ConfirmDialog` açılır.
- `components/SettingsModal/ConfirmDialog.tsx` (yeni): `Escape` → iptal,
  `Enter` → onay, `role="alertdialog"`, odak döngüsü. **Güvenli varsayılan:**
  odak "Değişiklikleri iptal et" butonundadır (kazara kaydetme olmaz).
- Diyalog overlay'i dış katmana sızmaz (`stopPropagation`) — çift tetiklenme düzeltildi.

### B. Odak döngüsü (focus trap)

- `hooks/useFocusTrap.ts` (yeni): `FOCUSABLE_SELECTOR` · `focusableElements()` ·
  `cycleFocus()` · `useFocusTrap()`.
- Modal açılışında **aktif sekme düğmesine** odaklanır (`data-autofocus`),
  kapanışta modal öncesi öğeye odak döner.
- `Tab`/`Shift+Tab` modal içinde döngüde kalır.
- **Tasarım kararı:** döngü native `addEventListener` değil **React `onKeyDown`**
  üzerinden sürülür — böylece iç içe diyaloglar `stopPropagation` ile üstteki
  Escape/Tab işleyicisini iptal edebilir.

### C. Sekme klavye navigasyonu + state korunumu

- `role="tablist"` + roving `tabindex` + `aria-selected` / `aria-controls` /
  `aria-labelledby` bağlantıları. `↑↓ ←→ Home End` ile sekme değişimi (odak da taşınır).
- Saf fonksiyon: `SettingsModal/types.ts` → `nextTabIndex()` (test edilebilir).
- **Sekme state korunumu:** ziyaret edilen sekmeler mount'ta kalır, `hidden` ile
  gizlenir (`visited` dizisi + `TabPanel` sarmalayıcısı) → Modeller sekmesindeki
  arama metni / süzgeç ve MCP keşif sonuçları sekme değiştirince **kaybolmaz**.
- `styles/global.css` → `[hidden] { display: none !important; }` (author `display`
  kuralları `hidden`'ı ezebilir).
- Sekme değişince içerik kaydırması başa döner.
- **Davranış değişikliği:** modal açılışında sekme artık `providers`'a **sıfırlanmaz** —
  son kullanılan sekmede açılır (odak tutarlılığı + "kaldığın yerden devam et").

### D. Ölçü ve görsel

- Modal 880 → **960px**, `max-height` 86vh → **88vh**.
- Başlığa **X kapatma butonu** (`.head-right` sarmalayıcısı — "kaydedilmemiş" rozeti
  artık `margin-left:auto` taşımıyor).
- `styles/settings.css` → onay kutusu stilleri (`.confirm*`), `.tab-panel`, `.modal-close`.

### E. i18n

- 4 yeni anahtar **5 dilde** eklendi: `settings.discard.title` ·
  `settings.discard.message` · `settings.discard.save` · `settings.discard.discard`.

### F. Test & doğrulama

- `components/SettingsModal/tabs.test.ts` (yeni, 10 test): `nextTabIndex`
  (döngü / Home / End / geçersiz tuş), `mergeVisited`, `TABS` bütünlüğü.
- `npm run test` → **61 dosya / 449 test geçti** (öncesi 60 / 439).
- `npm run build` (tsc --noEmit + vite build) → temiz.
- **Playwright + Firefox ile uçtan uca doğrulama:**
  dirty rozeti görünür · `Escape` onay kutusunu açar · "Değişiklikleri iptal et"
  modalı kapatır · Modeller arama metni sekme değiştirince korunur · ok tuşu sekmeyi
  değiştirir ve odağı taşır · 40 ardışık `Tab` sonrası odak modal içinde kalır ·
  konsol hatası yok.

---

## 2026-10-21 — Faz 13 · Ayarlar Sekme Yeniden Yapılandırması (Faz 2)

> Kullanıcı kararı: **7 sekme + iç alt sekmeler**. "Modeller" sekmesi önceden 6 ayrı
> işi tek sayfada barındırıyordu; işler bölündü. Aynı kayıtta: çift tanım
> (`clockFormat`/`contrast`) tek yere toplandı, ölü UI kaldırıldı, yeni
> `showTimestamps` ayarı eklendi.

### A. Sekme yapısı (6 → 7)

| # | Sekme | İkon | Not |
|---|---|---|---|
| 1 | Sağlayıcılar | key | değişmedi |
| 2 | Modeller | cpu | **3 alt sekme**: Liste │ Katalog & keşif │ Elle ekle |
| 3 | **Parametreler** | sliders | **yeni sekme** — 2 alt sekme: Model parametreleri │ Fiyatlar |
| 4 | Sohbet | message | görünüm bloğu çıkarıldı |
| 5 | **Görünüm & Dil** | globe | `LangTab` → `AppearanceTab` (yeniden adlandırıldı + genişletildi) |
| 6 | MCP | activity | değişmedi |
| 7 | Hakkında | info | değişmedi |

- `types.ts` → `TabId` genişletildi (`params`, `appearance` eklendi; `lang` kaldırıldı).
- `icons.tsx` → yeni **`sliders`** ikonu (16px ızgara, 1.5 stroke, `currentColor`).

### B. Alt sekmeler

- `components/Segmented.tsx` (yeni): segment kontrolü — `role="tablist"`,
  roving `tabindex`, **aynı klavye kuralı** (↑↓ ←→ Home End).
- `lib/tabNav.ts` (yeni): `nextTabIndex()` — tek kaynak (hem sekme rayı hem
  segmented kullanır; `SettingsModal/types.ts` re-export eder).
- Alt sekme panelleri de mount'ta kalır → **alt sekme state'i de korunur**.

### C. İçerik düzenlemesi

- **Varsayılan model seçimi** tablonun üstüne taşındı (önce altta idi).
- **Model tablosu** artık **görünür ad + id** gösteriyor (önce yalnız id).
- **Fiyat tablosu**: sütun başlıkları (girdi/çıktı/cache) + **kendi arama/süzgeci**
  + "N / M model gösteriliyor" sayacı (eski 120 satır kırpma yerine).
- **Elle model ekleme** artık tam: id · **görünür ad** · sağlayıcı · **bağlam penceresi** ·
  **azami çıktı** · yetenekler (SVG ikonlu) — ölü i18n anahtarları kullanıma alındı.
- **Katalog rozetleri** emoji (`🛠👁🧠`) yerine **SVG ikon** (memorybank kuralı 27 ihlali giderildi).
- **Çift tanım kaldırıldı:** `clockFormat` + `contrast` artık **yalnızca** "Görünüm & Dil" sekmesinde.
- **Ölü UI kaldırıldı:** "Sayı biçimi" bölümündeki iki `disabled` buton → tek satır not.
- **Yinelenen aç/kapa listesi** kaldırıldı (tablo zaten anahtar içeriyor).
- **Yeni ayar `showTimestamps`:** terminalde mesaj saati göster/gizle.
  `store/settings.ts` (varsayılan `true`) + `partialize`'ın **iki dalı** da güncellendi
  (aksi halde Tauri'de sıfırlanırdı) + `Terminal.tsx` (`toViewLine` + extras log satırları).

### D. Ortak model listesi mantığı

- `SettingsModal/modelList.ts` (yeni): `keyedProviders` · `modelView` · `filterModels`.
  Modeller · Parametreler · Sohbet sekmeleri artık **aynı** görünürlük kuralını
  kullanıyor (anahtarı olmayan sağlayıcı gizli, `ollama` hariç).

### E. i18n

- **Yeni anahtar:** 36 adet (`settings.tab.params`, `settings.models.sub.*`,
  `settings.params.*`, `settings.appearance.*`, `settings.chat.answerSection` …) — 5 dilde.
- **Yeniden adlandırma:** `settings.models.params.*` → `settings.params.*` ·
  `settings.models.fallback*` / `price*` → `settings.params.*` ·
  `settings.lang.*` + `settings.chat.*` (görünüm bloğu) → `settings.appearance.*` ·
  `settings.tab.lang` → `settings.tab.appearance`.
- **Silinen anahtar:** 12 adet (yinelenen aç/kapa listesi, kırpma notları, ölü
  `settings.models.params`, `settings.chat.viewSection`, `settings.lang.accessibility` …).
- **Çakışma düzeltmesi:** `settings.lang.clock24` ve `settings.chat.clock24` aynı
  yeni anahtara taşınıyordu → yinelenen girişler temizlendi (ilk occurrence korundu).
- `{count}` taşıyan yeni anahtar (`settings.chat.systemPromptCount`) İngilizcede
  **çoğul nesnesi** — i18n sözleşmesi gereği (5 dilde).

### F. Test & doğrulama

- `SettingsModal/modelList.test.ts` (yeni, 14 test): `keyedProviders` (yazılan/ipucu/
  silinmiş/ollama) · `modelView` (gizleme/kilit listesi/ollama istisnası) ·
  `filterModels` (arama/süzgeç/birlikte).
- `npm run test` → **62 dosya / 463 test geçti** (Faz 1'den sonra 61 / 449).
- `npm run build` (tsc --noEmit + vite build) → temiz.
- **Playwright + Firefox uçtan uca:** 7 sekme doğru sırada · Modeller'de 3 alt sekme ·
  Parametreler'de 2 alt sekme · Modeller arama metni sekme değiştirince korunuyor ·
  konsol hatası yok.
- README'deki bayat ayar yolları güncellendi (⚙ Ayarlar → **Görünüm & Dil**,
  ⚙ Ayarlar → Modeller → **Katalog & keşif**).

---

## 2026-10-21 — Çoklu Dil (i18n): TR / EN / DE / FR / ES

> Kullanıcı talebi: uygulamaya çoklu dil seçeneği. Kararlar: 5 dil, kapsam =
> "UI + terminal mesajları", modele giden tool açıklamaları İngilizce sabit,
> **sıfır bağımlılık** (elle yazılmış motor). Sürüm değişmedi (`0.1.0`).

### A. Motor (`src/lib/i18n/`) — sıfır runtime bağımlılığı

- `types.ts` — `Locale` (`tr|en|de|fr|es`), `LanguageSetting` (`'auto' | Locale`),
  `Message` (`string | PluralForms`), `TranslateParams`, `LOCALE_META`.
- `format.ts` — `interpolate()` (`{ad}` yer tutucu) + `selectForm()`
  (`Intl.PluralRules` ile de/fr/es çoğul seçimi).
- `core.ts` — `t()` · `makeT()` · `translate()` · `setLocale()` · `getLocale()` ·
  `detectLocale()` · `resolveLocale()`. **Store bağımsızdır** (döngüsel import yok).
- `hook.ts` — `useT()`: store'daki dile reaktif bağlı (`useSettingsStore` aboneliği).
- `locales/` — `tr.ts` **kaynak gerçek** (`as const` → `TranslationKey` türü buradan
  türer) + `en/de/fr/es.ts` (`Record<TranslationKey, Message>` → eksik/fazla anahtar
  TS hatası verir).
- **Fallback zinciri:** aktif dil → İngilizce → Türkçe → anahtarın kendisi.

### B. Çeviri sınırı

- ✅ Çevrilen: tüm bileşen metinleri (`title`/`aria-label`/`placeholder` dahil),
  ayarlar modalı (6 sekme), slash komut çıktıları, `formatProviderError`,
  ajan tool/onay/görev kartları, `policy.ts` red gerekçeleri, `engine/tools/*`
  hata metinleri, markdown export başlıkları, oturum varsayılan adı.
- 🔒 **İngilizce sabit:** `engine/toolspec.ts` tool + parametre açıklamaları
  (modele gider, kullanıcıya gösterilmez — model performansı ve araç çağrı
  tutarlılığı için). Önceden Türkçeydi; artık İngilizce.
- 🔒 Türkçe kalan: Rust backend hataları (`fs.rs`/`exec.rs`/`keystore.rs`),
  `engine/skills.ts` prompt'u, agent system prompt'u, log kayıtları.

### C. Entegrasyon

- `store/settings.ts` → `language: LanguageSetting` (varsayılan `'auto'`) +
  `setLanguage()`. `partialize`'ın **iki dalına** da eklendi (Tauri dalı alanları
  açık listeliyor — eklenmezse dil Tauri'de sıfırlanırdı).
- `App.tsx` → `useEffect(() => setLocale(resolveLocale(language)), [language])`:
  modül geneli locale + `<html lang>` senkronu.
- `SettingsModal/LangTab.tsx` → dil seçimi **aktif** (önceden `disabled`, sadece TR).
- `SettingsModal/types.ts` → `TABS` artık `labelKey` taşır (statik `label` yerine);
  `Draft.language` eklendi. Ölü `TEST_CONN_LABEL` kaldırıldı.
- `lib/commands.ts` → `HELP_LINES` sabiti yerine `helpLines()` fonksiyonu
  (dil değişince yeniden üretilir).

### D. Testler

- `lib/i18n/i18n.test.ts` (24) — anahtar bütünlüğü (5 dil), interpolasyon, çoğul,
  fallback, locale çözümleme.
- `lib/i18n/integration.test.ts` (9) — store entegrasyonu, `<html lang>` senkronu,
  modül geneli locale.
- **Çoğul denetimi:** `{count}` taşıyan her anahtar İngilizcede **çoğul nesnesi**
  olmak zorunda (düz metin "1 days ago" gibi hatalar üretirdi). Test bunu zorlar.
  23 sayaç anahtarı 5 dilde çoğul biçimine çevrildi.
- **Mevcut testler kırılmadı:** `t()` varsayılan locale'i `tr` → Türkçe çıktı
  birebir aynı (`commands.test.ts`, `pricing.test.ts`, `policy.test.ts` dahil).

### E. Doğrulama

| Kontrol | Sonuç |
|---|---|
| `npx tsc --noEmit` | ✅ 0 hata |
| `npm test` | ✅ **60 dosya / 439 test** yeşil (400 → 439) |
| `npm run build` | ✅ yeşil · CSS 45.2 kB (gzip 8.7) · JS 573 kB (gzip 169) |
| Tarayıcı (headless Firefox) | ✅ TR/EN/DE/FR/ES render; **kalıcı ayar** (`localStorage` → store → `useT`) doğrulandı; ayarlar modalı 6 sekme + dil sekmesi doğrulandı |
| Rust | ⚪ etkilenmedi (`cargo test --lib` → 57 test yeşil) |

### F. Notlar

- `package.json` dependencies **değişmedi** (i18n motoru elle yazıldı).
- `CONTRIBUTING.md` "UI metinleri Türkçe" kuralı → i18n kuralıyla değiştirildi.
- `README.md`'ye "Çoklu dil (i18n)" bölümü eklendi.
- Ayar modalındaki dil değişimi **Kaydet** ile uygulanır (taslak/iptal mantığı
  korunur) — yeniden başlatma gerekmez.

---

## 2026-10-19 — Görsel Yeniden Tasarım: Tamamlanma (sınıf standardizasyonu + inline style temizliği)

İlk yeniden tasarım commit'inde (`b33dad6`) 5 eski CSS sınıf adı CSS'ten düşürülmüş,
bileşenlerde ise bırakılmıştı. Bu turda kapatıldı.

### K1 — Kopuk sınıflar (31 element)

- `.field-input` (24) → `.input`; `.field-input field-area` (3) → `.input input-area`.
  Etkilenen: Ayarlar → Sağlayıcılar ("Özel taban URL" + "Özel sağlayıcılar" kartları),
  Modeller ("Yedek model", "Fiyat tablosu" = 18 sayı girişi, "Model parametreleri",
  "Elle model ekle"), MCP (sunucu kartları). Bu alanlar tarayıcı varsayılanı **beyaz**
  görünüyordu → yeni temada kırık.
- `.warn-text` (2) → InputBar uyarı metni artık `--col-warn`.
- `.head-icon` (1) → Ayarlar başlığı dişl ikonu artık `--accent`.
- `.sidebar-empty` (1) → Sidebar boş durum metni artık `--text-tertiary` + ortalı.
- `.model-group` (5) → Titlebar sağlayıcı grubu sarmalayıcısı.

### K2 — Inline style temizliği

- **70 `style={{...}}` → 0.** `styles/utilities.css` yardımcı sınıfları:
  `.mt-1/2/3 .mb-1/2/3/4 .my-1 .m-0 .flex-1 .flex-2 .gap-1 .hidden .btn-reset
  .input-area-lg .input-area-md .about-*`.
- Yardımcı sınıflarda **renk/yazı tipi yoktur** — yalnız boşluk/flex/görünürlük.
  Boşluklar `--sp-*` token'ından türetilir.

### K3 — Native form kontrolü

- `input[type=checkbox|radio]` → `accent-color: var(--accent)` (varsayılan mavi kutu
  temayla çelişiyordu).
- `input[type=number]` → artı/eksi okları gizlendi (koyu temada okunmuyordu).

### Doğrulama

| Kontrol | Sonuç |
|---|---|
| `npx tsc --noEmit` | ✅ 0 hata |
| `npm run build` | ✅ yeşil · CSS 44.7 kB (gzip 8.6) · JS 401 kB (gzip 124) |
| `npm run test` | ✅ 58 dosya / 400 test |
| Sınıf denetimi (kullanılan ⊆ tanımlı) | ✅ boşluk kalmadı (`.msg-` hariç — şablon ifade) |
| Tarayıcı | ✅ Sağlayıcılar (özel taban URL) · Modeller (fiyat tablosu) · MCP (sunucu kartı) · Özel sağlayıcı kartı — hepsi yeni temada |

## 2026-10-19 — Görsel Yeniden Tasarım (Faz G1–G8)

**Kapsam:** Terminal DNA'sı korunarak modern bir ürün arayüzü. Prototip ve faz planı:
`~/.opencode/plan/macrocode-gorsel-yeniden-tasarim.md` · `prototype/index.html`

### G1 — Tasarım temeli

- **Yeni token sistemi** (`styles/global.css`): yüzey rampası (`--bg-sunken` … `--bg-inset`),
  WCAG AA metin paleti (`--text-primary` 16.1:1 / `--text-secondary` 9.1:1 /
  `--text-tertiary` 4.9:1), gölge ölçeği, 4px boşluk ölçeği, hareket token'ları.
- **Kontrast düzeltmesi**: `--dim` (#444, 2.1:1) ve `--muted` (#666, 3.3:1) kullanımdan
  kaldırıldı → 10–11px meta/başlıklar okunur hale geldi.
- **Aksan markaya bağlandı**: `#00e5a0` → **`#00E676`** (logo ile birebir aynı, 11.7:1).
  Önceden 11°'lik ton kayması vardı.
- **Yüksek kontrast modu** (`styles/high-contrast.css` + `html[data-contrast]`).
- **SVG ikon seti** (`components/icons.tsx`, 36 ikon) — emoji tamamen kaldırıldı.
- `styles/terminal.css` (612 satır) → 6 dosyaya bölündü: `global` · `high-contrast` ·
  `shell` · `message` · `markdown` · `agent` · `settings`.

### G2 — Kabuk

- **Titlebar** 32→40px: sol hizalı kimlik kümesi (logo + MacroCode + oturum), workspace
  rozeti, **görünür ad** gösteren model rozeti (pill), platforma özel pencere düğmeleri
  (macOS traffic light / Windows-Linux kare glif), klavye gezinmeli model dropdown'u.
- **Sidebar** 200→240px, **sürüklenebilir** (180–420px), 56px ikona daraltma,
  zaman grupları (Bugün/Dün/Bu Hafta/Daha Eski), ikonlu footer.
- **Durum çubuğu (YENİ, 24px)**: sağlayıcı + bağlantı noktası · model · bağlam ölçer
  (12.4k/1M) · ↑↓ token · maliyet · **bekleyen onay rozeti** (nabız) · onay modu ·
  workspace · MCP sayısı. Tüm veri zaten mevcuttu; yalnız gösterildi.
- **Karşılama ekranı**: boot `///` satırları kaldırıldı → logo + "MacroCode".

### G3 — Mesaj yüzeyi

- **3 kolonlu grid** (gutter 22px / içerik / meta 112px) — zaman damgaları hizalı.
- Kullanıcı mesajı **kart**; AI mesajı **sol ray** (akış "belge" hissi korunur).
- `sys/err/warn` artık log satırı; `/// · ✗ · !` işaretleri içerikten gutter'a taşındı
  (çift işaret sorunu giderildi).
- Reasoning `<details>` bloğu, 3 noktalı düşünüyor göstergesi, glow'lu streaming caret,
  hover'da kopyala eylemi.
- `MessageLine` `React.memo` ile sarmalandı → tamamlanmış mesajlar yeniden render edilmiyor.

### G4 — Markdown + sözdizimi renklendirme

- **Blok parser**: başlık, sırasız/sıralı + iç içe liste, görev listesi, alıntı, yatay
  çizgi, **GFM tablo**, kod bloğu, paragraf.
- **Satır içi**: `` `kod` `` `**kalın**` `*italik*` `~~çizili~~` `[bağlantı](url)` `![görsel](url)`.
- **XSS**: `innerHTML` hâlâ YOK. Bağlantılarda şema allowlist (`http/https/mailto`),
  görsellerde CSP uyumlu gömme (uzak URL → bağlantı).
- **Sözdizimi renklendirme** (`lib/highlight.ts`): 12 dil ailesi, **bağımlılıksız**
  (shiki/prism/hljs yok — proje kuralı). Kod bloğunda satır numarası + dil etiketi + kopyala.
- Test: `lib/markdown.test.ts` (25) + `lib/highlight.test.ts` (3) — **372 → 400 test**.

### G5 — Agent arayüzü

- **Yapılandırılmış araç olayları**: `ExtraLine.tool` alanı eklendi; `useAgent` çağrı +
  sonucu id ile eşleştirir → tek kartta birleşir. Kart: ikon, ad, argüman önizlemesi,
  süre, durum (✓/⟳/✗), genişletilebilir çıktı.
- **Onay kartı**: tam komut (kırpılmadan), uyarı kutusu, Onayla/Reddet (Enter/Esc),
  **"bu komutu her zaman çalıştır"** kutusu → `customAllowList`'e yazar (yalnız `exec`).
- **Görev paneli**: checklist kartı (aktif görev vurgulu, tamamlananlar üstü çizili).
- Status bar'da bekleyen onay rozeti + tıklayınca onay kartına kaydırma.

### G6 — Ayarlar modalı

- 640→**880px**; ikonlu sekme rayı + sekme arama; sticky alt bar
  ("kaydedilmemiş değişiklikler" + Vazgeç/Kaydet).
- **Sağlayıcılar**: 2 kolon kart ızgarası, durum noktası (bağlı/anahtar yok/bağlanamadı),
  maskeli anahtar + göz ikonu.
- **Modeller**: arama yapılabilir `ModelPicker` (`datalist` — 500+ modelde `<select>`
  kullanılamaz durumdaydı) + **tablo** (yetenek ikonları, bağlam, fiyat, aç/kapat anahtarı).
- **Sohbet**: Görünüm / Davranış / Araçlar grupları; yeni ayarlar: yüksek kontrast,
  arayüz fontu, saat biçimi.
- **Dil ve bölge** ve **Hakkında** sekmeleri artık yer tutucu değil (içerik dolu).

### G7 — Marka

- Logo `m<` monogramında **chevron büyütüldü** (`M430 165 L340 270 L430 375`) ve optik
  merkez düzeltildi (`translate(-4,-14)`) → küçük boyutta "mc" okunması giderildi.
- `macrocode-logo.svg` (kaynak), `public/macrocode-logo.svg` (favicon) yenilendi;
  `32x32.png`, `128x128.png`, `icon.ico` (16/32/48/256), `icon.icns` (ic07–ic10) yeniden üretildi.

### G8 — Erişilebilirlik

- **Input odak halkası** eklendi (eskiden `outline:none` → odak görünmezdi).
- Model dropdown'unda klavye navigasyonu (↑↓ Home End Enter Esc) + `aria-selected`.
- Tüm etkileşimli öğelerde görünür `:focus-visible` (2px accent).
- `prefers-reduced-motion` tüm yeni animasyonları kapatır.
- Yüksek kontrast modu + `prefers-contrast: more` desteği.

### Doğrulama

| Komut | Sonuç | Not |
|---|---|---|
| `npx tsc --noEmit` | ✅ 0 hata | |
| `npm run build` | ✅ yeşil | CSS 43.7 kB (gzip 8.3 kB) · JS 402 kB (gzip 124 kB) |
| `npm run test` | ✅ 58 dosya / 400 test | 372 → 400 (+28 markdown/highlight) |
| Tarayıcı (Playwright/Firefox) | ✅ hatasız | karşılama · sohbet · markdown · kod bloğu · tablo · görev listesi · tool kartı · onay kartı · ayarlar (6 sekme) · yüksek kontrast · 800px |

## 2026-10-19 — Faz 12: Koruma (git + MIT) + Motor (model, compaction, auto-read, ajan devamı)

> UI dosyalarına dokunmadan yapılan motor işi + eşzamanlı çalışma güvenlik ağı.
> Sürüm değişmedi (`0.1.0`).

- **A.1 Git güvenlik ağı:** `git init` (`main` dalı) + ilk commit `1cf588d` (168 dosya).
  11 fazın emeği artık **tek kopyada** değil; eşzamanlı değişiklikler `git diff` ile
  görünür, `git checkout`/`stash` ile geri alınabilir. Kimlik repo-yerel
  (`MacroCode Dev <dev@macrocode.local>` — global config'de kimlik yok).
- **A.2 `.gitignore`:** `*.log`, `.idea/`, `.vscode/`, `*.db*`, `tmp/`, `*.bak` eklendi.
- **A.3 `LICENSE`:** MIT eklendi (README "MIT" diyordu, dosya yoktu).
- **B.1 Model registry (istenen liste):** `docs/MODELS.md` sonundaki liste eklendi —
  Anthropic: `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-mythos-5`,
  `claude-opus-4-8`, `claude-opus-4-7` · OpenAI: `gpt-5.6{,-sol,-terra,-luna}` ·
  DeepSeek: `deepseek-flash` (V4.1), `deepseek-v4-flash`, `deepseek-v4-pro` ·
  Google: `gemini-2.5-flash-image` / `gemini-3-pro-image` / `gemini-3.1-flash-image`
  (Nano Banana / Pro / NB2). **Model id'leri ve limit/fiyat bilgileri models.dev
  gerçek verisinden alındı** (tahmin edilmedi). `claude-mythos-5` models.dev'de yok →
  yerleşik limitlerle eklendi. Nano Banana ailesi görsel çıktı üretir (🛠 kapalı, not düşüldü).
  **Çekirdek model: 27 → 43.**
- **B.2 Compaction kalıcılığı:** özet artık `Session.compaction` alanında saklanıyor →
  restart sonrası bağlam yeniden kurulmuyor, **tekrar özetleme (LLM çağrısı) yapılmıyor**.
  `compactionMemo.ts`: `memoToPersisted` / `memoFromPersisted` / `resolveMemo`.
  `store/session.ts`: `setCompaction` (+ `clearSession` özeti de düşürür).
  JSON yedekle birlikte taşınır (`normalizeSession`).
- **B.3 `auto-read` = gerçek salt-okunur mod:** önceden `manual` ile aynıydı (anlamsız);
  artık **yazma araçları ve `exec` reddedilir** (onay istenmez). O6 korunur.
- **B.4 `run_state` (Faz 1'in açık kalan %10'u):** onay beklerken agent durumu
  (`pending_approvals.run_state`) JSON olarak yazılır; boot'ta `restorePendingRuns()`
  ile geri yüklenir → bekleyen iş **kaldığı yerden sürülür** (eskiden "yeniden
  başlatılamadı"). `useAgent` içinde ortak olay işleyicisi (`makeRunEventHandler`)
  yeni tur ile geri yüklenen tur arasında paylaşıldı.
- **Doğrulama:** `npx tsc --noEmit` temiz · `npx vitest run` → **372 test / 56 dosya yeşil**
  (yeni: `compactionPersist.test.ts` 5, `agentRestore.test.ts` 4, policy auto-read testi) ·
  `cargo test --lib` 49 yeşil · `cargo fmt --check` + `clippy -D warnings` temiz ·
  `npm run build` temiz · `bash scripts/smoke-test.sh` BAŞARILI (uygulama boot + DB yazımı).

---

## 2026-10-19 — Faz 11: Prompt Cache (Maliyet)

> Token sayacı ve fiyatlandırma tarafı hazırdı, ancak **istek tarafı** eksikti:
> hiçbir yerde `cache_control` gönderilmiyordu → önbellek hiç dolmuyor,
> `cacheRead` her zaman 0 kalıyordu. Sürüm değişmedi (`0.1.0`).

- **Anthropic:** sistem bloğu + son kullanıcı/tool bloğu `cache_control: {type:'ephemeral'}`.
  - **Kritik koşul:** Anthropic, önek < 1024 token (Haiku 2048) ise `cache_control`'ı
    **reddeder** (400). Bu yüzden işaret yalnızca tahmin edilen önek eşik + 160 token
    güvenlik payını aştığında konur (`promptCache.ts` → `cacheableBySize`).
  - Rust proxy yolu ve fetch yolu aynı gövdeyi kullanır (`buildAnthropicMessages`).
- **OpenAI-uyumlu:** oturuma bağlı `prompt_cache_key` (FNV-1a hash, ≤ 64 karakter).
- **Ayar:** `cachePrompts` (varsayılan **açık**) — ⚙ ayarlar → Sohbet. Kapalıyken
  sağlayıcı tarafında hiçbir önek saklanmaz (gizlilik tercihi).
- **Görünürlük:** `/tokens` → `önbellek: 12.4k okuma · 3.1k yazma` (önbelleğin
  gerçekten çalıştığı görülür).
- **Değerlendirilip yapılmayanlar (gerekçeli):** `tauri::test` mock testi (ACL mock
  runtime'da uygulanmıyor; gerçek smoke testi daha güçlü kanıt) · `proxy_fetch` host
  allowlist'i (WebView zaten güven sınırı; metadata reddi asıl riski kapatıyor).
- **Doğrulama:** `npx tsc --noEmit` temiz · `npx vitest run` → **347 test / 53 dosya yeşil**
  (yeni: `promptCache.test.ts` 10 + `promptCacheRequest.test.ts` 5 — istek gövdesi uçtan uca)
  · `cargo test --lib` 49 yeşil · `clippy -D warnings` ve `cargo fmt` temiz ·
  `bash scripts/smoke-test.sh` BAŞARILI.

---

## 2026-10-19 — Faz 10: Sertleştirme (O2/D1/D2 + CI + Gözlemlenebilirlik)

> 2026-10-18 güvenlik denetim raporundaki açıklar kapatıldı; CI sıkılaştırıldı;
> log kanalı eklendi. Sürüm değişmedi (`0.1.0`).

- **O2 — `proxy_fetch` SSRF serbestliği (kapandı):** istek yüzeyi daraltıldı —
  yalnızca http/https; URL'de kimlik bilgisi reddi; **link-local/metadata IP'leri
  engellendi** (169.254.0.0/16, fe80::/10, 0.0.0.0/8, 100.64.0.0/10 — alan adı
  **çözülerek** denetleniyor; LAN `192.168.x`/`10.x` ve `localhost` **serbest**,
  Ollama'nın meşru kullanımı korunuyor); metot kısıtı (GET/POST/PUT/PATCH/DELETE/
  HEAD/OPTIONS); başlık kısıtı (`host`, `connection`, `transfer-encoding`,
  `content-length`, `upgrade`, `proxy-authorization` gönderilmiyor); **120 sn timeout**
  (istek sonsuza kadar asılı kalabiliyordu); **32 MB yanıt sınırı** (sonsuz akış koruması).
- **D1 — `keys.json` izinleri (kapandı):** `set_api_key`/`delete_api_key` sonrası dosya
  Unix'te `0600` → diğer yerel kullanıcılar anahtarları okuyamaz.
- **D2 (3 bulgu) — tutarlılık:**
  - *Stale `/apply`*: yama üretildiği workspace kökünü taşıyor (`PendingPatch.root`);
    `/root` değişmişse yama **reddediliyor** (eskiden aynı göreli yol yeni kökte
    başka bir dosyayı ezebiliyordu).
  - *Rust `read_file` uzantı blokajı*: `.pem/.key/.p12/.pfx/.db/.sqlite` artık **tüm**
    fs araçlarında kapalı (`resolve_rooted`), yalnızca walk/glob'da değil.
  - *Blok listesi kopyaları*: `policy.ts` / `fs.rs` / `context.ts` → **tek kaynak**
    `src/lib/engine/blocks.json` (TS import, Rust `include_str!`); sözleşme testi
    ikisinin de aynı dosyayı kullandığını doğrular.
- **CI sıkılaştırma:** `cargo clippy --lib -- -D warnings` eklendi — **15 mevcut clippy
  uyarısı** temizlendi (10'u `cargo clippy --fix`, 5'i elle: doc listesi girintisi,
  `&PathBuf`→`&Path`, özyinelemede kullanılmayan parametre, boş satır).
- **Gerçek runtime testi:** `scripts/smoke-test.sh` — uygulamayı derler, **veritabanını
  yedekler** (veri yok edilmez), uygulamayı çalıştırır, **veritabanına yazıldığını**
  doğrular (3 tablo + ≥2 satır), yedeği geri yükler. CI'da ayrı `smoke` işi
  (xvfb + Tauri sistem bağımlılıkları).
- **Gözlemlenebilirlik:** yeni `src/lib/logger.ts` — halka arabellek (son 200 kayıt) +
  WebView konsoluna yazma + **redaksiyon** (anahtar/token/JWT alan ve değer kalıpları
  loglanmaz). Bağlandığı yerler: `stream.start/done/error`, `agent.run.start/done/error`,
  `db.open.failed`. Terminalde `/log [n]` komutu.
- **Doğrulama:** `npx tsc --noEmit` temiz · `npx vitest run` → **347 test / 53 dosya yeşil**
  (yeni: `logger.test.ts`, `patchRoot.test.ts`, `tauri-config.test.ts` blok-kaynak testleri) ·
  `cargo test --lib` → **49 test yeşil** (yeni: proxy O2, fs D2b/D2c) ·
  `cargo clippy -- -D warnings` temiz · `cargo fmt --check` temiz ·
  `bash scripts/smoke-test.sh` → BAŞARILI (uygulama boot etti, DB'ye 2 satır yazıldı).

---

## 2026-10-19 — Faz 9: Bağlam (Repo Haritası + Kalıcı Hafıza) + Risk Kapama

> Agent bir workspace'e girerken projenin ne olduğunu bilmiyordu; her şeyi tool
> çağrılarıyla keşfetmek zorundaydı (`buildContext`/`prioritizeFiles` yazılmış ama
> bağlanmamıştı). Sürüm değişmedi (`0.1.0`).

## Risk kapama (Faz 8'den devralan konular)

1. **CI kırmızıydı — giderildi.** `cargo fmt --check` 6 ihlal veriyordu: 5'i
   `fs.rs`'te (K1 güvenlik düzeltmesinden, bu oturumdan **önce**) + 1'i `exec.rs`'te
   (bu oturumda eklenen test helper'ı). `cargo fmt` ile 6'sı da düzeltildi.
   → CI adımları (`tsc` + `vitest` + `build` + `cargo fmt --check` + `cargo test`) artık yeşil.
2. **B2 — `auto-edit` modunda yazma yapılmıyordu — giderildi.** `propose_patch`/`edit_file`
   yalnızca pending patch üretir; asıl yazma `applyPendingPatch` ile **sadece onay
   akışında** (`resolve()`) oluyordu. `/approval` ile `auto-edit` erişilebilir olunca
   agent "yazdım" diyordu ama dosya değişmiyordu. Artık onaysız yazma yolunda üretilen
   pending patch hemen uygulanıyor. Koruma: `src/lib/engine/autoEdit.test.ts`.
3. **B3 — compaction hafızası kesimi id tabanlı.** Zaman damgası kesiminde "aynı
   milisaniyede oluşan mesaj" sonraki turda kaybolabiliyordu → `coveredIds` ile kesim.

## Faz 9 — Bağlam

- **Rust (yeni komutlar):** `list_tree(root, max)` → workspace'teki dosyaların **göreli**
  yolları (mevcut `walk` filtresi: bloklu dizinler/secret/256KB üstü elenir) ·
  `memory_read(root)` / `memory_append(root, text)` → `.macrocode/context.md` kalıcı not
  (yol sabit → traversal yok; 64KB sınır).
- **TS (yeni modül):** `engine/repoContext.ts` → `buildRepoContext()`:
  - **harita**: `prioritizeFiles` sırasıyla dosya listesi, modelin context penceresine
    göre ölçekli (pencere × %2, tavan 8k karakter),
  - **anahtar dosyalar**: `AGENTS.md` / `CLAUDE.md` / `README.md` (başına 2k karakter),
  - **kalıcı notlar**: son 4k karakter.
  Önbellek: aynı workspace + aynı dosya imzası → yeniden hazırlanmaz.
- **Bağlanma:** `useAgent` system prompt'una `[proje]` / `[proje:<dosya>]` / `[notlar]`
  blokları ekleniyor — agent ilk turda README/AGENTS.md'yi biliyor.
- **Komutlar:** `/note <not>` (kalıcı not ekler) · `/context` (agent'ın bildiklerini gösterir).
- **Doğrulama:** `npx tsc --noEmit` temiz · `npx vitest run` → **318 test / 49 dosya yeşil**
  (yeni: `autoEdit.test.ts`, `repoContext.test.ts`, `compactionMemo.test.ts` genişletildi) ·
  `cargo test --lib` → **44 test yeşil** (2 yeni: `list_tree`) · `npm run build` temiz ·
  `cargo fmt --check` temiz.
4. **Boot sonrası DB senkronizasyonu yoktu — giderildi.** Yazma yalnızca *state
   değişince* tetiklenen debounce persister ile yapılıyor; boot'ta state değişmediği
   için DB boş/eski kalıyordu → "SQLite > localStorage" önceliği bir kullanıcı mesajına
   kadar uygulanmıyordu. Artık boot sonrası mevcut durum bir kez DB'ye yansıtılıyor.
- **Gerçek uygulama boot testi (kesin kanıt):** `sessions.db` **silinerek** uygulama
  14 sn çalıştırıldı (panic/hata yok) → `~/.config/com.macrocode.app/sessions.db`
  içinde **2 satır** oluştu (session + meta). Bu, Faz 7 A1'in `sql:allow-execute`
  düzeltmesinin gerçek runtime'da çalıştığını kanıtlar (eskiden `sessions`/`audit_log`
  hiç yazılmıyordu).

---

## 2026-10-19 — Faz 7 Denetimi + Faz 8: Kalıntıların Bağlanması (L1–L8)

> Faz 7'de yazılan kod denetimden geçirildi; denetimde **iki gerçek hata** bulundu
> ve düzeltildi. Ardından yol haritasındaki "ölü kod / işlevsiz" kalıntılar bağlandı.
> Sürüm değişmedi (`0.1.0`).

## Denetimde bulunan hatalar (Faz 7 kodu)

1. **Agent isteğinde kullanıcı mesajı iki kez gönderiliyordu.** `useAgent` hem
   oturum geçmişinden (kullanıcı mesajı zaten eklenmişti) hem de `historyWithUser`
   ile aynı mesajı ikinci kez ekliyordu → model her istekte soruyu iki kez görüyordu.
   - **Düzeltme:** geçmiş kurulumu saf fonksiyona taşındı (`engine/agent.ts` →
     `buildAgentHistory(messages, assistantId)`), kullanıcı mesajı ikinci kez eklenmiyor.
   - **Koruma:** `src/lib/engine/agentHistory.test.ts` (yinelenen mesaj + tool çifti + ts/id).
2. **`rustFetch` abort sinyalini yok sayıyordu.** Proxy üzerindeki isteklerde çağıranın
   timeout'u işlemiyordu (MCP 15 sn sınırı dahil) → istek Rust tarafında asılı kalabiliyordu.
   - **Düzeltme:** `init.signal` → `proxy_abort` bağlandı, kuyruk AbortError ile kapanıyor.
   - **Koruma:** `src/lib/providers/rustFetchAbort.test.ts` (Tauri invoke mock'lu).
3. **Bağlantı her DB çağrısında yeniden açılıyordu** (agent döngüsünde her tool kararı
   `appendAudit` çağırıyor → her seferinde `Database.load` + 3 CREATE TABLE).
   - **Düzeltme:** `db.ts` bağlantı önbelleği; hata halinde önbellek düşürülür (yeniden denenir).
   - `appendAudit`/`readAuditLog` hataları artık `sqlError()` ile görünür.

## Faz 8 — Tamamlanmamış faz kalıntıları (L1–L8)

| # | İş | Yapılan |
|---|---|---|
| L1 | `subagent` aracı | 11. çekirdek tool; salt-okunur alt-agent (kendi bütçesi, `SUBAGENT_BLOCKED_TOOLS` ile yazma/özyineleme kapalı); alt-ajanın metni ana akışa ikinci kez akmıyor |
| L2 | `plan` → `todo` | Plan adımları `plan-N` görev id'leriyle türetiliyor (`deriveTodoState` + `planStepIds`); agent `todo complete plan-N` ile işaretliyor |
| L3 | `customAllowList` → Rust | `exec_cmd` `extra_allow` tablosunu kabul ediyor; TS + Rust tabloları **birleşik (OR)**; `rm` kuralları gevşemiyor. Özellik artık uçtan uca çalışıyor |
| L4 | Terminal'de görev listesi | Mesajların sonunda `[ ]`/`[x]` görev paneli + ilerleme sayacı |
| L5 | Skill'ler modele ulaşıyor | `skillsPrompt(listSkills()...)` agent system prompt'una ekleniyor |
| L6 | Araç çıktısı görünürlüğü | Başarılı araç çıktısı da terminale düşüyor (`▸ read_file: …`) |
| L7 | Onay modu erişilebilir | `/approval manual\|auto-read\|auto-edit` komutu; `auto-edit` seçilince uyarı satırı; `/root` çıktısında mod |
| L8 | Duplikasyon silindi | Legacy `runAgent` (~200 satır) kaldırıldı; tek döngü: `createAgentRun`. Alt-agent de buna geçti; testler `createAgentRun(...).step()`'e çevrildi |

- **Güvenlik notu (L3):** kullanıcı allowlist'i iki katmanlı kapının (TS karar + Rust savunma)
  **ikisine de** geçiyor; `rm` için özel kurallar (yalnız `-i`) hiçbir tabloda gevşemiyor.
- **Güvenlik notu (L7):** `auto-edit` modunda yazma onaysız; bloklu dizinler
  (`.git`, `node_modules`, …) Rust `resolve_rooted` + TS `isPathSafe` ile kapalı (Y1 düzeltmesi
  sonrası güvenli). `exec` her modda onaylı.
- **Doğrulama:** `npx tsc --noEmit` temiz · `npx vitest run` → **308 test / 47 dosya yeşil**
  (yeni: `agentHistory.test.ts`, `rustFetchAbort.test.ts`, `subagentTool.test.ts`,
  `todoPlan.test.ts` + policy/toolspec güncellemeleri) · `cargo test --lib` → **42 test yeşil**
  (3 yeni: kullanıcı allowlist'i) · `npm run build` (tsc + vite) temiz.

---

## 2026-10-19 — Faz 7: Doğruluk — Çalışmayan Yolların Düzeltilmesi (A1–A5)

> Yol haritasındaki ilk 6 fazın kodu büyük ölçüde yazılmıştı ama bir kısmı
> **fiilen çalışmıyordu**. Bu faz yeni özellik eklemedi; "yazılmış" ile
> "çalışıyor" arasındaki boşluğu kapattı. Sürüm değişmedi (`0.1.0`).

- **A1 (KRİTİK) — `sql:allow-execute` capability'si:**
  - **Bulgu:** `capabilities/default.json` yalnızca `sql:default` veriyordu; plugin'in
    `default` paketi `allow-execute`'u içermiyor. `db.execute()` sessizce başarısız
    oluyordu → `audit_log` hiç dolmuyordu, `pending_approvals` DB'ye yazılmıyordu,
    session'lar SQLite'a yazılmıyordu (kalıcılık localStorage'da kalıyordu).
  - **Düzeltme:** capability'ye `sql:allow-execute` eklendi. `db.ts` → `sqlError()`
    (hata artık yutulmuyor) + `openSql()` (paylaşılan bağlantı: db.ts + engine/approvals.ts).
    `App.tsx` boot'ta `! session veritabanı açılamadı: …` uyarısı gösteriyor.
  - **Koruma:** `src/lib/tauri-config.test.ts` (capability izinleri + Rust migration sözleşmesi).
- **A2 (KRİTİK) — Compaction özeti provider'a ulaşmıyordu:**
  - **Bulgu:** Özet `role: 'system'` üretiliyordu; Anthropic'in `buildAnthropicMessages`
    fonksiyonunda system dalı yoktu → özet sessizce düşüyordu (compaction fiilen ölüydü).
    Ollama'da system rolü mesaj dizisine karışıyordu.
  - **Düzeltme:** `common.ts` → `systemTextOf()` / `withoutSystemMessages()`; Anthropic,
    OpenAI-uyumlu ve Ollama sistem metnini istek gövdesinin `system` alanına taşıyor.
  - **Ek (Faz 2'yi canlı hale getirme):** `useAgent` geçmiş kesmesi `-40` → `-200`
    (sabit kesme bütçeyi aşmadığı için otomatik compaction hiç tetiklenmiyordu);
    `engine/compactionMemo.ts` ile özet hafızası (her tur yeniden özetleme yapılmıyor).
- **A3 — Agent cevabı parçalanıyordu:** Tool sonucu kalıcı katmana `role: 'system'`
  mesajı olarak yazıldığı için sonraki turdaki metin yeni bir assistant mesajına
  gidiyordu. `store/session.ts` → `appendToMessage(sessionId, messageId, delta)`;
  `useAgent` tüm yazımlarda `assistantId`'yi hedefliyor.
- **A4 — Çok turlu maliyet eksik hesaplanıyordu:** `mergeUsage` (max) turlar arasında da
  kullanılıyordu. `common.ts` → `sumUsage`; tur içi `mergeUsage`, tur arası `sumUsage`.
- **A5 — Uzak MCP sunucuları CSP'e takılıyordu:** `mcp/transports/http.ts` artık
  `fetchFor` (Rust `proxy_fetch` köprüsü) kullanıyor — uzak origin'ler için
  `connect-src` genişletmeye gerek kalmıyor.
- **Dokümantasyon:** `AI Çekirdek Yol Haritası.md` → Bölüm J sürüm politikası
  (sürüm sabit `0.1.0`), Bölüm K (Faz 7 kaydı), Bölüm L/M/N (Faz 8/9/10 planı).
  `ARCHITECTURE.md` → capability, provider sistem rolü kuralı, akış kontrolü ve kısıtlar güncellendi.
- **Doğrulama:** `npx tsc --noEmit` temiz · `npx vitest run` → **289 test / 43 dosya yeşil**
  (yeni: `tauri-config.test.ts`, `usage.test.ts`, `systemMessages.test.ts`,
  `compactionMemo.test.ts`, `session.test.ts` A3 testleri, `http.test.ts` A5 testleri) ·
  `npm run build` (tsc + vite) temiz · `cargo check` temiz (capability geçerli) ·
  `cargo test --lib` 39 test yeşil.
- **Not:** Bu faz sırasında kod tabanında eşzamanlı başka bir oturumun değişiklikleri
  (models.dev kataloğu, prompt-cache token takibi) görüldü; çakışma olmaması için
  her dosya değiştirilmeden önce yeniden okundu.

---

## 2026-10-19 — Proje Adı Değişikliği: MONOCODE → MacroCode

> Kullanıcı talebi: uygulamanın adı kod tabanının her yerinde `MacroCode` olarak değiştirildi.

- **Kapsam:** marka + kalıcı veri yolları + bundle id dahil (kullanıcı onayıyla tam kapsam).
- **Marka/etiket:** `index.html` başlığı ve favicon, `package.json` (`name`, `productName`,
  `description`), `package-lock.json`, `Cargo.toml` (`name`, `lib.name`, `description`,
  `authors`), `Cargo.lock`, `tauri.conf.json` (`productName`, `identifier`, pencere `title`),
  `main.rs` (`macrocode_lib::run()`), UI metinleri (`Titlebar`, `AboutTab`, `/help`,
  oturum dışa aktarım başlıkları), MCP `clientInfo.name`, OpenRouter `X-Title`.
- **Marka URL:** `https://monocode.app` → `https://macrocode.app` (OpenRouter referer).
- **Kalıcı veri yolları:**
  - zustand persist anahtarları: `monocode-sessions` → `macrocode-sessions`,
    `monocode-settings` → `macrocode-settings`, `monocode-workspace` → `macrocode-workspace`,
    `monocode-approvals` → `macrocode-approvals`. *(Eski anahtardaki verilere erişim kalmaz;
    yeni kurulum gibi başlar.)*
  - gizli çalışma dizini: `.monocode` → `.macrocode` (`fs.rs` ignore listesi + backup yolu,
    `policy.ts` `BLOCKED_DIRS`, `context.ts` filtre). *(Eski `.monocode/backups` yedekleri
    yürürlükteki `.macrocode` güvenlik duvarının dışında sayılır.)*
  - bundle identifier: `com.monocode.app` → `com.macrocode.app`.
- **Dosya adları:** logo kaynakları `src-tauri/icons/macrocode-logo.svg`,
  `public/macrocode-logo.svg` yeniden adlandırıldı; dışa aktarım dosya adları
  `macrocode-session-*.{md,json}`.
- **Doğrulama:** `npm test` → 215/215 yeşil; `npm run build` (tsc + vite) temiz, `dist/`
  yeniden üretildi (eski `monocode-logo.svg` artığı temizlendi); `cargo clean` sonrası
  `cargo test --lib` yeniden derlemeyle yeşil.
- **Not:** `src-tauri/target` içindeki eski derleme artıkları klasörün eski adını
  (`MonoCode`) taşıyan bayat yollar içeriyordu; `cargo clean` ile temizlendi.

---

## 2026-10-18 — Faz 1: Güvenlik Denetimi K1 → `undo_patch` Manifest Doğrulaması

> Kaynak: `docs/Güvenlik Denetim Raporu.md` K1 (Kritik). 7 fazlık planın 1/7'si.

- **Kök neden:** `undo_patch`, `.macrocode/backups/manifest.json` içindeki `backup_file`
  alanını doğrulamadan `backup_dir.join(...)` ile çözüyordu. Manifest workspace içinde
  yaşar (3. taraf repo ile dağıtılabilir); `PathBuf::join` mutlak tarafta tam yolu aldığı
  için `backup_file: "/home/kurban/.ssh/id_rsa"` yazan bir manifest → özel anahtar hedefe
  kopyalanıp **gerçek dosya silinebilirdi** (`..` varyantı dahil).
- **Fix (`fs.rs`):** iki yeni katman —
  - `safe_backup_name()`: tek bileşenli ad zorunlu (`/`, `\`, `..`, mutlak yol ve
    `[A-Za-z0-9._-]` dışı karakter reddi).
  - `resolve_backup_inside()`: `backup_dir` + dosyanın canonical hali workspace altında
    olmalı (adı güvenli symlink'in dışarıyı göstermesi de engellenir).
  - `undo_patch` artık `backup_dir.join(&entry.backup_file)` yerine bu doğrulamalı çözümleyiciyi kullanır.
- **Regresyon testleri (3 yeni):** `kotu_niyetli_manifest_red` (mutlak yol / `../` /
  dizin ayracı / geçersiz karakter — hedef değişmez, kaynak silinmez),
  `kotu_niyetli_symlink_yedek_red` (güvenli ad ama dışa symlink),
  `safe_backup_name_kontrolleri` (saf birim testi).
- **Doğrulama:** `cargo test --lib commands::fs` → 18/18 yeşil (eski testler de dahil;
  `apply_patch_ve_undo_calisir` normal akışın bozulmadığını kanıtlar).
- **Sonraki:** Faz 2 (Y1) — bloklu dizin zorlaması (`resolve_rooted` bileşen bazlı +
  `policy.isPathSafe`).

---

## 2026-10-18 — Faz 2: Güvenlik Denetimi Y1 → Bloklu Dizin Zorlaması

> Kaynak: `docs/Güvenlik Denetim Raporu.md` Y1 (Yüksek). 7 fazlık planın 2/7'si.

- **Kök neden:** `BLOCKED_DIRS` (`.git`, `node_modules`, `dist`, `target`, `.tauri`,
  `coverage`, `.vite`, `.macrocode`) yalnızca `list_dir`/`walk`/`glob` çocuk filtrelerinde
  çalışıyordu; `resolve_rooted`'e dizin kontrolü yoktu → `read_file(".git/config")`
  otomatik onaylıydı (token sızıntısı), `.git/**` yazılabilirdi. TS `policy.ts`'te
  bloklu dizin listesi hiç yoktu (`isPathSafe` yalnız `..`/mutlak/secret dosya bakıyordu).
- **Fix (iki katman):**
  - **Rust `fs.rs` → `resolve_rooted`:** path'in **her bileşeni** `is_blocked_dir`'dan
    geçirilir → `read_file`/`list_dir`/`grep_files`/`glob_files`/`write_file`/`apply_patch`
    hepsi aynı kapıdan geçer (`.git/config` okumak da `.git/hooks/pre-commit`'e yazmak da reddedilir).
    Mevcut `walk`/`glob` filtreleri savunma derinliği olarak duruyor.
  - **TS `policy.ts`:** `BLOCKED_DIRS` seti (Rust ile senkron) + `isBlockedDir()` yardımcı
    + `isPathSafe` içine bileşen bazlı ret → `read_file`/`list_dir`/`grep`/`glob` (autoApproved
    yolu) ve `write_file`/`edit_file`/`propose_patch` (auto-edit dahil) reddi.
- **Regresyon testleri:** Rust `bloklu_dizin_tum_araclar_reddedilir` +
  `git_ici_okuma_ve_yazma_reddedilir` (`.git/config` read → "yasaklı dizin", grep/list/
  apply_patch/write_file hepsi err; normal yol etkilenmez). TS `policy.test.ts`
  "Y1 (Faz 2)" bloğu (`isPathSafe` + tüm decideTool yolları, auto-edit modu dahil).
- **Doğrulama:** `cargo test --lib commands::fs` 20/20 · `npm test` 34 dosya / 207 test
  yeşil (3 yeni) · `tsc --noEmit` 0 hata.
- **Sonraki:** Faz 3 (Y2) — exec onay akışının `approved` bayrağıyla yeniden kurulması.

---

## 2026-10-18 — Faz 3: Güvenlik Denetimi Y2 → Exec Onay Akışı Yeniden Kuruldu

> Kaynak: `docs/Güvenlik Denetim Raporu.md` Y2 (Yüksek). 7 fazlık planın 3/7'si.

- **Kök neden:** `decideTool('exec', …)` her modda `autoApproved: false` döner (O6 bilinçli
  karar); `toolExec` ise `if (!d.autoApproved) throw` yapıyordu ve `resolve` onaylayınca
  aynı `defaultRunTool → toolExec` yolunu **aynı `mode`** ile çağırıyordu → onaylansa da
  komut asla çalışmaz, "onay gerekli" hatası alırdı. `/exec` hatası da HELP'te olmayan
  bir komuta yönleniyordu.
- **Fix (3 dosya):**
  - `tools/shell.ts → toolExec`: yeni `opts?: { approved?: boolean; extraAllow?: Record<string, string[][]> }`.
    Guard artık `if (!d.autoApproved && !opts?.approved) throw` — yani exec'i çalıştırabilmenin
    **tek yolu** `approved: true` alan çağrıdır. `decideTool` çağrısına `extraAllow` geçirildi
    (özel allowlist ilk kez bu katmanda işlemeye başladı). Hata mesajı `/exec` → `/apply`.
  - `agent.ts → defaultRunTool`: `opts` parametresi eklendi; `exec` dalında `toolExec`'e
    `approved` + `extraAllow` aktarılıyor. 5 çağrı noktasının 4'ü yalnız `extraAllow`
    geçer; **`approved: true` yalnız `resolve`'ta** (tek nokta, koddan sabitlendi).
  - `extraAllow` artık tüm `defaultRunTool` çağrılarına taşınıyor (önceki 5 çağrı
    noktasının hiçbirinde geçilmiyordu → Faz 6 özel allowlisti ölüydü).
- **Regresyon testleri (7 yeni):** `shell.test.ts` (onaysız ret / `approved` guard'ı
  geçer / allowlist dışı `approved` ile bile ret / `extraAllow` iki yönlü) +
  `agent.test.ts` (resolve(approved:true) → gerçek `toolExec` zinciri "onay gerekli"
  hatası VERMEZ; resolve(approved:false) → "reddetti" ile devam).
- **Doğrulama:** `npm test` 35 dosya / 213 test yeşil (7 yeni) · `tsc --noEmit` 0 hata ·
  `cargo test --lib commands::fs` 20/20 (Rust tarafı etkilenmedi).
- **Not:** `runToolImpl` enjeksiyonu (test/mock) `approved` bayrağını görmez — bu bilinçli;
  mock'lar Rust'a gitmez. Gerçek Tauri'de `resolve → toolExec → exec_cmd` uçtan uca
  entegrasyon testi Faz 7'de (D2 kapsamı) yapılacak.
- **Sonraki:** Faz 4 (O1) — onay ekranında kırpmasız tam komut + serbest-argüman
  komutlarının daraltılması.

---

## 2026-10-18 — Faz 4: Güvenlik Denetimi O1 → Exec Dosya Jail'i + Onay Ekranı

> Kaynak: `docs/Güvenlik Denetim Raporu.md` O1 (Orta → Y2 sonrası Yüksek). 7 fazlık planın 4/7'si.

- **Kök neden:** `check_cmd` yalnız `\n`/`\0` reddediyordu → `cat /etc/passwd`,
  `find /`, `cat .env` allowlist'ten geçiyordu (read_file'daki `.env`/secret koruması
  exec ile deliniyordu). Onay ekranı `JSON.stringify(...).slice(0, 120)` ile uzun
  argümanları **görünmeden** onaylanabilir kılıyordu.
- **Fix:**
  - **Rust `exec.rs`:** `FILE_ARG_CMDS` (cat/head/tail/wc/find/rg/ls/touch/mkdir/prettier)
    + `rm` → `check_file_arg()`: mutlak yol, `..` segmenti, `BLOCKED_DIRS`/`BLOCKED_FILES`
    (fs.rs'ten `pub(crate)` paylaşıldı), `.env.` prefix ve `[pem|key|p12|pfx|db|sqlite]`
    uzantısı argümanlarda reddedilir. Bayraklar (`-la`) ve desenler (`*.ts`) etkilenmez.
    Kontrol boş liste branch'inden ÖNCE çalışır (cat/find serbest-argüman olduğu için
    oradan kaçamaz).
  - **TS `policy.ts`:** `FILE_ARG_CMDS` + `isFileArgSafe` + `execFileArgViolation`
    (Rust ile senkron) → `decideTool('exec')` içinde çift savunma. `execApprovalWarning`:
    npm run/test, pip install, cargo build/run/test, git commit/push/add/stash, go test,
    pytest, prettier/eslint → onay satırında `⚠` uyarısı (bileşen `--col-warn`).
  - **UI `Terminal.tsx`:** exec onayı artık `exec · cmd arg1 arg2` şeklinde **kırpılmadan**
    (diğer araç türlerinde kırpmasız JSON, eski 120 sınırı kalktı) + uyarı satırı.
  - **Dokümantasyon (O1-d):** `allowlist.json` `_note`'una "allowlist 'hangi komut'u
    kısıtlar, 'ne yaptığını' değil" kararı yazıldı.
- **Regresyon testleri (3 yeni):** Rust `o1_dosya_argumani_jail` (16 assertion) +
  `o1_rm_jail`; TS "dosya argümanı jaili decideTool'da" (17 assertion) + "onay uyarısı" (8).
- **Doğrulama:** `cargo test --lib` 39/39 (3 yeni) · `npm test` 35 dosya / 215 test yeşil
  (2 yeni) · `tsc --noEmit` 0 hata.
- **Sonraki:** Faz 5 (O3) — `sql:allow-execute` capability + denetim kaydı kurtarma.

---

## 2026-10-16 — Faz 6: Güvenlik & İzin UX → `v0.1.0` (sürüm sabit)

- **Allowlist uzantısı:** `policy.ts` (`parseCustomLine`/`parseCustomAllowList`, `rm` satırı geçersiz) + `settings.customAllowList` + Sohbet sekmesi textarea; `decideTool`/`isExecAllowed` `extraAllow` parametreli (saf, drift yok); exec hep onaylı (O6).
- **Denetim logu:** `audit_log` tablosu (frontend DDL + Rust migration v3) + `db.ts` (`appendAudit`/`readAuditLog`, ateşle-bırak) + agent karar noktalarında `denied/allowed-auto/allowed-approval/approved/rejected` + `/audit [n]` + `auditEnabled` ayarı.
- **Jail rötuşları:** Windows ayırıcı dönüşümü, `.git` içi symlink baskını, glob üst-dizin desenleri (Rust testleriyle sabitlendi; kod değişmedi).
- **CI + dokümantasyon:** `.github/workflows/ci.yml` (tsc + vitest + build + fmt + cargo test) + `CONTRIBUTING.md` (faz kapanış kuralı + allowlist prosedürü).
- **Doğrulama:** `tsc` 0 hata · `npm test` 31 dosya / 164 test yeşil · `npm run build` ok · `cargo test --lib` 29/29 (3 yeni) · `cargo fmt` temiz.
- **Sürüm:** sabit `0.1.0` (kullanıcı isteği; haritadaki `0.7` uygulanmadı).

---

## 2026-10-16 — Faz 5: MCP + Sub-agent/Plan → `v0.1.0` (sürüm sabit)

- **Protokol/istemci:** `mcp/protocol.ts` (JSON-RPC 2.0 + `McpError`, 4KB kırpma) + `client.ts` (initialize/list/call, timeout) + `transports/http.ts` (JSON/SSE, id eşleşmeli) + `transports/stdio.ts` (Rust köprüsü, bildirim satırı atlar).
- **Registry/havuz:** `mcp:<sunucu>:<araç>` namespace (`makeMcpServerId` TR slug); policy hep onaylı; `pool.ts` (5 dk cache, config değişiminde yeniden bağlanma, düşeni atma + havuzdan düşürme).
- **Rust:** `mcp_spawn/write/read/kill` (tokio subprocess, `kill_on_drop`, cwd jail); `McpState` + pencere-kapanış hook'u; shell plugin yok.
- **Ayarlar:** MCP sekmesi (transport, komut/URL, keşif, izinler, env); env değerleri keystore `custom_<id>` blob'unda, metadata persist'te.
- **Agent:** `extraTools` (MCP registry) + `disallowTools` koruması; `plan` tool (auto, terminalde listelenir); `runSubagent` (salt-okunur, kendi bütçesi, max 4 tur).
- **Doğrulama:** `tsc` 0 hata · `npm test` 30 dosya / 160 test yeşil · `npm run build` ok · `cargo test --lib` 26/26 · `cargo fmt` temiz.
- **Sürüm:** sabit `0.1.0` (kullanıcı isteği; haritadaki `0.6` uygulanmadı).
- **Açık:** gerçek MCP sunucusuyla uçtan uca duman testi; HTTP origin için CSP derleme-anı genişletmesi (README'de); koordinatörün alt-agentı otomatik çağırması (takip).

---

## 2026-10-16 — Faz 4: Provider Sertleştirme → `v0.1.0` (sürüm sabit)

- **Reasoning sözleşmesi:** `StreamChunk.reasoning/thinking` + `ThinkingBlock` + `TokenUsage.reasoning` (output'a dahil değil, maliyete dahil); `mergeUsage` tek birleştirme noktası. DeepSeek `reasoning_content`, o-series `reasoning_tokens`, Anthropic `thinking_delta`/`signature_delta` akıştan çekilir.
- **Tek Rust yolu (K7):** `buildAnthropicMessages` TS'de saf kurulur (tool_result birleştirme + thinking imzalı taşıma + vision base64); Rust saf proxy (`tools`/`thinking`/`temperature`/`top_p` geçirir, `StreamAcc` ile tool_use + imzalı thinking biriktirir). Tauri'de tüm Anthropic istekleri Rust'tan; invoke hatasında fetch fallback korunur.
- **UI:** `Message.reasoning/thinking` kalıcı + export dahil; `MessageLine` `⠿ düşünüyor` dim bloğu + `showThinking` ayarı (Sohbet sekmesi).
- **Cost:** `costForTokens` (reasoning output fiyatından) + `sessionCost` toplam; `/tokens` reasoning satırı + toplam maliyet (reasoning dahil); agent `done` usage'ı son mesaja yazılır.
- **Doğrulama:** `tsc` 0 hata · `npm test` 23 dosya / 138 test yeşil (yeni: reasoning 4 + pricing 2 + agent 1 + session 1 + commands 1) · `npm run build` ok · `cargo test --lib` 24/24 (3 yeni) · `cargo fmt` temiz.
- **Sürüm:** sabit `0.1.0` (kullanıcı isteği; haritadaki `0.5` uygulanmadı).
- **Açık:** gerçek Anthropic anahtarıyla thinking+tool duman testi; `tauri build` (webkit yok).

---

## 2026-10-15 — Faz 3: Tool Seti Genişlemesi → `v0.1.0` (sürüm sabit)

- **Allowlist tek kaynak:** `lib/engine/allowlist.json` (TS import + Rust `include_str!`); geniş tablo (git add/commit/stash/show/push, cargo clippy, pytest/tsc/go test/find/rg/cat/head/tail/wc/which/mkdir/touch, eslint/prettier, pip install, `rm` yalnız `-i`). `rm -i -rf`/`-f`/`--force` reddedilir (TS+Rust aynı kural).
- **Rust:** `grep_files` regex modu (bozuk regex Türkçe hata), `read_file` offset (1-tabanlı sayfalama), `glob_files` (ignore+secret filtreli, jail), `write_file` O_EXCL (`dosya zaten var · edit_file kullan`). `regex` + `glob` crate. `glob_files`/`write_file` invoke kayıtlı.
- **TS motor:** 9 tool (`grep.regex`, `glob`, `read_file.offset`, `write_file`, `todo`); policy: okuma/glob/todo auto, `write_file` auto-edit'te auto, exec asla auto (O6). `tools/write.ts` + `tools/todo.ts` (history'den `deriveTodoState`, son 50 mesaj); agent system prompt'a aktif todo bloğu; todo sonucu terminalde listelenir.
- **Doğrulama:** `tsc` 0 hata · `npm test` 22 dosya / 129 test yeşil (yeni: policy drift+rm+todo/write/toolspec) · `npm run build` ok · `cargo test --lib` 21/21 (4 yeni) · `cargo fmt` temiz.
- **Sürüm:** sabit `0.1.0` (kullanıcı isteği; haritadaki `0.4` uygulanmadı).

---

## 2026-10-15 — Faz 2: Context Bütçesi & Compaction → `v0.1.0` (sürüm sabit)

- **Token tahmini:** `lib/engine/tokens.ts` (chars/4 + overhead + tool JSON + görsel; `windowFor` registry, bilinmeyende 200_000; `budgetFor` window × 0.6).
- **Compaction:** `lib/engine/compact.ts` (`COMPACTION_THRESHOLD` 0.75; `shouldCompact`/`splitAtCompactionPoint` + tool-çifti bütünlüğü/`compactHistory`/`compactSessionMessages`; özet `[özet · tarih]` max 2000 karakter, transcript kırpık).
- **Özetleyici:** `lib/summarize.ts` (`summarizerConfig` + `makeSummarizeFn`, boşsa aktif model); `store/settings` + `SettingsModal/ChatTab` ("Özetleyici model", boş = aktif).
- **Akış:** `useStream`/`useAgent` gönderim öncesi otomatik compaction (ephemeral + `/// context özetlendi` satırı, hatada özgün geçmişle devam); `/compact` (`App.tsx`) kalıcı (özet başa, yeniler korunur, id/timestamp korunur).
- **Doğrulama:** `tsc` 0 hata · `npm test` 20 dosya / 117 test yeşil (yeni: tokens 6 + compact 8 + summarize 4 + /compact help) · `npm run build` ok. Rust değişikliği yok.
- **Sürüm:** sabit `0.1.0` (kullanıcı isteği; haritadaki `0.3` uygulanmadı).

---

## 2026-10-14 — Faz 1: Agent Döngüsü Sağlamlığı + İnteraktif Onay → `v0.1.0` (sürüm sabit)

- **G1 şema:** `Message`'e `toolCalls`/`toolCallId`/`toolName`/`isError` (K5); tool sonuçları `system` rolünde saklanır, `toProviderMessages` `role:'tool'`'a çevirir. `store/session`: `addToolMessages` + `appendToolCalls`. `normalizeSession` roundtrip ile korunur (`commands.test`).
- **G2 duraklatılabilir döngü:** `createAgentRun` (`step`/`resolve`/`serialize`/`abort`) + `AgentStepResult` (`done`/`needs-approval`); `runAgent` geriye uyumlu durur. `resolve` reddi `isError:true` "kullanıcı reddetti" ile devam eder (K2); `exec` hep onaylı (K3). Patch önizlemesi `tool_preview` olayı (kalıcı değil), apply/reject `tool_result` (kalıcı).
- **G3 kalıcı kuyruk:** `lib/engine/approvals.ts` (SQLite `pending_approvals` + bellek + localStorage fallback) + `db.ts` DDL + Rust migration v2. Boot'ta `restoreApprovals` → `pendingBySession`.
- **G4 geçmiş:** `useAgent` history `AgentHistoryItem[]` (tool alanları dahil), `.slice(-40)` + kopan tool çifti geriye taraması. `toProviderMessages` C.6 temizliği (orphan call düşer, sahipsiz sonuç user'a çevrilir).
- **G5 UI:** `Terminal` satır içi `[ONAYLA ✓ Enter] [REDDET ✗ Esc]` + `InputBar` boşken Enter/Esc + meta bar sayacı. `/apply` aktif run'da `resolve` yolundan devam eder.
- **G6 retry:** `withRetry` (yalnızca 429/≥500 + `TypeError`; 400/401/abort asla; backoff+jitter tavan 4000ms) — agent `streamOneTurn` + `useStream` tek noktasından; fallback korunur.
- **Doğrulama:** `tsc` 0 hata · `npm test` 17 dosya / 99 test yeşil (yeni: retry 4 + approvals 2 + session 3 + agent 3 + commands 1) · `npm run build` 93→~286kB · `cargo test --lib` 17/17.
- **Sürüm:** sabit `0.1.0` (`package.json` + `tauri.conf.json` + boot satırı oynamadı).

---

## 2026-10-06 — Çekirdek Motor Faz A–G + Rust `stream_anthropic` aktif

- **Faz A (tool-calling):** `common.ts` → `tools?: ToolDefinition[]`, `toolCalls?: ToolCall[]`, `usage?: TokenUsage`. OpenAI/Anthropic/Gemini tool streaming; `engine/toolspec.ts` kanonik 5 tool + `toAnthropicTools` / `safeParseArgs`; `engine/providers.ts` (`supportsTools`, toolsuz modelde sessiz düşüş).
- **Faz B (context):** `engine/context.ts` — ignore/secret/budget/prioritize + `summarizeWorkspace`.
- **Faz C (fs):** Rust `list_dir` / `read_file` / `grep_files` (root jail, secret blok) + `engine/tools/fs.ts` + `policy.ts` client jail.
- **Faz D (patch):** Rust `apply_patch` (backup + atomic) + `engine/tools/patch.ts` (diff önizleme, `propose → /apply → apply`, tek kullanımlık id).
- **Faz E (shell):** Rust `exec_cmd` (allowlist, timeout 15sn, 8k truncate) + `engine/tools/shell.ts`.
- **Faz F (agent):** `engine/agent.ts` (`runAgent`, maxSteps 8, onay-bekleyenlerde durur) + `hooks/useAgent.ts` (history son 20 mesaj, workspace etiketi systemPrompt'a eklenir, `tool_call`/`tool_result` eventleri extras'a). Workspace seçiliyse chat yerine agent çalışır.
- **Faz G (skills):** `engine/skills.ts` registry (`repo-guide` yerleşik) + `/skill`.
- **UI:** `store/workspace.ts` (root/label/approvalMode, persist `macrocode-workspace`), `App.tsx` → `/root` `/files` `/apply` `/skill` `/compact`, `/help` 16 satır. `setProvider`/`setModel` artık `updateSessionModel` ile aktif session'ı da günceller.
- **Rust kayıtları:** `lib.rs` → list_dir/read_file/grep_files/apply_patch/exec_cmd + stream_anthropic; `Cargo.toml` → tokio + reqwest + futures-util. `ChatMsg` pub yapıldı.
- **Anthropic yolu netleşti:** Tauri + toolsuz chat → Rust proxy (`stream_anthropic`, `Channel<StreamEvent>`); tarayıcı-dev veya tool'lu çağrı → doğrudan `fetch`. Eski stub kaldırıldı.

## 2026-10-08 — Faz H: Provider Registry (7 provider, capability, model bazlı `maxOutput`)

- `Provider → Model → Capabilities → Agent` zinciri kuruldu. 7 provider: anthropic/openai/gemini/ollama/openrouter/deepseek/xai.
- `openaiCompatible.ts` fabrikası (openai/openrouter/deepseek/xai). Yeni provider = 1 dosya + registry kaydı.
- Model bazlı `maxOutput` (eski Anthropic 4096 sabiti kalktı; Anthropic `min(maxOutput, 16384)`, OpenAI `max_tokens`/`max_completion_tokens`, Gemini `generationConfig.maxOutputTokens`, Ollama `options.num_predict`).
- `deepseek-reasoner` toolsuz/reasoning olarak ayrıştı.
- Titlebar capability rozetleri (🛠👁🧠), `/model` capability satırı (`tools✓/vision✓/reasoning✓`).
- `commands.test.ts` güncel modellere uyarlandı (gpt-6.1-sol + capability satırı).
- Güncel default modeller: `claude-opus-5-5`, `gpt-6.1-sol`, `gemini-3.8-flash`, `llama3.3`, `openrouter/auto`, `deepseek-chat`, `grok-4.20`.

## 2026-10-08 — P0/P1: ground-truth, migration, suggest, vision uçtan uca

- **P0-2 model ID ground-truth:** OpenRouter `/v1/models` (public, 468 model) ile doğrulandı: `openrouter/auto`, `openai/gpt-6.1-sol`, `deepseek/deepseek-chat`, `x-ai/grok-4.7`, `x-ai/grok-4.20` OK. Düzeltme: `anthropic/claude-sonnet-5-5` (tireli) OpenRouter'da YOK → doğrusu noktalı `anthropic/claude-sonnet-5.5` (`openrouter.ts` + `REMOVED_MODEL_MAP`). Native Anthropic/OpenAI/DeepSeek/xAI/Gemini ID'leri anahtarsız doğrulanamadı — gerçek anahtarla duman testi açık kaldı.
- **P0-3 eski model migration:** `REMOVED_MODEL_MAP` (10 girdi: gpt-4o→gpt-6.1-sol, gpt-4o-mini→gpt-6-luna, o3→gpt-6.1-sol, o4-mini→gpt-6-luna, sonnet-4-6→sonnet-5-5, opus-5→opus-5-5, haiku-4-5→haiku-5-5, gemini-2.5-pro→3-pro, gemini-2.5-flash→3.8-flash, OR tireli slug→noktalı) + `migrateModelId` / `migrateProviderModel`; `db.ts` (`parseSession`) + `commands.ts` (`normalizeSession`) import yolunda uygulanır, özel/boş ID korunur; 2 yeni vitest eklendi.
- **P1 suggest:** `suggestProvider()` (önek + harf skoru), `/provider` ve `getProvider` hatasında "bunu mu demek istedin" önerisi.
- **P1 vision uçtan uca:** `Message.images` + `ChatItem.images` → provider formatları (Anthropic blocks / OpenAI `image_url` / Gemini `inline_data` / Ollama `images`; Rust proxy görselde fetch'e düşer) → InputBar `[IMG]` (canvas 1568px JPEG, max 4) → Terminal thumbnail → vision'suz modelde erken err + export notu.
- **P1 test:** `openaiCompatible.test.ts` (stream/usage/tool/error/headers/max_tokens/vision + registry bütünlüğü + suggest).

## 2026-10-08 — Çözülen sınırlamalar

1. `stream.rs` stub → `stream_anthropic` aktif. Kalan gap: Rust proxy tool-call desteklemez.
2. `csp: null` → kısıtlı CSP aktif (`tauri.conf.json`, bkz. Güvenlik bölümü).
3. `fontSize` görsel etkisiz → çözüldü (`:root` `--font-size` canlı bağ).
4. Full-snapshot DB yazma → çözüldü (transaction içinde `INSERT OR REPLACE` + stale silme, `db.ts`).
5. Session model/provider kilidi → çözüldü (`updateSessionModel` ile Titlebar/`/model`/`/provider` aktif session'ı da günceller).
6. Test dosyası yok → engine + providers vitest'leri eklendi (`agent/context/policy/toolspec/patch/openaiCompatible/commands`).
7. `src/Memorybank/` boş klasörü silindi.

## 2026-10-08 — Güvenlik Sertleştirme + UI Temizliği

Doğrulama: `cargo check --lib` temiz, `cargo test commands::fs` 3/3, JSON geçerli. `npm` ortamda yoktu → TS tarafı API-stabil tutuldu.

- **20.1 `exec_cmd` timeout:** Ölü kod (`let _ = timeout`) kaldırıldı; `tokio::process::Command::output()` artık `tokio::time::timeout(timeout, …)` ile sarılı (`exec.rs:81-92`). Aşımda `kill_on_drop(true)` process'i öldürür, `"komut zaman aşımına uğradı"` döner. Aralık aynı: 1–30sn (varsayılan 15sn).
- **20.2 `exec_cmd` workspace jail:** Yeni opsiyonel `root: Option<String>` (`exec.rs:54-79` + `shell.ts:40-43`); doluysa `cwd` canonicalize edilip `starts_with` ile doğrulanır, değilse `"cwd workspace dışına çıkamaz"`. Frontend (`toolExec`) her çağrıda `root` gönderir. `Option` olduğu için eski IPC yükleri kırılmaz. Ulaşılamaz `rm/sudo/chmod…` ölü kontrolü silindi (allowlist zaten reddediyordu).
- **20.3 CSP + shell saldırı yüzeyi:** `tauri.conf.json` `csp: null` → kısıtlı policy (Google Fonts + 6 AI API hostu + localhost/127.0.0.1). `lib.rs`'ten `tauri_plugin_shell::init()`, `capabilities/default.json`'dan `shell:default`, `Cargo.toml`'dan `tauri-plugin-shell` kaldırıldı. `src/` içinde `plugin-shell` importu yok (`exec_cmd` tek shell yoludur). `package.json`'daki `@tauri-apps/plugin-shell` bilerek bırakıldı (kaldırılırsa `package-lock.json` senkronu bozulur; backend izni kalktığı için güvenlik etkisi yok).
- **20.4 Frontend tekilleştirme (davranış değişikliği yok):** Yeni `src/lib/tauri.ts` tek `isTauri()` tanımı (`db.ts`, `settings.ts`, `rustStream.ts` buraya bağlandı). `providerNeedsKey` tek tanımı `store/settings.ts`'te (`PROVIDER_DEFS` tabanlı; `useStream.ts` import + re-export eder).
- **20.5 Terminal + App.tsx:** `Terminal.tsx` her token'daki `out.sort(O(n log n))` kaldırıldı (mesajlar kronolojik, extras hep en yeni → birleştirme yeterli). `App.tsx` `extrasBySession` session başına 200 satırla cap'lendi; silinen session'ların `extras/clearedBefore` kayıtlarını budayan effect eklendi. Boot anahtar-durum satırı 4 hardcoded provider yerine `PROVIDER_IDS` üzerinden dinamik (openrouter/deepseek/xai eksikti).

## 2026-10-08 — Doğrulama kayıtları

Her `npm run test` / `npm run build` / `cargo check` koşusundan sonra bu tablo güncellenir.

| Komut | Sonuç | Not |
|---|---|---|
| `npm run test` (vitest 4.1.11) | ✅ 6 dosya / 39 test yeşil (~1s) | `commands.test.ts` güncel modellere uyarlandı (gpt-6.1-sol + capability satırı) |
| `tsc --noEmit` | ✅ 0 hata | SettingsModal Draft cast düzeltmesi sonrası temiz |
| `npm run build` | ✅ yeşil (72→76 modül) | `@tauri-apps/api/core.js` chunk notu kozmetik; SettingsModal dinamik import kaldırıldı |
| `cargo check` | ⚠️ bloklu | `javascriptcoregtk-4.1.pc` yok → `webkit2gtk-4.1` + full Tauri system deps gerekli |
| `rustfmt --check` (keystore.rs) | ✅ yeni kod format-temiz | Tek diff pre-existing `read_key` zincirinde |
| P0-2 ground-truth | ⚠️ kısmi | OpenRouter 468 model OK; tireli OR slug düzeltildi; native ID'ler anahtarsız doğrulanamadı |
| P0-3 migration | ✅ tamam | `REMOVED_MODEL_MAP` 10 girdi; `db.ts` + `commands.ts` yolunda uygulanır; 2 yeni vitest |
| `cargo check --lib` (§20 sonrası) | ✅ temiz | `exec.rs` timeout+jail + shell kaldırma sonrası |
| `cargo test --lib commands::fs` | ✅ 3/3 geçti | `parent_dir/mutlak_yol/secret` jail testleri |
| JSON geçerlilik | ✅ OK | `package.json`, `tauri.conf.json`, `capabilities/default.json` doğrulandı |
| `npm run build` / `npm test` (§20 sonrası) | ⚠️ koşulamadı | Ortamda Node yok; Node'lu makinede koşulmalı |
| `npm run build` / `npm test` (2026-10-09) | ✅ yeşil | Taşınabilir toolchain Node v22.23.3 (`/tmp/opencode/toolchain`): `tsc` 0 hata + vite 81 modül + favicon `dist/` kökünde; **7 dosya / 52 test yeşil** |

## 2026-10-09 — Dokümantasyon ayrımı (bu işlem)

- `ARCHITECTURE.md` sadece **güncel proje mimarisi** olacak şekilde sadeleştirildi: tarihli faz anlatımları (§18), doğrulama kayıtları (§19), güvenlik işlem detayları (§20) ve `~~çözüldü~~` geçmişleri (§15) buraya taşındı.
- Stale mimari bilgiler güncellendi: shell plugin kaldırma, 7 provider'lı keystore, güncel model ID'leri, model bazlı `maxOutput`, `Message.images`, `workspace` store, `tauri.ts` tekilleştirmesi, dinamik boot satırı, extras cap, terminal sort kaldırma.
- Yeni kural: mimari değişikliği = `ARCHITECTURE.md` güncelle + buraya tarihli işlem ekle.

## 2026-10-09 — Logo değişimi + bundle ikonları üretildi

- Yeni logo (`src-tauri/icons/macrocode-logo.svg`, 512×512: siyah yuvarlak kare + neon yeşil `m<` monogramı) uygulamanın logosu olarak dahil edildi.
- Tespit: `tauri.conf.json` → `bundle.icon` 4 dosya gösteriyordu ama klasörde hiçbiri yoktu (`tauri build` kırık olurdu). SVG'den 4 dosya üretildi:
  `32x32.png` + `128x128.png` (`rsvg-convert`), `icon.ico` (16/32/48/256 PNG-sıkıştırmalı girdiler),
  `icon.icns` (ic07–ic10: 128/256/512/1024 PNG verili). Doğrulama: `file` → `MS Windows icon resource - 4 icons` /
  `Mac OS X icon, "ic07" type`. (Not: ImageMagick `.ico`/`.icns` uzantısına düz PNG yazdığı için konteynerlar
  python3-stdlib betikle kuruldu: `/tmp/opencode/make_icons.py` — ICO: `00 00 01 00` başlık + PNG blob'lar;
  ICNS: `icns` sihri + `ic07..ic10` elemanları.)
- Favicon bağlandı: `public/macrocode-logo.svg` (kaynağın birebir kopyası) + `index.html` →
  `<link rel="icon" type="image/svg+xml" href="/macrocode-logo.svg">`.
- `tauri.conf.json` değişmedi (zaten doğru 4 dosyayı gösteriyordu; dosyalar artık mevcut).
- UI: Titlebar ortaya 18px logo eklendi (`Titlebar.tsx` + `.titlebar-logo` CSS; dekoratif, `draggable=false`,
  göreli yol — dev/preview/Tauri'de çözülür, CSP `img-src 'self'` kapsamında).
- UI: Titlebar ortaya 18px logo gösteriyor (`Titlebar.tsx` + `.titlebar-logo`).

## 2026-10-09 — Kritik sıkıntılar turu (K1/K3/Y1/Y2/Y3/O1/O2/O3 düzeltildi)

Detaylı incelemede bulunan kritik/yüksek/orta sorunların fixleri:

- **K1 TLS kök sertifikası:** `Cargo.toml` → reqwest'e `rustls-tls-native-roots` eklendi
  (yalnızca `manual-roots` vardı = boş root store → `stream_anthropic` HTTPS el sıkışması patlıyordu).
  + `anthropic.ts` → Rust yolu yanıt başlamadan düşerse fetch'e geri döner (metin aktıysa düşmez).
- **K3 Rust `max_tokens` sabiti:** `stream_anthropic` artık `max_tokens: Option<u32>` alıyor;
  frontend `min(maxOutput,16384)` gönderiyor (bilinmeyende 4096). Varsayılan yol da model bazlı oldu.
- **Y1 symlink jail bypass:** `resolve_rooted` (`fs.rs`) final hedef mevcutsa canonicalize edip
  jail'i tekrar denetliyor (yeni dosya → parent kontrolü). 3 yeni test (dışarı symlink red, içeri kabul, yeni dosya).
- **Y2 exec allowlist:** `exec.rs` `check_cmd` prefix tablosuna çevrildi (frontend `policy.ts` ile birebir:
  `node/npx` sadece `--version`, `npm run` prefix'li, `cargo` check/test/build...). `node -e` / `npx <paket>` /
  `npm install` artık backend'de de red. 2 yeni test.
- **Y3 saldırı yüzeyi:** `capabilities/default.json`'dan `store:default` çıkarıldı
  (frontend plugin-store JS kullanmıyor — yalnızca `invoke`; Rust tarafı etkilenmez).
- **O1 abort israfı:** `stream.rs` kanal kapanınca akışı bitiriyor (`send` Err → `return Ok`).
- **O2 SSE toleransı:** bozuk satır akışı öldürmüyor, atlanıyor (fetch yoluyla aynı). 4 yeni `stream` testi.
- **O3 usage overwrite:** `useStream` + `agent` artık usage'ı max-birleştiriyor (Anthropic input kaybolmuyor).
- **Biçim:** 6 Rust dosyası `rustfmt` ile temizlendi (bu toolchain'in stilinde pre-existing farklar da vardı).
- **Doğrulama:** `cargo check --lib` ✅ temiz · `cargo test --lib` ✅ 12/12 (9 yeni: fs 3 + exec 2 + stream 4; 3 eski jail testi) · `rustfmt --check` ✅ · capabilities JSON ✅.
- **Frontend doğrulama (2026-10-09, taşınabilir toolchain Node v22.23.3 `/tmp/opencode/toolchain`):**
  `npm run build` ✅ (`tsc` 0 hata + vite 81 modül; bilinen kozmetik chunk uyarısı; favicon `dist/` köküne kopyalandı) ·
  `npm test` ✅ 7 dosya / 52 test yeşil (~1s).
  Gerçek Anthropic anahtarıyla duman testi hâlâ açık (K1'in fiilî kanıtı + `tauri dev` webkit bağımlılıkları eksik).

## 2026-10-09 — Faz 1: sekmeli Ayarlar + Sağlayıcılar sekmesi

- `SettingsModal.tsx` → `SettingsModal/` klasörü (kabuk + 5 sekme; `App.tsx` importu değişmedi).
  Sağlayıcılar sekmesi tam işlevsel: maskeli anahtar (`key_hint` → `••••a1b2`, 3 durumlu alan:
  değişmedi/yazıldı/silindi), 3 durumlu bağlantı testi (`validateDetailed`: bağlı/geçersiz/ağ hatası),
  özel base URL (4 OpenAI-uyumlu), Ollama model keşfi (`listOllamaModels`), özel uç ekle
  (ad+baseURL+anahtar+modeller, varsayılan yap). Modeller/Sohbet sekmelerine mevcut
  kontroller taşındı; Dil/Hakkında yer tutucu (Faz 4).
- Yeni tipler: `CustomEndpoint` (`types`), `validate.ts`, `custom.ts` (TR transliterasyonlu slug,
  `Provider` birliğine dokunulmadı). `openaiCompatible` ayar `baseUrl` override'ı okuyor.
- Store: `baseUrlOverride/customEndpoints/activeEndpointId` (+ persist) ve `customSecrets`
  (yalnızca bellek — `partialize`'da `{}`). `useStream` özel uç dalı, `useAgent` erken ret.
- Rust (önce gözle yazılmıştı, bu turda doğrulandı):
  `normalize_provider` `custom_*` öneki + `key_hint` komutu + kayıt (`lib.rs`, `mod.rs`) + 3 test.
- **Doğrulama (bu tur):** `cargo check --lib` ✅ temiz · `cargo test --lib` ✅ **15/15**
  (3 yeni keystore: yerleşik/custom-kabul/custom-red) · `rustfmt --check` ✅ (1 satır-uzunluğu düzeltildi) ·
  IPC sözleşme: `key_hint` adı/parametresi + `custom_<slug>` kuralı TS↔Rust uyumlu (küçük harf, ≤48, `[a-z0-9-]`) ·
  `npm run build` ✅ 0 hata · `npm test` ✅ 9 dosya / 61 test.
- Dürüstlük: bilgi satırı keychain İDDİA ETMİYOR ("bu cihazda saklanır (keys.json)").
- **Doğrulama (Node toolchain):** `npm run build` ✅ 0 hata (89 modül) ·
  `npm test` ✅ 9 dosya / 61 test (2 yeni dosya: validate 5 test + custom 4 test).
- **Kalan tek doğrulama (bu makinede imkânsız):** canlı Tauri çalıştırma (webkit2gtk yok):
  ayarları aç → anahtar gir → maskeli görünüm → test et → kaydet → yeniden başlat → kalıcılık kontrolü.

## 2026-10-09 — Faz 2: Modeller sekmesi (2a–2e)

- **2a birleştirme + aç/kapa:** `resolveModels` (registry + custom, çakışmada custom kazanır) +
  `isModelEnabled`; lookup'lar opsiyonel `customs` parametresi aldı (geriye uyumlu).
  Titlebar/`/model`/vision/agent aynı birleşimi kullanıyor; `CommandContext.customModels?` eklendi.
- **2b elle ekleme + yenileme:** `discovery.ts` (openrouter anahtarsız / ollama / openai / gemini;
  bulunanlar otomatik eklenmez, "ekle" ile `customModels`'a) + `CustomModel` (id+provider+caps).
- **2c parametreler:** `ProviderConfig.params` + `sanitizeParams` (thinking topP'yi ezer);
  eşleme: Anthropic (temp/top_p/thinking, temp=1 + fetch yoluna düşer), OpenAI-uyumlu (16k tavan),
  Gemini (`generationConfig`), Ollama (`options`). `useStream`/`useAgent` geçiriyor.
- **2d yedek model:** sohbette tek retry (metin akmadıysa; `onFallback` → `/// yedek model kullanıldı`).
  Ajan ve özel uç akışında yok.
- **2e fiyat:** `pricing.ts` (1M USD birimi, `$0.0000` hassasiyeti) + `/tokens` eki
  (`tokenSummaryLine(session, prices?)` — mevcut testler kırılmadı).
- **Doğrulama:** `npm run build` ✅ 0 hata · `npm test` ✅ 13 dosya / 79 test
  (4 yeni dosya: params/resolve/discovery/pricing, +18 test). Rust değişikliği yok → cargo gerekmedi.

## 2026-10-11 — P0 Düzeltmeleri: Güvenlik Sertleştirmesi (O6) + Yerel (Native) Tool Calling Formatı

- **P0 Güvenlik (O6 Düzeltmesi):** `policy.ts` içindeki `decideTool('exec', ...)` mantığında `auto-read` ve `auto-edit` modlarında shell komutlarının yetkisiz otomatik onaylanmasına (`autoApproved: true`) yol açan kritik açık kapatıldı. Artık `exec` hiçbir standart modda (`manual`, `auto-read`, `auto-edit`) otomatik onaylanamaz; kabuk komutları her zaman kullanıcı onayı (`autoApproved: false`) gerektirir. `policy.test.ts` güncellendi ve doğrulandı.
- **P0 Yerel (Native) Tool Calling:** Çok turlu agent döngüsünde sahte metin (`(araç çağrısı: ...)` ve `[araç:sonuç]`) yerine standart sağlayıcı protokollerine geçildi:
  - `ChatItem` ve `AgentHistoryItem` arayüzlerine `toolCalls`, `toolCallId`, `toolName`, `isError` alanları eklendi.
  - `agent.ts`: `runAgent` artık asistan mesajını yerel `toolCalls` ile, araç sonucunu ise `role: 'tool'` ile kaydeder.
  - `openaiCompatible.ts`: `role: 'tool'` (`tool_call_id` ile) ve asistan `tool_calls` dizisi native OpenAI `chat/completions` formatında gönderilir.
  - `anthropic.ts`: `buildAnthropicMessages` ile asistan içeriği `tool_use` bloklarına, araç sonuçları ise ardışık birleştirilerek `user` mesajı içindeki `tool_result` bloklarına dönüştürülür (Anthropic ardışık rol ve tool standartlarına tam uyum).
  - `gemini.ts`: `buildGeminiContents` ile model mesajı `functionCall` partlarına, araç sonuçları ise `function` rolü altında `functionResponse` partlarına dönüştürülür.
  - `ollama.ts`: `role: 'tool'` ve asistan `tool_calls` eşlemesi sağlandı.
- **Testler & Doğrulama:**
  - Yeni `src/lib/providers/nativeTools.test.ts` eklendi (Anthropic tek/çoklu `tool_result` birleşimi ve Gemini `functionResponse` testleri).
  - `agent.test.ts` ve `openaiCompatible.test.ts` yeni native tool formatı assertion'ları ile güçlendirildi.
  - **14 dosya / 84 vitest testi yeşil** (~3.4s).
  - `tsc --noEmit && vite build` 0 hata ile derlendi (92 modül).
  - `cargo test --lib` 15/15 test yeşil.

## Açık kalanlar (sonraki tur)

- `App.tsx`'teki inline `/root|/files|/apply|/skill` dallarının `commands.ts`'e taşınması.
- Token-bazlı bağlam kırpma (`useAgent` sabit 20 mesaj yerine budget tabanlı).
- Blok düzenleme (`search_replace`) ve `.macrocode/backups/` mimarisi (O5).
- `exec_cmd` çıktılarının anlık streaming ile akıtılması.
- Native provider model ID'lerinin gerçek API anahtarıyla duman testi.
- Büyük geçmişlerde `updateLastMessage` performansı (her token'da full array kopyası).
- Uzak özel Ollama URL'leri CSP `connect-src`'ye takılır — gerekirse genişletme.
- `git init`, ESLint/Prettier + CI.
- **K2 (ertelendi, büyük iş):** `keys.json` düz metin — stronghold/OS keychain geçiş tasarımı.
- **O4:** vision görselleri localStorage/SQLite şişmesi (persist ayrımı + boyut guard'ı).
- Titlebar logo `img` eklendi (SVG bileşen notu kapandı).

