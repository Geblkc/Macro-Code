# MacroCode — Model Kataloğu

> Uygulamanın **model listesi** iki kaynaktan gelir:
>
> 1. **Elle çekirdek** (27 model) — `src/lib/providers/*.ts` → `ALL_MODELS`.
>    Varsayılanlar, garantili çalışır, offline'da bile hazırdır.
> 2. **models.dev kataloğu** (~467 model) — `https://models.dev/api.json`.
>    Çekirdekle eşleşmeyen modeller otomatik listeye eklenir.
>
> Toplam: **~494 model / 7 sağlayıcı**. Kullanıcı tarafından eklenen modeller
> (`customModels`) ve gizlenenler (`disabledModels`) cihazdaki store'da durur,
> burada yer almaz.
>
> **Görünürlük kuralı:** API anahtarı olmayan sağlayıcının modelleri hiçbir
> listede görünmez (`ollama` hariç — URL yeterli). Bkz. "API Anahtarı Kuralı".
>
> Son güncelleme: 2026-10-19 · Toplam: **~494 model / 7 sağlayıcı**

## Başlıklar

| İşaret | Anlam |
|---|---|
| ★ | Sağlayıcının varsayılan modeli (`PROVIDER_DEFS.defaultModel`) |
| 🛠 / 👁 / 🧠 | `tools` / `vision` / `reasoning` yetenekleri |
| ctx | `contextWindow` — bağlam penceresi (token) |
| max out | `maxOutput` — istek başına azami çıktı (token) |

> İstekteki çıktı tavanı her durumda `MAX_OUTPUT_TOKEN_CAP` = **16.384**'e kırpılır
> (`src/lib/providers/common.ts`); tablodaki `max out` registry değeridir.
> Aşağıdaki tablolar **elle çekirdeği** gösterir — katalogdan gelen modeller
> uygulamada otomatik olarak listelenir (arama: ⚙ ayarlar → Modeller).

---

## Anthropic (4) — varsayılan: `claude-opus-5-5`

| Model id | Ad | ctx | max out | 🛠👁🧠 | models.dev |
|---|---|---|---|---|---|
| `claude-opus-5-5` ★ | Claude Opus 5.5 | 1.000.000 | 128.000 | ✓✓✓ | eşleşti ($4/$20) |
| `claude-sonnet-5-5` | Claude Sonnet 5.5 | 1.000.000 | 128.000 | ✓✓✓ | eşleşti |
| `claude-haiku-5-5` | Claude Haiku 5.5 | 1.000.000 | 128.000 | ✓✓✗ | eşleşti |
| `claude-fable-5-1` | Claude Fable 5.1 | 1.000.000 | 128.000 | ✓✓✓ | eşleşmedi |

## OpenAI (4) — varsayılan: `gpt-6.1-sol`

| Model id | Ad | ctx | max out | 🛠👁🧠 | models.dev |
|---|---|---|---|---|---|
| `gpt-6.1-sol` ★ | GPT-6.1 Sol | 1.050.000 | 128.000 | ✓✓✓ | eşleşti ($2/$10) |
| `gpt-6-astra` | GPT-6 Astra | 1.050.000 | 128.000 | ✓✓✓ | eşleşti |
| `gpt-6-sol` | GPT-6 Sol | 1.050.000 | 128.000 | ✓✓✓ | eşleşti |
| `gpt-6-luna` | GPT-6 Luna | 1.050.000 | 128.000 | ✓✓✗ | eşleşti |

## Gemini (3) — varsayılan: `gemini-3.8-flash`

| Model id | Ad | ctx | max out | 🛠👁🧠 | models.dev |
|---|---|---|---|---|---|
| `gemini-3.8-flash` ★ | Gemini 3.8 Flash | 1.000.000 | 65.536 | ✓✓✓ | eşleşti ($0.75/$3.75) |
| `gemini-3.5-flash` | Gemini 3.5 Flash | 1.000.000 | 65.536 | ✓✓✓ | eşleşti |
| `gemini-3-pro` | Gemini 3 Pro | 1.000.000 | 131.072 | ✓✓✓ | **eşleşmedi** |

## Ollama (6) — varsayılan: `llama3.3`

| Model id | Ad | ctx | max out | 🛠👁🧠 | models.dev |
|---|---|---|---|---|---|
| `llama3.1` | Llama 3.1 | 128.000 | 4.096 | ✗✗✗ | yok (yerel model) |
| `llama3.3` ★ | Llama 3.3 | 128.000 | 4.096 | ✗✗✗ | yok (yerel model) |
| `mistral` | Mistral | 32.000 | 4.096 | ✗✗✗ | yok (yerel model) |
| `qwen2.5` | Qwen 2.5 | 32.000 | 4.096 | ✗✗✗ | yok (yerel model) |
| `qwen3` | Qwen 3 | 32.768 | 4.096 | ✗✗✓ | yok (yerel model) |
| `codellama` | Code Llama | 16.000 | 4.096 | ✗✗✗ | yok (yerel model) |

> Ollama modellerinde `tools` kapalıdır → **ajan modunda kullanılamazlar** (sadece sohbet).
> Kurulu modellerin listesi `discoverOllama(baseUrl)` ile yerel API'den gelir.

## OpenRouter (5) — varsayılan: `openrouter/auto`

| Model id | Ad | ctx | max out | 🛠👁🧠 | models.dev |
|---|---|---|---|---|---|
| `openrouter/auto` ★ | OpenRouter Auto | 200.000 | 16.384 | ✓✓✗ | eşleşti |
| `anthropic/claude-sonnet-5.5` | Claude Sonnet 5.5 (via OR) | 1.000.000 | 128.000 | ✓✓✓ | eşleşti |
| `openai/gpt-6.1-sol` | GPT-6.1 Sol (via OR) | 1.050.000 | 128.000 | ✓✓✓ | eşleşti |
| `deepseek/deepseek-chat` | DeepSeek Chat (via OR) | 128.000 | 8.192 | ✓✗✗ | eşleşti |
| `x-ai/grok-4.7` | Grok 4.7 (via OR) | 256.000 | 16.384 | ✓✓✓ | eşleşti |

## DeepSeek (2) — varsayılan: `deepseek-chat`

| Model id | Ad | ctx | max out | 🛠👁🧠 | models.dev |
|---|---|---|---|---|---|
| `deepseek-chat` ★ | DeepSeek Chat | 128.000 | 8.192 | ✓✗✗ | **eşleşmedi** |
| `deepseek-reasoner` | DeepSeek Reasoner | 128.000 | 8.192 | ✗✗✓ | **eşleşmedi** |

## xAI (3) — varsayılan: `grok-4.20`

| Model id | Ad | ctx | max out | 🛠👁🧠 | models.dev |
|---|---|---|---|---|---|
| `grok-4.20` ★ | Grok 4.20 | 256.000 | 16.384 | ✓✓✓ | **eşleşmedi** |
| `grok-4.7` | Grok 4.7 | 256.000 | 16.384 | ✓✓✓ | eşleşti ($2/$6) |
| `grok-latest` | Grok Latest | 256.000 | 16.384 | ✓✓✓ | **eşleşmedi** |

---

## Özet

| Sağlayıcı | Çekirdek | models.dev eşleşmesi | Katalog + çekirdek toplam |
|---|---|---|---|
| anthropic | 4 | 4/4 | 17 |
| openai | 4 | 4/4 | 37 |
| gemini | 3 | 2/3 | 32 |
| ollama | 6 | — (yerel) | 6 |
| openrouter | 5 | 5/5 | 388 |
| deepseek | 2 | 0/2 | 4 |
| xai | 3 | 1/3 | 10 |
| **Toplam** | **27** | **16/27** | **494** |

## API Anahtarı Kuralı

**Anahtarı olmayan sağlayıcının modelleri listelenmez** (`ollama` hariç — URL yeterli).
Uygulama noktaları:

| Ekran | Davranış |
|---|---|
| Titlebar model açılır listesi | Arama kutusu + sağlayıcı grupları; anahtarsız sağlayıcı gizli, sonunda **"🔑 … — anahtar ekle"** satırı (tıklayınca ayarlar açılır) |
| Ayarlar → Modeller | Üstte arama + sağlayıcı filtresi; "Varsayılan model", "Yedek model", "Fiyat tablosu" ve "Modeller (açık/kapalı)" listeleri filtrelenmiş görünür; anahtarsız sağlayıcı için **"anahtar ekle"** satırı |
| Ayarlar → Sohbet | "Özetleyici model" listesi de filtrelenir |
| `/model` komutu | Sağlayıcı başına model sayısı; anahtarı olmayan sağlayıcı **"anahtar yok — listede gizli"** uyarısıyla çıkar |
| `/model <id>` | Anahtarsız sağlayıcının modeli seçilirse uyarı verir |

Uygulama mantığı: `src/lib/providers/visibility.ts` → `hasProviderKey()`,
`visibleModels()`, `hiddenProviders()`.

## models.dev Kataloğu (ayrı kaynak)

`https://models.dev/api.json` → uygulama yalnızca **6 yerleşik sağlayıcıdan** kayıt saklar:

| models.dev sağlayıcısı | Kayıt sayısı |
|---|---|
| anthropic | 17 |
| openai | 37 |
| gemini (google) | 31 |
| openrouter | 388 |
| deepseek | 2 |
| xai | 8 |
| **Toplam** | **483** |

Bu 483 model registry'ye **girmez** — Modeller sekmesi → "models.dev kataloğu" ile
aranır, "ekle" denilince `customModels`'e alınır. Ayrıntı:
`memorybank/memorybank.md` § 7.6.

> **Güncelleme:** models.dev kataloğu artık doğrudan registry'ye de giriyor —
> çekirdekle eşleşmeyen ~467 model `resolveModels()` ile otomatik listelenir.
> Yukarıdaki tablo katalogun ham kayıt sayılarını gösterir; uygulamadaki toplam
> listede çekirdek modeller de yer alır.

### models.dev'de eşleşmeyen 11 model ve nedeni

| Model | Neden |
|---|---|
| `gemini-3-pro` | models.dev'de `google` altında yok (yalnız 3. taraf sağlayıcılarda) |
| `deepseek-chat`, `deepseek-reasoner` | `deepseek` altında yok (yalnız 3. taraf sağlayıcılarda) |
| `grok-4.20`, `grok-latest` | `xai` altında yok (`grok-4.20-0309-*` varyantları var) |
| 6 Ollama modeli | models.dev yerel modelleri listelemez |

Eşleşmeyenlerde **yerleşik limit/fiyat bilgileri aynen korunur**, otomatik fiyat gelmez.

## Bu listeyi güncelleme

- Çekirdek registry değişikliği: `src/lib/providers/{sağlayıcı}.ts` → `MODELS` dizisi
- Katalog genişletmesi otomatiktir — `src/lib/providers/catalog.ts` →
  `catalogModels()` + `resolveModels()` (elle gerek yok)
- models.dev eşleşmesi: katalog yenilendikçe değişebilir →
  `src/lib/providers/modelsDevIntegration.test.ts` canlı doğrulama sağlar
- Kullanıcıya özel modeller (`customModels`) ve gizlenenler (`disabledModels`)
  cihazda saklanır; bu dosyada yer almaz
  
  ## Eklenecek modeller
  1 Deepseek V4.1 Flash
  2 Deepseek V4 Flash
  3 Deepseek V4 Pro
  4 Claude Opus 5
  5 Claude sonnet 5
  6 Claude Fable 5 
  7 Claude Mythos 5 
  8 Claude Opus 4.8 ve 4.7
  9 google nano banana
  10 Openaı GPT-5.6 Modelleri
