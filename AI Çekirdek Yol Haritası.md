# MacroCode — AI Çekirdeği Geliştirme Haritası (Detaylı)

> **Kaynak inceleme:** 2026-10-14 · Kod durumu: 86 test yeşil (14 dosya, ~5.5k satır incelendi)
> **Güncelleme (2026-10-19):** Denetim yeniden yapıldı — **372 test yeşil (56 dosya)** + 49 Rust test.
> Yeni fazlar: **Faz 7–12 ✅** tamamlandı (12 = koruma + motor).
> **Sürüm sabittir: `0.1.0`.** Bu belgedeki eski sürüm adımları (`v0.2`…`v0.7`) uygulanmaz.
> **Kapsam:** `src/lib/engine/`, `src/lib/providers/`, `src/hooks/`, `src-tauri/src/commands/`
> **Hedef:** Açık kaynak yayın kalitesinde, agent-tabanlı AI kodlama çekirdeği.
> **İlerleme:** Sürüm sabit `0.1.0`. Faz kapanışı = tüm testler yeşil + kabul kriterleri + memorybank güncellemesi.

---

## BÖLÜM A — Karar Kaydı

Bu harita, kullanıcıyla yapılan 4 tur karar oturumu sonunda oluşmuştur. Aşağıdaki
kararlar haritanın **değişmezleri**dir; aksi yönde değişiklik istenirse ilgili faz yeniden değerlendirilir.

| # | Karar | Seçim | Etkilediği faz |
|---|---|---|---|
| K1 | Kapsam | Tam kapsamlı: agent döngüsü → context → tool seti → provider → yeni yetenekler → güvenlik UX | Tümü |
| K2 | Onay modeli | Kısayol tuşlu **interaktif onay** (Enter onayla / Esc reddet); **reddet + devam et** (döngü kırılmaz) | Faz 1, 6 |
| K3 | exec allowlist | **"Daha geniş"** liste; exec **her zaman** manuel onaylı (O6 ilkesi değişmez) | Faz 3 |
| K4 | Compaction | **Otomatik (%75 eşik) + manuel `/compact`**; özetleyici ayrı ayar, boşsa aktif model | Faz 2 |
| K5 | Tool geçmişi | **`Message` tipine gömülü** (`toolCalls`/`toolCallId`/`toolName`/`isError`) → SQLite + `/export json` dahil | Faz 1 |
| K6 | Tool seti | Regex grep + glob, satır aralıklı okuma, `write_file` (create-only), todo. **Web fetch/arama YOK** | Faz 3 |
| K7 | Anthropic | Rust proxy **büyütülecek** (tool-use + vision + thinking) → çift yol kalkar, fetch fallback kalır | Faz 4 |
| K8 | Sertleştirme | Retry+backoff, reasoning/thinking desteği, cost telemetrisi. **Prompt caching kapsam dışı** | Faz 1, 4 |
| K9 | Bekleyen onaylar | **Kalıcı** (SQLite `pending_approvals`) | Faz 1 |
| K10 | Ölçüm & sürüm | Açık kaynak: her fazda test barı zorunlu; **sürüm sabit `0.1.0`** (2026-10-19 düzeltmesi) | Tümü |

---

## BÖLÜM B — Denetim Bulguları (haritanın dayanağı)

Bu bölüm, yol haritasının neden bu şekilde kurulduğunu mühendislik gerekçesiyle açıklar.
Her bulgu gerçek kod referanslıdır.

### B.1 Kritik boşluklar

| # | Boşluk | Kod kanıtı | Etki |
|---|---|---|---|
| 1 | **Tool geçmişinde veri kaybı** | `src/hooks/useAgent.ts:82-89` → history `.map(m => ({role, content, images}))`; `toolCalls`, `toolCallId`, `isError` **hiç taşınmıyor**. `runAgent` içindeki tur geçmişi (`msgs`) her `sendAgent` çağrısında sıfırlanıyor | Agent ikinci turda ne yaptığını unutuyor; multi-turn tool use fiilen bozuk |
| 2 | **Onay sonrası devam yok** | `src/lib/engine/agent.ts:232-236` → `if (needsApproval) break;`; kullanıcı `/apply` yazınca patch uygulanıyor ama agent'a tool sonucu geri beslenmiyor, tur devam ettirilmiyor | Yarım kalan işler; kullanıcı metinle yeniden yönlendirmek zorunda |
| 3 | **Context bütçesi yok** | `buildContext`/`prioritizeFiles` (`context.ts`) **hiç çağrılmıyor** (sadece `summarizeWorkspace` kullanılıyor); `useAgent.ts:84` sabit `.slice(-20)`; `Model.contextWindow`'a hiçbir yerde bakılmıyor | Uzun oturumda `context limit` (400/413) hatası; compaction yok |
| 4 | **Dayanıklılık zayıf** | `useStream.ts:154-162` → tek `fallbackModel` denemesi, 429/5xx için retry/backoff yok; `StreamChunk`'ta reasoning alanı yok (deepseek `reasoning_content`, o-series `reasoning_tokens` kayıp) | Uzun ajan oturumlarında sık hata + maliyet şişmesi |
| 5 | **Tool seti dar** | `grep` literal-only (`fs.rs`); `glob`/`write_file`/`todo` yok; exec allowlist (`policy.ts:16-25` + `exec.rs` senkron tablo) çok dar (`npm run`, `cargo check`, `git status/log/diff/branch`) | Agent gerçek bir kodlama görevini tamamlayamıyor |
| 6 | **Onay UX kırılgan** | Onay = terminal yazısı `/// onay için: /apply <id>` (`patch.ts:104,152`) + kullanıcı manuel yazar; pending patch'ler yalnızca bellekte (`patch.ts` `pending` Map, max 10) | Güven + kullanılabilirlik; app kapanınca bekleyen işler kayıp |

### B.2 Sağlam temel (korunacaklar)

- `lib/engine/` UI'dan bağımsız; `runAgent`'a `streamImpl`/`runToolImpl` enjeksiyonu ile test edilebilir.
- Rust jail gerçek: `fs.rs` → `resolve_rooted` (`canonicalize` + `starts_with`, symlink kaçış kontrolü, `BLOCKED_FILES`).
- Provider dönüşümleri (`toolspec.ts`) saf fonksiyon ve testli (`toolspec.test.ts`, `nativeTools.test.ts`).
- O6 düzeltmesi: `decideTool` → `exec` hiçbir modda `autoApproved` değil (`policy.ts:92-94`).

---

## BÖLÜM C — Faz 1: Agent Döngüsü Sağlamlığı + İnteraktif Onay

### C.1 Hedef

Agent'ın çok turlu tool kullanımında **hiçbir bilgi kaybetmemesi**, onay bekleyen
işlerin **kalıcı** olması, onay verilince **turun kendiliğinden devam etmesi**, ve
sağlayıcı hatalarına karşı **temel dayanıklılık** (retry/backoff).

### C.2 Veri modeli değişiklikleri

**`src/types/index.ts`** — `Message` tipine opsiyonel alanlar (K5):

```typescript
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  provider?: Provider;
  tokens?: { input: number; output: number };
  images?: string[];
  // ── YENİ (Faz 1) ─────────────────────────────────────────────
  /** assistant mesajının tool çağrıları (role assistant iken). */
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  /** tool sonucu mesajının bağlı olduğu çağrı id'si (extras katmanında gösterilir,
   *  kalıcı katmanda Message.role system olarak saklanır — bkz. C.4). */
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};
```

**Kalıcı katman uyarısı:** `Message.role` enum'ı `'user' | 'assistant' | 'system'`.
Tool sonuçları `'tool'` rolüyle değil, `'system'` rolü + `toolCallId`/`toolName`/`isError`
alanlarıyla saklanır (enum'a dokunmadan eski veri uyumu korunur). Provider'a gönderirken
`toProviderMessages` bunları `role: 'tool'`'a çevirir.

**SQLite şema değişikliği yok** — `sessions` tablosunda `data TEXT` (JSON) esnektir;
eski satırlarda alanlar `undefined` okunur.

**Yeni tablo** (`src-tauri/src/lib.rs` migration v2 + `lib/db.ts` DDL çift garanti):

```sql
CREATE TABLE IF NOT EXISTS pending_approvals (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  call        TEXT NOT NULL,   -- ToolCall JSON { id, name, args }
  run_state   TEXT,            -- AgentRun durumu JSON (boşsa: run yok, sadece patch)
  created_at  INTEGER NOT NULL
);
```

### C.3 Görev listesi

**G1. Şema + normalize uyumu**
- `types/index.ts`: C.2'deki alanlar.
- `lib/commands.ts` → `normalizeSession`: yeni alanları **koru** (şu an bilinmeyen
  alanları atıyorsa tool alanları export/import'ta kaybolur — `parseSessionBackup`
  roundtrip testi ile sabitlenir).
- `store/session.ts`: `addMessage` yeni alanları passthrough eder; yeni yardımcı:
  ```typescript
  addToolMessages(sessionId: string, items: Array<Partial<Message> & { role: 'system' }>): void
  ```
  (tool_call satırı + tool_result satırı tek çağrıda eklenir, `updatedAt` güncellenir.)

**G2. Duraklatılabilir agent döngüsü**
- `lib/engine/agent.ts`: `runAgent` korunur (geriye uyumluluk), altına yeni:
  ```typescript
  export interface AgentRun {
    /** Bir tur daha çalıştırır; onay bekleyen iş varsa durur. */
    step(): Promise<AgentStepResult>;
    /** Bekleyen kararları uygulayıp tura devam eder (K2: reddet + devam). */
    resolve(decisions: Array<{ id: string; approved: boolean }>): Promise<AgentStepResult>;
    /** Bellek durumu (pending_approvals'a yazmak için). */
    serialize(): string;
    abort(): void;
  }
  export type AgentStepResult =
    | { kind: 'done'; text: string; steps: number; usage?: TokenUsage }
    | { kind: 'needs-approval'; pending: ToolCall[] };
  export function createAgentRun(
    history: AgentHistoryItem[], deps: AgentDeps,
  ): AgentRun;
  ```
- Davranış: `resolve` → her karar için `approved=true` ise tool'u çalıştır ve sonucu
  geçmişe yaz; `false` ise tool sonucu `isError: true`, içerik
  `kullanıcı reddetti — alternatif bir yol öner` (K2). Sonra **yeni tur** atılır
  (`maxSteps` sayacı korunur). `exec` onay bekliyorsa ve reddedilirse agent devam eder
  ama `exec` policy'si değişmez (K3: her zaman onaylı — reddedilen komut tekrar
  aynı şekilde onay ister).

**G3. Onay kuyruğu + kalıcılık**
- Yeni dosya `lib/engine/approvals.ts`:
  ```typescript
  export interface PendingApproval {
    id: string;             // ToolCall.id
    sessionId: string;
    call: ToolCall;
    createdAt: number;
  }
  export function queueApproval(p: PendingApproval): Promise<void>;   // SQLite + bellek
  export function takeApproval(id: string): Promise<PendingApproval | undefined>;
  export function listApprovals(sessionId?: string): Promise<PendingApproval[]>;
  export function restoreApprovals(): Promise<PendingApproval[]>;     // boot'ta
  ```
- `run_state` alanı: run devam ettirilebilecek durumda değilse (app yeniden
  başladı) `null` yazılır; patch apply yine çalışır, agent devamı çalışmaz ve
  kullanıcıya `/// onay bekleyen iş yeniden başlatılamadı · yeniden iste` satırı düşer.

**G4. Geçmiş derleme düzeltmesi**
- `useAgent.ts`: history artık `AgentHistoryItem[]` üretir:
  ```typescript
  .map((m) => ({
    role: m.role === 'system' && m.toolCallId ? 'tool' : m.role,
    content: m.content,
    ...(m.images?.length ? { images: m.images } : {}),
    ...(m.toolCalls?.length ? { toolCalls: m.toolCalls } : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId, toolName: m.toolName } : {}),
    ...(m.isError !== undefined ? { isError: m.isError } : {}),
  }))
  ```
- `.slice(-20)` → `.slice(-40)` (Faz 2'nin token bütçesine kadar geçici tedbir);
  tool çiftlerinin kopmaması için `slice` sonrası **başı kesilen tool sonucu** varsa
  onun eşleştiği assistant mesajı da dahil edilir (basit geriye tarama).

**G5. İnteraktif onay UI**
- `App.tsx`: `pendingBySession: Record<sessionId, PendingApproval[]>` yerel state
  (boot'ta `restoreApprovals`).
- `Terminal.tsx`: onay bekleyen her çağrı için satır:
  ```
  ⏸ onay bekleniyor: edit_file src/App.tsx  [ONAYLA ✓ Enter] [REDDET ✗ Esc]
  ```
  - Butonlar `Terminal`'de satır içi; kısayollar `InputBar` odaktayken全局 keydown
    (`App.tsx` katmanında dinlenir, `Esc` sadece onay kuyruğu varken aktif).
- Çözüm akışı: `takeApproval(id)` → `run.resolve([...])` → yeni tur devam eder.
  Kuyrukta birden fazla varsa **sırayla** çözülür; onaylanan satır `[✓]` olarak
  işaretlenir, reddedilen `[✗]` (extras katmanı, kalıcı değil).
- `/apply <id>` geriye uyumlu kalır: aynı `resolve` yolunu çağırır (artık tur devam eder).

**G6. Retry + backoff (K8)**
- `lib/providers/common.ts` yeni:
  ```typescript
  export interface RetryOptions { retries?: number; baseMs?: number; maxMs?: number }
  export async function withRetry<T>(
    fn: (attempt: number) => Promise<T>, opts: RetryOptions = {},
  ): Promise<T>;
  ```
  - Kural: yalnızca `ProviderError` (status 429 veya ≥500) ve `TypeError` (ağ) retry eder.
    `400/401/403` ve `AbortError` **asla** retry etmez.
  - Backoff: `baseMs * 2^attempt + jitter(0..250ms)`, tavan `maxMs` (default 4000).
- `useStream.ts` ve `useAgent.ts`: `doStream(...)` sarmalanır (tek noktadan).
- Mevcut `fallbackModel` akışı korunur: retry (aynı model) başarısız → fallback (tek deneme).

### C.4 Testler (kapanış barı)

| Test | Senaryo |
|---|---|
| `agent.test.ts` (genişlet) | 3 turlu mock: tool → `resolve(approved)` → tool → metin |
| `agent.test.ts` | Reddet + devam: reddedilen tool `isError` sonucu alır, agent alternatif dener |
| `session.test.ts` (yeni) | tool alanları persist roundtrip; eski kayıt (alan yok) sorunsuz açılır |
| `commands.test.ts` (genişlet) | `normalizeSession` tool alanlarını **korur** (export/import) |
| `retry.test.ts` (yeni) | 429 → 2 deneme → başarı; 400 → deneme yok; abort → deneme yok |
| `approvals.test.ts` (yeni) | kuyruk → SQLite roundtrip → `takeApproval` tek kullanımlık |

### C.5 Kabul kriterleri

1. Üç turlu mock agent testi yeşil; tool geçmişinin üçüncü tur mesajında korunduğu doğrulanır.
2. `/export json` çıktısında `toolCalls` alanları mevcut.
3. Uygulama kapatılıp açılınca bekleyen onaylar listelenir (`restoreApprovals`).
4. Esc reddetmede agent **durmaz**, alternatif yol önerisiyle devam eder.
5. `429` simülasyonunda istek 2 ek denemeyle succeed olur; `400`'de anında hata.

### C.6 Riskler ve önlemler

| Risk | Önlem |
|---|---|
| `updateLastMessage` delta semantiği tool mesajlarıyla çakışır (delta yanlış mesaja yazılır) | Delta yalnızca `assistantId`'ye yazılır; `addToolMessages` sonrası `updateLastMessage` hedefi `assistantId` olarak sabitlenir |
| Zustand `partialize` tool alanlarını atar | `session.test.ts`'e persist partialize testi |
| Eski oturumlarda yarım tool çifti (result'siz call) → provider 400 | `toProviderMessages`: eşleşmeyen `toolCalls`'ı düşür, eşleşmeyen tool sonucunu user mesajına çevir |

---

## BÖLÜM D — Faz 2: Context Bütçesi & Compaction

### D.1 Hedef

Uzun oturumların context limitini **otomatik** yönetmesi: gönderim öncesi token
tahmini, bütçe aşıldığında eski mesajların özetlenmesi (compaction), `/compact` ile
elle tetikleme.

### D.2 Yeni modüller

**`src/lib/engine/tokens.ts`** (saf fonksiyon, provider bağımsız tahmin):

```typescript
/** Gerçek tokenizer yok → tahmin: chars/4 + mesaj overhead + tool JSON. */
export function approxMessageTokens(m: Message): number;
export function approxHistoryTokens(h: AgentHistoryItem[]): number;
/** Modelin contextWindow'u registry'den; bilinmiyorsa 200_000 varsayımı. */
export function windowFor(model: string, customs?: CustomModel[]): number;
/** Bütçe: window × factor (default 0.6 — yanıt + tool sonuçları için pay). */
export function budgetFor(model: string, customs?: CustomModel[], factor?: number): number;
```

**`src/lib/engine/compact.ts`**:

```typescript
export const COMPACTION_THRESHOLD = 0.75;   // bütçenin %75'i

export interface CompactInput {
  history: AgentHistoryItem[];
  budget: number;
  summarize: (transcript: string) => Promise<string>;  // özetleyici model (C.4'e bak)
}
export function shouldCompact(history: AgentHistoryItem[], budget: number): boolean;
export function splitAtCompactionPoint(h: AgentHistoryItem[]): {
  keep: AgentHistoryItem[];   // son mesajlar (özet hariç bütçenin ~%50'si)
  drop: AgentHistoryItem[];   // özetlenecek eski mesajlar
};
export async function compactHistory(input: CompactInput): Promise<AgentHistoryItem[]>;
```

- Özet mesajı: `role: 'system'`, içerik:
  `[özet · ${date}] …` + verilen kararlar, değişen dosyalar (`toolCalls`'tan
  `edit_file`/`propose_patch`/`write_file` çağrıları taranır), açık todo'lar (Faz 3'te),
  sonraki adım.
- Özet transcript'i: `drop` mesajları + tool sonuçları sadeleştirilerek yazılır
  (tool JSON'u kırpılır, ilk 200 karakter).

### D.3 Ayarlar değişikliği

**`store/settings.ts`**:
```typescript
summarizerProvider: Provider | '';   // boş → aktif model
summarizerModel: string;             // boş → aktif model
```
- Persist: `macrocode-settings` (partialize'a eklenir).
- `SettingsModal/ChatTab.tsx`: "Özetleyici model" select (registry + custom modeller;
  boş bırakılabilir, placeholder: "aktif modeli kullan").
- `summarizerConfig()` helper: `{ provider, model, apiKey }` üretir (`useStream`'deki
  `apiKeyFor` yeniden kullanılır).

### D.4 Akış değişiklikleri

**`useStream.ts` / `useAgent.ts`** — gönderim öncesi:
```typescript
const budget = budgetFor(model, settings.customModels);
if (shouldCompact(history, budget)) {
  const summarized = await compactHistory({ history, budget, summarize });
  history = summarized;
  pushExtra({ type: 'sys', content: '/// context özetlendi (compaction)' });
}
```
- Compaction, **user mesajı eklenmeden önce** çalışır (özet kendi başına bir tur
  başlatmaz).
- `/compact` slash komutu (`lib/commands.ts`): elle tetik + terminal'e özet satırı.

### D.5 Testler

- `tokens.test.ts`: bilinen örneklerde tahmin bant aralığı (±%30); tool JSON sayımı.
- `compact.test.ts`: eşik altındayla tetiklenmiyor; üstünde `drop` boyutu ve
  `keep` bütçe içinde; mock özetleyiciyle eski mesajların azaldığı.
- Bütünleşme: 200 mesajlık simüle oturum → gönderim bütçeyi aşmıyor.
- `/compact` komut testi (`commands.test.ts`).

### D.6 Kabul kriterleri

1. 200 mesajlık simüle oturumda `approxHistoryTokens > budget` → otomatik compaction
   tetiklenir, istek bütçe içinde gider.
2. `/compact` elle çalışır; terminal'e özet satırı düşer.
3. Özetleyici boş bırakıldığında aktif model kullanılır.
4. Tüm yeni testler yeşil; mevcut 86 test bozulmaz.

### D.7 Riskler

| Risk | Önlem |
|---|---|
| Özet kalitesiz → agent bağlamı kaybeder | Özet prompt'u Türkçe ve şablonlu; `keep` her zaman son ~%50 bütçeyi korur; `/compact` ile elle tekrar denenebilir |
| Özetlemek için ikinci model çağrısı maliyeti | Ayrı ayarla ucuz model seçilebilir; özet transcript'i kırpılmış |
| Compaction döngüsü (özet bile bütçeyi aşarsa) | Özet mesajı max 2000 karakter + `keep` budaması |

---

## BÖLÜM E — Faz 3: Tool Seti Genişlemesi

### E.1 Hedef

Agent'ın gerçek bir kodlama görevini tamamlayabilmesi: regex/glob araması, büyük
dosya okuma, yeni dosya oluşturma, görev takibi, ve genişletilmiş (ama hâlâ onaylı)
shell.

### E.2 Rust tarafı (`src-tauri/src/commands/fs.rs` + `exec.rs`)

| Komut | Değişiklik |
|---|---|
| `grep_files` | `regex: Option<bool>` parametresi (default `false` = literal). Regex: `regex::Regex::new` → compile hatası Türkçe: `✗ geçersiz regex: {err}`. Literal davranış korunur (eski çağrılar etkilenmez) |
| `glob_files` **(yeni)** | `(root, pattern, path?) → Vec<{path, is_dir}>`. Pattern glob (`*.ts`, `src/**\/test_*`). Ignore listesi Rust'a taşınır: `node_modules, .git, dist, build, target, .tauri, coverage, .vite, .macrocode` + `BLOCKED_FILES` + secret uzantıları (`.pem/.key/.p12/.pfx`) |
| `read_file` | `offset: Option<usize>` (1-tabanlı satır) — `offset..offset+limit` aralığı döner; `truncated` bayrağı korunur |
| `write_file` **(yeni)** | `(root, path, content) → { created: bool }`. `OpenOptions::new().write(true).create_new(true)` → **`O_EXCL`: mevcut dosya varsa hata** `✗ dosya zaten var: {path} · edit_file kullan`. Jail `resolve_rooted` üzerinden; `BLOCKED_FILES` reddi |
| `exec.rs` allowlist | K3'e göre genişletilir (aşağıda) |

**Yeni crate bağımlılığı:** `regex = "1"` (Cargo.toml).

### E.3 exec allowlist genişletmesi (K3: "daha geniş", onay HER ZAMAN)

Rust `exec.rs` tablosu ve TS `policy.ts` `ALLOWED_CMDS` **senkron** güncellenir:

| Komut | İzin verilen alt kümeler |
|---|---|
| `git` | `status`, `log`, `diff`, `branch`, `--version`, **`add`, `commit`, `stash`, `show`, `push`** |
| `npm` | `--version`, `ls`, `run`, `test` |
| `npx`/`node` | `--version` |
| `cargo` | `--version`, `check`, `test`, `build`, **`clippy`** |
| **yeni** | `pytest`, `pip install`, `tsc`, `go test`, `find`, `rg`, `cat`, `head`, `tail`, `wc`, `which`, `mkdir`, `touch` |
| `ls`/`pwd`/`echo` | serbest (tehlikeli karakter hariç) — mevcut davranış |
| **`rm`** | **yalnızca `-i` ile** (interaktif); `-f`, `-r`, `-rf` vb. **reddedilir** |

- `eslint`/`prettier`: her alt küme kabul (onay zorunlu olduğu için risk sınırlı).
- `push`: yalnızca onay akışından geçer (K2 onay UI'ı zorunlu kılar).
- **Drift testi** (`policy.test.ts` genişletilir): iki tablo tek JSON kaynaktan
  üretilir (`src/lib/engine/allowlist.json` → TS import + Rust `include_str!`),
  böylece TS↔Rust kayması derleme/test anında yakalanır.

### E.4 Tool spec + policy (`src/lib/engine/`)

**`toolspec.ts`** — `CORE_TOOLS`'a ekler (mevcut 6 korunur, 4 yeni):

| Tool | Parametreler | Not |
|---|---|---|
| `grep` (genişler) | `pattern`, `path?`, `regex?: boolean` | `regex: true` → Rust regex yolu |
| `glob` **(yeni)** | `pattern`, `path?` | Dosya adı keşfi |
| `read_file` (genişler) | `path`, `limit?`, `offset?` | Satır aralıklı okuma |
| `write_file` **(yeni)** | `path`, `content` | **Sadece yeni dosya** (O_EXCL) |
| `todo` **(yeni)** | `action: 'add'\|'complete'\|'list'`, `id?`, `text?` | Görev takibi |

**`policy.ts`** kararları:

```typescript
// read_file/list_dir/grep/glob → autoApproved: true (jail korunur)
// write_file → allowed (jail), autoApproved: mode === 'auto-edit'  // edit_file ile tutarlı
// exec → allowed (allowlist), autoApproved: false                   // DEĞİŞMEZ (K3)
```

**`tools/write.ts` (yeni)** — `toolWriteFile(root, call)`:
- Rust `write_file` çağırır; `O_EXCL` hatasını Türkçe iletir.
- `propose_patch`'teki gibi önizleme satırı döner: `/// oluşturuldu: {path}`.

**`tools/todo.ts` (yeni)** — saf state yönetimi:
```typescript
export interface TodoState { items: Array<{ id: string; text: string; done: boolean }> }
export function applyTodoAction(state: TodoState, args: Record<string, unknown>): {
  state: TodoState; output: string;
};
```
- State **tool geçmişinden türetilir** (K5: todo add/complete çağrıları mesajlarda
  duruyor → `deriveTodoState(history)`). Ek kalıcılık gerekmez.
- Agent'ın system prompt'una aktif todo listesi otomatik eklenir
  (`useAgent.ts`: `[todo] …` bloğu, varsa).

### E.5 UI

- `Terminal.tsx`: todo listesi render'ı (assistant mesajı altında `[ ]`/`[x]` bloğu,
  son `deriveTodoState` çıktısı).
- `MessageLine.tsx`: `glob`/`write_file` extras satırları mevcut `tool ▸` deseniyle
  uyumlu.

### E.6 Testler

| Test | Kapsam |
|---|---|
| Rust `fs.rs` testleri (genişlet) | regex literal/regex ayrımı; glob ignore; offset+limit; `write_file` O_EXCL; jail hâlâ korunuyor |
| `policy.test.ts` | yeni allowlist satırları; `rm -i` kabul / `rm -rf` ret; drift testi |
| `toolspec.test.ts` (snapshot) | yeni tool JSON şemaları |
| `todo.test.ts` (yeni) | add/complete/list state geçişleri; `deriveTodoState` history'den |
| `tools/write.test.ts` (yeni) | O_EXCL hata yolu (mock invoke) |

### E.7 Kabul kriterleri

1. Agent glob ile dosya bulabiliyor, regex ile arayabiliyor, offset'le büyük dosya
   okuyabiliyor (mock Rust yoksa Tauri entegrasyon testi manuel doğrulama listesinde).
2. `write_file` mevcut dosya hedefini **reddediyor**.
3. `rm -rf` policy'de reddediliyor; `rm -i` onaya düşüyor.
4. Drift testi: iki allowlist tablosu birebir aynı.

### E.8 Riskler

| Risk | Önlem |
|---|---|
| Glob Rust'ta patern kaçışı (`**` vs platform) | Unix-only hedeflenir, Windows için test atlanır |
| Todo state history'den türetilince uzun geçmişte pahalı | Son 50 mesajda tarama yeterli (todo çağrıları yakın geçmişte) |
| exec allowlist genişledi → kötüye kullanım | Her komut hâlâ manuel onaylı; `audit_log` Faz 6'da |

---

## BÖLÜM F — Faz 4: Provider Sertleştirme

### F.1 Hedef

(1) Reasoning/thinking model çıktılarının işlenmesi, (2) Anthropic Rust proxy'nin
tool-use + thinking + vision destekleyerek **çift yolu sonlandırması**, (3) cost
telemetrisi.

### F.2 Reasoning/thinking akışları

**`providers/common.ts`**:
```typescript
interface StreamChunk {
  text: string;
  done: boolean;
  error?: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  /** YENİ: reasoning/thinking metni (dim blok). */
  reasoning?: string;
}
```

| Sağlayıcı | Kaynak alan | Dönüşüm |
|---|---|---|
| deepseek / openai-uyumlu | `delta.reasoning_content` | `chunk.reasoning` |
| openai (o-series) | `usage.reasoning_tokens` | `usage.output`'a **eklenmez**; ayrı `usage.reasoning` alanı + maliyete dahil |
| anthropic | `content_block_delta(thinking_delta)` | `chunk.reasoning` (imzalı thinking blokları — F.3) |

**UI (`MessageLine.tsx` + `terminal.css`)**: `reasoning` metni `--dim` renkte,
`⠿ düşünüyor:` önekli, tek açılır-kapanır blok. Ayar: `showThinking: boolean`
(`store/settings.ts`, ChatTab toggle, default `true`).

### F.3 Rust proxy büyütme (K7) — `src-tauri/src/commands/stream.rs`

Bugünkü durum: yalnız `text_delta` + usage. **Hedef: tool_use + thinking + görsel.**

1. **İstek genişlemesi** (frontend → Rust):
   ```rust
   struct StreamRequest {
     model: String,
     system: Option<String>,
     messages: Vec<Value>,        // {role, content, tool_calls?, tool_use_id?}
     tools: Option<Value>,        // Anthropic tool şeması (toAnthropicTools çıktısı)
     images: Option<Vec<Value>>,  // base64 image block'ları
     max_tokens: u32,
     temperature: Option<f32>,
     thinking: Option<Value>,     // extended thinking config (varsa)
   }
   ```
2. **Yanıt akışı** (`StreamEvent` genişler):
   ```rust
   enum StreamEvent {
     Text { delta: String },
     Reasoning { delta: String },              // YENİ
     ThinkingSignature { signature: String },  // YENİ (geri gönderim için zorunlu)
     ToolCalls { calls: Vec<Value> },          // YENİ (final birikmiş liste)
     Usage { input: u64, output: u64 },        // mevcut
   }
   ```
3. **Stateful thinking geri gönderim**: extended thinking + tool-use döngüsünde
   Anthropic, `thinking` bloklarının (signature dahil) tool_use öncesinde aynen
   geri gönderilmesini **zorunlu** kılar. Rust `stream_anthropic` çağrısı artık
   frontend'den gelen `messages` içindeki `thinking` bloklarını korur
   (`thinking: { signature }` alanları `ChatItem`'e taşınır → `providers/anthropic.ts`
   istek gövdesine yazar).
4. **Görsel**: Rust body'de `content: [{type:'image', source:{type:'base64', ...}}]`
   — WebView'daki `parseDataUrl` mantığının karşılığı.
5. **Çift yol sonu**: `providers/anthropic.ts` → tool/görsel/normal **hepsi Rust
   yolundan** akar; `invoke` (ağ/TLS) hatasında eskisi gibi doğrudan `fetch`'e
   düşer (güvenlik ağı korunur, `rustStream.ts`'teki fallback mantığı).

### F.4 Cost telemetrisi

- `lib/pricing.ts` genişler:
  ```typescript
  export function costForTokens(usage: TokenUsage, price?: ModelPrice): number | null;
  export function sessionCost(session: Session): { usd: number | null; pricedMsgs: number; totalMsgs: number };
  ```
- `commands.ts` `/tokens` → son satıra `· oturum toplam ~$X.XX` (fiyatı olmayan
  mesajlar sayılarak `· N mesaj fiyatlanamadı` notu).
- Agent turlarındaki usage'lar Faz 1'de zaten mesaja yazılıyor → telemetri otomatik.

### F.5 Testler

- Rust: fixture SSE metinleri (`tool_use` akışı, `thinking` akışı, usage, hata) ile
  `stream.rs` ayrıştırma testleri.
- `providers/*.test.ts`: reasoning alanlarının akıştan çekildiği (mock fetch + SSE).
- `pricing.test.ts`: kısmi fiyat, usage olmayan tur, reasoning token dahil maliyet.

### F.6 Kabul kriterleri

1. Anthropic tool'lu istek tek Rust yolundan akıyor (fetch çağrısı yok; fallback
   yalnız invoke hatasında).
2. DeepSeek `reasoning_content` terminal'de dim blokta görünüyor.
3. `/tokens` oturum toplam maliyeti gösteriyor (reasoning token'lar dahil).
4. Mevcut 86+ yeni testler yeşil; `tauri build` derleniyor.

### F.7 Riskler

| Risk | Önlem |
|---|---|
| Anthropic thinking+tool_use sıra kuralı ihlali → 400 | Rust fixture testleri; thinking blokları istek gövdesinde aynen taşınır |
| Rust SSE ayrıştırıcı karmaşıklaşır | `stream.rs` ayrıştırma saf fonksiyona bölünür (test edilebilir) |
| Proxy'ye taşınan yol regression | `fetch` fallback her zaman kalır; `isTauriRuntime()` davranışı değişmez |

---

## BÖLÜM G — Faz 5: Yeni Yetenekler — MCP

### G.1 Hedef

Kullanıcının kendi MCP sunucularını bağlayabilmesi (JSON-RPC 2.0), araçların
agent'ın tool setine **onaylı olmadan** (K2) girmesi; ardından sub-agent/plan mimarisi.

### G.2 Mimari

```
lib/engine/mcp/
├── protocol.ts   # JSON-RPC 2.0 tipleri (initialize, tools/list, tools/call)
├── client.ts     # transport bağımsız McpClient arayüzü
├── transports/
│   ├── http.ts   # WebView fetch + SSE (CSP genişletme gerekir)
│   └── stdio.ts  # Rust subprocess köprüsü üzerinden
└── registry.ts   # aktif sunucular → ToolDefinition adaptörü
```

- **Tool namespace**: `mcp:<sunucu>:<tool>` (çakışma imkânsız; `ToolName` tipi genişler).
- **Adaptör**: MCP tool şeması → `ToolDefinition` (JSON-Schema zaten uyumlu).
- **Çağrı**: `tools/call` → sonuç metni (4k truncate, agent tool sonuçlarıyla aynı).
- **Policy**: `mcp:*` → `autoApproved: false` (her zaman onay; K2 akışına girer).

### G.3 Transport kararları

| Transport | Kanal | Not |
|---|---|---|
| HTTP/SSE | WebView `fetch` | Ayarlarda origin listesi → CSP `connect-src` genişletilir (README'deki bilinen kısıt) |
| stdio | **Rust** | WebView'da subprocess yok. Yeni komutlar: `mcp_spawn(cmd, args, env)`, `mcp_write(id, data)`, `mcp_read(id)`, `mcp_kill(id)`. `tauri-plugin-shell` **geri eklenmez** (yüzey genişlemesin) |

### G.4 Ayarlar

- `SettingsModal` yeni sekme **"MCP"**: sunucu listesi (ad, transport, komut/URL,
  aktif aç/kapa, `tools/list` keşif butonu, araç izin listesi).
- `store/settings.ts`: `mcpServers: McpServerConfig[]`; secret'lar keystore
  (`custom_<id>` deseni korunur); `partialize` secret içermez.

### G.5 Sub-agent / plan mimarisi (ayrı alt faz)

- `lib/engine/subagent.ts`: `runSubagent(task, deps)` — aynı tool seti, **kendi**
  context bütçesi (Faz 2 mekanizması), koordinatöre tek özet döner.
- `plan` tool: `plan{steps: string[]}` → Terminal'de adım listesi + agent
  her adımda `todo` ile işaretler.
- Sınır: sub-agent `exec`/`write_file` **kullanamaz** (sadece okuma + grep/glob) —
  güvenlik; yazma koordinatörde onay akışından geçer.

### G.6 Testler

- `protocol.test.ts`: JSON-RPC handshake fixture'ları.
- `client.test.ts`: mock transport üzerinden `tools/list`/`tools/call`.
- `registry.test.ts`: namespace adaptasyonu; policy `autoApproved:false`.
- Rust: `mcp_spawn` lifecycle testleri (spawn/echo/kill).

### G.7 Kabul kriterleri

1. Bir HTTP MCP sunucusu bağlanabiliyor; araçlar agent tool listesinde `mcp:` önekli.
2. MCP aracı çağrısı **onay UI'ına** düşüyor (autoApproved değil).
3. stdio sunucu spawn/kill temiz (proses sızıntısı yok).
4. CSP yalnızca kullanıcı tanımlı origin'lere genişliyor.

### G.8 Riskler

| Risk | Önlem |
|---|---|
| stdio sunucu asılı kalır → proses sızıntısı | `mcp_kill` + app kapanışında tüm child'lar öldürülür (Tauri `RunEvent::Exit`) |
| Güvensiz MCP sunucu (zararlı araç) | Varsayılan onaylı değil; kullanıcı araç bazında izin verir; secret'lar keystore'da |
| CSP gevşetmesi | Yalnız ayarlarda tanımlı origin'ler; `connect-src` dinamik genişlemez (derleme anı) |

---

## BÖLÜM H — Faz 6: Güvenlik & İzin UX Rötuşları

### H.1 Görevler

1. **Kullanıcı allowlist uzantısı**: `customAllowList: string[]` (ayarlar;
   örn. `docker ps`). `policy.ts` birleştirir; exec yine onaylı.
2. **Denetim logu**: `audit_log` tablosu
   `(id, ts, session_id, tool, args_preview, decision, result)`;
   `/audit [n]` son N kaydı gösterir; ayarlardan açılıp kapanır.
3. **Jail rötuşları**: `fs.rs`'e Windows yol ayırıcı testleri, symlink baskın testleri
   (`.git` içine symlink → okuma reddi).
4. **CI**: `.github/workflows/ci.yml` — `tsc --noEmit` + `vitest run` + `cargo test`
   (Linux); PR barı; `npm run build` smoke.
5. **Dokümantasyon**: `CONTRIBUTING.md` (test çalıştırma, faz kapanış kuralı,
   allowlist değişikliği prosedürü — TS+Rust+drift test); `memorybank/memorybank.md`
   güncellemesi (yeni tool'lar, şema, komutlar).

### H.2 Kabul kriterleri

1. Özel allowlist komutu onay akışından geçerek çalıştırılabiliyor.
2. `/audit` kayıtları tool kararlarını içeriyor.
3. CI PR'da yeşil olmadan birleşemiyor.

---

## BÖLÜM I — Risk Kaydı (özet)

| Risk | Faz | Önlem |
|---|---|---|
| `normalizeSession` yeni Message alanlarını siler | 1 | Roundtrip testi zorunlu |
| Delta yanlış mesaja yazılır (tool mesajları) | 1 | Delta hedefi `assistantId` sabit |
| Eksik tool çifti → provider 400 | 1 | `toProviderMessages` eşleşmeyen çağrı/sonucu temizler |
| Özet kalitesiz / döngüsel compaction | 2 | `keep` koruması + özet max 2k karakter |
| Glob/regex platform farkları | 3 | Unix öncelikli; Windows testleri atlanır |
| Allowlist TS↔Rust kayması | 3 | Tek JSON kaynak + drift testi |
| Anthropic thinking+tool_use sıra kuralı | 4 | Rust fixture testleri |
| MCP proses sızıntısı | 5 | Exit'te child kill; asılı sunucu timeout |
| CSP gevşetmesi | 5 | Yalnız derleme anı, kullanıcı tanımlı origin |

---

## BÖLÜM J — Sürümlendirme & Ritim

> **Sürüm politikası (2026-10-19 düzeltmesi):** MacroCode'ın sürümü **sabit `0.1.0`**
> olarak kalacaktır. Aşağıdaki tablo eski bir tasarım varsayımıydı; faz sürüm
> adımları (`0.2` … `0.7`) **UYGULANMAYACAK**. Faz kapanışı artık sürüm artışı
> değil, **kabul kriterleri + test barı + memorybank güncellemesi** demektir.
> Sürüm, açık kaynak öncesi API sözleşmeleri dondurulduğunda tek seferde güncellenir.

| Faz | Konu | Durum | Teslim |
|---|---|---|---|
| 1 | Sağlam agent döngüsü (tool geçmişi, interaktif onay, kalıcı kuyruk, retry) | %90 | `run_state` kalıcılığı eksik |
| 2 | Token bütçesi + otomatik/manuel compaction | %70 | Özet provider'a ulaşmıyordu → **Faz 7'de düzeltildi** |
| 3 | Regex/glob/offset/write/todo + geniş allowlist | %100 | Todo render'ı → **Faz 8'de eklendi** |
| 4 | Tek Rust yolu (tool+vision+thinking), reasoning UI, cost | %90 | Çok turlu maliyet eksik → **Faz 7'de düzeltildi** |
| 5 | MCP client (HTTP + stdio) + sub-agent/plan | %95 | Sub-agent bağlı değil + HTTP MCP CSP'te → **Faz 7'de düzeltildi**; sub-agent aracı **Faz 8'de bağlandı** |
| 6 | Allowlist uzantısı, audit log, jail rötuşları, CI | %95 | Audit log yazmıyordu → **Faz 7'de düzeltildi**; allowlist Rust'a taşınmadı → **Faz 8'de düzeltildi** |
| **7** | **Doğruluk: çalışmayan yolların düzeltilmesi** | ✅ **tamamlandı** | A1–A5 + compaction canlı hale getirildi |
| 8 | Tamamlanmamış faz kalıntıları | ✅ **tamamlandı** | L1–L8: sub-agent aracı, plan→todo, allowlist→Rust, todo render, skill, tool çıktı, onay modu, duplikasyon |
| 9 | Bağlam (repo haritası, skill, proje özeti) | ✅ **tamamlandı** | Repo haritası + AGENTS.md/README + kalıcı not + `/context`; CI fmt yeşil; auto-edit yazma hatası kapandı |
| 10 | Sertleştirme (güvenlik, gözlemlenebilirlik, test) | ✅ **tamamlandı** | O2/D1/D2 kapandı, clippy temiz, smoke test betiği + CI işi, `/log` kanalı |
| 11 | Prompt cache (maliyet) | ✅ **tamamlandı** | `cache_control` + `prompt_cache_key`, ayar (varsayılan açık), `/tokens` cache çıktısı |
| 12 | Koruma + motor | ✅ **tamamlandı** | Git + MIT lisans, 10 model ailesi, kalıcı compaction, `auto-read` salt-okunur, `run_state` ile ajan devamı |

**Kural:** Faz yalnızca (1) tüm testler yeşil, (2) kabul kriterleri karşılanmış,
(3) `memorybank/memorybank.md` güncellenmişse kapanır.

---

## BÖLÜM K — Faz 7: Doğruluk (✅ tamamlandı)

> **Amaç:** Kodu var olan ama **çalışmayan** yolları düzeltmek. Yeni özellik yok;
> "yazılmış" ile "fiilen çalışıyor" arasındaki boşluk kapatıldı.
> Test barı: 289 test yeşil (43 dosya) + `tsc --noEmit` temiz + `cargo check` temiz.

### K.1 A1 — `sql:allow-execute` capability'si (KRİTİK)

**Bulgu:** `capabilities/default.json` yalnızca `sql:default` veriyordu; plugin'in
`default` paketi `allow-execute`'u **içermiyor**. Bu yüzden `db.execute()` sessizce
başarısız oluyordu ve:
- `audit_log` **hiç dolmuyordu** (`/audit` hep "kayıt yok"),
- `pending_approvals` DB'ye yazılmıyordu (localStorage'a düşüyordu),
- session'lar SQLite'a yazılmıyordu (kalıcılık localStorage'da kalıyordu).

**Düzeltme:**
- `capabilities/default.json` → `+ "sql:allow-execute"`.
- `db.ts`: DB açma hatası artık yutulmuyor → `sqlError()`; `App.tsx` boot'ta
  `! session veritabanı açılamadı: …` uyarısı gösteriyor.
- `openSql()`: tek paylaşılan bağlantı (`db.ts` + `engine/approvals.ts`).
- Regresyon koruması: `src/lib/tauri-config.test.ts` (capability + migration sözleşmesi).

### K.2 A2 — Compaction özeti provider'a ulaşmıyordu (KRİTİK)

**Bulgu:** Compaction özeti `role: 'system'` olarak üretiliyordu; Anthropic'in
`buildAnthropicMessages` fonksiyonunda system dalı **yoktu** → özet sessizce
düşüyordu. Ollama'da da system rolü mesaj dizisine karışıyordu. Yani Faz 2'nin
compaction'ı Anthropic'te **fiilen hiç çalışmıyordu** (bütçe aşımı sürüyordu).

**Düzeltme:** Provider ortak kuralı — sistem metni her zaman istek gövdesinin
`system` alanına taşınır:
- `common.ts`: `systemTextOf(messages)` + `withoutSystemMessages(messages)`.
- Anthropic: `buildAnthropicMessages` system'i düşürür; metin `system` alanına girer
  (Rust proxy yolu dahil).
- OpenAI-uyumlu / Ollama: baştaki system mesajıyla birleşir. Gemini zaten doğruydu.

**Ek (Faz 2'nin agent tarafını canlı hale getirme):**
- `useAgent` geçmiş kesmesi `-40` → `-200` (güvenlik üst sınırı). Sabit kesme
  bütçeyi hiç aşmadığı için **otomatik compaction hiç tetiklenmiyordu**.
- `engine/compactionMemo.ts`: özet sonucu oturum başına bellekte tutuluyor;
  sonraki turlarda geçmiş "özet + o özetten sonraki mesajlar" → **her tur yeniden
  özetleme (LLM çağrısı + maliyet) yapılmıyor**. `/reset` ve session silinince temizlenir.

### K.3 A3 — Agent cevabı parçalanıyordu

**Bulgu:** `updateLastMessage` yalnızca "son mesaj assistant ise" ekliyordu.
Tool sonuçları kalıcı katmana `role: 'system'` mesajı olarak yazıldığı için,
bir sonraki turdaki metin **yeni** bir assistant mesajına yazılıyordu.

**Düzeltme:** `store/session.ts` → `appendToMessage(sessionId, messageId, delta)`
(hedef mesaj sabit); `useAgent` tüm metin/reasoning/thinking/toolCalls/usage
yazımlarında `assistantId`'yi hedefler. Boş placeholder kontrolü de id ile yapılır.

### K.4 A4 — Çok turlu agent maliyeti eksik hesaplanıyordu

**Bulgu:** `mergeUsage` (max) turlar arasında da kullanılıyordu → raporlanan token
"en büyük tur"du, toplam değil.

**Düzeltme:** `common.ts` → `sumUsage` (tur içi `mergeUsage`, tur arası `sumUsage`).

### K.5 A5 — Uzak MCP sunucuları CSP'e takılıyordu

**Bulgu:** `mcp/transports/http.ts` `globalThis.fetch` kullanıyordu; diğer tüm ağ
yolları `fetchFor` (Rust proxy) kullanıyor. Uzak origin'ler `connect-src` dışında
kaldığı için MCP sunucularına ulaşılamıyordu.

**Düzeltme:** Transport `fetchFor` kullanıyor (`mcpFetchFor` ile testlenebilir).

### K.6 Faz 7 kabul kriterleri

1. ✅ `audit_log` yazılabiliyor (capability izni + hata görünürlüğü).
2. ✅ Compaction özeti Anthropic/OpenAI/Ollama'ya ulaşıyor.
3. ✅ Agent cevabı tek assistant mesajında kalıyor.
4. ✅ Çok turlu agent toplam token/maliyeti doğru raporlanıyor.
5. ✅ Uzak MCP origin'i Rust proxy üzerinden çalışıyor.
6. ✅ `tsc --noEmit` + `vitest run` (289 test) + `cargo check` temiz.

---

## BÖLÜM L — Faz 8: Tamamlanmamış Faz Kalıntıları (✅ tamamlandı)

> **Amaç:** Ölü koddu ("yazılmış ama bağlı değil") veya işlevsizdi ("var ama
> çalışmıyor") olan yol haritası kalıntılarını bağlamak/onar mak.
> Test barı: 308 test yeşil (47 dosya) + 42 Rust test + `tsc` + `vite build` temiz.

| # | İş | Durum | Yapılan |
|---|---|---|---|
| L1 | `runSubagent` → `subagent` aracı | ✅ | 11. çekirdek tool (`CORE_TOOLS`); salt-okunur, kendi bütçesiyle çalışır, `disallowTools` ile yazma/özyineleme kapalı; koordinatöre tek özet döner |
| L2 | `plan` → `todo` | ✅ | Plan adımları `plan-N` görev id'leriyle türetilir (`deriveTodoState`); agent `todo complete plan-2` ile işaretler |
| L3 | `customAllowList` → Rust | ✅ | `exec_cmd` artık `extra_allow` tablosunu kabul eder; TS ve Rust tabloları **birleşik (OR)** uygulanır → özellik uçtan uca çalışır |
| L4 | Terminal'de todo render'ı | ✅ | Görev paneli mesajların sonunda (`[ ]`/`[x]` + ilerleme sayacı) |
| L5 | `skillsPrompt` → system prompt | ✅ | Kayıtlı skill'lerin talimatları agent system prompt'una eklenir |
| L6 | Tool çıktısı görünürlüğü | ✅ | Başarılı araç çıktısı da terminale düşer (`▸ read_file: …`, kırpılmış) |
| L7 | Onay modu UI'sı | ✅ | `/approval [manual\|auto-read\|auto-edit]` komutu + `/root` çıktısında mod + yardım satırı; `auto-edit` seçilirse uyarı satırı |
| L8 | `runAgent` duplikasyonu | ✅ | Legacy döngü **silindi** (~200 satır); tek uygulama: `createAgentRun`. Alt-agent de buna geçti |

### L.9 Faz 8 denetiminde bulunan ve düzeltilen hatalar

Faz 7 kodu denetim edildiğinde iki gerçek hata bulundu ve düzeltildi:

1. **Agent isteğinde kullanıcı mesajı iki kez gönderiliyordu.** `useAgent` hem
   oturum geçmişinden (mesaj zaten eklenmişti) hem de `historyWithUser` ile
   kullanıcı mesajını ikinci kez ekliyordu → her istekte aynı soru iki kez görünüyordu.
   Geçmiş kurulumu saf bir fonksiyona taşındı (`buildAgentHistory`) ve tekilleştirildi.
2. **`rustFetch` abort sinyalini yok sayıyordu.** Proxy üzerinden yapılan isteklerde
   çağıranın timeout'u işlemiyordu (MCP'nin 15 sn sınırı dahil) → Rust tarafında
   istek asılı kalabiliyordu. `init.signal` → `proxy_abort` bağlandı.

Ayrıca: `db.ts` bağlantı önbelleği (her `appendAudit` çağrısında 4 IPC yerine 1),
`appendAudit`/`readAuditLog` hatalarının `sqlError()` ile görünür olması.

### L.10 Faz 8 kabul kriterleri

1. ✅ `subagent` aracı agent döngüsünde çalışıyor; alt-agent metni akışa ikinci kez akmıyor.
2. ✅ `plan` adımları görev listesinde görünüyor ve `todo` ile işaretlenebiliyor.
3. ✅ Kullanıcı allowlist'indeki komut Rust tarafında da çalışıyor (TS **ve** Rust kapıları).
4. ✅ Terminal'de görev listesi ve araç çıktıları görünüyor.
5. ✅ Skill talimatları modele ulaşıyor.
6. ✅ `/approval` komutu onay modunu değiştiriyor.
7. ✅ Tek agent döngüsü kaldı (legacy `runAgent` silindi).
8. ✅ 308 TS test + 42 Rust test yeşil; `tsc` ve `vite build` temiz.

## BÖLÜM M — Faz 9: Bağlam (✅ tamamlandı)

> **Amaç:** Agent bir workspace'e girerken projenin ne olduğunu bilmiyordu; her şeyi
> `list_dir`/`read_file` tool çağrılarıyla keşfetmek zorundaydı. `buildContext`/
> `prioritizeFiles` yazılmış ama **bağlanmamıştı** (ölü kod).
> Test barı: 318 test yeşil (49 dosya) + 44 Rust test + `tsc` + `vite build` + gerçek app boot.

### M.1 P9.0 — Risk kapama (Faz 8'den devralan iki konu)

1. **CI kırmızıydı:** `cargo fmt --check` 6 ihlal veriyordu (5'i `fs.rs`'te — K1
   güvenlik düzeltmesinden, benim oturumumdan önce; 1'i `exec.rs`'te — benim eklediğim
   test helper'ı). `cargo fmt` ile 6'sı da düzeltildi → **CI adımı artık yeşil**.
2. **B2 — `auto-edit` modunda yazma yapılmıyordu:** `propose_patch`/`edit_file` yalnızca
   *pending patch* üretir; asıl yazma `applyPendingPatch` ile **sadece onay akışında**
   (`resolve()`) oluyordu. `auto-edit` modu L7 ile erişilebilir hâle gelince agent
   "yazdım" diyordu ama dosya değişmiyordu.
   - **Düzeltme:** onaysız yazma yolunda üretilen pending patch hemen uygulanıyor
     (`listPending()` farkı ile bulunuyor).
   - **Koruma:** `src/lib/engine/autoEdit.test.ts` (düzeltme olmadan test kırmızı).

### M.2 P9.1 — Repo haritası

- **Rust:** yeni `list_tree(root, max_entries)` komutu — mevcut `walk` yardımcısını kullanır
  (bloklu dizinler, secret dosyalar, 256KB üstü dosyalar elenir), **göreli** yol döner.
- **TS:** `engine/repoContext.ts` → `buildRepoContext(root, {model, customModels})`.
  - Harita: `prioritizeFiles` sırasıyla dosya listesi; **modelin context penceresine göre
    ölçekli** (pencere × %2, tavan 8k karakter).
  - Önbellek: aynı workspace + aynı dosya imzası → yeniden hazırlanmaz (tur başına 1 IPC).
- **Bağlanma:** `useAgent` system prompt'una `[proje]` bloğu olarak eklenir.

### M.3 P9.2 — Anahtar dosyalar

`AGENTS.md` / `CLAUDE.md` / `README.md` varsa okunur (başına 2k karakter) ve
`[proje:<dosya>]` bloğu olarak eklenir. Yoksa atlanır.

### M.4 P9.3 — Kalıcı proje hafızası

- **Rust:** `memory_read(root)` / `memory_append(root, text)` → `.macrocode/context.md`
  (yol sabit → traversal riski yok; 64KB sınır).
- **Komut:** `/note <not>` → not kalıcı hafızaya yazılır, sonraki oturularda
  `[notlar]` bloğu olarak agent'a aktarılır.

### M.5 P9.4 — `/context` komutu (şeffaflık)

"Agent şunu biliyor?" — harita (ilk 25 dosya), anahtar dosyalar, kalıcı notlar.

### M.6 P9.5 — B3: hafıza kesimi id tabanlı

Compaction hafızası artık `coveredIds` ile kesiyor (zaman damgası kesimindeki "aynı
milisaniyede oluşan mesaj kaybolurdu" riski giderildi). Eski hafıza biçimi geriye uyumlu.

### M.7 P9.6 — Dokümantasyon tutarlılığı

`memorybank.md` içindeki bayat `runAgent` referansları (Faz 8 L8'de silinmişti) güncellendi.

### M.8 Faz 9 kabul kriterleri

1. ✅ `/context` haritayı ve kalıcı notları gösteriyor.
2. ✅ Agent ilk turda README/AGENTS.md'yi biliyor (system prompt `[proje]` bloğu).
3. ✅ `/note` sonraki oturuda hatırlanıyor.
4. ✅ Harita bütçeyi aşmıyor (pencere × %2, tavan 8k; anahtar dosya 2k; not 4k).
5. ✅ `cargo fmt --check` temiz → **CI adımları yeşil**.
6. ✅ `auto-edit` modunda yazma gerçekten uygulanıyor.
7. ✅ **Gerçek uygulama boot testi (kesin kanıt):** `sessions.db` silinip uygulama
   14 sn çalıştırıldı (panic yok) → DB'de **2 satır** oluştu (session + meta) →
   `sql:allow-execute` düzeltmesi (A1) gerçek runtime'da doğrulandı (eskiden
   `audit_log`/`sessions` hiç yazılmıyordu).
8. ✅ **Boot sonrası DB senkronizasyonu** (P9.0): yazma yalnızca state değişince
   tetiklendiği için DB boot'ta boş kalıyordu → mevcut durum artık boot sonrası bir
   kez DB'ye yansıtılıyor ("SQLite > localStorage" önceliği geçerli).
8. ✅ 318 TS test + 44 Rust test yeşil; `tsc` ve `vite build` temiz.

---

## BÖLÜM N — Faz 10: Sertleştirme (✅ tamamlandı)

> **Amaç:** 2026-10-18 denetim raporundaki açıkları (O2/D1/D2) kapatmak, CI'ı
> sıkılaştırmak ve gözlemlenebilirlik eklemek.
> Test barı: 332 test yeşil (51 dosya) + 49 Rust test + `clippy -D warnings` temiz +
> `cargo fmt` temiz + **gerçek uygulama smoke testi** (veritabanı yazımı doğrulandı).

### N.1 O2 — `proxy_fetch` SSRF serbestliği (kapandı)

Proxy'nin işi yalnızca CSP'yi aşmak; istek yüzeyi daraltıldı:
- yalnızca `http`/`https` (şema kontrolü zaten vardı),
- **URL içinde kimlik bilgisi reddi** (`http://user:pass@host`),
- **link-local / metadata IP'leri engellendi**: `169.254.0.0/16` (bulut metadata
  dahil), `fe80::/10`, `0.0.0.0/8`, `100.64.0.0/10` — alan adları **çözümlenip**
  denetleniyor. LAN'daki Ollama (`192.168.x`, `10.x`) ve `localhost` **serbest**
  (meşru kullanım),
- **metot kısıtı**: yalnızca GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS,
- **başlık kısıtı**: `host`, `connection`, `transfer-encoding`, `content-length`,
  `upgrade`, `proxy-authorization` gönderilmez,
- **zaman aşımı**: 120 sn (istek sonsuza kadar asılı kalabiliyordu),
- **yanıt boyutu sınırı**: 32 MB (sonsuz akış koruması).

### N.2 D1 — `keys.json` dosya izinleri (kapandı)

`set_api_key` / `delete_api_key` sonrası dosya Unix'te **`0600`** yapılır
(`chmod`) → diğer yerel kullanıcılar anahtarları okuyamaz.

### N.3 D2 — tutarsızlıklar (kapandı)

| Bulgu | Düzeltme |
|---|---|
| **Stale `/apply`**: yama eski workspace'te üretildiyse `/root` değişince yeni köke yazılıyordu | `PendingPatch.root` eklendi; `applyPendingPatch` kök eşleşmiyorsa reddeder |
| **Rust `read_file` uzantı blokajı yoktu** (`.pem/.key/.db` yalnızca walk/glob'da engelliydi) | `is_blocked_ext` → `resolve_rooted` içinde **her** fs aracında |
| **Blok listesi 3 yerde kopyalanmıştı** (policy.ts / fs.rs / context.ts) | **Tek kaynak**: `src/lib/engine/blocks.json` (TS import eder, Rust `include_str!` ile gömer). Sözleşme testi ikisinin de aynı dosyayı kullandığını doğrular |

### N.4 CI sıkılaştırma

- `cargo clippy --lib -- -D warnings` eklendi (15 mevcut uyarı temizlendi: 10 `cargo clippy --fix`, 5 elle).
- **Yeni `smoke` işi**: gerçek uygulamayı `xvfb` ile çalıştırıp **veritabanına
  yazıldığını doğrulayan** `scripts/smoke-test.sh` (ACL hataları yalnızca gerçek
  çalışmada ortaya çıkar; betik veri tabanını yedekleyip geri yükler → yok etmez).

### N.5 Gözlemlenebilirlik

- Yeni `src/lib/logger.ts`: halka arabellek (son 200 kayıt) + WebView konsoluna yazma.
- **Redaksiyon**: API anahtarı/token/JWT alan ve değer kalıpları loglanmaz
  (denetim raporundaki "console.* ile secret log'u yok" maddesi korunur).
- Bağlandığı yerler: `stream.start/done/error`, `agent.run.start/done/error`,
  `db.open.failed`.
- Terminalde: **`/log [n]`** komutu (son kayıtlar).

### N.6 Faz 10 kabul kriterleri

1. ✅ `proxy_fetch` metadata/link-local hedeflerini, tehlikeli metot/başlıkları reddediyor; timeout ve boyut sınırı var.
2. ✅ `keys.json` 0600.
3. ✅ Stale `/apply` engellendi; Rust uzantı blokajı tüm fs araçlarında; blok listesi tek kaynakta.
4. ✅ `clippy -D warnings` temiz; `cargo fmt --check` temiz.
5. ✅ Smoke test betiği gerçek uygulamayı çalıştırıp DB yazımını doğruluyor (CI'da ayrı iş).
6. ✅ `/log` komutu + redakte edilen log kanalı.
7. ✅ 332 TS test + 49 Rust test yeşil; smoke test başarılı.

### N.7 Kalan (Faz 11 — aşağıda)

---

## BÖLÜM O — Faz 11: Prompt Cache (Maliyet) (✅ tamamlandı)

> **Amaç:** Uzun oturumlarda her turda yeniden gönderilen sistem prompt'u + geçmiş
> en pahalı kalemdir. Token *sayacı* ve *fiyatlandırma* tarafı hazırdı, ancak
> **istek tarafı** eksikti: hiçbir yerde `cache_control` gönderilmediği için
> önbellek hiç dolmuyor, `cacheRead` her zaman 0 kalıyordu.

### O.1 İstek tarafı

- **Anthropic:** sistem bloğu + son kullanıcı/tool bloğu `cache_control:
  {type:'ephemeral'}` ile işaretlenir.
  - **Kritik güvenlik koşulu:** Anthropic, önek < 1024 token (Haiku'da 2048) ise
    `cache_control`'ı **reddeder** (400). Bu yüzden işaret yalnızca tahmin edilen
    önek eşik + güvenlik payını aştığında konur (`promptCache.ts`).
  - Hem Rust proxy yolu hem fetch yolu aynı gövdeyi kullanır (`buildAnthropicMessages`).
- **OpenAI-uyumlu:** oturuma bağlı `prompt_cache_key` gönderilir (aynı oturumun
  istekleri aynı önbelleğe yönlendirilir; DeepSeek otomatik cache'ler).
- **Ayar:** `cachePrompts` (varsayılan **açık**) — ⚙ ayarlar → Sohbet. Kapalıyken
  hiçbir önek sağlayıcı tarafında saklanmaz.

### O.2 Görünürlük

`/tokens` çıktısına önbellek kullanımı eklendi:
`önbellek: 12.4k okuma · 3.1k yazma` → önbelleğin gerçekten çalıştığı görülür.

### O.3 Değerlendirilip yapılmayanlar (gerekçeli)

| Öneri | Karar | Gerekçe |
|---|---|---|
| `tauri::test` mock entegrasyon testi | ⏭ | ACL uygulaması WebView yolunda devreye girer; mock runtime ACL'i test etmez. `scripts/smoke-test.sh` **gerçek** uygulamayı çalıştırıp doğruluyor (daha güçlü kanıt). |
| `proxy_fetch` host allowlist'i | ⏭ | WebView zaten güven sınırı (`mcp_spawn` ile keyfi süreç çalıştırabilir) → allowlist saldırı yüzeyini daraltmaz. Metadata/link-local **reddi** (O2) asıl riski kapatır. |
| Blok listesi kayması testi (Rust tarafı) | ✅ | Faz 10'da eklendi (`fs.rs` testi + `tauri-config.test.ts` sözleşme testi). |

### O.4 Faz 11 kabul kriterleri

1. ✅ Anthropic isteğinde `cache_control` var (önek büyükse) ve kısa önekte **yok** (400 koruması).
2. ✅ OpenAI-uyumlu istekte `prompt_cache_key` var; cache kapalıyken hiçbiri gönderilmiyor.
3. ✅ Ayar (varsayılan açık) Sohbet sekmesinde; `partialize` ile kalıcı.
4. ✅ `/tokens` önbellek kullanımını gösteriyor.
5. ✅ Testler: `promptCache.test.ts` (10) + `promptCacheRequest.test.ts` (5) — istek gövdesi uçtan uca doğrulanıyor.

---

## BÖLÜM P — Faz 12: Koruma + Motor (✅ tamamlandı)

> **Amaç:** (a) 11 fazın emeğini koruyan güvenlik ağı, (b) UI dosyalarına dokunmadan
> motor tarafındaki kalan işler. Sürüm değişmedi (`0.1.0`).

### P.1 Güvenlik ağı (git + lisans)

- **`git init`** → ilk commit (`1cf588d`, 168 dosya). Bundan sonra her eşzamanlı
  değişiklik `git diff` ile **görünür** ve `git checkout`/`stash` ile **geri alınabilir**.
  (Bu faz öncesinde 11 fazın emeği tek kopya + sürüm kontrolü olmadan duruyordu.)
- `.gitignore` genişletildi (`*.log`, `.idea/`, `.vscode/`, `*.db*`, `tmp/`, `*.bak`).
- **`LICENSE`** (MIT) eklendi — README "MIT" diyordu, depoda lisans dosyası yoktu.
- Git kimliği repo-yerel: `MacroCode Dev <dev@macrocode.local>` (global config'de kimlik yok).

### P.2 Model registry (istenen liste, gerçek veriyle)

`memorybank/Modeller.md` sonundaki "Eklenecek modeller" listesi registry'ye eklendi.
Model id'leri ve limit/fiyat bilgileri **models.dev gerçek verisinden** alındı (tahmin edilmedi):

| Sağlayıcı | Eklenenler |
|---|---|
| Anthropic | `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-mythos-5`*, `claude-opus-4-8`, `claude-opus-4-7` |
| OpenAI | `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` |
| DeepSeek | `deepseek-flash` (V4.1 Flash), `deepseek-v4-flash`, `deepseek-v4-pro` |
| Google | `gemini-2.5-flash-image` (Nano Banana), `gemini-3-pro-image` (Pro), `gemini-3.1-flash-image` (NB2) |

> `claude-mythos-5` models.dev'de **yok** → yerleşik limitlerle eklendi (otomatik fiyat gelmez).
> Nano Banana ailesi **görsel** çıktı üretir; uygulama metin işlediği için 🛠 kapalı
> ve tabloda not düşüldü.

**Çekirdek model sayısı: 27 → 43** (toplam ~510).

### P.3 Compaction kalıcılığı

Özet artık **oturumun JSON'unda** (`Session.compaction`) saklanıyor → uygulama yeniden
başlatıldığında bağlam yeniden kurulmuyor ve **tekrar özetleme (LLM çağrısı + maliyet) yapılmıyor**.
`/reset` özeti de düşürür, JSON yedekle birlikte taşınır.

### P.4 `auto-read` = gerçek salt-okunur mod

Önceden `auto-read` pratikte `manual` ile aynıydı (okuma araçları zaten hep serbestti) →
anlamsızdı. Artık: **yazma araçları ve `exec` reddedilir** (onay bile istenmez).
O6 kuralı (exec hiçbir modda otomatik onaylanmaz) korunur.

### P.5 `run_state` — ajan devamı (Faz 1'in açık kalan %10'u)

`pending_approvals.run_state` kolonu artık **dolduruluyor**: onay beklerken agent
durumu (geçmiş + adım + bekleyen çağrılar) JSON olarak yazılır; boot'ta geri yüklenir
→ uygulama yeniden başlatıldığında bekleyen iş **kaldığı yerden sürülür**
(eskiden "yeniden başlatılamadı" deniyordu). Yazma yolu `useAgent` içinde ortak
olay işleyicisi ile paylaşılır (yeni tur ve geri yüklenen tur aynı mesaja yazar).

### P.6 Faz 12 kabul kriterleri

1. ✅ Git deposu + ilk commit + LICENSE (geçmiş korunuyor, lisans mevcut).
2. ✅ İstenen 10 model ailesi registry'de (models.dev gerçek verisiyle).
3. ✅ Compaction özeti restart'ta korunuyor (yeniden özetleme yok).
4. ✅ `auto-read` modu anlamlı (yazma + exec kapalı).
5. ✅ Bekleyen agent işi restart sonrası kaldığı yerden sürülüyor.
6. ✅ 372 TS test + 49 Rust test yeşil; `tsc`/`vite build`/`fmt`/`clippy` temiz;
   `scripts/smoke-test.sh` başarılı.

---

*Bu belge tek seferlik bir plandır; fazlar tamamlandıkça `memorybank/memorybank.md`
güncel mimari kaynağı olarak kalır.*
