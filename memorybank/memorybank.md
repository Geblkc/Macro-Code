# MacroCode — Memory Bank (Proje Mimarisi)

> Bu belge, MacroCode projesinin **güncel mimarisini** tanımlayan canlı referans belgesidir.
> Tarihsizdir: sadece mevcut durum anlatılır. Tarihli işlem geçmişi için bkz. `Değişiklik Raporu.md`.
> Kod değiştiğinde bu dosya da güncellenmelidir.
> Son güncelleme: 2026-10-19 · Sürüm: `0.1.0` (sabit) · 7 provider (anthropic/openai/gemini/ollama/openrouter/deepseek/xai) · models.dev kataloğu entegrasyonu

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
| Dil / UI dili | TypeScript (kod yorumları İngilizce-Türkçe karışık), UI metinleri **Türkçe** |
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
| Model kataloğu | `memorybank/Modeller.md` — registry listesi (27 model) + models.dev eşleşmesi |
| Slash komutları + streaming hook | 15 komut + `/export` varyantları, abort + usage kaydı |
| Terminal UI | Markdown render, boot sequence, SQLite persist (debounce) |
| Rust proxy | `stream_anthropic` (tool-use + vision + thinking, saf proxy) |
| Agent motoru | `createAgentRun` (maxSteps 8, duraklatılabilir) + workspace fs/patch/shell tool'ları + skills + `subagent` aracı |

---

## 2. Teknoloji Yığını

```
Desktop Shell:    Tauri v2 (Rust backend — minimal Rust kodu, sadece native API'ler)
Frontend:         React 18.3 + TypeScript 5.6 + Vite 5.4
UI Framework:     Sıfırdan CSS (Tailwind YOK — tam kontrol için)
Tipografi:        JetBrains Mono (Google Fonts, index.html üzerinden)
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
├── memorybank/
│   ├── memorybank.md            ← BU BELGE (güncel mimari)
│   └── Değişiklik Raporu.md     ← tarihli işlem kayıtları
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
│   │   └── workspace.ts         # Zustand: root/label/approvalMode persist (agent modu)
│   ├── hooks/
│   │   ├── useStream.ts         # AI mesaj gönderimi (stream + abort + hata yönetimi + usage kaydı)
│   │   ├── useAgent.ts          # Agent'lı gönderim (createAgentRun + tool eventleri + repo bağlamı)
│   │   └── useKeyHistory.ts     # ↑↓ komut geçmişi (50 öğe, saf fonksiyonlar + hook)
│   ├── components/
│   │   ├── Titlebar.tsx         # Traffic lights, orta başlık, logo + model badge + dropdown
│   │   ├── Sidebar.tsx          # Session listesi + footer butonları + JSON import/export
│   │   ├── Terminal.tsx         # Mesaj görünümü, scroll stick, clearedBefore, thumbnail
│   │   ├── MessageLine.tsx      # Tek satır: prefix, markdown render, thinking/cursor, reasoning dim blok
│   │   ├── InputBar.tsx         # ❯ input, [SEND]/[DUR], [IMG] görsel ekleme, kısayollar, meta bar
│   │   └── SettingsModal/       # Sekmeli ayarlar: index (kabuk+draft+Kaydet) + types + 5 sekme
│   │       ├── ProvidersTab.tsx # Maskeli anahtarlar, test et, özel URL, özel uçlar, Ollama keşfi
│   │       ├── ModelsTab.tsx    # Varsayılan model + yenile/ekle/parametre/yedek/fiyat/aç-kapa
│   │       ├── ChatTab.tsx      # System prompt + yazı boyutu + özetleyici model (Faz 2) + düşünme bloğu (Faz 4)
│   │       └── LangTab.tsx + AboutTab.tsx  # Yer tutucular (Faz 4)
│   ├── lib/
│   │   ├── tauri.ts             # Tek isTauri() tanımı (tüm modüller buradan import eder)
│   │   ├── logger.ts            # Faz 10: log kanalı (halka arabellek + redaksiyon) · `/log` komutu
│   │   ├── db.ts                # SQLite oku/yaz + debounce persister + model migration + sqlError (Faz 7 A1)
│   │   ├── tauri-config.test.ts # capability/migration sözleşme koruması (Faz 7 A1)
│   │   ├── commands.ts          # /slash komut işleyici + /export(md|json) + /backup + /tokens(gerçek+yaklaşık+maliyet) + backup parse/build
│   │   ├── pricing.ts           # costForMessage/formatCost/sessionCost (1M token/USD birimi)
│   │   ├── markdown.ts          # Sıfırdan markdown tokenizer + güvenli DOM render
│   │   ├── engine/              # UI'dan bağımsız motor (vitest'li)
│   │   │   ├── agent.ts         # createAgentRun (maxSteps 8, onay-bekleyenlerde durur) + buildAgentHistory
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
│       ├── global.css           # CSS token'ları (:root) + layout
│       └── terminal.css         # Animasyonlar, mesaj satırları, markdown, sidebar, modal stilleri
│
└── src-tauri/                   # ─── RUST BACKEND ───
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json          # Pencere, bundle, plugin config, kısıtlı CSP
    ├── capabilities/default.json# core/store/sql :default izinleri (shell YOK)
    ├── icons/                   # macrocode-logo.svg (kaynak) + üretilmiş: 32x32.png, 128x128.png, icon.ico, icon.icns
    └── src/
        ├── main.rs              # fn main() { macrocode_lib::run() }
        ├── lib.rs               # Tauri Builder: pluginler + invoke_handler (keystore + stream_anthropic + fs/exec/mcp) + McpState + exit hook
        └── commands/
            ├── mod.rs           # pub mod keystore/stream/fs/exec/mcp + re-export'lar
            ├── keystore.rs      # set/get/delete_api_key, key_status, has_any_key, key_hint (7 + custom_*)
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
  Session başına 200 satırla cap'lenir.
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

- `root/label/approvalMode` tutar, persist `macrocode-workspace`.
- `root` doluysa normal chat yerine agent yolu çalışır (`useAgent`).
- `/root` ile set/göster, `/files` ile listele.

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
| `/root` `/files` `/apply` `/undo` `/skill` `/compact` `/audit` `/approval` `/note` `/context` | `/root`/`/files`/`/skill`/`/compact`/`/audit [n]`/`/approval [m]` `App.tsx handleSend`'de; `/apply` aktif run varsa `resolve` yolundan devam eder, yoksa doğrudan `applyPendingPatch` (kalıcı `pending_approvals` + bellek `PendingPatch`). **Faz 8 L7:** `/approval manual\|auto-read\|auto-edit` onay modunu değiştirir (`auto-edit` seçilirse uyarı satırı düşer). **Faz 9:** `/note <not>` kalıcı proje notu ekler, `/context` repo bağlamını gösterir. |
| bilinmeyen | `✗ bilinmeyen komut · /help ile listeye bak` |

**Yardımcılar:** `approxTokens` (karakter/4), `realTokens`, `formatTokenCount` (k kısaltması),
`tokenSummaryLine`, `buildExportMarkdown`, `buildSessionBackup`/`parseSessionBackup`/`normalizeSession`
(bozuk mesaj varsa dosya reddedilir; bilinmeyen provider → `anthropic` fallback; id çakışırsa yeni id).

**İndirme:** `Blob` → `URL.createObjectURL` → `<a download>` → 5sn sonra revoke.
Dosya adı `macrocode-session-YYYYMMDD-HHMM.{md,json}`.

**App köprüsü (`handleSend` sırası):** `/root|/files|/apply|/skill` → direkt workspace yolu;
diğer `/…` → `handleSlashCommand` (export varsa indir); değilse workspace varsa `sendAgent`, yoksa `send`.

---

## 10. Markdown Motoru (`lib/markdown.ts`) — Sıfırdan, Kütüphanesiz

- Inline regex: `` `code` ``, `**bold**`, `*italic*` (tek satır).
- `tokenizeMarkdown`: `^```fence` çok-satırlı tek `codeblock` üretir; **kapanmamış blok dosya sonuna kadar kod** sayılır.
- `renderMarkdown`: yalnızca `createElement` + `createTextNode` + `textContent`; **`innerHTML` YOK → XSS koruması**.
- Kullanım: `type==='ai'` ve thinking değilken her delta'da yeniden render.

---

## 11. UI Bileşenleri

### 11.1 Layout (`App.tsx`)

```
┌─────────────────────────────────────────────────┐
│ [● ● ●]   macrocode — {sessionName}  [model ▾]   │ ← Titlebar (32px, drag region)
├──────────┬──────────────────────────────────────┤
│ SESSIONS │   Terminal (scroll)                  │
├──────────┼──────────────────────────────────────┤
│ + new    │  ❯ _                         [SEND]  │ ← InputBar
│ ⚙ sett.  │  Enter gönder · ↑↓ · Ctrl+L          │
│ ✕ clear  └──────────────────────────────────────┤
└─────────────────────────────────────────────────┘
Sidebar: 200px sabit
```

Yerel state: `settingsOpen`, `extrasBySession` (cap 200), `clearedBefore`, `bootedRef`.
SQLite yansıtma: store `subscribe` → `persister.schedule(...)`; cleanup'ta `flush()`.
Silinen session'ların `extras/clearedBefore` kayıtları budanır.

### 11.2 `Titlebar.tsx`

- `data-tauri-drag-region` (özel Titlebar, `decorations: false`).
- İşlevsel pencere butonları (Tauri'de close/minimize/toggleMaximize).
- Orta: logo (18px `.titlebar-logo`) + `macrocode — {sessionName}` (ellipsis taşar). Sağ: `[model ▾]` badge → `ALL_MODELS` dropdown (capability rozetli 🛠👁🧠).

### 11.3 `Sidebar.tsx`

- Session listesi (`>` aktif prefix, hover'da `×` — yalnızca `sessions.length > 1`).
- Footer: `+ new session`, `⚙ settings`, `✕ clear`, JSON export/import.

### 11.4 `Terminal.tsx`

- Mesajlar + extras **birleştirilir** (sort yok — mesajlar kronolojik, extras en yeni).
- Son assistant + streaming: içerik varsa cursor, boşsa "düşünüyor..." animasyonu.
- Otomatik scroll (120px stick eşiği). Session geçişinde 150ms fade-in. Görsel thumbnail desteği.

### 11.5 `MessageLine.tsx`

- `msg msg-{type} msg-in` (80ms animasyon). `ai` → markdown div; diğerleri `pre-wrap` metin.
- Streaming cursor (yanıp sönen blok).
- Faz 4: `reasoning` varsa `⠿ düşünüyor` dim `<details>` bloğu (`showThinking` kapalıyken gizli).

### 11.6 `InputBar.tsx`

- `❯` + input + `[SEND]`/`[DUR]` + `[IMG]` (canvas 1568px JPEG, max 4 görsel).
- `Enter` gönder · `↑/↓` geçmiş · `Ctrl+L` temizle. Meta bar: kısayollar + karakter sayısı.

### 11.7 `useKeyHistory.ts`

- `historyPush`: boş ve art arda tekrar yok sayılır; son 50 öğe.
- `historyMove`: `up` taslağı saklar, `down` `-1`'de draft'ı geri koyar.

### 11.8 `SettingsModal/` — sekmeli ayarlar

- Kabuk (`index.tsx`): sol sekme listesi (Sağlayıcılar/Modeller/Sohbet/MCP/Dil ve Bölge/Hakkında) + sağ içerik + Kaydet/Vazgeç. `Esc`/overlay kapatır; `dirty` JSON karşılaştırması.
- **Maskeli secret:** input'ta tam değer asla durmaz — açılışta `key_hint` (`••••a1b2`) çekilir; alan durumları: değişmedi / yazıldı / silindi (geri alınabilir). Test, bellekteki tam değerle yapılır (görüntülenmez).
- **Sağlayıcılar:** 3 durumlu test (bağlı/geçersiz/ağ hatası), özel base URL (4 OpenAI-uyumlu), Ollama model keşfi (`/api/tags`), özel uç ekle (ad+baseURL+anahtar+modeller, varsayılan yap).
- **Modeller/Sohbet:** model select + system prompt + font size buraya taşındı; Faz 2'de
  Modeller sekmesi genişletildi (yenile/ekle/parametre/yedek/fiyat/aç-kapa).
- Kaydet → store + keystore senkronu (silinenler `delete_api_key`, özel uçlar `custom_<id>` adıyla).

---

## 12. Boot Sequence (App.tsx)

Yalnızca **ilk açılışta** ve **tek/boş** session varsa, 100ms aralıkla:

```
/// macrocode v0.1.0 — ai terminal interface
/// platform: {platform} · arch: {arch}
/// başlamak için mesajını yaz veya /help yaz
```

Ardından `PROVIDER_IDS` üzerinden dinamik key-durum satırı (7 provider); hiç bağlı yoksa ayarlar uyarısı.
Platform: `navigator.userAgentData?.platform ?? navigator.platform`. Arch: user-agent regex.

**models.dev kataloğu (boot):** `loadFromStore()` sonrası `loadModelsDevCatalog()`
önbellekten anında yükler (ağ üretmez, yerleşik modellerin metadata'sını
zenginleştirir ve fiyatları doldurur). Katalog bayatsa (24 saat TTL) arka planda
`refreshModelsDevCatalog()` ile yenilenir; hata sessizce yutulur (kritik değil).

---

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

**Yeni renk EKLENMEZ; yalnızca bu token'lar kullanılır.**

| Token | Değer | Rol |
|---|---|---|
| `--bg` | `#080808` | Ana zemin |
| `--bg2` | `#0f0f0f` | Panel, sidebar, modal, inputbar |
| `--bg3` | `#161616` | Input, hover, kod içi zemin |
| `--border` | `#1e1e1e` | İnce ayırıcı |
| `--border2` | `#2a2a2a` | Buton border |
| `--accent` | `#00e5a0` | **Mint yeşil — ana aksan** |
| `--accent2` | `#00b87a` | Aksan hover |
| `--dim` | `#444` | Çok soluk (başlık, meta) |
| `--muted` | `#666` | Soluk metin |
| `--text` | `#d4d4d4` | Ana metin |
| `--textbright` | `#f0f0f0` | Vurgulu metin |
| `--col-user` | `#7eb8f7` | Kullanıcı prefix |
| `--col-ai` | `#00e5a0` | AI prefix |
| `--col-sys` | `#a78bfa` | System mesajı |
| `--col-err` | `#f87171` | Hata |
| `--col-warn` | `#fbbf24` | Uyarı |
| `--font-mono` | `'JetBrains Mono', ...` | Tipografi |
| `--font-size` | `13px` | Varsayılan (store'dan canlı bağlanır, 10–20) |
| `--line-height` | `1.65` | Satır yüksekliği |

Traffic light renkleri token DIŞI (bilerek soluk): `#3a2a2a`, `#3a362a`, `#2a3a2f`.

### 14.2 Animasyonlar (`styles/terminal.css`)

| Sınıf | Davranış |
|---|---|
| `.cursor` | 7×13px accent blok; blink |
| `.thinking::after` | `...` dots animasyonu |
| `.terminal-view` | session geçişi 150ms fade-in |
| `.msg-in` | yeni satır 80ms `translateY` |
| Scrollbar | 5px, thumb `--border2` |

### 14.3 Ölçüler

- Titlebar 32px · Sidebar 200px · Modal 480px (max 90vw/85vh).
- Pencere 1100×700, min 800×500, `decorations: false`.
- Modal overlay `rgba(0,0,0,.6)` + blur, z-index 100. Dropdown backdrop 40, menü 50.

---

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
17. **Faz 8 L3:** `exec` allowlist'i iki katmanlıdır — TS `policy.ts` (karar) + Rust `exec.rs`
    (savunma). Kullanıcı tablosu (`customAllowList`) **her ikisine de** geçer; iki tablo
    **birleşik (OR)** uygulanır. `rm` kuralları hiçbir tabloda gevşemez.
18. **Faz 8 L1:** `subagent` aracı onaysız çalışır (salt-okunur) — token harcar, dosya yazmaz.
    Alt-agent'ın kendi olayları ana akışa **metin dışında** geçer.
19. **Faz 8 L7:** `auto-edit` modunda yazma araçları onaysız çalışır; bloklu dizinler
    (`.git`, `node_modules`, …) Rust `resolve_rooted` + TS `isPathSafe` ile yine kapalıdır.
    `exec` her modda onaylıdır.
20. **Faz 9:** repo bağlamı system prompt'a **her istekte** gider (token maliyeti) →
    harita modelin context penceresine göre ölçeklidir (pencere × %2, tavan 8k karakter);
    anahtar dosya 2k, kalıcı not 4k karakter ile sınırlıdır. `.macrocode/context.md`
    64KB'da durur (Rust tarafında sınır).
21. **Faz 9:** `list_tree` yalnızca dosya listesi verir (göreli yol); bloklu dizinler,
    secret dosyalar ve 256KB üstü dosyalar Rust tarafında elenir.
22. **Faz 10 O2:** `proxy_fetch` yalnızca http/https + izinli metot/başlık; link-local/metadata
    IP'leri (169.254/16, fe80::/10, 0.0.0.0/8, 100.64/10) engellenir (alan adı **çözülerek**
    denetlenir). LAN (`192.168.x`, `10.x`) ve `localhost` serbesttir (Ollama). Timeout 120 sn,
    yanıt sınırı 32 MB.
23. **Faz 10 D1:** `keys.json` Unix'te `0600` (yalnızca sahibi okur).
24. **Faz 10 D2c:** blok listeleri `engine/blocks.json`'dan gelir (TS import, Rust `include_str!`)
    → TS/Rust kayması imkânsız; sözleşme testi `tauri-config.test.ts`.
25. **Faz 10:** Log kanalı (`lib/logger.ts`) **gizli değerleri redakte eder**
    (anahtar/token/JWT alan ve değer kalıpları) → API anahtarı loglanmaz.
26. **Faz 11:** Prompt cache Anthropic'te **eşik kuralına bağlıdır** — önek < 1024 token
    (Haiku 2048) ise `cache_control` gönderilmez (API 400 döner). Tahmin char/4'tür;
    güvenlik payı 160 token'dır.

---

## 16. Geliştirme & Build Komutları

```bash
npm install
bash scripts/smoke-test.sh   # Faz 10: gerçek uygulamayı çalıştırıp DB yazımını doğrular
npm run dev          # sadece vite (http://localhost:1420, strict)
npm run tauri dev    # tam masaüstü dev (Rust derlemesi REQUIRED)
npm run build        # tsc --noEmit + vite build
npm run tauri build  # platform paketleri
npm run test         # vitest run (tek sefer)
npm run test:watch   # vitest (izleme)
```

**Rust:** https://rustup.rs · **Linux:** `libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
**Windows:** WebView2 + MSVC · **macOS:** Xcode CLT.
**Node (taşınabilir, sudo'suz):** Node v22 LTS tarball'unu `/tmp/opencode/toolchain` altına çıkar,
`PATH`'e ekle (`export PATH="/tmp/opencode/toolchain/node-v22.23.3-linux-x64/bin:$PATH"`);
sistem Node'u yoksa `npm run build/test` böyle koşar.
**Çıktılar** (`bundle.targets: all`): `.exe` setup · `.dmg` · `.deb` + `.AppImage`.

### Kalıcılık Dosyaları

| Veri | Konum | Kütüphane |
|---|---|---|
| API anahtarları | `app_data_dir/keys.json` | tauri-plugin-store |
| Session'lar (birincil) | `app_data_dir/sessions.db` | tauri-plugin-sql |
| Session'lar (yedek) | `localStorage['macrocode-sessions']` | zustand persist |
| Ayarlar | `localStorage['macrocode-settings']` (anahtarsız!) | zustand persist |
| models.dev kataloğu | `localStorage['macrocode-modelsdev-catalog']` (24 saat TTL) | doğrudan yazım |

### Git Ignore

`node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`, `.DS_Store`, `.env`, `.env.local`

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
| Yeni token/renk | `styles/global.css` → `:root` |
| Yeni UI davranışı | `components/*.tsx` + `styles/terminal.css` |
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
| Prompt cache | `providers/promptCache.ts` (eşik + işaretleme) + `anthropic.ts` (`cache_control`) + `openaiCompatible.ts` (`prompt_cache_key`) + ayar `cachePrompts` |

---

*İşlem geçmişi için bkz. `Değişiklik Raporu.md`.*
