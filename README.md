# MacroCode — AI terminal desktop app

Kendi API anahtarınla (BYOK) 7 sağlayıcıyla (Anthropic, OpenAI, Gemini, Ollama,
OpenRouter, DeepSeek, xAI) terminal arayüzünde sohbet edebildiğin masaüstü uygulaması.
Tauri v2 + React 18 + TypeScript + Vite + Zustand.

## Gereksinimler

- **Node v22** (önyüz derleme + test için)
  - Sistemde Node yoksa, sudo'suz taşınabilir kurulum:
    ```bash
    mkdir -p /tmp/opencode/toolchain && cd /tmp/opencode/toolchain
    curl -sS -O https://nodejs.org/dist/latest-v22.x/node-v22.23.3-linux-x64.tar.xz
    tar -xf node-v22.23.3-linux-x64.tar.xz
    export PATH="/tmp/opencode/toolchain/node-v22.23.3-linux-x64/bin:$PATH"
    node --version && npm --version
    ```
  - Ya da sistem kurulumu: `sudo pacman -S nodejs npm`
- **Rust stable** (sadece `tauri dev/build` için): https://rustup.rs
- **Tauri sistem bağımlılıkları** (sadece `tauri dev/build` için):
  - Linux: `libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
  - Windows: WebView2 + MSVC build tools · macOS: Xcode CLT

## Kurulum

```bash
npm install
```

## Uygulamayı Başlatma

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Sadece tarayıcıda çalıştırır (http://localhost:1420). Hızlı önyüz geliştirme için; Tauri API'leri yok sayılır. |
| `npm run tauri dev` | Tam masaüstü uygulamayı başlatır (Rust derlemesi gerekir). Gerçek keystore + SQLite + Rust proxy bu modda çalışır. |
| `npm run build` | Üretim derlemesi (`tsc` tip kontrolü + `vite build` → `dist/`). |
| `npm run preview` | `dist/` çıktısını yerel önizler. |
| `npm test` | Vitest ile tüm testleri koşar. |
| `bash scripts/smoke-test.sh` | Gerçek uygulamayı derleyip çalıştırır, session veritabanına yazıldığını doğrular (veri yedeklenir/geri yüklenir). |
| `npm run tauri build` | Platform paketlerini üretir. |

Önerilen sıra (ilk kez):

```bash
npm install
npm run build     # tsc + vite sorunsuz mu?
npm test          # testler yeşil mi?
npm run tauri dev # masaüstü uygulamayı başlat
```

## İlk Çalıştırma (API anahtarı)

1. Uygulama açılınca `⚙ settings` (veya terminale `/key` yaz).
2. Kullandığın sağlayıcının anahtarını girip **Kaydet** (Ollama için anahtar değil
   `http://localhost:11434` URL'si yeterli).
3. Boot satırında `bağlı ✓` görünmeli. Sonra mesajını yaz veya `/help` ile komutlara bak.

Anahtarlar `app_data_dir/keys.json` içinde **düz metin** saklanır (tauri-plugin-store
şifrelemez) — dosyanın kimlerin erişebildiğine dikkat et.

## Model kataloğu (models.dev)

Uygulama, açık model kataloğu **models.dev**'den model metadata'sı çeker:

- **Kaynak**: `https://models.dev/api.json` (232 sağlayıcı / 9061 model) — uygulama
  yalnızca **6 yerleşik sağlayıcıya** ait kayıtları saklar (~480 model).
  Ollama bu listede yoktur (yerel modeller `discoverOllama` ile bulunur).
- **Kayıt**: elle yazılmış **çekirdek** (27 model) + katalogdaki **diğer** modeller
  otomatik birleşir → toplam **~494 model**. Katalog yoksa/bozuksa yalnız çekirdek
  çalışır (offline).
- **Zenginleştirme**: model açıklaması, ailesi (`family`), yayın tarihi,
  modaliteler (text/image/pdf/audio), düşünme seçenekleri (effort/toggle/budget),
  context & çıktı limitleri katalogla güncellenir. Limitler **küçülmez**,
  yetenekler **kapanmaz** — yerleşik değerler güvenli tarafta kalır.
- **Fiyat**: katalogdaki `cost` (girdi/çıktı/**cache_read**/**cache_write**) fiyat
  tablosunu **otomatik** doldurur; elle girdiğin değerler **korunur** (katalog
  ezmaz). "Eksik fiyatları katalogdan doldur" ile elle girilmemiş satırlar tazelenir.
- **Yenileme**: ⚙ ayarlar → Modeller → **models.dev kataloğu** düğmesi.
  Açılışta önbellek (`macrocode-modelsdev-catalog`, 24 saat TTL) kullanılır;
  bayatsa arka planda yenilenir. Ağ isteği Tauri'de Rust `proxy_fetch` üzerinden
  çıkar (CSP `connect-src` değişikliği gerekmez).

## API anahtarı kuralı

**API anahtarı olmayan sağlayıcının modelleri hiçbir listede görünmez.**
`ollama` istisnadır (anahtar değil, URL gerekir). Kural üç yerde uygulanır:

- **Titlebar** model açılır listesi (arama kutusuyla) — anahtarsız sağlayıcı gizli,
  listenin sonunda "🔑 Anthropic — anahtar ekle" satırı çıkar.
- **Ayarlar → Modeller / Sohbet** — "Varsayılan model" ve "Özetleyici model"
  listeleri de filtrelenir; "anahtar ekle" satırı ayarları açar.
- **`/model`** — sağlayıcı başına model sayısı gösterilir; anahtarı olmayan
  sağlayıcı "anahtar yok — listede gizli" uyarısıyla listelenir.

## Prompt Önbelleği (maliyet)

Uzun oturumlarda sistem prompt'u + geçmiş her turda yeniden gönderilir; bu
en pahalı kalemdir. MacroCode istek tarafında **prompt cache** kullanır:

- **Anthropic**: sistem bloğu + son kullanıcı bloğu `cache_control` ile işaretlenir
  (yalnızca önek ≥ 1024 token ise — daha kısa önekte API 400 döner).
- **OpenAI-uyumlu**: oturuma bağlı `prompt_cache_key` gönderilir (OpenAI/DeepSeek
  önbelleği kendi tarafında yönetir).
- Token sayaçları (`cache_read` / `cache_write`) okunur ve **ayrı fiyatla** hesaplanır.
- `/tokens` çıktısında önbellek kullanımı görünür: `önbellek: 12.4k okuma · 3.1k yazma`.
- Kapatmak için: ⚙ ayarlar → Sohbet → **Prompt önbelleği** (varsayılan açık).
  Kapalıyken sağlayıcı tarafında hiçbir önek saklanmaz.

## Kalıcılık

- API anahtarları: `keys.json` (tauri-plugin-store) + kaynakta `key_status`/`has_any_key`
- Session'lar: SQLite `sessions.db` (öncelikli), yedek localStorage
  (tarayıcı-dev ve DB erişilemezse devreye girer).
- Ayarlar/workspace: localStorage (`macrocode-settings`, `macrocode-workspace`).
- models.dev kataloğu: ayrı localStorage anahtarı (`macrocode-modelsdev-catalog`),
  24 saat TTL; zustand persist'ine girmez (yüzlerce model).

## Sorun Giderme

- `javascriptcoregtk-4.1.pc yok` / `tauri dev` derlenmiyor → Linux sistem
  bağımlılıkları eksik (yukarıdaki listeyi `pacman`/`apt` ile kur).
- `✗ ağ hatası` (Anthropic, Tauri) → Rust proxy TLS sorunu olabilir; uygulama
  otomatik olarak doğrudan `fetch` yoluna düşer. Düzelmezse anahtarı `/key` ile kontrol et.
- Uzak (LAN) Ollama URL'si çalışmıyor → CSP `connect-src` yalnızca
  `localhost/127.0.0.1` + 6 AI API hostuna izin verir; `src-tauri/tauri.conf.json`
  içinden genişletmen gerekir.
- HTTP MCP sunucusuna ulaşılamıyor → aynı CSP kısıtı özel origin'lere de uygulanır;
  sunucu adresini `connect-src`'ye ekleyip yeniden derle (stdio taşıma CSP istemez).
- `✗ api anahtarı eksik` → sağlayıcı anahtarı girilmemiş; `/key` ile ekle
  (Ollama hariç hepsi anahtar ister).
- `npm run build` Node hatası veriyor → Gereksinimler'deki taşınabilir Node
  kurulumunu yapıp PATH'i aktif kabukta export et.

## Çıktılar (`tauri build`)

Windows `.exe` setup, macOS `.dmg`, Linux `.deb` + `.AppImage`
(`src-tauri/tauri.conf.json` → `bundle.targets: all`, id `com.macrocode.app`).
Uygulama ikonu `src-tauri/icons/` içinden alınır (kaynak: `macrocode-logo.svg`).

## Ajan Modu (`/root`)

Workspace seçildiğinde uygulama **ajan** moduna geçer:

- `/root <yol>` workspace seçer · `/files` dosya özeti · `/context` ajanın bildiği
  proje bağlamı (harita + AGENTS.md/README + kalıcı notlar)
- `/note <not>` kalıcı proje notu ekler (sonraki oturumlarda hatırlanır)
- `/approval manual|auto-read|auto-edit` onay modu · `/apply <id>` bekleyen yamayı uygular
  · `/undo` geri alır · `/audit [n]` denetim kaydı · `/log [n]` son olay kayıtları
- Araçlar: `read_file`, `list_dir`, `grep`, `glob`, `edit_file`, `propose_patch`,
  `write_file`, `exec`, `todo`, `plan`, `subagent` (salt-okunur alt ajan) + MCP araçları
- **Güvenlik**: yazma araçları onay ister (`exec` **her zaman** onaylı), bloklu dizinler
  (`.git`, `node_modules`, …) kapalı, `rm` yalnızca `-i` ile.

## Dokümantasyon

- `memorybank/memorybank.md` — güncel proje mimarisi (canlı referans).
- `memorybank/Modeller.md` — yerleşik model kataloğu (27 model + models.dev eşleşmesi).
- `memorybank/Değişiklik Raporu.md` — tarihli işlem ve doğrulama kayıtları.
