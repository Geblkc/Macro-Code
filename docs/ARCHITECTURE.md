# MacroCode — Memory Bank (Proje Mimarisi)

> Bu belge, MacroCode projesinin **güncel mimarisini** tanımlayan canlı referans belgesidir.
> Tarihsizdir: sadece mevcut durum anlatılır. Tarihli işlem geçmişi için bkz. `Değişiklik Raporu.md`.
> Kod değiştiğinde bu dosya da güncellenmelidir.
> Son güncelleme: 2026-10-27 · Sürüm: `0.1.0` (sabit) · 7 provider (anthropic/openai/gemini/ollama/openrouter/deepseek/xai) · models.dev kataloğu entegrasyonu
> **Çoklu dil (i18n)** eklendi: TR/EN/DE/FR/ES — sıfır bağımlılık, elle yazılmış motor (bkz. §18).
> **Görsel yeniden tasarım** uygulandı: yeni token sistemi, durum çubuğu, ikon seti, zengin markdown + sözdizimi renklendirme, yeniden tasarlanan ayarlar modalı, yüksek kontrast modu.
> **Klasör seçme altyapısı** eklendi: `tauri-plugin-dialog` ile yerel klasör diyaloğu
> (argümansız `/root`), yol doğrulama+normalize katmanı (`lib/workspace.ts`),
> Titlebar workspace menüsü (son klasörler/Son 5 off), StatusBar rozet tıklaması,
> Welcome agent ipucu ve boot'ta eksik kök uyarısı.
> **Slash komut otomatik tamamlama** eklendi: `COMMAND_SPECS` tek kaynak komut tablosu
> (22 komut + `commands.desc.*` kısa açıklamalar), inputbar `/` öneri menüsü
> (↑↓ gez · Tab tamamla · Enter gönder · Esc kapat; zorunlu argümanlı komutlarda
> Enter yalnız tamamlar), `/help` çıktısı tablodan üretilir — bkz. `lib/commands.ts`.
> **Kopyalama + konuşma içi arama** eklendi: satır üstü kopyala butonu artık canlı
> (`onCopy` bağlantılı, toast geri bildirimli), `/copy [md|json]` oturum transkriptini
> panoya yazar, `Ctrl+F` ile satır bazlı arama (vurgu + tur navigasyonu + kapanınca
> giriş alanına odak) — bkz. `lib/search.ts`, `lib/clipboard.ts`, `hooks/useCopy.ts`.
> **Oturum yönetimi** eklendi: satır içi yeniden adlandırma (çift tık veya kalem
> butonu; Enter kaydet · Esc iptal), onaylı oturum silme (genel `ConfirmDialog` —
> `SettingsModal`'dan `components/`'a taşındı, App kökünde tek instance),
> giriş geçmişi localStorage persist (`macrocode-keyhistory`, son 50; `/reset`
> temizler) ve global kısayollar `Ctrl+N` (yeni oturum) + `Ctrl+Tab` /
> `Ctrl+Shift+Tab` (oturum gezinmesi; ayarlar modalı açıkken pasif).
> **Performans + dilbilgisi** eklendi: streaming markdown render throttle
> (~50ms trailing-edge, `MessageLine`), IME `isComposing` guard'ı (input +
> global kısayollar + Ctrl+F), `Ctrl+C` akış iptali (seçim varken kopyalamaya
> bırakılır), hata satırlarında "tekrar dene" (`ExtraLine.retry` →
> `handleSendRef`), `useAgent.ts`/`markdown.ts` sabit Türkçe metinleri i18n'e
> taşındı (10 yeni anahtar × 5 dil). **Görsel giriş sürtünmesi** azaltıldı:
> panodan `Ctrl+V` yapıştırma ve inputbar'a sürükle-bırak görsel ekleme tek
> `attachImages` hattından geçer (max 4 · `image/*` · ≤1568px JPEG); sürükleme
> `.dropping` kesikli vurgu + `drop-hint` (`input.dropHint`) ile işaretlenir,
> streaming'de buton gizliyken paste/drop da yok sayılır. **Gösterim & polish
> (Faz 7)** eklendi: StatusBar'da streaming rozeti (nabız atan nokta +
> `status.streaming`), Terminal `.terminal-view` `role="log" aria-live="polite"`
> (yeni satırlar duyurulur), model dropdown'ı `ModelDropdown.tsx` olarak ortak
> bileşene çıkarıldı (Titlebar pill + `ModelPicker` + ChatTab özetleyici aynı
> paneli kullanır; Esc yalnız paneli kapatır) ve extras cap 200'ün ilk
> kırılmasında oturum başına tek `extrasCapped` sys satırı uyarısı.
> **Agent çalışma modları** eklendi: `build` (tam yetki) / `plan` (salt-okunur
> analiz) / `ask` (danışma) — `Session.agentMode` persist, araç süzme +
> ikinci savunma hattı disallow listesi `engine/agentModes.ts`'te, UI
> `ModeSelector.tsx` (InputBar rozeti) + StatusBar etiketi, komutlar
> `/mode`·`/build`·`/plan`·`/ask`; sağlayıcı hatalarında 402/bakiye ve JSON
> gövde mesajı ayrıştırma (`httpErrorMessage`).

---

## 1. Proje Genel Bakış

**MacroCode**, kullanıcıların kendi API anahtarlarını girerek birden fazla AI sağlayıcısıyla
(Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter, DeepSeek, xAI) **terminal benzeri bir arayüzde** sohbet edebildiği,
açık kaynaklı, masaüstü bir AI terminal uygulamasıdır.

| Özellik | Değer |
|---|---|
| Ürün adı | `MacroCode` |
| Sürüm | `0.1.0` |
| Kimlik / Bundle ID | `com.macrocode.app` |
| Model | **BYOK** (Bring Your Own Key) — abonelik yok, kullanıcı kendi anahtarını kullanır |
| Hedef kullanıcı | Geliştirici (terminal arayüzü seven, gizliliğine değer veren) |
| Platform | Windows, macOS, Linux (cross-platform) |
| Dil / UI dili | TypeScript (kod yorumları İngilizce-Türkçe karışık), UI metinleri **5 dilde** (TR/EN/DE/FR/ES — `lib/i18n/`) |
| Lisans (bundle meta) | MIT |

### Marka / Logo

- **Kaynak:** `src-tauri/icons/macrocode-logo.svg` (512×512) — siyah yuvarlak kare zemin (`rx=112`)
  üzerinde neon yeşil (`#00E676`) `m<` monogramı (glow efektli). Bu dosya uygulama logosunun tek kaynağıdır.
- **Bundle ikonları** (SVG'den üretilir, `tauri.conf.json` → `bundle.icon` bu 4 dosyayı gösterir):
  `icons/32x32.png`, `icons/128x128.png`, `icons/icon.ico` (16/32/48/256, PNG-sıkıştırmalı),
  `icons/icon.icns` (ic07–ic10: 128/256/512/1024, PNG verili). Yeniden üretme: `rsvg-convert` (PNG'ler) +
  ICO/ICNS konteynerları (`Değişiklik Raporu.md` 2026-10-09 kaydındaki betik).
- **Favicon:** `public/macrocode-logo.svg` (kaynağın birebir kopyası) + `index.html` →
  `<link rel="icon" type="image/svg+xml" href="/macrocode-logo.svg">` (tarayıcı-dev sekmesi).
- **UI:** Titlebar ortada 18px logo (`public/macrocode-logo.svg`, dekoratif `img`, `draggable=false`) + başlık gösterir.

### Mimari Şema

```
┌─────────────────────────────────────────────────────────────┐
│  WebView (React 18 + TS + Zustand)                         │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Titlebar │ │ Sidebar   │ │ Terminal │ │ InputBar      │  │
│  └──────────┘ └───────────┘ └──────────┘ └───────────────┘  │
│        │              │            │             │         │
│   useSettingsStore  useSessionStore         useStream       │
│        │              │            │         useAgent        │
│   lib/providers (fetch + SSE)     lib/commands  lib/markdown│
│   lib/engine (agent/context/policy/toolspec/skills) │       │
│   lib/db (SQLite debounce)                          │       │
├───────────────┬─────────────────────────────────────┼───────┤
│  invoke(...)  │  tauri-plugin-store (keys.json)     │       │
│  keystore.rs  │  tauri-plugin-sql  (sessions.db)    │       │
│               │         ↳ global fetch → AI API'leri ◄─────┘
└───────────────┴─────────────────────────────────────────────┘
```

**Kritik mimari karar:** Chat/agent streaming sağlayıcıya göre seçilir —
Anthropic (Tauri + toolsuz + görselsiz) **Rust `stream_anthropic` proxy** (`Channel`), diğerleri ve tool'lu/görsel çağrılar
**doğrudan WebView `fetch` + SSE**. Detay: §7.4 + §13.3.

### Kapsam (mevcut modüller)

| Alan | İçerik |
|---|---|
| İskelet | Tauri + React + Vite + Zustand, özel Titlebar, sidebar, terminal |
| Keystore + settings | 7 provider anahtar/URL yönetimi + model/systemPrompt/fontSize |
| Provider katmanı | 7 sağlayıcı SSE streaming, registry + capability lookup |
| Model kataloğu | `docs/MODELS.md` — registry listesi (27 model) + models.dev eşleşmesi |
| Slash komutları + streaming hook | 26 komut (`COMMAND_SPECS` tek kaynak + inputbar öneri menüsü; `/mode`+`/build`+`/plan`+`/ask`) + `/export` varyantları, abort + usage kaydı |
| Terminal UI | Markdown render, boot sequence, SQLite persist (debounce) |
| Rust proxy | `stream_anthropic` (tool-use + vision + thinking, saf proxy) |
| Agent motoru | `createAgentRun` (maxSteps 8, duraklatılabilir) + workspace fs/patch/shell tool'ları + skills + `subagent` aracı |

---

## 2. Teknoloji Yığını

```
Desktop Shell:    Tauri v2 (Rust backend — minimal Rust kodu, sadece native API'ler)
Frontend:         React 18.3 + TypeScript 5.6 + Vite 5.4
UI Framework:     Sıfırdan CSS (Tailwind YOK — tam kontrol için)
Tipografi:        JetBrains Mono (içerik akışı) + Inter (arayüz kabuğu) — Google Fonts, index.html üzerinden
HTTP/Streaming:   global fetch + ReadableStream (SSE)
API Key Storage:  tauri-plugin-store → app_data_dir/keys.json
State:            Zustand 5 (+ persist middleware)
DB (sessions):    tauri-plugin-sql → SQLite (sessions.db)
Build:            Vite + tauri-cli (tauri-bundler)
```

### package.json — Script'ler

| Script | Komut | Not |
|---|---|---|
| `dev` | `vite` | Sadece tarayıcı dev (port 1420, strict) |
| `build` | `tsc --noEmit && vite build` | Önce tip kontrolü, sonra bundle → `dist/` |
| `preview` | `vite preview` | Build çıktısını önizler |
| `test` | `vitest run` | Engine + providers + commands testleri |
| `test:watch` | `vitest` | İzleme modu |
| `tauri` | `tauri` | `npm run tauri dev` / `build` |
| `dist:linux` | `bash scripts/build-linux.sh` | Linux paketleri (deb+rpm+AppImage) → `bundles/` |
| `dist:deb` / `dist:rpm` / `dist:appimage` | `bash scripts/build-linux.sh --bundles …` | Tekil Linux paketi |
| `release` | `bash scripts/release.sh` | Versiyon bump + tag + push → CI tüm paketleri üretir |

### Bağımlılıklar

**dependencies:** `@tauri-apps/api` ^2.12.1, `@tauri-apps/plugin-shell` ^2.4.0
(frontend'de import YOK — sadece `package-lock.json` senkronu için durur, backend izni kalkmıştır),
`@tauri-apps/plugin-sql` ^2.5.0, `@tauri-apps/plugin-store` ^2.5.0,
`react` ^18.3.1, `react-dom` ^18.3.1, `zustand` ^5.0.2

**devDependencies:** `@tauri-apps/cli` ^2.12.1, `@types/node`, `@types/react`,
`@types/react-dom`, `@vitejs/plugin-react` ^4.3.4, `typescript` ~5.6.3, `vite` ^5.4.11,
`vitest` ^4.1.11

### Rust (src-tauri/Cargo.toml)

```toml
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", default-features = false, features = ["stream", "rustls-tls-manual-roots", "rustls-tls-native-roots", "json"] }  # stream_anthropic proxy için (native-roots: OS sertifika deposu, TLS doğrulaması için şart)
futures-util = "0.3"          # SSE bytes_stream
tokio = { version = "1", features = ["process", "time"] }  # exec_cmd timeout + process
```

- `tauri-plugin-shell` backend'den kaldırılmıştır (tek shell yolu `exec_cmd`).
- `build.rs` → `tauri_build::build()`
- Features: `default = ["custom-protocol"]`

---

## 3. Dizin Yapısı

```
MacroCode/
├── docs/
│   ├── ARCHITECTURE.md          ← BU BELGE (güncel mimari)
│   ├── MODELS.md                ← model kataloğu
│   ├── PACKAGING.md             ← dağıtım rehberi (deb/rpm/AppImage/Windows)
│   └── DEVLOG.md                ← tarihli işlem kayıtları
├── scripts/                     # betikler
│   ├── build-linux.sh           # Linux paketleri (deb/rpm/AppImage) → bundles/
│   ├── release.sh               # versiyon bump + tag + push → CI tüm paketleri üretir
│   └── smoke-test.sh            # gerçek uygulama smoke testi (Faz 10)
├── .github/workflows/
│   ├── ci.yml                   # PR/push: tsc+vitest+build+fmt+clippy+cargo test + smoke
│   └── release.yml              # v* tag: Linux (deb/rpm/AppImage) + Windows (NSIS/msi) → GitHub Release
├── bundles/                     # dağıtım çıktıları (git ignored)
├── README.md                    # Kurulum / build / kalıcılık notları
├── index.html                   # HTML girişi — JetBrains Mono font linki, favicon (/macrocode-logo.svg), lang="tr"
├── public/macrocode-logo.svg     # favicon (src-tauri/icons kaynağının kopyası, Vite root'tan servis edilir)
├── package.json / package-lock.json
├── vite.config.ts               # port 1420, strictPort, src-tauri watch ignore, outDir dist
├── tsconfig.json                # strict, noUnusedLocals/Parameters, paths: @/* → src/*
├── tsconfig.node.json           # sadece vite.config.ts için
├── .gitignore                   # node_modules, dist, src-tauri/target, src-tauri/gen, .env
├── dist/                        # build çıktısı (git ignored)
│
├── src/                         # ─── FRONTEND ───
│   ├── main.tsx                 # ReactDOM.createRoot + StrictMode, 2 CSS import eder
│   ├── App.tsx                  # Root layout, boot sequence, slash komut köprüsü, DB persist
│   ├── vite-env.d.ts            # /// <reference types="vite/client" />
│   ├── types/index.ts           # Tüm tipler (Provider, Model, Message+images, Session, ...)
│   ├── store/
│   │   ├── session.ts           # Zustand: sessions/activeSessionId/isStreaming + persist (+ updateSessionModel/setMessageUsage)
│   │   ├── settings.ts          # Zustand: apiKeys/model/systemPrompt/fontSize/keyStatus (+ providerNeedsKey, isTauri re-export)
│   │   └── workspace.ts         # Zustand: root/label/approvalMode/recent persist (agent modu; pushRecent saf)
│   ├── hooks/
│   │   ├── useStream.ts         # AI mesaj gönderimi (stream + abort + hata yönetimi + usage kaydı)
│   │   ├── useAgent.ts          # Agent'lı gönderim (createAgentRun + tool eventleri + repo bağlamı)
│   │   ├── useKeyHistory.ts     # ↑↓ komut geçmişi (50 öğe, saf fonksiyonlar + hook) · localStorage persist · resetKeyHistory (/reset)
│   │   ├── useCopy.ts           # pano kopyalama + toast geri bildirimi (Terminal satırı / komutlar)
│   │   └── useFocusTrap.ts      # Modal odak döngüsü + açılış odaklaması (Faz 13)
│   ├── lib/
│   │   ├── workspace.ts          # Klasör seçme altyapısı: normalize/label/forbidden (saf) + dialog.open köprüsü + list_dir varlık kontrolü
│   │   └── tabNav.ts            # Sekme/alt-seme klavye navigasyonu (nextTabIndex) — Faz 13
│   ├── components/
│   │   ├── Titlebar.tsx         # Traffic lights, orta başlık, logo + model badge (panel → ModelDropdown)
│   │   ├── ModelDropdown.tsx    # Ortak model paneli: arama + gruplama + kilitli satır + klavye (Faz 7)
│   │   ├── Sidebar.tsx          # Session listesi (yeniden adlandırma + onaylı silme) + footer butonları + JSON import/export
│   │   ├── Terminal.tsx         # Mesaj görünümü, scroll stick, clearedBefore, thumbnail
│   │   ├── MessageLine.tsx      # Tek satır: prefix, markdown render, thinking/cursor, reasoning dim blok
│   │   ├── InputBar.tsx         # ❯ input, [SEND]/[DUR], [IMG] görsel ekleme, '/' öneri menüsü, kısayollar, meta bar
│   │   ├── ModeSelector.tsx     # Agent modu rozeti + açılır seçici (build/plan/ask) — InputBar'da, streaming'de gizli
│   │   ├── Segmented.tsx        # Alt sekme kontrolü (segmented) — Faz 13
│   │   ├── SettingsModal/       # Sekmeli ayarlar: index (kabuk+draft+Kaydet) + types + 7 sekme
│   │       ├── modelList.ts      # Ortak model listesi mantığı (görünürlük + süzgeç) — Faz 13
│   │       ├── ProvidersTab.tsx # Maskeli anahtarlar, test et, özel URL, özel uçlar, Ollama keşfi
│   │       ├── ModelsTab.tsx    # Alt sekmeler: Liste │ Katalog & keşif │ Elle ekle
│   │       ├── ParamsTab.tsx    # Alt sekmeler: Model parametreleri │ Fiyatlar
│   │       ├── ChatTab.tsx      # System prompt + özetleyici model + düşünme/cache + shell allowlist
│   │       ├── AppearanceTab.tsx # Görünüm (font/kontrast/saat/zaman damgası) + Dil
│   │       └── AboutTab.tsx     # Logo, sürüm, lisans, gizlilik notu
│   │   └── ConfirmDialog.tsx    # Genel onay kutusu (ayarlar + oturum silme; App kökü tek instance)
│   ├── lib/
│   │   ├── i18n/                # Çoklu dil motoru (sıfır bağımlılık) — §18
│   │   │   ├── index.ts         # genel API (t/useT/setLocale/...)
│   │   │   ├── core.ts          # t(), makeT(), setLocale(), detectLocale() (store bağımsız)
│   │   │   ├── hook.ts          # useT() — store'daki dile bağlı (reaktif)│   │   │   ├── types.ts         # Locale/LanguageSetting/Message/PluralForms
│   │   │   ├── format.ts        # {placeholder} interpolasyon + Intl.PluralRules
│   │   │   └── locales/         # tr.ts (KAYNAK GERÇEK) + en/de/fr/es.ts
│   │   ├── tauri.ts             # Tek isTauri() tanımı (tüm modüller buradan import eder)
│   │   ├── logger.ts            # Faz 10: log kanalı (halka arabellek + redaksiyon) · `/log` komutu
│   │   ├── toast.ts             # Faz 13: kısa bildirim kanalı (showToast/toast.*) — sıfır bağımlılık
│   │   ├── clipboard.ts         # pano kopyalama tek kaynağı (clipboard API + textarea fallback)
│   │   ├── appInfo.ts           # Faz 13: sürüm/kaynak bağlantısı (package.json'dan gömülür)
│   │   ├── db.ts                # SQLite oku/yaz + debounce persister + model migration + sqlError (Faz 7 A1)
│   │   ├── tauri-config.test.ts # capability/migration sözleşme koruması (Faz 7 A1)
│   │   ├── commands.ts          # COMMAND_SPECS tek kaynak + filterCommands + /slash komut işleyici + /export(md|json) + /backup + /tokens(gerçek+yaklaşık+maliyet) + backup parse/build
│   │   ├── pricing.ts           # costForMessage/formatCost/sessionCost (1M token/USD birimi)
│   │   ├── markdown.ts          # Blok + satır içi markdown tokenizer + güvenli DOM render
│   │   ├── search.ts            # konuşma içi arama (saf): findHits satır bazlı + stepHit tur gezinmesi
│   │   ├── engine/              # UI'dan bağımsız motor (vitest'li)
│   │   │   ├── agent.ts         # createAgentRun (maxSteps 8, onay-bekleyenlerde durur) + buildAgentHistory
│   │   │   ├── agentModes.ts    # build/plan/ask: filterToolsForMode + getDisallowedToolsForMode + getModePrompt (saf, testli)
│   │   │   ├── context.ts       # ignore/secret/budget/prioritize + summarizeWorkspace
│   │   │   ├── compactionMemo.ts # özet hafızası (özet + sonrası mesajlar; tekrar özetlemeyi önler, Faz 7; id tabanlı kesim Faz 9)
│   │   │   ├── repoContext.ts    # Faz 9: repo haritası + AGENTS.md/README + kalıcı hafıza (`.macrocode/context.md`)
│   │   │   ├── policy.ts        # client-side jail + onay politikası (BLOCKED_DIRS bileşen bazlı, Y1)
│   │   │   ├── providers.ts     # supportsTools capability lookup
│   │   │   ├── skills.ts        # skill registry (repo-guide yerleşik)
│   │   │   ├── toolspec.ts      # kanonik 11 tool (subagent dahil) + provider dönüşümleri
│   │   │   ├── allowlist.json   # exec allowlist tek kaynağı (TS+Rust)
│   │   │   ├── blocks.json      # Faz 10 D2c: blok listeleri tek kaynağı (TS import + Rust include_str!)
│   │   │   ├── subagent.ts      # salt-okunur alt-agent (kendi bütçesi, tek özet; `subagent` aracı olarak bağlı)
│   │   │   ├── mcp/protocol.ts  # JSON-RPC 2.0 + McpError (saf)
│   │   │   ├── mcp/client.ts    # transport bağımsız istemci (initialize/list/call)
│   │   │   ├── mcp/registry.ts  # mcp:sunucu:araç adaptörü + makeMcpServerId
│   │   │   ├── mcp/pool.ts      # istemci havuzu + configureMcp/runMcpTool
│   │   │   ├── mcp/transports/http.ts   # WebView fetch (+SSE) + fetchFor proxy (Faz 7 A5)
│   │   │   ├── mcp/transports/stdio.ts  # Rust subprocess köprüsü
│   │   │   ├── types.ts         # engine tipleri (ChatItem+images dahil)
│   │   │   └── tools/{fs,patch,shell,write,todo}.ts  # Rust komutlarına invoke köprüleri (todo saf/yerele; shell toolExec approved+extraAllow bayrağı, Y2)
│   │   └── providers/
│   │       ├── index.ts         # PROVIDER_DEFS/IDS, PROVIDERS, ALL_MODELS, capability lookup, suggestProvider, REMOVED_MODEL_MAP
│   │       ├── common.ts        # AIProvider arayüzü, feedSSELines, ProviderError, formatProviderError, TokenUsage, mergeUsage/sumUsage, systemTextOf/withoutSystemMessages
│   │       ├── promptCache.ts   # Faz 11: cache_control (Anthropic) + prompt_cache_key (OpenAI-uyumlu) + eşik kuralları
│   │       ├── openaiCompatible.ts  # openai/openrouter/deepseek/xai fabrika (+ ayar baseUrl override)
│   │       ├── custom.ts        # Özel uç: makeEndpointId/parseEndpointModels/buildCustomProvider (kayıtsız, sohbetlik)
│   │       ├── validate.ts      # validateDetailed 3-durumlu bağlantı testi (ok/invalid/network)
│   │       ├── params.ts        # sanitizeParams (thinking topP'yi ezer, geçersizi atar)
│   │       ├── discovery.ts     # Model keşfi: openrouter/ollama/openai/gemini + SOURCE_PROVIDER
│   │       ├── modelsDev.ts     # models.dev kataloğu: fetch + parse + 6 sağlayıcıya kırpma + localStorage önbellek
│   │       ├── catalog.ts       # models.dev eşleştirme (3 aşama) + zenginleştirme + katalog→registry + aktif katalog singleton'ı
│   │       ├── visibility.ts    # API anahtarı kuralı: hasProviderKey/visibleModels/hiddenProviders
│   │       ├── rustStream.ts    # streamAnthropicViaRust (Tauri Channel) + isTauriRuntime
│   │       ├── anthropic.ts / openai.ts / gemini.ts / ollama.ts
│   │       └── openrouter.ts / deepseek.ts / xai.ts
│   └── styles/
│       ├── global.css           # Token'lar (:root) + reset + focus + ikon + sr-only
│       ├── high-contrast.css    # [data-contrast="high"] token override'ı
│       ├── shell.css            # Titlebar, sidebar, status bar, input bar, butonlar
│       ├── message.css          # 3 kolonlu mesaj grid'i, kartlar, log satirlari, karşılama
│       ├── markdown.css         # Markdown blokları, kod bloğu, sözdizimi renklendirme
│       ├── agent.css            # Araç kartları, onay kartı, görev paneli
│       ├── settings.css         # Modal kabuğu, sekme rayı, form kontrolleri, tablolar
│       ├── toast.css            # Kısa bildirimler (sağ alt) — Faz 13
│       └── utilities.css        # Yardımcı sınıflar (boşluk/flex/görünürlük)
│
└── src-tauri/                   # ─── RUST BACKEND ───
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json          # Pencere, bundle, plugin config, kısıtlı CSP
    ├── capabilities/default.json# core/store/sql :default + dialog:default izinleri (shell YOK)
    ├── icons/                   # macrocode-logo.svg (kaynak) + üretilmiş: 32x32.png, 128x128.png, icon.ico, icon.icns
    └── src/
        ├── main.rs              # fn main() { macrocode_lib::run() }
        ├── lib.rs               # Tauri Builder: pluginler (store/sql/**dialog**) + invoke_handler (keystore + stream_anthropic + fs/exec/mcp) + McpState + exit hook
        └── commands/
            ├── mod.rs           # pub mod keystore/stream/fs/exec/mcp/paths + re-export'lar
            ├── keystore.rs      # set/get/delete_api_key, key_status, has_any_key, key_hint (7 + custom_*)
            ├── paths.rs         # get_app_paths (app_data_dir + keys.json + sessions.db) — Faz 13
            ├── stream.rs        # stream_anthropic Rust SSE proxy (Channel<StreamEvent>)
            ├── mcp.rs           # mcp_spawn/write/read/kill (tokio subprocess, kill_on_drop)
            ├── fs.rs            # list_dir/read_file(offset)/grep_files(regex)/glob_files/write_file(O_EXCL)/apply_patch (root jail, backup+atomic) + undo_patch manifest doğrulaması (safe_backup_name, K1) + list_tree (Faz 9 repo haritası) + memory_read/memory_append (Faz 9 kalıcı not)
            └── exec.rs          # exec_cmd (allowlist.json tek kaynak + kullanıcı extra_allow tablosu [Faz 8 L3], timeout 1-30sn varsayılan 15sn, 8k truncate, workspace jail, rm yalnız -i; FILE_ARG_CMDS dosya argümanı jail'i, O1)
```

---

## 4. Veri Modeli & Tipler (`src/types/index.ts`)

```typescript
type Provider = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openrouter' | 'deepseek' | 'xai';

interface ModelCapabilities { tools: boolean; vision: boolean; reasoning: boolean }

type Model = {
  id: string;              // ör: 'claude-opus-5-5'
  name: string;            // görünür ad: 'Claude Opus 5.5'
  provider: Provider;
  contextWindow: number;   // token
  supportsVision: boolean; // capabilities.vision ile senkron tutulur (legacy)
  maxOutput: number;       // provider isteğindeki max_tokens buradan türetilir (model bazlı)
  capabilities: ModelCapabilities; // Agent kararları buradan beslenir
};

interface ProviderDefinition {
  id: Provider; label: string; auth: 'api-key' | 'url';
  placeholder: string; defaultModel: string; defaultBaseUrl?: string;
  needsKey: boolean; openAICompatible: boolean;
}

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;       // epoch ms
  model?: string;
  provider?: Provider;
  tokens?: { input: number; output: number; reasoning?: number }; // stream usage event'inden gelir; /tokens gerçek değeri gösterir, yoksa approx
  images?: string[];       // ekli görseller (data URL, JPEG). Sadece user mesajlarında
  reasoning?: string;      // Faz 4: reasoning metni (dim blok)
  thinking?: Array<{ thinking: string; signature: string }>; // Faz 4: imzalı thinking (geri gönderim)
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>; // Faz 1 (K5): assistant tool çağrıları
  toolCallId?: string;     // Faz 1 (K5): tool sonucu hangi çağrıya ait (system rolünde saklanır)
  toolName?: string;
  isError?: boolean;
};

type Session = {
  id: string;
  name: string;            // otomatik: ilk user mesajının ilk 20 karakteri
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  provider: Provider;      // session yerinde dondurulan sağlayıcı
  model: string;
  systemPrompt: string;
  agentMode?: AgentMode;   // 'build' | 'plan' | 'ask' — araç erişimini belirler (varsayılan build)
};

type ApiKeys = {
  anthropic: string;
  openai: string;
  gemini: string;
  ollamaUrl: string;       // 'ollama' adı altında URL saklanır (default http://localhost:11434)
  openrouter: string;
  deepseek: string;
  xai: string;
};

type LineType = 'user' | 'ai' | 'sys' | 'err' | 'warn';

type CodeBlock = { lang: string; code: string };

type TerminalLine = {
  id: string;
  type: LineType;
  content: string;
  isStreaming?: boolean;
  codeBlocks?: CodeBlock[];
};

/** Geçici görünüm satırı (boot mesajı, komut çıktısı, hata).
 *  `ts` oluşturma anıdır (görünüm sıralaması için).
 *  Uzlaşma: sys/err/warn içerikleri `///`, `✗`, `!` işaretlerini TAŞIR;
 *  MessageLine bunlara ek prefix KOYMAZ (sadece user→❯, ai→◆ ekler). */
type ExtraLine = TerminalLine & { ts: number };
```

### İki Katmanlı Görünüm Modeli (önemli!)

- **Kalıcı katman:** `Session.messages` (Message[]) → SQLite'a yazılır. Faz 1'den beri
  tool geçmişi burada durur: assistant mesajında `toolCalls`, tool sonucunda `system` rolü +
  `toolCallId`/`toolName`/`isError` (K5). Provider'a gönderirken `toProviderMessages`
  bunları `role: 'tool'`'a çevirir; eşleşmeyen çiftler temizlenir (orphan call düşer,
  sahipsiz sonuç user mesajına çevrilir).
- **Geçici katman:** `App` içindeki `extrasBySession: Record<sessionId, ExtraLine[]>`
  (boot satırları, komut çıktıları, hatalar, tool_call/tool_result) → **saklanmaz**, sadece görünür.
  Session başına 200 satırla cap'lenir; **ilk kırpma anında** oturum başına tek
  `extrasCapped` sys satırı eklenir (`extrasCountRef`/`extrasCappedRef` — Faz 7).
- **Temizleme:** `clearedBefore: Record<sessionId, number>` → `/clear` veya ✕ clear,
  mesajların `timestamp >= clearedBefore` olanları gösterilir (veri silinmez!).

`Terminal.tsx` iki katmanı **birleştirir** (mesajlar kronolojik, extras hep en yeni → sort yok).

### Prefix Uzlaşması (MessageLine)

| Tip | Prefix | Renk |
|---|---|---|
| `user` | `❯` | `--col-user` (#7eb8f7) |
| `ai` | `◆` | `--col-ai` (#00e5a0) |
| `sys` | (içerikteki `///` taşır) | `--col-sys` (#a78bfa) |
| `err` | (içerikteki `✗` taşır) | `--col-err` (#f87171) |
| `warn` | (içerikteki `!` taşır) | `--col-warn` (#fbbf24) |

---

## 5. State Yönetimi (Zustand)

### 5.1 `store/session.ts` → `useSessionStore`

```typescript
interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  isStreaming: boolean;

  createSession(): Session;
  deleteSession(id): void;
  renameSession(id, name): void;   // Faz 3: boş ad yok sayılır, 60 karakterde kesilir
  setActiveSession(id): void;
  addMessage(sessionId, message): void;
  updateLastMessage(sessionId, content): void;   // streaming delta
  appendToMessage(sessionId, messageId, content): void;  // Faz 7 A3: hedef mesaja delta
  clearSession(sessionId): void;
  removeMessage(sessionId, messageId): void;
  updateSessionModel(sessionId, patch: { provider?: Provider; model?: string }): void;
  setMessageUsage(sessionId, messageId, usage: { input: number; output: number }): void;
  setStreaming(value): void;
  getActiveSession(): Session | null;
}
```

**Davranış detayları:**

- `createId()` — `crypto.randomUUID()` varsa onu, yoksa `${Date.now()}-${random}`.
- `createSession()` — anlık settings'ten `provider/model/systemPrompt` **kopyalayarak** oturum
  oluşturur; `model` boşsa `DEFAULT_MODELS[provider]` fallback'i. Aktif oturumu yeni olana çeker.
- `deleteSession(id)` — aktif oturum silindiyse listedeki ilk session'a geçer.
  Sidebar'da silme butonu **yalnızca `sessions.length > 1`** iken görünür.
- `addMessage()` — **otomatik adlandırma:** ilk `user` mesajı ekleniyorsa
  `content.trim().slice(0, 20)` ile `session.name` güncellenir (boşsa `"yeni session"`).
- `appendToMessage(sessionId, messageId, content)` — **Faz 7 A3:** delta'yı *belirli*
  bir assistant mesajına ekler (yoksa o id ile yeni mesaj açar). Agent akışı bunu
  kullanır: tool sonuçları kalıcı katmana `role:'system'` mesajı olarak yazıldığı için
  "son mesaj assistant olmalı" kuralı cevabı parçalıyordu.
- `updateLastMessage(sessionId, content)` — **streaming semantiği:**
  son mesaj `assistant` ise içeriğe **ekler** (delta append), değilse yeni `assistant` mesajı **açar**.
  Her çağrıda `updatedAt = Date.now()`.
- `clearSession()` — mesajları boşaltır, session silinmez (`/reset`).
- `removeMessage()` — tek mesaj siler (boş kalan assistant placeholder temizliği için).
- `updateSessionModel()` — Titlebar/`/model`/`/provider` hem `currentModel`'i hem aktif session'ın
  `provider/model`'ini günceller.
- `setMessageUsage()` — `useStream`/`useAgent`'de biriken son `usage` chunk'ı assistant mesajına yazar.
- **Persist:** `name: 'macrocode-sessions'`, localStorage; `partialize` sadece
  `{sessions, activeSessionId}` yazar (`isStreaming` saklanmaz).

### 5.2 `store/settings.ts` → `useSettingsStore`

```typescript
DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-6.1-sol',
  gemini: 'gemini-3.8-flash',
  ollama: 'llama3.3',
  openrouter: 'openrouter/auto',
  deepseek: 'deepseek-chat',
  xai: 'grok-4.20',
} // PROVIDER_DEFS'ten türetilir (registry tek kaynaktır)

interface SettingsStore {
  apiKeys: ApiKeys;
  currentProvider: Provider;      // default 'anthropic'
  currentModel: string;
  systemPrompt: string;
  fontSize: number;               // default 13, clamp 10–20
  keyStatus: Record<Provider, boolean>;
  baseUrlOverride: Partial<Record<Provider, string>>; // özel taban URL (boş = fabrika URL'si)
  customEndpoints: CustomEndpoint[];   // metadata (persist edilir, secret HARİÇ)
  activeEndpointId: string | null;     // null = yerleşik akış
  customSecrets: Record<string, string>; // SADECE bellek (partialize'da `{}`)
  customModels: CustomModel[];   // elle eklenenler (resolveModels birleştirir, çakışmada custom kazanır)
  disabledModels: string[];        // listelerde gizlenir (seçili rozet korunur)
  modelParams: Record<string, ModelParams>; // boş = sağlayıcı varsayılanı
  fallbackModel: string;           // boş = kapalı (sohbette tek retry)
  prices: Record<string, ModelPrice>; // 1M token/USD (eksikse maliyet yok)
  discovered: DiscoveredModel[];   // keşfedilen, henüz eklenmemiş
  modelsDevCatalog: ModelsDevCatalog | null; // models.dev kataloğu (PERSIST EDİLMEZ — ayrı localStorage anahtarı)
  summarizerProvider: Provider | ''; // Faz 2: boş = aktif sağlayıcı
  summarizerModel: string;         // Faz 2: boş = aktif model
  showThinking: boolean;           // Faz 4: reasoning bloğu görünürlüğü
  mcpServers: McpServerConfig[];   // Faz 5: metadata (secret HARİÇ persist)
  mcpSecrets: Record<string, Record<string, string>>; // Faz 5: env değerleri, SADECE bellek + keystore `custom_<id>`
  customAllowList: string[]; // Faz 6: kullanıcı shell uzantıları
  auditEnabled: boolean;     // Faz 6: denetim kaydı (default true)
  language: LanguageSetting; // i18n: 'auto' (sistem dili) | 'tr'|'en'|'de'|'fr'|'es'

  setApiKey(provider, key): void;
  setProvider(provider): void;    // ← model'i o sağlayıcının DEFAULT'INA sıfırlar
  setModel(id): void;
  setSystemPrompt(text): void;
  setFontSize(size): void;
  setBaseUrlOverride(provider, url): void;   // boş URL kaydı siler
  setCustomEndpoints(list): void;
  setCustomSecret(id, key): void;            // bellek; localStorage'a düşmez
  clearCustomSecret(id): void;
  setActiveEndpoint(id | null): void;        // null = yerleşik sağlayıcı akışı
  setCustomModels(list): void;
  toggleModel(id): void;
  setModelParams(id, params): void;        // boş alanlar temizlenir
  setFallbackModel(id): void;
  setPrice(id, price): void;               // sıfır/geçersiz kaydı siler
  setPrices(prices): void;                 // toplu (katalog fiyatları)
  setDiscovered(list): void;
  setModelsDevCatalog(catalog): void;      // global katalog + fiyatları otomatik doldurur
  loadModelsDevCatalog(): void;            // önbellekten yükler (ağ yok)
  refreshModelsDevCatalog(): Promise<ModelsDevCatalog>; // ağdan yeniler
  loadFromStore(): Promise<void>;            // + özel uç secret'larını keystore'dan yükler
  saveToStore(): Promise<void>;              // + özel uç secret'larını keystore'a yazar
  setLanguage(v: LanguageSetting): void;     // i18n: dil ayarı (persist'li)
}
```

**Kritik güvenlik davranışı — `partialize`:**

```typescript
partialize: (s) => isTauri()
  ? { currentProvider, currentModel, systemPrompt, fontSize,
      apiKeys: { ...EMPTY_KEYS, ollamaUrl: s.apiKeys.ollamaUrl },  // ← secret'lar SIFIRLANIR
      keyStatus }
  : s   // tarayıcı-dev'de kolaylık için hepsi saklanır
```

- **Tauri'de API anahtarları asla localStorage'a düşmez** → sadece `keys.json` (keystore) ve bellek.
- `isTauri()` tek tanımı `lib/tauri.ts`'tedir (buradan re-export edilir).
- `providerNeedsKey` tek tanımı buradadır (`PROVIDER_DEFS` tabanlı; `useStream` import + re-export eder).
- `storeKeyOf(provider)` / `fieldOf(provider)` yardımcıları `ollama` ↔ `ollamaUrl` farkını tek yerde çözer.

**Yazma akışı:** `setApiKey()` → state + arka planda `saveToStore()`; `saveToStore()` dolu alanlar için
`invoke('set_api_key')`; `loadFromStore()` her sağlayıcı için ayrı try/catch ile `get_api_key` + `key_status`.

### 5.3 `store/workspace.ts` → `useWorkspaceStore`

- `root/label/approvalMode/recent` tutar, persist `macrocode-workspace`
  (`recent`: son 5 klasör — `WorkspaceRecentEntry {root, label}`, secret içermez).
- `root` doluysa normal chat yerine agent yolu çalışır (`useAgent`).
- `/root` ile seç (argümansız = Tauri'de **yerel klasör diyaloğu**; `off` = kaldır,
  `1..5` = recents geçişi, `<yol>` = elle giriş), `/files` ile listele.
- Tüm `/root` dalları tek yoldan geçer: `App.tsx → applyRoot()` →
  `lib/workspace.ts` SAF katmanı (`validateRootInput`: normalize + label +
  `rootForbidCode` reddetmeleri [boş/bağıl/kök/sistem/home/hassas dizin]) →
  `checkRootExists()` (Rust `list_dir` jail'i üzerinden varlık kontrolü) →
  `setWorkspace()` (`store/workspace.ts`, `pushRecent` saf güncelleme).
- UI giriş noktaları: Titlebar `workspace-chip` (açılır menü: seç / son klasörler
  / kaldır), StatusBar klasör rozeti (tıkla → diyalog), Welcome agent ipucu.
- Boot'ta persist edilmiş kök artık yoksa `!` uyarı satırı düşer
  (otomatik silme yok — kullanıcı karar verir).

---

## 6. Kalıcılık Katmanı — Öncelik: **SQLite > localStorage**

### 6.1 `lib/db.ts`

```typescript
DB_URL          = 'sqlite:sessions.db'
SESSIONS_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);'
PENDING_APPROVALS_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS pending_approvals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, call_data TEXT NOT NULL, run_state TEXT, created_at INTEGER NOT NULL);'
META_ID         = '__meta__'   // aktif session id bu satırda tutulur
```

- **Şema:** tek tablo, her satır bir session'ın **tam JSON**'u. Meta satır: `{"activeSessionId": "..."}`.
- `openDb()` — Tauri değilse `null`. Hata → `null` (localStorage'a düş) **+ hata `sqlError()` ile
  okunabilir** (Faz 7 A1: DB açılamadıysa boot'ta kullanıcıya `!` uyarı satırı düşer —
  sessiz kalıcılık düşüşü artık görünür).
- `openSql()` — **paylaşılan** bağlantı (db.ts + `engine/approvals.ts` aynı bağlantıyı kullanır).
- `parseSession()` — JSON + `id` + `messages` doğrulaması; bozuk satır yok sayılır.
  Eski model ID'ler `migrateModelId` / `migrateProviderModel` ile hizalanır.
- `loadSessionsFromDb()` — `__meta__` hariç parser'dan geçirir; `activeSessionId` geçersizse ilk session'a düşer.
- `saveSessionsToDb()` — **transaction içinde `INSERT OR REPLACE` + stale silme + meta UPSERT**
  (`BEGIN IMMEDIATE` … `COMMIT`, hatada `ROLLBACK`).

### 6.2 Gecikmeli Yazıcı: `createSessionPersister(save, delayMs = 800)`

- `schedule()` pending'i günceller ve timer'ı **sıfırlar** (debounce).
- 800 ms sessizlik sonra tek yazma → **streaming sırasında her token'da DB'ye yazılmaz.**
- `flush()` bekleyeni anında yazar (cleanup/unmount için).

### 6.3 Boot'ta Öncelik Sırası (App.tsx)

```
1. useSettingsStore.loadFromStore()   → keys.json'dan anahtarlar + keyStatus
2. loadSessionsFromDb()               → başarılı ve doluysa state'i DB ile DEĞİŞTİR
2b. saveSessionsToDb(...)             → Faz 9 P9.0: mevcut durum DB'ye bir kez yansıtılır
                                       (yazma yalnızca state değişince tetiklendiği için
                                        DB aksi halde boş kalıyordu)
3. Aktif session yoksa createSession()
4. Yalnızca İLK boot'ta ve boş ilk session'da boot sequence satırları (100ms aralık)
```

`bootedRef` — StrictMode çift-çalışmasına karşı guard.

---

## 7. AI Provider Katmanı (`src/lib/providers/`)

### 7.1 Ortak Arayüz (`common.ts`)

```typescript
interface StreamChunk { text: string; done: boolean; error?: string; usage?: TokenUsage; toolCalls?: ToolCall[]; reasoning?: string; thinking?: ThinkingBlock[] }
interface ThinkingBlock { thinking: string; signature: string }
interface TokenUsage { input: number; output: number; reasoning?: number } // reasoning output'a dahil değildir, maliyete dahildir
```

interface ProviderConfig {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  messages: ChatItem[];     // role, content, images, toolCalls, toolCallId, toolName, isError
  onChunk: (chunk: StreamChunk) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  baseUrl?: string;           // Ollama taban URL
  tools?: ToolDefinition[];   // varsa tool-calling aktif (boş/undefined = text-only)
  params?: ModelParams;          // sanitizeParams çıktısı (boş = sağlayıcı varsayılanı)
}

interface AIProvider {
  name: Provider;
  models: Model[];
  stream(config: ProviderConfig): Promise<void>;
  validateKey(key: string, fetchImpl?: typeof fetch): Promise<boolean>;
}
```

`ProviderError extends Error` — `status?: number` taşır.
`TokenUsage` negatif/NaN'ı 0'lar, ikisi de 0 ise `undefined` döner.

### 7.2 `feedSSELines(body, onPayload, signal)` — Tek SSE Okuyucu

- `data: {...}` (OpenAI/Gemini/Anthropic) **ve** çıplak `{...}` (Ollama) satırları kabul edilir.
- `:` yorum, `event:`, boş satırlar **atlanır**. `data: [DONE]` → durur.
- `onPayload` `true` dönerse durur (Ollama `done:true`).
- Abort → `reader.cancel()` + döngü kırar; `finally` listener temizler + `releaseLock()`.

### 7.3 `formatProviderError(err)` — Türkçe hata mesajları

| Durum | Mesaj |
|---|---|
| `AbortError` | `null` (**sessiz çıkış**) |
| 401 / 403 | `✗ api hatası (401): geçersiz API anahtarı · /key ile güncelleyebilirsin` |
| 429 | `✗ rate limit: çok fazla istek · birkaç saniye bekle` |
| 400/413 + context/token ifadesi | `✗ context limit: konuşma çok uzadı · /reset ile sıfırla` |
| 400/413 (diğer) | `✗ istek hatası ({s}): {msg} · /help ile komutlara bak` |
| ≥500 | `✗ sunucu hatası ({s}): sağlayıcı şu an yanıt vermiyor · sonra tekrar dene` |
| diğer status | `✗ api hatası ({s}): {msg}` |
| `TypeError` (ağ) | `✗ ağ hatası: sunucuya ulaşılamıyor · internet bağlantını kontrol et` |
| bilinmeyen | `✗ bilinmeyen hata: {msg}` |

> **Stack trace asla terminal'e yazılmaz.**

### 7.4 Sağlayıcılar

| | Endpoint | Kimlik | Stream | Modeller |
|---|---|---|---|---|
| **anthropic** | `POST https://api.anthropic.com/v1/messages` | `x-api-key` + `anthropic-version: 2023-06-01` | `content_block_delta/text_delta` | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1` (hepsi 1M context, vision; maxOutput model bazlı, istekte `min(maxOutput,16384)`) |
| **openai** | `POST https://api.openai.com/v1/chat/completions` | `Authorization: Bearer` | `choices[0].delta.content` | `gpt-6.1-sol` (default), `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` (1.05M) |
| **gemini** | `POST .../v1beta/models/{model}:streamGenerateContent?key=…&alt=sse` | query `key` | `candidates[0].content.parts[].text` | `gemini-3.8-flash` (default), `gemini-3.5-flash`, `gemini-3-pro` (1M) |
| **ollama** | `POST {baseUrl}/api/chat` | yok (yerel) | çıplak JSON → `message.content` | `llama3.1`, `llama3.3` (default), `mistral`, `qwen2.5`, `qwen3`, `codellama` |
| **openrouter** | `POST https://openrouter.ai/api/v1/chat/completions` | `Authorization: Bearer` | OpenAI-compatible | `openrouter/auto` (default), `anthropic/claude-sonnet-5.5` (noktalı!), `openai/gpt-6.1-sol`, `deepseek/deepseek-chat`, `x-ai/grok-4.7` |
| **deepseek** | `POST https://api.deepseek.com/v1/chat/completions` | `Authorization: Bearer` | OpenAI-compatible | `deepseek-chat` (tools), `deepseek-reasoner` (reasoning, toolsuz) |
| **xai** | `POST https://api.x.ai/v1/chat/completions` | `Authorization: Bearer` | OpenAI-compatible | `grok-4.20` (default), `grok-4.7`, `grok-latest` |

**Sağlayıcıya özel detaylar:**

- **Anthropic — TEK RUST YOLU + fallback (Faz 4, K7):** Tauri'de tool'lu/görsel/thinking dahil tüm istekler **Rust proxy**'den akar (`rustStream.ts` → `invoke('stream_anthropic')`); gövde TS'de `buildAnthropicMessages` ile kurulur, Rust saf proxy'dir (tool_use + thinking/signature + vision base64 + usage). Rust yolu **yanıt başlamadan** düşerse (TLS/ağ) fetch'e geri dönülür (metin aktıysa düşülmez — çift ekleme yok). Tarayıcı-dev/test enjeksiyonu doğrudan `fetch` kullanır. Thinking blokları imzalarıyla aynen geri gönderilir (sıra kuralı). `max_tokens` model bazlıdır (`min(maxOutput,16384)`, bilinmeyende 4096). `systemPrompt` boş değilse `system` eklenir. Mesajlar `buildAnthropicMessages` ile kurulur (tool_result birleştirme + thinking imzalı taşıma). `validateKey`: `sk-ant-` prefix + uzunluk format kontrolü (ücretli çağrı yok).
- **OpenAI:** o-serisi (`/^o\d/`) `system` kabul etmez → `developer` rolü. `validateKey`: `GET /v1/models`.
- **Gemini:** `assistant` → `model` rolü; system'ler `system_instruction`'da birleşir. `validateKey`: `GET /v1beta/models?key=…`.
- **Ollama:** `DEFAULT_OLLAMA_URL = 'http://localhost:11434'`; `validateKey`: `GET {base}/api/tags`.
- **Vision:** Anthropic blocks / OpenAI `image_url` / Gemini `inline_data` / Ollama `images`. Vision'suz modelde erken err verilir.

**Sistem rolü mesajları (Faz 7 A2) — provider ortak kuralı:**

Compaction özeti (`role: 'system'`) ve kalıcı sistem mesajları **hiçbir provider'da
konuşma ortasında `system` rolü olarak gönderilmez**:

| Provider | Davranış |
|---|---|
| Anthropic | `buildAnthropicMessages` system mesajlarını **düşürür**; metin `systemTextOf(messages)` ile istek gövdesinin `system` alanına eklenir (Rust yolu dahil). Anthropic `messages` dizisinde system rolü kabul etmez — düşürülürse özet modele hiç ulaşmaz. |
| OpenAI-uyumlu | Sistem metni baştaki `system`/`developer` mesajıyla birleşir (`withoutSystemMessages` ile mesaj listesinden çıkarılır). |
| Ollama | Aynı: tek `system` mesajı. |
| Gemini | `system_instruction` içine alınır (zaten doğru davranış). |

Yardımcılar: `common.ts` → `systemTextOf(messages)` / `withoutSystemMessages(messages)`.

### 7.5 Registry (`providers/index.ts`) + `openaiCompatible.ts` + `rustStream.ts`

- `PROVIDER_DEFS` + `PROVIDER_IDS` + `PROVIDERS` (7 provider). `ALL_MODELS` registry'den türetilir.
- `getModel/getCapabilitiesForModel/supportsToolsForModel/getMaxOutputForModel/getProviderForModel`, `isKnownModel`.
- `suggestProvider()` — `/provider` ve `getProvider` hatasında "bunu mu demek istedin" önerisi.
- `resolveModels(customs)` — registry + elle eklenenler (çakışmada custom kazanır);
  `isModelEnabled(disabled, id)` liste filtresidir. Capability/maxOutput/provider lookup'lar
  opsiyonel `customs` parametresi alır (verilmezse registry).
- `validateDetailed()` (`validate.ts`) — 3 durumlu bağlantı testi (bağlı/geçersiz/ağ hatası); `validateKey` davranışı değişmez.
- `sanitizeParams()` (`params.ts`) — thinking topP'yi ezer, geçersizi atar. Eşleme:
  Anthropic (temperature/top_p/thinking, thinking'te temp=1 + top_p yok + fetch yoluna düşer),
  OpenAI-uyumlu (temperature/top_p, 16k tavan), Gemini (`generationConfig`), Ollama (`options`).
- Özel uçlar registry DIŞI: `custom.ts` (`makeEndpointId/parseEndpointModels/buildCustomProvider`)
  runtime'da OpenAI-uyumlu provider üretir; `ALL_MODELS`'a girmez, sohbet akışıyla sınırlıdır.
- `REMOVED_MODEL_MAP` + `migrateModelId/migrateProviderModel` — eski ID'ler güncel karşılıklarına taşınır (özel/boş ID korunur).
- `rustStream.ts` → `streamAnthropicViaRust()` (Tauri `Channel` + `invoke`, reasoning/tool_calls/thinking olaylı), `toProviderError`, `isTauriRuntime()`.

### 7.5.1 Prompt Cache (Faz 11)

- **Anthropic:** sistem bloğu + son kullanıcı/tool bloğu `cache_control: {type:'ephemeral'}`.
  **Kural:** önek < 1024 token (Haiku: 2048) ise API isteği **reddeder** → işaret yalnızca
  eşik + güvenlik payı aşıldığında konur (`promptCache.ts` → `cacheableBySize`).
  Rust proxy yolu ve fetch yolu aynı gövdeyi kullanır.
- **OpenAI-uyumlu:** oturuma bağlı `prompt_cache_key` (FNV-1a hash, ≤ 64 karakter).
- **Ayar:** `cachePrompts` (varsayılan açık) — ⚙ ayarlar → Sohbet. Kapalıyken hiçbir
  önek sağlayıcı tarafında saklanmaz.
- **Sayaç/fiyat:** `cache_read`/`cache_write` tokenları `TokenUsage`'a girer;
  `pricing.ts` cache'li kısım için ayrı fiyat uygular (fiyat yoksa girdi fiyatına düşer).
- **Görünürlük:** `/tokens` → `önbellek: X okuma · Y yazma`.

### 7.6 models.dev Kataloğu (`providers/modelsDev.ts` + `providers/catalog.ts`)

Açık model kataloğu `https://models.dev/api.json` (232 sağlayıcı / 9061 model) —
uygulama yalnızca **6 yerleşik sağlayıcıya** ait kayıtları saklar (~480 model).
Ollama bu listede yoktur (yerel modeller `discoverOllama` ile bulunur).

- **`modelsDev.ts`** — `fetchModelsDevCatalog()` (Rust `proxy_fetch` üzerinden, CSP
  değişikliği gerekmez), `parseModelsDev()` (sağlayıcı kırpma + sohbet filtresi:
  `status=active`, giriş/çıkışta `text`, `limit.output > 0`), `MODELS_DEV_PROVIDERS`
  (gemini → `google`), localStorage önbelleği (`macrocode-modelsdev-catalog`, 24 saat TTL).
- **`catalog.ts`** — 3 aşamalı eşleştirme: **doğrudan** (sağlayıcı+id) →
  **canonical** (`canonical_model_id`) → **global id** (kapsamdaki başka sağlayıcı).
  Eşleşmezse yerleşik değerler korunur.
  `enrichModel()` kuralları: limitler **küçülmez** (`max`), yetenekler **kapanmaz**
  (`||`), `supportsVision === capabilities.vision` korunur. `description/family/
  releaseDate/modalities/reasoningOptions/catalogPrice` katalogdan gelir.
- **Aktif katalog singleton** — `setActiveCatalog()/getActiveCatalogIndex()`.
  `resolveModels()` ve tüm lookup'lar global indeksten beslenir (parametre
  zinciriyle uğraşmamak için). `store/settings.ts` → `setModelsDevCatalog()`
  hem store'u hem global'i günceller ve **fiyatları otomatik doldurur**
  (elle girilen `prices` satırları korunur — katalog ezmaz).
- **Cache kademeleri** — `ModelPrice { input, output, cacheRead?, cacheWrite? }`;
  `pricing.ts` cache'li tokenları kendi kademesinden hesaplar (fiyat yoksa girdi
  fiyatına düşer). Provider'lar cache tokenlarını parse eder: Anthropic
  (`cache_read_input_tokens` + `cache_creation_input_tokens`, toplam prompt'a
  normalize edilir), OpenAI-uyumlu (`prompt_tokens_details.cached_tokens`,
  DeepSeek `prompt_cache_hit_tokens`), Gemini (`cachedContentTokenCount`).
- **Registry genişletmesi** — `resolveModels()` = elle **çekirdek** (27 model,
  `ALL_MODELS`) + katalogdaki **diğer** modeller (`catalogModels()`, ~467) +
  `customModels`. Çakışmada çekirdek satırı korunur (katalog metadata'sıyla
  zenginleşir). Katalog yoksa `base === ALL_MODELS` referansı korunur
  (test kontratı `toBe(ALL_MODELS)` bozulmaz). Toplam **~494 model**.
- **API anahtarı kuralı** (`providers/visibility.ts`) — anahtarı olmayan sağlayıcının
  modelleri **hiçbir listede görünmez** (`ollama` hariç — URL yeterli).
  `hasProviderKey()` / `visibleModels()` / `hiddenProviders()` saf fonksiyonlardır.
  Uygulama: Titlebar açılır listesi (arama kutusu + "🔑 … anahtar ekle" satırı),
  Ayarlar > Modeller + Sohbet (aynı filtre + "anahtar ekle"), `/model` komutu
  (sağlayıcı başına model sayısı; anahtarsız sağlayıcı uyarı satırı).

---

## 8. Akış Kontrolü — `hooks/useStream.ts` + `hooks/useAgent.ts`

```typescript
const { send, abort } = useStream();
const { sendAgent } = useAgent();
```

**`send(text)` akışı (+ özel uç dalı):**

1. Boş metin veya `isStreaming` ise sessiz `null`.
2. Aktif session yoksa `createSession()`.
3. `providerName = session.provider ?? settings.currentProvider`, `model = session.model || settings.currentModel`.
   `settings.activeEndpointId` doluysa özel uç akışı: model uçta tanımlı olmalı, anahtar
   `customSecrets`'tan alınır, `buildCustomProvider` ile OpenAI-uyumlu istek atılır
   (agent motoru özel ucu reddeder — `useAgent` erken hata döner).
   `modelParams[model]` her iki akışa da `params` olarak geçer.
   `fallbackModel` doluysa (yerleşik akış): ilk hata + metin akmadıysa tek retry,
   `onFallback` ile `/// yedek model kullanıldı` satırı yazılır.
4. Ollama dışı sağlayıcıda anahtar boşsa → `✗ api anahtarı eksik · /key ile ekleyebilirsin`.
5. `setStreaming(true)`; user mesajı + **boş assistant placeholder** peş peşe eklenir (sabit `userId`/`assistantId`).
6. Geçmiş = `assistantId` hariç + boş içerikler filtrelenir → `{role, content}`.
   Faz 2: gönderim öncesi `budgetFor`/`shouldCompact` kontrolü — aşımda özetleyici modelle
   `compactHistory` + `/// context özetlendi (compaction)` satırı (özet tur başlatmaz).
   **Faz 7:** compaction sonucu `engine/compactionMemo.ts` hafızasına yazılır; sonraki
   gönderimlerde geçmiş "özet + o özetten sonraki mesajlar" olur → **her tur yeniden
   özetleme yapılmaz** (maliyet). `applyMemo(memo, items)` birleştirir.
7. `AbortController` + `getProvider(...).stream({...})`; `chunk.usage` biriktirilir, `chunk.text` → `updateLastMessage`.
8. Başarı/abort → biriken `usage` `setMessageUsage` ile yazılır.
9. Hata: abort ise sessiz; değilse boş placeholder `removeMessage` ile silinir + `formatProviderError(err)` döner.
10. `finally`: `setStreaming(false)`.

**`sendAgent(text, pushExtra)` akışı (workspace seçiliyse):**

- History **son 200 mesaj** + tool alanlarıyla (`AgentHistoryItem[]`, `system+toolCallId` → `role:'tool'`;
  kesitte kopan tool çifti geriye taramayla tamamlanır). Kesme artık güvenlik üst sınırıdır;
  asıl sınır **token bütçesidir** (`budgetFor`: window × 0.6 → `shouldCompact`).
  (Faz 7: sabit `-40` kesme bütçeyi hiç aşmadığı için otomatik compaction hiç tetiklenmiyordu.)
  Geçmiş kurulumu saf fonksiyondadır: `engine/agent.ts` → `buildAgentHistory(messages, assistantId)`
  (Faz 8 denetimi: kullanıcı mesajı hem geçmişte hem `historyWithUser` ile **iki kez**
  gönderiliyordu → tekilleştirildi).
  Gönderim öncesi token bütçesi aşılırsa otomatik compaction: eski mesajlar özetleyici modelle
  özetlenip (`[özet · tarih]` system mesajı) son ~%50 bütçe korunarak istek küçültülür (Faz 2).
  Özet `engine/compactionMemo.ts` hafızasına yazılır (tekrar özetlenmez).
- **Faz 7 A3:** agent'ın yazdığı metin **tek assistant mesajına** yazılır
  (`appendToMessage(sessionId, assistantId, delta)`). Tool sonuçları araya girdiğinde
  "son mesaj assistant olmalı" kuralı cevabı parçalıyordu.
- `createAgentRun` (Faz 1 G2; legacy `runAgent` Faz 8 L8'de silindi) turları koşar; `tool_call`/`tool_result`/
  `tool_preview` eventleri extras'a + kalıcı katmana (`appendToolCalls`/`addToolMessages`) yazılır.
- Onay-bekleyen tool'da `needs-approval` ile durur → `pending_approvals` (SQLite + bellek) +
  `pendingBySession` UI (`Terminal` satır içi `[ONAYLA ✓ Enter] [REDDET ✗ Esc]`, `InputBar` boşken
  Enter/Esc; **O1 (Faz 4):** exec onayı kırpmasız `exec · cmd args` + `⚠` kod-çalıştırma-uyarısı
  satırı, `execApprovalWarning`). `resolve(approved)` → tool çalışır ya da `isError: true` "kullanıcı reddetti" ile
  **devam eder** (K2). `exec` reddedilse de hep onaylı kalır (K3). `/apply` aktif run varsa aynı
  `resolve` yolunu çağırır. **Y2 (Faz 3):** exec'in çalıştırılabilmesinin tek yolu `resolve`'tan
  gelen `approved: true` bayrağıdır (`toolExec` guard'ı); `extraAllow` tüm `defaultRunTool`
  çağrılarına aktarılır.
- Retry: `withRetry` (yalnızca 429/≥500 + `TypeError`, 400/401/abort asla; baseMs*2^attempt+jitter,
  tavan 4000ms) `useStream` + agent `streamOneTurn` tek noktasından sarar; `fallbackModel` korunur.
- **Faz 9 (P9.1–P9.4) — repo bağlamı:** agent'ın system prompt'una `[proje]` bloğu
  eklenir: (a) **harita** — dosya listesi (öncelik sırası: package.json → README → src/ →
  src-tauri/src/ → diğerleri; modelin context penceresine göre ölçekli, tavan 8k karakter),
  (b) **anahtar dosyalar** — `AGENTS.md` / `CLAUDE.md` / `README.md` (başına 2k karakter),
  (c) **kalıcı notlar** — `.macrocode/context.md` (son 4k karakter).
  Kaynak: `engine/repoContext.ts` (Rust `list_tree` + `read_file` + `memory_read`).
  Önbellek: aynı workspace + aynı dosya imzası → tekrar hazırlanmaz (1 IPC/tur).
  Komutlar: `/note <not>` (kalıcı not ekler), `/context` (agent'ın bildiklerini gösterir).
- **Faz 9 (P9.0 — B2) — `auto-edit` yazma düzeltmesi:** onaysız yazma yolunda
  `propose_patch`/`edit_file` üretilen pending patch **hemen uygulanır** (önceden yalnızca
  onay akışında uygulanıyordu → dosya değişmiyordu).
- **Faz 9 (P9.5 — B3) — hafıza kesimi id tabanlı:** compaction hafızası artık
  `coveredIds` ile kesiyor (zaman damgası kesimindeki "aynı ms" riski giderildi).
- **Faz 8 L1 — `subagent` aracı (11. çekirdek tool):** salt-okunur alt-agent
  (kendi bütçesiyle, `disallowTools` ile yazma/özyineleme kapalı) koordinatöre tek
  özet döner; alt-ajanın **metni** ana akışa ikinci kez akmaz (araç olayları geçer).
- **Faz 8 L2 — `plan` → `todo`:** plan adımları `plan-N` görev id'leriyle türetilir
  (`deriveTodoState`); agent `todo complete plan-2` ile işaretler.
- **Faz 8 L5 — skill'ler:** kayıtlı skill talimatları system prompt'a eklenir
  (`skillsPrompt(listSkills().map(...))`).
- **Faz 8 L6 — araç çıktısı görünürlüğü:** başarılı araç çıktısı da terminale düşer
  (`▸ read_file: …`, tek satır, kırpılmış).
- **Faz 7 A4:** kullanım sayacı **tur içi `max`**, **tur arası `sum`** (`sumUsage`).
  Tek istekte kümülatif gelen usage event'leri `mergeUsage` (max) ile birleşir; her tur
  ayrı bir istek olduğu için turlar toplanır. Aksi halde maliyet "en büyük tur" olarak raporlanıyordu.

> Slash komutları `send`'e gitmez; ayrıştırma `App.handleSend` içindedir (bkz. §9).

---

## 9. Slash Komutları (`lib/commands.ts`)

İşleyici **saf fonksiyondur** — store'a doğrudan dokunmaz; etkiler `CommandContext` ile enjekte edilir.

| Komut | Davranış |
|---|---|
| `/help` | 15 satır komut listesi |
| `/clear` | Sadece görünümü temizler (`clearedBefore`) |
| `/reset` | Mesajları siler (`clearSession`) |
| `/session` | Yeni session |
| `/model` / `/model <id>` | Aktif modeli gösterir / ayarlar (bilinmeyense uyarı + registry/custom capability satırı) |
| `/provider <p>` | Sağlayıcıyı doğrular + ayarlar (7 provider; yazım hatasında öneri) |
| `/key` | Ayarlar modalını açar |
| `/export` / `/export md` | Markdown indirir |
| `/export json` / `/backup` | JSON yedek indirir |
| `/tokens` | Gerçek usage varsa gerçek, yoksa karakter/4 approx; fiyat varsa `· maliyet ~$X` (kısmi fiyatta not) |
| `/system <text>` | System prompt günceller |
| `/root` `/files` `/apply` `/undo` `/skill` `/compact` `/audit` `/approval` `/note` `/context` | `/root` (argümansız=klasör diyaloğu · `off` · `1..5` · `<yol>` — hepsi `applyRoot` tek yolundan: SAF doğrulama → Rust `list_dir` varlık → `setWorkspace`) `/files`/`/skill`/`/compact`/`/audit [n]`/`/approval [m]` `App.tsx handleSend`'de; `/apply` aktif run varsa `resolve` yolundan devam eder, yoksa doğrudan `applyPendingPatch` (kalıcı `pending_approvals` + bellek `PendingPatch`). **Faz 8 L7:** `/approval manual\|auto-read\|auto-edit` onay modunu değiştirir (`auto-edit` seçilirse uyarı satırı düşer). **Faz 9:** `/note <not>` kalıcı proje notu ekler, `/context` repo bağlamını gösterir. |
| bilinmeyen | `✗ bilinmeyen komut · /help ile listeye bak` |

**Yardımcılar:** `approxTokens` (karakter/4), `realTokens`, `formatTokenCount` (k kısaltması),
`tokenSummaryLine`, `buildExportMarkdown`, `buildSessionBackup`/`parseSessionBackup`/`normalizeSession`
(bozuk mesaj varsa dosya reddedilir; bilinmeyen provider → `anthropic` fallback; id çakışırsa yeni id).

**İndirme:** `Blob` → `URL.createObjectURL` → `<a download>` → 5sn sonra revoke.
Dosya adı `macrocode-session-YYYYMMDD-HHMM.{md,json}`.

**App köprüsü (`handleSend` sırası):** `/root|/files|/apply|/skill` → direkt workspace yolu;
diğer `/…` → `handleSlashCommand` (export varsa indir); değilse workspace varsa `sendAgent`, yoksa `send`.

---

## 10. Markdown Motoru (`lib/markdown.ts` + `lib/highlight.ts`) — Sıfırdan, Kütüphanesiz

### 10.1 Blok tokenizer (`tokenizeBlocks`)

| Blok | Not |
|---|---|
| Başlık | `#{1,6} ` → `h1`–`h6` |
| Paragraf | Boş satır veya yeni blok başlangıcında kesilir |
| Sırasız / sıralı liste | İç içe girinti alt öğe olur (`children`) |
| Görev listesi | `- [x]` / `- [ ]` → `checked: true/false` |
| Alıntı | `> ` satırları birleşir |
| Yatay çizgi | `---` / `***` / `___` (3+) |
| GFM tablo | Başlık + ayırıcı + satırlar |
| Kod bloğu | ```` ```lang ````; **kapanmamış blok dosya sonuna kadar kod** |

### 10.2 Satır içi (`tokenizeInlineRich`)

`` `kod` `` · `**kalın**` · `*italik*` · `~~üstü çizili~~` · `[metin](url)` · `![alt](url)`

- **Bağlantı şeması allowlist**: yalnız `http`/`https`/`mailto` + göreli yol + `#çapa`.
  `javascript:` / `data:` / `vbscript:` → düz metne düşer.
- **Görsel**: `data:image/*` ve `blob:` gömülür; uzak URL CSP (`img-src 'self' data: blob:`)
  dışı olduğu için **bağlantı olarak** gösterilir.
- `renderMarkdown`: yalnızca `createElement` + `createTextNode` + `textContent`;
  **`innerHTML` YOK → XSS koruması**. Regresyon testi `lib/markdown.test.ts` (kaynak düzeyinde).

### 10.3 Sözdizimi renklendirme (`lib/highlight.ts`)

- Bağımlılıksız (shiki/prism/hljs **YOK** — proje kuralı).
- Diller: ts/tsx/js/jsx · python · rust · go · json · bash/sh · sql · css · yaml · diff · xml.
- Token sınıfları: `hl-key` `hl-str` `hl-num` `hl-com` `hl-fn` `hl-type` `hl-pun`.
- Çok satırlı blok yorumlar state ile takip edilir.
- Bilinmeyen dil → düz metin (çökmez).

### 10.4 Kullanım

- `type==='ai'` ve thinking değilken her delta'da yeniden render.
- `MessageLine` `React.memo` ile sarmalanır → tamamlanmış mesajlar yeniden render edilmez.

---

## 11. UI Bileşenleri

> Görsel yeniden tasarım (2026-10-19) sonrası güncel mimari. Prototip ve faz planı:
> `~/.opencode/plan/macrocode-gorsel-yeniden-tasarim.md` · `prototype/index.html`

### 11.1 Layout (`App.tsx`)

```
┌──────────────────────────────────────────────────────────────┐
│ [◀◀◀]  ◆ MacroCode · oturum adı      [📁 workspace] [model ▾] │ ← Titlebar 40px
├──────────┬───────────────────────────────────────────────────┤
│ OTURUMLAR│                                                   │
│  ▸ liste │   Terminal (scroll)                               │
│  ▸ liste │                                                   │
│  ▸ liste │                                                   │
├──────────┴───────────────────────────────────────────────────┤
│ ❯ mesajını yaz…                                     [Gönder] │ ← InputBar
├──────────────────────────────────────────────────────────────┤
│ ● anthropic │ model │ ctx 12.4k/1M │ ↑8.2k ↓1.1k │ ⚠ 2 onay │ ← StatusBar 24px
└──────────────────────────────────────────────────────────────┘
```

- Yerel state: `settingsOpen`, `extrasBySession` (cap 200 + ilk kırpma
  `extrasCapped` satırı), `clearedBefore`, `pendingBySession`.
- **Global kısayollar (pencere `keydown`, Faz 4):** `Ctrl+N` yeni oturum ·
  `Ctrl+Tab` / `Ctrl+Shift+Tab` oturum gezinmesi · `Ctrl+C` **yalnız seçim yokken**
  ve akış sürüyorsa iptal (seçim varsa normal kopyalamaya bırakılır). Hepsi
  `e.isComposing` ile IME'ye kapalı; ayarlar modalı açıkken pasif.
- **Genel onay + hata tekrarı (Faz 3/4):** `confirmState` → kökte tek
  `ConfirmDialog` (Sidebar oturum silme); `pushExtra(err, retry)` →
  `handleSendRef` ile aynı girdiyi yeniden gönderir ("tekrar dene").
- SQLite yansıtma: store `subscribe` → `persister.schedule(...)`; cleanup'ta `flush()`.
- Silinen session'ların `extras/clearedBefore/pending` kayıtları budanır.
- Görünüm tercihleri `<html>` niteliklerine yazılır: `data-contrast`, `data-uifont`.
- Boot `///` satırları **kaldırıldı** — boş oturumda karşılama ekranı gösterilir,
  durum bilgisi status bar'da yaşar.

### 11.2 `Titlebar.tsx`

- `data-tauri-drag-region` (özel Titlebar, `decorations: false`).
- **Sol hizalı kimlik kümesi**: logo (18px) + "MacroCode" + oturum adı (ellipsis).
  Gerçek "ortalanmış başlık" dar pencerede model rozetiyle çarpışıyordu.
- Pencere düğmeleri platforma göre: macOS traffic light · Windows/Linux kare glifler.
- Workspace rozeti (yalnız `/root` ayarlıysa) — tıklanınca klasör diyaloğu
  açılır (`App.tsx → runRootCommand('')`); ayrıca açılır **workspace menüsü**:
  seç / son 5 klasör (tıkla → `/root <n>` yolu) / workspace'i kaldır (`off`).
- **Model rozeti (pill)**: durum noktası + **görünür ad** (`Claude Opus 5.5`) + sağlayıcı
  + chevron. Ham model id'si gösterilmez.
- **Açılır liste (Faz 7 → `ModelDropdown.tsx` ortak paneli)**: arama kutusu +
  sağlayıcı grupları + **klavye navigasyonu** (↑↓ Home End Enter Esc,
  `aria-selected`) + yetenek ikonları (🛠/👁/🧠 → SVG) + "anahtar ekle" satırı.
  Panel `ModelPicker` ile paylaşılır; Esc yalnız paneli kapatır (React
  baloncuğu `stopPropagation` — modalı kapatmaz), ok tuşları panel dışına sızmaz.

### 11.3 `Sidebar.tsx`

- 240px (180–420 arası **sürüklenebilir**, `⌘B`/düğme ile 56px ikona daralır).
- Başlık: "OTURUMLAR" + adet çipi + `+` (yeni oturum artık tepede).
- Arama kutusu (her zaman görünür).
- Oturumlar **zaman gruplarına** ayrılır: Bugün / Dün / Bu Hafta / Daha Eski.
- Satır: ad + sağlayıcı/model + göreli zaman + mesaj sayısı; hover'da **kalem
  (yeniden adlandır)** + **çöp kutusu (sil)**. Satır `div role="button"` (içindeki
  gerçek butonlar geçerli); çift tık veya kalem → satır içi input (Enter kaydet ·
  Esc iptal · blur commit; açılışta ad seçili). Silme → App kökündeki genel
  `ConfirmDialog` (danger + odak iptalde).
- Footer: yeni oturum · ayarlar · 4 ikon butonu (temizle, dışa aktar, içe aktar, daralt).

### 11.4 `Terminal.tsx`

- Mesajlar + extras **birleştirilir** (sort yok — mesajlar kronolojik, extras en yeni).
- **3 kolonlu grid**: gutter (22px) | içerik (1fr) | meta (112px). Meta kolonu
  çok satırlı (sağa hizalı): saat / model / token.
- Araç çağrıları **id ile eşleştirilir** (çağrı + sonuç tek kartta birleşir).
- Boş oturum → `<Welcome />` (logo + ürün adı).
- Otomatik scroll (120px stick eşiği) + "yeni mesaj" butonu.
- **aria-live (Faz 7):** `.terminal-view` → `role="log" aria-live="polite"`
  `aria-relevant="additions"` — ekran okuyucu yalnız yeni satırları duyurur
  (akış metin değişimi sessiz); streaming caret `aria-hidden`.
- **Konuşma içi arama (Ctrl+F):** saf motor `lib/search.ts` (`findHits` satır bazlı,
  `stepHit` tur gezinmesi). Üstte `.term-search` çubuğu: `aria-live` sayaç
  (`2 / 5`), `Enter`/`Shift+Enter` gezinme, `Esc`/✕ kapatır **ve giriş alanına odak
  döner** (`InputBar.focusRef`). Eşleşen satır `match-hit`, aktif eşleşme
  `match-current` (accent kenarlık); `data-line-key` çapası + `scrollIntoView`
  ortalama; streaming yapışması (`stickRef`) aramada kapatılır. Eşleşme araması O(1)
  `hitMap`. Ayarlar modalı açıkken devre dışı (`searchEnabled`); oturum değişince kapanır.
  Satır kopyalama: `useCopy()` → `onCopy` her `MessageLine`'a bağlı (toast `message.copyOk`).

### 11.5 `MessageLine.tsx`

- `msg msg-{type}` + 3 kolonlu grid. `ai` → markdown; `user` → **kart**
  (`--bg-inset` + `--col-user` sol çubuk); `sys/err/warn` → log satırı.
- `///` · `✗` · `!` işaretleri içerikten **gutter'a taşınır** (çift işaret olmaz).
- AI mesajı sol ray (`--accent-line`) ile ayrışır — kart değil (akış "belge" hissi).
- Reasoning: `<details>` bloğu + canlı düşünüyor göstergesi (3 nokta nabız).
- Streaming caret (accent, glow'lu) + satır üstünde kopyala butonu (`onCopy` prop'u
  Terminal'den gelir; başarısızlıkta `message.copyFail` toast).
- `className` / `dataLineKey` prop'ları: arama vurgusu (`match-hit` / `match-current`)
  + DOM çapası (`data-line-key`) — memo karşılaştırması bunları da kapsar.
- **Stream throttle (Faz 4):** streaming sırasında markdown render trailing-edge
  ~50ms'de bir (`STREAM_RENDER_MS`); her delta'da tam parse yok, akış bitince
  içerik anlık senkronlanır (`isStreaming` etkisi).
- **"tekrar dene" (Faz 4):** `err` satırlarında `onRetry` butonu (`message.retry` +
  `refresh` ikonu, `.retry-btn`) — `App.handleSendRef` aynı girdiyi yeniden gönderir.
- `React.memo` + içerik/karşılaştırması → tamamlanmış mesajlar yeniden render edilmez.

### 11.6 `InputBar.tsx`

- `❯` + textarea + `[Gönder]`/`[Dur]` + görsel ekleme (canvas 1568px JPEG, max 4).
- **Odak halkası**: satır kutusu focus'ta accent kenarlık + 3px halka.
- `Enter` gönder · `↑/↓` geçmiş · `Ctrl+L` temizle. Meta bar: kısayollar + karakter/token.
- **IME guard (Faz 4):** `e.nativeEvent.isComposing` ise tüm tuşlar yok sayılır
  (Enter göndermez, ↑↓ geçmişi çağırmaz — Japonca/Çince/Korece bestesi bozulmaz).
- **Slash öneri menüsü** (`lib/commands.ts` → `filterCommands`, `.cmd-menu`): tek satırlık
  `/<komut>` yazımında inputbar üstünde açılır (boşluk = argüman aşaması). `↑↓` gezin ·
  `Tab`/`→` (imleç sonda) tamamla · `Enter` gönderir — zorunlu argümanlı komutlarda
  (`/provider`, `/note`) yalnız tamamlar ve imleç argümana geçer · `Esc` kapatır.
  Onay kartı kısayolları (Enter onay / Esc reddet) popup'tan önce gelir; aktif satır
  `scrollIntoView` ile görünürde tutulur. `submit()` ham metin override'ı alır
  (popup Enter birleştirmesi state yarışına girmez).
- **Tek görsel ekleme hattı (Faz 5):** `attachImages(files: FileList | File[])` —
  buton dosya seçici, panodan yapıştırma (`onPaste` → `clipboardData.items` içinde
  `image/*` varsa `preventDefault` + hattı çalıştırır; düz metin varsayılan akar) ve
  sürükle-bırak (`.inputbar-inner` `onDragEnter/Over/Leave/Drop`) aynı fonksiyonu
  çağırır: max 4 (odaya göre dilim), yalnız `image/*`, ≤1568px JPEG. Dosya
  sürüklemede `.dropping` kesikli accent vurgu + `drop-hint` (`input.dropHint`,
  `role="status"`) görünür; `preventDefault` her koşulda (aksi hâlde webview dosyayı
  açmaya çalışır), `dragDepthRef` çocuk eleman titremesini engeller. Streaming'de
  buton gizliyken paste/drop da yok sayılır.
- **Agent modu seçici (`ModeSelector.tsx`):** sağdaki rozet + açılır liste
  (build 🔧 / plan 📋 / ask 💬), `session.agentMode`'a yazar (`App.onModeChange` →
  `setAgentMode`); streaming'de gizli. `/mode`+`/build`+`/plan`+`/ask` komutları
  aynı state'i değiştirir. Mod araç süzme + sistem promptu talimatı
  `lib/engine/agentModes.ts`'te (bkz. § motor).

### 11.7 `useKeyHistory.ts`

- `historyPush`: boş ve art arda tekrar yok sayılır; son 50 öğe.
- `historyMove`: `up` taslağı saklar, `down` `-1`'de draft'ı geri koyar.
- **Persist (Faz 3):** `macrocode-keyhistory` localStorage anahtarı — modül
  düzeyinde tek depo (tek InputBar), ilk erişimde `parseStoredHistory` ile
  yüklenir (bozuk kayıt → boş geçmiş), `push` yazma anında kalıcı yazar.
  `resetKeyHistory()` dışa aktarımlıdır ve `/reset` komutuna bağlıdır
  (session + compaction özetinden sonra giriş geçmişi de temizlenir).

### 11.8 `SettingsModal/` — sekmeli ayarlar

**Kabuk (Faz 13 — kullanıcı dostu ayarlar):**

- 960px modal (max 94vw / 88vh), **ikonlu sekme rayı** (200px + arama), sağ içerik,
  sticky alt bar ("kaydedilmemiş değişiklikler" + Vazgeç/Kaydet) + **X kapatma butonu**.
- **Kaydedilmemiş değişiklikle kapatma:** `Escape` · overlay tıklaması · X · Vazgeç →
  `dirty` ise `ConfirmDialog` ("Kaydet ve kapat" / "Değişiklikleri iptal et").
  Odağı güvenli tarafa (iptal) verilir; `Enter` onaylar, `Escape` iptal eder.
- **Odak döngüsü (focus trap):** `hooks/useFocusTrap.ts` — modal açılışında aktif sekme
  düğmesine odaklanır, `Tab`/`Shift+Tab` modal içinde döngüde kalır, kapanışta odak
  modal öncesi öğeye döner. Diyalog kendi döngüsünü kurar ve tuş olaylarını
  `stopPropagation` ile modalın Escape/Tab işleyicisine sızdırmaz.
- **Sekme klavye navigasyonu:** `role="tablist"` + roving `tabindex` (`↑↓ ←→ Home End`),
  `aria-selected` / `aria-controls` / `aria-labelledby` bağlantıları. Mantık saf
  fonksiyondur: `SettingsModal/types.ts` → `nextTabIndex()`.
- **Sekme state korunumu:** ziyaret edilen sekmeler mount'ta kalır, `hidden` ile
  gizlenir (`visited` dizisi) → arama metni, süzgeç ve keşif sonuçları sekme
  değiştirince kaybolmaz. Sekme değişince içerik kaydırması başa döner.
- **Sekme sıfırlanmaz:** modal her açılışta son kullanılan sekmede açılır
  (odaklama tutarlılığı + kullanıcı kaldığı yerden devam eder).

**Sekme içerikleri (Faz 13 — yeniden yapılandırılmış):**

| Sekme | İkon | İçerik |
|---|---|---|
| **Sağlayıcılar** | key | 4 bölüm: *Bulut sağlayıcıları* (2 kolon kart + "Tümünü test et" + "Anahtar al" bağlantısı + aktif rozeti) · *Yerel sağlayıcı* (Ollama) · *Özel taban URL* (fabrika adresi placeholder + "sıfırla") · *Özel uçlar* |
| **Modeller** | cpu | 3 **alt sekme**: `Liste` (varsayılan model + arama/süzgeç + model tablosu) · `Katalog & keşif` (openrouter/ollama/openai/gemini/models.dev) · `Elle ekle` (id · ad · sağlayıcı · bağlam · çıktı · yetenekler) |
| **Parametreler** | sliders | 2 **alt sekme**: `Model parametreleri` (temperature/top_p/max tokens/thinking + "Varsayılanlara dön" + **yedek model**) · `Fiyatlar` (arama + süzgeç + girdi/çıktı/cache başlıklı tablo + katalog fiyatları) |
| **Sohbet** | message | Davranış (system prompt + karakter sayacı, özetleyici sağlayıcı/model) · Cevap davranışı (düşünme bloğu, prompt önbelleği) · Araçlar (shell allowlist + **geçersiz satır uyarısı**, denetim) |
| **Görünüm & Dil** | globe | Görünüm (yazı boyutu + ölçek, yüksek kontrast, arayüz fontu, saat biçimi, **zaman damgası**) · Dil (arayüz dili, sayı biçimi) |
| **MCP** | activity | MCP sunucu listesi (ad, transport, komut/URL, **anahtar (Switch)**, keşif, **maskeli env**, **keşfedilen araçlardan izin seçimi**) |
| **Hakkında** | info | logo, sürüm, lisans, gizlilik notu |

**Yeniden yapılandırma kararları:**

- **Sekme sayısı 6 → 7.** Önceden "Modeller" sekmesi **6 ayrı işi** tek sayfada
  barındırıyordu (varsayılan model · 200 satırlık tablo · keşif/katalog · elle
  ekleme · parametreler · yedek model · 120 satırlık fiyat tablosu · 120 satırlık
  aç/kapa listesi). Artık işler bölündü.
- **Çift tanım kaldırıldı:** `clockFormat` ve `contrast` hem `ChatTab`'te hem
  `LangTab`'ta tanımlıydı → artık **yalnızca** "Görünüm & Dil" sekmesinde.
- **`LangTab.tsx` silindi** → `AppearanceTab.tsx` (görünüm + dil birlikte).
- **Ölü UI kaldırıldı:** `LangTab`'daki "Sayı biçimi" iki adet `disabled`
  butondu (hiçbir işlevi yok) → tek satır not.
- ** Yinelenen aç/kapa listesi kaldırıldı** — tablo zaten anahtar içeriyor.
- **Alt sekmeler** `components/Segmented.tsx` (segmented control) ile; aynı
  klavye kuralı (↑↓ ←→ Home End) `lib/tabNav.ts` → `nextTabIndex()`.
- **Model tablosu** artık **görünür adı + id**'yi birlikte gösterir (önce yalnız id).
- **Fiyat tablosu** sütun başlıklarını (girdi/çıktı/cache) gösterir (önce yalnız
  placeholder) ve **kendi arama/süzgecini** kullanır.
- **Yeni ayar:** `showTimestamps` — terminalde mesaj saati gösterilir/gizlenir.
  `store/settings.ts` → `partialize`'ın **iki dalına** da eklenmiştir.
- **Ortak model listesi mantığı** `SettingsModal/modelList.ts` →
  `keyedProviders` · `modelView` · `filterModels` (3 sekme aynı kuralı kullanır).

**Faz 3 — içerik ayrıntılandırması:**

- **Sağlayıcılar 4 bölüme ayrıldı:** Bulut sağlayıcıları (6 kart) · Yerel sağlayıcı
  (Ollama, ayrı kart) · Özel taban URL · Özel uçlar.
- **`PROVIDER_DEFS` → `keyUrl` + `keyUrlLabel` + `defaultBaseUrl`** (7 sağlayıcı).
  Her kartta **"Anahtar al"** dış bağlantısı (konsol adresiyle) görünür.
- **"Tümünü test et"** butonu — 7 sağlayıcıyı sırayla test eder.
- **Aktif sağlayıcı rozeti** (sağlayıcının başlığında yeşil "aktif" çipi).
- **Base URL override**: placeholder artık **fabrika adresini** gösterir; dolu
  olduğunda **"sıfırla"** butonu çıkar. (Override yalnız OpenAI-uyumlu 4
  sağlayıcıda desteklenir — Anthropic Rust proxy, Gemini kendi URL şeması.)
- **Durum rozetine ipucu** (`title`): "bağlı / anahtar geçersiz / ağ hatası" sebebi.
- **Erişilebilirlik:** her alan `id` + `<label htmlFor>` ile eşleşiyor.
- **MCP:** native `<input type=checkbox>` → **`Switch`** bileşeni; **env değerleri
  maskeleniyor** (`maskEnvText`, varsayılan gizli + "Göster/Gizle"); **keşif sonucu
  araç listesi** döndürüyor (`McpDiscovery.tools`) ve izinler listeden **çoklu
  seçim** ile atanabiliyor (keşif yoksa serbest metin).
- **Sohbet:** shell allowlist **geçersiz satırları** uyarı olarak gösteriyor —
  kural motorla aynı (`engine/policy.ts` → `parseCustomLine`); `rm` gevşemez.

- Kaydet → store + keystore senkronu (silinenler `delete_api_key`, özel uçlar `custom_<id>`).

### 11.9 Yeni bileşenler

| Bileşen | Rol |
|---|---|
| `icons.tsx` | 36 ikonluk SVG seti (16px, 1.5 stroke, `currentColor`) — emoji yok |
| `StatusBar.tsx` | sağlayıcı · model · **agent modu rozeti** · context ölçer · token ↑↓ · maliyet · bekleyen onay · **streaming rozeti (nabız)** · onay modu · workspace (tıkla → klasör diyaloğu) · MCP |
| `Welcome.tsx` | karşılama ekranı (logo + MacroCode) |
| `ToolCallCard.tsx` | araç kartı (ikon, ad, argüman, süre, durum, genişletilebilir çıktı) |
| `ApprovalCard.tsx` | onay kartı (tam komut, uyarı, Onayla/Reddet, "her zaman çalıştır") |
| `TaskPanel.tsx` | görev checklist paneli |
| `Switch.tsx` | native checkbox yerine özel anahtar |
| `ModelPicker.tsx` | arama yapılabilir model seçici — tetikleyici form alanı + ortak `ModelDropdown` paneli (Faz 7) |
| `ModelDropdown.tsx` | ortak model paneli: arama + sağlayıcı gruplama + yetenek rozetleri + "anahtar ekle" + clear/extra satır + panel içi klavye (Faz 7) |
| `Segmented.tsx` | alt sekme kontrolü (segmented) — Faz 13 |
| `Toast.tsx` | kısa bildirim konteyneri (sağ alt) — Faz 13 |

### 11.10 Toast bildirimleri (`lib/toast.ts` + `components/Toast.tsx`)

- **Sıfır bağımlılık**, React dışı modüllerden de çağrılabilir:
  `showToast(msg, kind)` · `toast.ok/err/info` · `dismissToast(id)` ·
  `subscribeToasts(listener)`.
- Süre: başarı **3 sn**, hata **6 sn** (ayar `0` → elle kapanır).
- **Flood koruması:** aynı anda en fazla **4** toast (en eski atılır).
- `ToastHost` uygulama kökünde bir kez mount edilir (`App.tsx`);
  `role="status"` + `aria-live="polite"` → ekran okuyucular duyurur.
- **Kritik kullanım:** ayarların kaydedilmesi. `save()` artık keystore yazma
  hatalarını **yutmaz** — başarısız işler toplanır, hata toast'ı gösterilir ve
  **modal açık kalır** (tekrar deneyebilir). Başarılıysa "Ayarlar kaydedildi"
  toast'ı + modal kapanır.

### 11.11 Uygulama kimliği (`lib/appInfo.ts`) — sürüm tek kaynak

- `package.json` → `version` **tek kaynaktır**. `vite.config.ts` build sırasında
  `__APP_VERSION__` ve `__REPO_URL__` sabitlerini `define` ile gömülür
  (`src/vite-env.d.ts` → global bildirimler).
- `APP_VERSION` · `REPO_URL` · `LICENSE` · `PLATFORMS` · `APP_NAME` —
  uygulama içinde **sabit sürüm yazılmaz**.
- `src-tauri/tauri.conf.json` → `version` elle tutulur; senkron olduğu
  `src/lib/version.test.ts` ile doğrulanır (CI'da kırılır).
- `package.json` → `repository.url` / `homepage` boşsa Hakkında sekmesinde
  "Kaynak kod" bağlantısı **gösterilmez** (yayın öncesi doldurulmalı).
- **Veri konumları:** Rust `get_app_paths` komutu (`commands/paths.rs`) →
  `app_data_dir` + `keys.json` + `sessions.db` yollarını döndürür; Hakkında
  sekmesinde kopyalanabilir olarak gösterilir.

## 12. Boot (App.tsx)

Sıra:

```
1. useSettingsStore.loadFromStore()   → keys.json'dan anahtarlar + keyStatus
2. loadSessionsFromDb()               → başarılı ve doluysa state'i DB ile DEĞİŞTİR
2b. saveSessionsToDb(...)             → mevcut durum DB'ye bir kez yansıtılır
3. Aktif session yoksa createSession()
4. Bekleyen onaylar geri yüklenir (SQLite pending_approvals)
5. DB açılamadıysa `!` uyarı satırı düşer (sessiz kalıcılık düşüşü yok)
```

**Boot `///` satırları kaldırıldı.** Boş oturumda `<Welcome />` (logo + "MacroCode")
gösterilir; platform/anahtar durumu artık **status bar** ve **model rozeti** üzerinden
bildirilir. `bootedRef` StrictMode çift-çalışmasına karşı guard'dır.

**models.dev kataloğu (boot):** `loadFromStore()` sonrası `loadModelsDevCatalog()`
önbellekten anında yükler (ağ üretmez, yerleşik modellerin metadata'sını
zenginleştirir ve fiyatları doldurur). Katalog bayatsa (24 saat TTL) arka planda
`refreshModelsDevCatalog()` ile yenilenir; hata sessizce yutulur (kritik değil).

## 13. Tauri / Rust Arka Yüzü

### 13.1 `lib.rs` — Builder

```rust
.plugin(tauri_plugin_store::Builder::default().build())
.plugin(tauri_plugin_sql::Builder::default()
    .add_migrations("sqlite:sessions.db", vec![Migration {
        version: 1, description: "create sessions table",
        sql: "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);",
        kind: MigrationKind::Up,
    }, Migration {
        version: 2, description: "create pending approvals table",
        sql: "CREATE TABLE IF NOT EXISTS pending_approvals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, call_data TEXT NOT NULL, run_state TEXT, created_at INTEGER NOT NULL);",
        kind: MigrationKind::Up,
    }, Migration {
        version: 3, description: "create audit log table",
        sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT NOT NULL, tool TEXT NOT NULL, args_preview TEXT NOT NULL, decision TEXT NOT NULL, result TEXT NOT NULL);",
        kind: MigrationKind::Up,
    }])
    .build())
.invoke_handler(tauri::generate_handler![
    set_api_key, get_api_key, delete_api_key, key_status, has_any_key, key_hint,
    stream_anthropic, list_dir, read_file, grep_files, glob_files, apply_patch, undo_patch, write_file,
    mcp_spawn, mcp_write, mcp_read, mcp_kill, exec_cmd
])
```
`main.rs` → `macrocode_lib::run()`. SQL migration frontend ile aynı (çift garanti). Shell plugin YOK.

### 13.2 `commands/keystore.rs` — API Anahtarı CRUD

Depolama: `app_data_dir/keys.json`. Format: `{ "<provider>": { "key": "<secret-or-url>" } }`.
İlke: değerler toplu dönmez, sadece var/yok.

| Komut | Davranış |
|---|---|
| `set_api_key` | Boş key reddi → `store.set` → `save()` |
| `get_api_key` | Yoksa boş string |
| `delete_api_key` | `store.delete` → `save()` |
| `key_status` | 7 alan bool (`anthropic/openai/gemini/ollama_url/openrouter/deepseek/xai`, camelCase) |
| `has_any_key` | Herhangi biri dolu mu |

`VALID_PROVIDERS` 7 eleman (`ollamaUrl` kanonik) + `custom_<slug>` öneki (harf/rakam/`-`/`_`, ≤48).
`normalize_provider`: `ollama`/`ollamaurl` → `ollamaUrl`.
`key_hint` → `••••` + son 4 (tam değer dönmez; boşta boş string).
Hata mesajları Türkçe ve aksiyon odaklı.

### 13.3 `commands/stream.rs` — `stream_anthropic` proxy

- CORS bypass için istek Rust `reqwest`'ten çıkar; token'lar `Channel<StreamEvent>` ile akar.
- Faz 4 (K7): tool-use + vision + thinking destekler — gövde TS'de kurulur (`messages`/`tools`/`thinking`/`temperature`/`top_p` geçirilir), Rust saf proxy'dir. Ayrıştırma saf `StreamAcc` birikimine bölünmüştür (fixture testli).
- Hata: `Err("http {status}: {snippet}")` → frontend `ProviderError`'a çevirir.
- SSE: `text_delta` → text; `thinking_delta` → reasoning; `signature_delta`+`tool_use`/`input_json_delta` → final `thinking`/`tool_calls` listeleri; `message_start/message_delta` usage → usage event; `type:error` → `Err`.
- `max_tokens` parametrelidir (frontend `min(maxOutput,16384)` gönderir, verilmezse 4096).
  Kanal kapanırsa (abort) akış durur; bozuk SSE satırı atlanır (fetch yoluyla aynı tolerans).

### 13.4 `capabilities/default.json`

```json
{ "identifier": "default", "windows": ["main"],
  "permissions": ["core:default", "sql:default", "sql:allow-execute"] }
```

`store:default` bilerek YOK: frontend keystore'a yalnızca `invoke` ile erişir
(plugin-store JS kullanımı yok); kaldırma Rust tarafını etkilemez, XSS yüzeyini daraltır.
`sql:default` okuma/bağlantı izinlerini (close/load/select) verir.
**`sql:allow-execute` şarttır (Faz 7 A1):** plugin'in `default` paketi `execute`'u
İÇERMEZ — bu izin yoksa `db.execute()` sessizce başarısız olur ve
`audit_log` / `pending_approvals` / `sessions` **hiç yazılmaz**.
Regresyon koruması: `src/lib/tauri-config.test.ts` (capability + migration sözleşmesi).

### 13.5 `tauri.conf.json` — CSP

Kısıtlı policy: `default-src 'self'`, Google Fonts (style/font), 6 AI API hostu + localhost/127.0.0.1 (`connect-src`).
Uzak özel Ollama URL'leri CSP'ye takılır — gerekirse `connect-src` genişletilmeli.

---

## 14. Tasarım Sistemi

### 14.1 CSS Token'ları (`styles/global.css` → `:root`)

**Kural:** Yeni renk **yalnızca** buraya eklenir; bileşenlerde ham hex kullanılmaz.
Görsel yeniden tasarım (2026-10-19) ile token seti genişletildi.

**Yüzey rampası** (karanlık → açık; saf siyah yerine kaldırılmış taban):

| Token | Değer | Rol |
|---|---|---|
| `--bg-sunken` | `#07090B` | kod gövdesi, içe gömülü kuyu |
| `--bg-base` | `#0B0D10` | uygulama zemini |
| `--bg-panel` | `#111419` | sidebar, titlebar, inputbar, status bar |
| `--bg-raised` | `#171B21` | kart, dropdown, modal |
| `--bg-overlay` | `#1C2128` | raised üzerinde hover/active |
| `--bg-inset` | `#0E1116` | input alanları |
| `--bg` / `--bg2` / `--bg3` | alias | geriye uyum (`--bg-base` / `--bg-panel` / `--bg-raised`) |

**Kenarlar:** `--border-subtle` `#1C2128` · `--border-default` `#262C35` · `--border-strong` `#38404C`

**Metin** (WCAG AA, `--bg-base` üzerinde ölçülmüş):

| Token | Değer | Kontrast | Rol |
|---|---|---|---|
| `--text-primary` | `#E6EAF0` | 16.1:1 | gövde, başlık |
| `--text-secondary` | `#A8B2C1` | 9.1:1 | ikincil metin |
| `--text-tertiary` | `#77808E` | 4.9:1 | meta, zaman damgası, etiket |
| `--text-disabled` | `#4A525E` | — | dekoratif devre dışı |

> Eski `--dim` (#444, 2.1:1) ve `--muted` (#666, 3.3:1) **kullanımdan kaldırıldı** — okunamıyordu.

**Vurgu** (logo `#00E676` ile birebir aynı — marka/UI tek palet):

| Token | Değer | Rol |
|---|---|---|
| `--accent` | `#00E676` | ana vurgu (11.7:1) |
| `--accent-hover` / `--accent-active` | `#2BEB8E` / `#00C563` | hover / basılı |
| `--accent-subtle` / `--accent-line` | `rgba(0,230,118,.10)` / `rgba(0,230,118,.30)` | tonlu yüzey / ince çizgi |
| `--accent-ink` | `#04150C` | aksan dolgulu zemindeki metin |

**Anlamsal:** `--col-user` `#6FB1FF` · `--col-ai` `= --accent` · `--col-sys` `#B79CFF` ·
`--col-err` `#FF8A8A` · `--col-warn` `#FFC861` · `--col-tool` `#7FD4FF`

**Gölge:** `--sh-1` · `--sh-2` · `--sh-3` · `--sh-glow` (yeni; önceden neredeyse yoktu)

**Tipografi:** `--font-mono` (JetBrains Mono — içerik akışı) · `--font-ui` (Inter — arayüz
kabuğu) · `--fs-2xs..--fs-2xl` (10/11/12/13/15/18/24px) · `--line-height` 1.65

**Boşluk:** `--sp-1..--sp-8` (2/4/8/12/16/24/32/48px) · **Yarıçap:** `--r-xs/s/md/lg/pill`

**Hareket:** `--ease-out` · `--ease-in-out` · `--dur-1..--dur-4` (90/160/240/420ms)

**Ölçü:** `--h-titlebar` 40px · `--h-statusbar` 24px · `--w-sidebar` 240px (sürüklenebilir) · `--measure` 78ch

**Yüksek kontrast** (`styles/high-contrast.css`): `html[data-contrast="high"]` token
override'ı — düz renkler, gölge yokluğu, `--fs-2xs/--fs-xs` büyütme. Sistem
`prefers-contrast: more` tercihi de karşılanır.

### 14.2 Animasyonlar

| Sınıf | Davranış |
|---|---|
| `.caret` | 2×1.05em accent caret; `blink 1.1s` + glow (streaming imleci) |
| `.thinking-dots i` | 3 nokta nabız (düşünüyor göstergesi) |
| `.msg` | 120ms `translateY` giriş (her mesaj satırı) |
| `.terminal-view` | oturum değişiminde 240ms fade-in |
| `.sb-badge` | bekleyen onay rozeti 2s nabız |
| `.tool-status.run` | çalışan araç ikonu 1.2s nabız |
| `.modal` / `.model-dropdown` | 240ms / 160ms açılma (scale + translateY) |
| Scrollbar | 8px, thumb `--border-strong` |

`prefers-reduced-motion: reduce` → tüm animasyonlar kapanır (`global.css`).

### 14.3 Ölçüler

- Titlebar 40px · Sidebar 240px (180–420 arası sürüklenebilir, 56px ikona daralır) ·
  Status bar 24px · Modal 960px (max 94vw / 88vh) · Terminal ölçüsü 78ch
- Pencere 1100×700, min 800×500, `decorations: false`
- Modal overlay `rgba(0,0,0,.70)` + `blur(8px)`, z-index 300. Dropdown backdrop 200, menü 201
- Duyarlılık: <1180px workspace chipi gizlenir · <1000px mesaj meta kolonu gizlenir ve
  sidebar 200px'e iner · <860px durum çubuğunun sağ bölümü gizlenir

## 15. Mimari Kısıtlar (güncel)

1. `Message.tokens` kısmi: usage stream event'inden gelir; doldurmayan provider'da `/tokens` approx'a düşer.
2. `Model.supportsVision` legacy alandır; kaynak `capabilities.vision`'dır.
3. `updateLastMessage` her token'da full `sessions` array'ini kopyalar — büyük geçmişlerde izlenmeli.
4. Anthropic istek limiti model bazlıdır (`min(maxOutput, 16384)`); çok uzun yanıtlar kırpılabilir.
5. Anthropic tek Rust yolu: debug'da `isTauriRuntime()` kontrol edilmeli (Tauri'de fetch'e yalnızca invoke hatasında ve metin akmadan düşülür).
6. ~~Rust proxy tool-call ve vision desteklemez~~ (Faz 4'te destekler; kısıt kalktı).
7. Uzak özel Ollama URL'leri CSP `connect-src`'ye takılabilir.
8. Bağlam: `useAgent` son 200 mesaj (güvenlik üst sınırı) + gönderim öncesi token bütçesi (`budgetFor`) — aşımda otomatik compaction (Faz 2); özet `engine/compactionMemo.ts` hafızasında tutulur (her tur yeniden özetlenmez); `/compact` ile elle kalıcı özetleme.
9. `/root|/files|/skill` dalları `App.tsx`'tedir; `/apply` aktif run'da `resolve` yoluna bağlıdır.
10. MCP: havuz istemcileri 5 dk tool-cache'ler; düşen sunucu sessizce atlanır (uyarı satırı düşer). stdio cwd workspace-root ile jail'lenir.
11. HTTP MCP origin'leri CSP `connect-src` derleme-anıdır — yeni origin elle eklenip yeniden derlenir (README). **Faz 7 A5:** HTTP transport artık `fetchFor` kullanır → CSP dışı origin'ler Rust `proxy_fetch` köprüsünden geçer (derleme gerekmez).
12. Faz 6: `customAllowList` satırlarında `rm` geçersiz sayılır; `decideTool`/`isExecAllowed` ek tabloyu `extraAllow` parametresiyle alır (saf fonksiyon, store'a dokunmaz). Audit yazımı ateşle-bırak (`void ... .catch`), akışı durdurmaz.
13. **Faz 7 A1:** `sql:allow-execute` capability'de ZORUNLUDUR — yoksa `audit_log`/`pending_approvals`/`sessions` yazılmaz. DB açılamazsa `sqlError()` boot'ta `!` uyarısı olarak gösterilir (sessiz kalıcılık düşüşü yok).
14. **Faz 7 A3:** Agent'ın metni tek assistant mesajına yazılır (`appendToMessage`); "son mesaj assistant olmalı" kuralı tool sonrası cevabı parçalıyordu.
15. **Faz 7 A4:** Kullanım sayacı tur içi `mergeUsage` (max), tur arası `sumUsage` (toplam). `mergeUsage` tek istekte doğrudur, turlar arasında kullanılmaz.
16. Compaction özeti **kalıcı transcript'e yazılmaz** (görünüm bozulmasın diye); yalnızca bellek hafızasında tutulur. `compactionMemo` oturum silinince/`/reset` ile temizlenir.
17. **Faz 8 L3:** `exec` allowlist'i iki katmanlıdır — TS `policy.ts` (karar) + Rust `exec.rs` (savunma). Kullanıcı tablosu (`customAllowList`) **her ikisine de** geçer; iki tablo **birleşik (OR)** uygulanır. `rm` kuralları hiçbir tabloda gevşemez.
18. **Faz 8 L1:** `subagent` aracı onaysız çalışır (salt-okunur) — token harcar, dosya yazmaz. Alt-agent'ın kendi olayları ana akışa **metin dışında** geçer.
19. **Faz 8 L7:** `auto-edit` modunda yazma araçları onaysız çalışır; bloklu dizinler (`.git`, `node_modules`, …) Rust `resolve_rooted` + TS `isPathSafe` ile yine kapalıdır. `exec` her modda onaylıdır.
20. **Faz 9:** repo bağlamı system prompt'a **her istekte** gider (token maliyeti) → harita modelin context penceresine göre ölçeklidir (pencere × %2, tavan 8k karakter); anahtar dosya 2k, kalıcı not 4k karakter ile sınırlıdır. `.macrocode/context.md` 64KB'da durur (Rust tarafında sınır).
21. **Faz 9:** `list_tree` yalnızca dosya listesi verir (göreli yol); bloklu dizinler, secret dosyalar ve 256KB üstü dosyalar Rust tarafından elenir.
22. **Faz 10 O2:** `proxy_fetch` yalnızca http/https + izinli metot/başlık; link-local/metadata IP'leri (169.254/16, fe80::/10, 0.0.0.0/8, 100.64/10) engellenir (alan adı **çözülerek** denetlenir). LAN (`192.168.x`, `10.x`) ve `localhost` serbesttir (Ollama). Timeout 120 sn, yanıt sınırı 32 MB.
23. **Faz 10 D1:** `keys.json` Unix'te `0600` (yalnızca sahibi okur).
24. **Faz 10 D2c:** blok listeleri `engine/blocks.json`'dan gelir (TS import, Rust `include_str!`) → TS/Rust kayması imkânsız; sözleşme testi `tauri-config.test.ts`.
25. **Faz 10:** Log kanalı (`lib/logger.ts`) **gizli değerleri redakte eder** (anahtar/token/JWT alan ve değer kalıpları) → API anahtarı loglanmaz.
26. **Faz 11:** Prompt cache Anthropic'te **eşik kuralına bağlıdır** — önek < 1024 token (Haiku 2048) ise `cache_control` gönderilmez (API 400 döner). Tahmin char/4'tür; güvenlik payı 160 token'dır.
27. **Görsel yeniden tasarım:** Emoji **kullanılmaz** — tüm ikonlar `components/icons.tsx` SVG setinden gelir
    (16px, 1.5 stroke, `currentColor`). Model yetenek rozetleri de SVG'dir.
28. **Görsel yeniden tasarım:** CSS token'ları **tek kaynaktan** (`styles/global.css` → `:root`)
    gelir; bileşenlerde ham hex kullanılmaz. Yüksek kontrast `styles/high-contrast.css`
    üzerinden token override'ıdır (yeni renk tanımlamaz).
29. **Görsel yeniden tasarım:** Markdown render'ı **`innerHTML` kullanmaz** (XSS). Bağlantılarda
    şema allowlist, görsellerde CSP uyumlu gömme kuralı vardır. Regresyon testi
    `lib/markdown.test.ts` içinde kaynak düzeyindedir.
30. **Görsel yeniden tasarım:** Yeni runtime bağımlılığı **yoktur** (sözdizimi renklendirici
    elle yazılmıştır; ikon seti elle yazılmıştır). `package.json` dependencies değişmez.
31. **Görsel yeniden tasarım:** Onay kartındaki "her zaman çalıştır" kutusu yalnızca `exec`
    için görünür ve `customAllowList`'e yazar; `rm` kuralları gevşemez (K3 korunur).
32. **Görvisual yeniden tasarım:** Ayarlar `partialize`'ına eklenen alanlar (`contrast`, `uiFont`,
    `clockFormat`, `sidebarWidth`, `sidebarCollapsed`) secret **içermez**.
33. **Görsel yeniden tasarım:** Form alanları **tek sınıf standardı** kullanır: `.input`
    (metin girişi / select), `.input-area` (textarea), `.switch`, `.slider`.
    Eski `.field-input` / `.field-area` **kullanılmaz** (CSS'ten kaldırıldı).
34. **Görsel yeniden tasarım:** Bileşenlerde `style={{...}}` **kullanılmaz**. Tek seferlik
    yerleşim ayarları `styles/utilities.css` yardımcı sınıflarıyla verilir
    (`.mt-* .mb-* .my-* .m-0 .flex-1 .flex-2 .gap-1 .hidden`). Renk/yazı tipi
    yardımcı sınıflarda **bulunmaz** — token sınıfları kullanılır.
35. **Görsel yeniden tasarım:** Native form kontrolleri temayla eşleşir —
    `accent-color: var(--accent)` (checkbox/radio), `input[type=number]` artı/eksi
    okları gizlenir (koyu temada okunmuyordu).
36. **i18n:** Kaynak sözlük `lib/i18n/locales/tr.ts`'dir; diğer diller aynı anahtar
    kümesini **taşımak zorundadır** (TS `Record<TranslationKey, Message>` +
    `lib/i18n/i18n.test.ts` bütünlük testi). Yeni metin eklenirken 5 sözlüğe de
    eklenir.
37. **i18n:** Modele giden tool açıklamaları (`engine/toolspec.ts`) **İngilizce ve
    sabittir** — arayüz dilinden bağımsız (model performansı + araç çağrı
    tutarlılığı). `engine/skills.ts` prompt'u ve agent system prompt'u da
    modele gider; bunlar kapsam dışı bırakıldı (Türkçe kalır).
38. **i18n:** `t()` **modül geneli locale** ile çalışır (varsayılan `tr`) —
    React dışı modüller (`lib/commands.ts`, `providers/common.ts`, `engine/*`)
    `lib/i18n/core` → `t()` kullanır. React bileşenleri `useT()` hook'unu
    kullanır (store'daki dile **reaktif** bağlıdır). `App.tsx` her dil
    değişiminde `setLocale(resolveLocale(language))` çağırır → modül geneli
    locale ile `<html lang>` senkronlanır.
39. **i18n:** Sıfır yeni runtime bağımlılığı (i18n motoru elle yazıldı —
    `package.json` dependencies değişmez).
40. **i18n:** Rust backend hata mesajları (`fs.rs`, `exec.rs`, `keystore.rs`)
    çeviri **kapsamı dışındadır** — Türkçe kalır. Locale'in invoke ile Rust'a
    taşınması ayrı bir çalışma gerektirir.

## 16. Geliştirme & Build Komutları

```bash
npm install
bash scripts/smoke-test.sh   # Faz 10: gerçek uygulamayı çalıştırıp DB yazımını doğrular
npm run dev          # sadece vite (http://localhost:1420, strict)
npm run tauri dev    # tam masaüstü dev (Rust derlemesi REQUIRED)
npm run build        # tsc --noEmit + vite build
npm run tauri build  # platform paketleri
npm run dist:linux   # Linux dağıtımı: deb + rpm + AppImage → bundles/ (bkz. PACKAGING.md)
npm run release X.Y.Z  # sürüm bump + tag + push → CI Linux + Windows paketlerini üretir
npm run test         # vitest run (tek sefer)
npm run test:watch   # vitest (izleme)
```

**Rust:** https://rustup.rs · **Linux:** `libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
**Windows:** WebView2 + MSVC · **macOS:** Xcode CLT.
**Node (taşınabilir, sudo'suz):** Node v22 LTS tarball'unu `/tmp/opencode/toolchain` altına çıkar,
`PATH`'e ekle (`export PATH="/tmp/opencode/toolchain/node-v22.23.3-linux-x64/bin:$PATH"`);
sistem Node'u yoksa `npm run build/test` böyle koşar.
**Çıktılar** (`bundle.targets: all`): `.exe` (NSIS) · `.msi` · `.deb` + `.rpm` + `.AppImage`
(bkz. `docs/PACKAGING.md`; Linux çıktıları `bundles/` klasöründe toplanır).

### Kalıcılık Dosyaları

| Veri | Konum | Kütüphane |
|---|---|---|
| API anahtarları | `app_data_dir/keys.json` | tauri-plugin-store |
| Session'lar (birincil) | `app_data_dir/sessions.db` | tauri-plugin-sql |
| Session'lar (yedek) | `localStorage['macrocode-sessions']` | zustand persist |
| Ayarlar | `localStorage['macrocode-settings']` (anahtarsız!) | zustand persist |
| models.dev kataloğu | `localStorage['macrocode-modelsdev-catalog']` (24 saat TTL) | doğrudan yazım |

### Git Ignore

`node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`, `bundles/`, `.DS_Store`, `.env`, `.env.local`

---

## 17. Sık Yapılacak Değişiklikler İçin Hızlı Referans

| Ne değişecek? | Dosya(lar) |
|---|---|
| Yeni model ekle | Modeller sekmesi (elle ekle/keşif) veya `lib/providers/{sağlayıcı}.ts` → `MODELS` (capabilities + maxOutput ile) |
| Model aç/kapa | `disabledModels` (store) + `isModelEnabled` (Titlebar/select filtresi) |
| Model keşfi | `lib/providers/discovery.ts` (openrouter/ollama/openai/gemini) → `discovered` → `customModels` |
| models.dev kataloğu | `lib/providers/modelsDev.ts` (fetch/parse) + `lib/providers/catalog.ts` (eşleştirme/zenginleştirme) + `setModelsDevCatalog` (store) |
| Model parametresi | `modelParams` (store) + `sanitizeParams` + ilgili provider eşlemesi |
| Yeni sağlayıcı ekle | `lib/providers/yeni.ts` (`createOpenAICompatibleProvider`) + `providers/index.ts`, `types/index.ts`, `keystore.rs`, `SettingsModal/` (registry'den otomatik) |
| Eski model ID migration | `providers/index.ts` → `REMOVED_MODEL_MAP` + `migrateModelId/migrateProviderModel`; uygulanır: `lib/db.ts` + `lib/commands.ts` |
| Yeni slash komut | `lib/commands.ts` + gerekirse `App.tsx` CommandContext |
| Hata mesajı | `lib/providers/common.ts` → `formatProviderError` |
| Yeni ikon | `components/icons.tsx` → `Icon` + `P` tablosu |
| Markdown/sözdizimi | `lib/markdown.ts` (blok/satır içi) + `lib/highlight.ts` (renklendirme) |
| Yeni token/renk | `styles/global.css` → `:root` (yüksek kontrast: `styles/high-contrast.css`) |
| Yeni UI davranışı | `components/*.tsx` + `styles/{shell,message,markdown,agent,settings}.css` |
| Kalıcılık şeması | `lib/db.ts` + `src-tauri/src/lib.rs` (migration) |
| SSE okuma kuralı | `lib/providers/common.ts` → `feedSSELines` |
| Anthropic akış yolu | `providers/anthropic.ts` + `rustStream.ts` + `commands/stream.rs` + `lib.rs` |
| Yeni engine tool | `engine/toolspec.ts` + `engine/tools/*.ts` + `engine/policy.ts` + Rust `fs.rs`/`exec.rs` |
| Token/usage/maliyet | `common.ts` (TokenUsage+reasoning/cache+`mergeUsage`/`sumUsage`) + `lib/pricing.ts` (costForTokens/sessionCost) + `useStream.ts`/`useAgent.ts` + `commands.ts` (realTokens/tokenSummaryLine) |
| Reasoning/thinking | `StreamChunk.reasoning/thinking` + `Message.reasoning/thinking` + `MessageLine` dim blok + `showThinking` |
| MCP | `mcp/protocol+client+registry+pool` + `transports/http+stdio` + `commands/mcp.rs` + Ayarlar MCP sekmesi |
| Denetim/allowlist | `policy.ts` (parseCustomLine/parseCustomAllowList + `extraAllow`) + `db.ts` (audit_log) + `/audit` |
| Sub-agent/plan | `engine/subagent.ts` (salt-okunur, kendi bütçesi) + `plan` tool |
| Bağlam/compaction | `engine/tokens.ts` (approx/window/budget) + `engine/compact.ts` (shouldCompact/split/compactHistory/compactSessionMessages) + `engine/compactionMemo.ts` (özet hafızası) + `lib/summarize.ts` (summarizerConfig/makeSummarizeFn) + `/compact` (`App.tsx`) |
| Sistem mesajı gönderimi | `providers/common.ts` → `systemTextOf`/`withoutSystemMessages` + her provider'ın system alanı |
| Tauri izinleri | `src-tauri/capabilities/default.json` + koruma testi `src/lib/tauri-config.test.ts` |
| Yeni skill | `engine/skills.ts` (kayıt + `skillsPrompt`) + `App.tsx` `/skill` dalı |
| Yeni agent aracı | `engine/toolspec.ts` (`CORE_TOOLS`) + `engine/agent.ts` (`executeTool`) + `engine/policy.ts` (`decideTool`) |
| Alt-agent | `engine/subagent.ts` (`runSubagent` + `SUBAGENT_BLOCKED_TOOLS`) + `agent.ts` (`runSubagentTool`) |
| Görev listesi | `engine/tools/todo.ts` (`deriveTodoState` + `planStepIds`) + `Terminal.tsx` (görev paneli) |
| Onay modu | `/approval` (`App.tsx`) + `store/workspace.ts` (`approvalMode`) + `engine/policy.ts` (`decideTool`) |
| Repo bağlamı | `engine/repoContext.ts` (harita/anahtar dosya/hafıza) + Rust `list_tree`/`memory_read`/`memory_append` + `/note` + `/context` |
| Blok listeleri | `engine/blocks.json` (tek kaynak) + `policy.ts`/`context.ts` (TS) + `fs.rs` (Rust `include_str!`) |
| Log/gözlemlenebilirlik | `lib/logger.ts` (`logInfo/logWarn/logError` + redaksiyon) + `/log` komutu |
| Proxy sertleştirme | `commands/proxy.rs` (method/header/IP/timeout/boyut kısıtları) + `rustFetch.ts` |
| CI | `.github/workflows/ci.yml` (tsc+vitest+build+fmt+**clippy**+cargo test) + `scripts/smoke-test.sh` |
| Dağıtım | `scripts/build-linux.sh` (deb/rpm/AppImage → `bundles/`) + `scripts/release.sh` (tag) + `.github/workflows/release.yml` (Linux+Windows → GitHub Release) + `docs/PACKAGING.md` |
| Prompt cache | `providers/promptCache.ts` (eşik + işaretleme) + `anthropic.ts` (`cache_control`) + `openaiCompatible.ts` (`prompt_cache_key`) + ayar `cachePrompts` |
| Kalıcı compaction | `engine/compactionMemo.ts` (memoToPersisted/memoFromPersisted/resolveMemo) + `Session.compaction` + `store/session.ts` (`setCompaction`) |
| Ajan devamı (run_state) | `engine/agent.ts` (`AgentRunState` + `createAgentRun(..., resume)`) + `engine/approvals.ts` (`runState`) + `useAgent.ts` (`restorePendingRuns`) |
| Model registry | `providers/{anthropic,openai,gemini,deepseek}.ts` → `MODELS` + `docs/MODELS.md` |
| Yeni UI metni | `lib/i18n/locales/tr.ts` → anahtar ekle → `en/de/fr/es.ts` aynı anahtarı ekle → bileşende `t()`/`useT()` |
| Yeni dil | `lib/i18n/types.ts` (`LOCALES`) + `LOCALE_META` + `locales/<dil>.ts` + `core.ts` (`DICTIONARIES`) |
| Modal odak döngüsü | `hooks/useFocusTrap.ts` (`useFocusTrap`/`cycleFocus`) + bileşende `onKeyDown` |
| Onay kutusu | `components/ConfirmDialog.tsx` (Escape/Enter + odak döngüsü; App kökünde tek instance) |
| Alt sekme (segmented) | `components/Segmented.tsx` + `lib/tabNav.ts` (`nextTabIndex`) |
| Model listesi filtresi | `SettingsModal/modelList.ts` (`keyedProviders`/`modelView`/`filterModels`) |
| Toast bildirimi | `lib/toast.ts` (`toast.ok/err/info`) + `components/Toast.tsx` (`ToastHost`) |
| Sürüm / kimlik | `lib/appInfo.ts` (`APP_VERSION`/`REPO_URL`) + `vite.config.ts` (`define`) + `lib/version.test.ts` |
| Veri konumu | Rust `commands/paths.rs` → `get_app_paths` + About sekmesi |

---

## 18. Çoklu Dil (i18n) — `src/lib/i18n/`

**Durum:** TR · EN · DE · FR · ES. Sıfır runtime bağımlılığı (elle yazıldı).

### 18.1 Mimari

```
lib/i18n/
├── types.ts     Locale · LanguageSetting · Message · PluralForms · LOCALE_META
├── format.ts    interpolate() ({ad}) + selectForm() (Intl.PluralRules)
├── core.ts      t() · makeT() · translate() · setLocale() · getLocale()
│                detectLocale() · resolveLocale()   ← store bağımsız
├── hook.ts      useT()  ← store'daki dile reaktif bağlı
├── index.ts     genel API (barrel)
└── locales/     tr.ts (KAYNAK GERÇEK) · en.ts · de.ts · fr.ts · es.ts
```

### 18.2 Sözlük sözleşmesi

```typescript
// tr.ts — as const → anahtar tipleri buradan türer
export const tr = { 'common.save': 'Kaydet', 'status.pendingCount': { one: '{count} onay', other: '{count} onay' } } as const;
export type TranslationKey = keyof typeof tr;

// diğer diller — anahtar kümesi BİREBİR aynı olmak zorunda (TS zorunlu kılar)
export const en: Record<TranslationKey, Message> = { ... };
```

- **Eksik anahtar** → TS hatası (derleme zamanı).
- **Fazla anahtar** → TS hatası.
- **Çalışma zamanı** bütünlük testi (`i18n.test.ts`) ayrıca doğrular.
- **Fallback zinciri:** aktif dil → İngilizce → Türkçe → anahtarın kendisi.

### 18.3 Yer tutucu + çoğul

- Yer tutucu: `{ad}` → `interpolate()` ile doldurulur (bilinmeyen yer tutucu boşaltılmaz).
- Çoğul: değer `{ one, other, zero? }` nesnesi olabilir;
  seçim `new Intl.PluralRules(locale).select(count)` ile yapılır.
  de/fr/es için zorunludur ("1 Bestätigung" / "2 Bestätigungen").
  **Kural:** `{count}` taşıyan her anahtar İngilizcede çoğul nesnesi olmalıdır
  (düz metin "1 days ago" gibi hatalar üretir) — `i18n.test.ts` bunu zorlar.
- `count` **sayı** olmalıdır; biçimlenmiş sayı için `{amount}` gibi ayrı bir yer
  tutucu kullanılır (bkz. `tokens.reasoning`).

### 18.4 Locale kaynağı ve senkron

| Katman | Mekanizma |
|---|---|
| Tek kaynak | `useSettingsStore.language` (`LanguageSetting = 'auto' \| Locale`), persist'li (`macrocode-settings`) |
| React | `useT()` → `useSettingsStore((s) => s.language)` → `resolveLocale()` → `translate()` |
| React dışı | `t()` → modül geneli `currentLocale` (`core.ts`) |
| Senkron | `App.tsx`: `useEffect(() => setLocale(resolveLocale(language)), [language])` |
| `<html lang>` | `setLocale()` içinde `document.documentElement.lang = LOCALE_META[l].htmlLang` |

`'auto'` ayarı `detectLocale()` ile çözülür: `navigator.languages` → `navigator.language`
→ en yakın desteklenen dil → `tr`.

### 18.5 Çeviri sınırı

| Yüzey | Durum |
|---|---|
| Bileşen metinleri, `title`/`aria-label`/`placeholder` | ✅ çevrilir |
| Slash komut çıktıları (`/help`, `/model`, …) | ✅ çevrilir |
| Provider hata mesajları (`formatProviderError`) | ✅ çevrilir |
| Ajan tool/onay/görev kartları | ✅ çevrilir |
| `policy.ts` red gerekçeleri, `engine/tools/*` hata metinleri | ✅ çevrilir (tool çıktısında görünür) |
| Markdown export başlıkları | ✅ çevrilir |
| **`engine/toolspec.ts` tool + parametre açıklamaları** | 🔒 **İngilizce, sabit** (modele gider) |
| `engine/skills.ts` prompt'u, agent system prompt'u | 🔒 Türkçe (modele gider — kapsam dışı) |
| Rust backend hataları | 🔒 Türkçe (kapsam dışı) |
| Log kayıtları (`lib/logger.ts`), kod yorumları | 🔒 değişmez |

### 18.6 Ayarlar ekranı

`Ayarlar → Dil ve bölge` sekmesi (`LangTab.tsx`):

- **Arayüz dili**: `Sistem dili` + 5 dil (kendi dilinde adıyla).
- Saat biçimi (24h/12h) — mevcut.
- Sayı biçimi — dile göre otomatik (`Intl.NumberFormat`; dil değişince yerel ayar değişir).
- Erişilebilirlik (yüksek kontrast) — mevcut.

Dil değişimi **yeniden başlatma gerektirmez**; ayar modalı "Kaydet" ile
store'a yazılır (kaydetmeden iptal edilirse dil değişmez).

---

*İşlem geçmişi için bkz. `Değişiklik Raporu.md`.*
