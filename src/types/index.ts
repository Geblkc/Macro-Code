export type Provider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'openrouter'
  | 'deepseek'
  | 'xai';

export type ProviderId = Provider;

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
}

export type Model = {
  id: string;
  name: string;
  provider: Provider;
  contextWindow: number;
  supportsVision: boolean;
  maxOutput: number;
  capabilities: ModelCapabilities;
  /** models.dev kataloğundan gelen opsiyonel metadata (katalog yoksa boş). */
  description?: string;
  /** Model ailesi (ör. "claude", "gemini") — UI gruplaması için. */
  family?: string;
  /** Yayın tarihi (YYYY-MM-DD). */
  releaseDate?: string;
  /** Eğitim veri kesim tarihi. */
  knowledge?: string;
  /** Giriş/çıkış modaliteleri (text, image, audio, pdf, video). */
  modalities?: CatalogModalities;
  /** Düşünme (reasoning) seçenekleri: toggle / effort / budget_tokens. */
  reasoningOptions?: ReasoningOption[];
  /** Yapılandırılmış çıktı (JSON schema) desteği. */
  structuredOutput?: boolean;
  /** Açık ağırlık (open weights) modeli mi. */
  openWeights?: boolean;
  /** Katalog fiyatı — `settings.prices` bunu ezebilir (elle girilen kazanır). */
  catalogPrice?: ModelPrice;
};

export interface ProviderDefinition {
  id: Provider;
  label: string;
  /** api-key: secret gerekir · url: yerel URL (ollama) */
  auth: 'api-key' | 'url';
  placeholder: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  /** false ise anahtar yokluğu hata üretmez (ollama). */
  needsKey: boolean;
  /** OpenAI-compatible chat/completions tabanlı mı (tool mapping reuse). */
  openAICompatible: boolean;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  provider?: Provider;
  tokens?: { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
  /** Ekli görseller (data URL, JPEG). Sadece user mesajlarında dolar. */
  images?: string[];
  /** Faz 4: reasoning/thinking metni (dim blokta gösterilir). */
  reasoning?: string;
  /** Faz 4: imzalı thinking blokları (Anthropic geri gönderimi için). */
  thinking?: Array<{ thinking: string; signature: string }>;
  /** Faz 1 (K5): assistant mesajının tool çağrıları. */
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  /** Faz 1 (K5): tool sonucu mesajının bağlı olduğu çağrı (system rolünde saklanır). */
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

/**
 * Faz 12 B.6 — kalıcı compaction özeti.
 *
 * Otomatik compaction özeti transcript'e **yazılmaz** (görünüm bozulmasın diye),
 * ama oturum yeniden başlatıldığında kaybolursa uzun ajan oturumu tam bağlamı
 * yeniden kurar ve **tekrar özetleme** (LLM çağrısı + maliyet) yapar. Bu kayıt
 * özeti ve kapsanan mesaj id'lerini saklar → yeniden başlatma sonrası aynı
 * sıkıştırılmış bağlam kullanılır.
 */
export type SessionCompaction = {
  /** Özetleme anı (epoch ms). */
  at: number;
  /** Özetlenmiş geçmiş (özet mesajı + korunan mesajlar). */
  items: Array<{
    role: string;
    content: string;
    id?: string;
    ts?: number;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  }>;
  /** Özete dahil edilen mesajların id'leri. */
  coveredIds?: string[];
};

export type Session = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  provider: Provider;
  model: string;
  systemPrompt: string;
  /** Faz 12 B.6: kalıcı compaction özeti (yoksa otomatik compaction yok). */
  compaction?: SessionCompaction;
};

export type ApiKeys = {
  anthropic: string;
  openai: string;
  gemini: string;
  ollamaUrl: string;
  openrouter: string;
  deepseek: string;
  xai: string;
};

export type LineType = 'user' | 'ai' | 'sys' | 'err' | 'warn';

export type CodeBlock = {
  lang: string;
  code: string;
};

export type TerminalLine = {
  id: string;
  type: LineType;
  content: string;
  isStreaming?: boolean;
  codeBlocks?: CodeBlock[];
};

/**
 * Yapılandırılmış araç çağrısı bilgisi (görsel kart için).
 * `status`: 'run' (çağrıldı) → 'ok' | 'err' (sonuç geldi).
 */
export type ToolEvent = {
  /** Araç çağrısının id'si (çağrı + sonuç eşleşmesi için). */
  id: string;
  /** Araç adı (read_file, exec, todo, ...). */
  name: string;
  /** Argüman önizlemesi (tek satır). */
  args: string;
  status: 'run' | 'ok' | 'err';
  /** Araç çıktısı (sonuç geldiyse). */
  output?: string;
  /** Ölçülen süre (ms). */
  ms?: number;
};

/**
 * Gecici gorunum satiri (boot mesaji, komut ciktisi, hata).
 * `ts` olusturma anidir (gorunum siralamasi icin).
 * Uzlasim: sys/err/warn icerikleri `///`, `✗`, `!` isaretlerini TASIR;
 * MessageLine bunlara ek prefix koymaz (sadece user->❯, ai->◆ ekler).
 */
export type ExtraLine = TerminalLine & {
  ts: number;
  /** Varsa satır bir araç çağrısıdır (kart olarak render edilir). */
  tool?: ToolEvent;
};

/**
 * OpenAI-uyumlu özel uç (proxy, Azure-benzeri, OpenRouter, LM Studio...).
 * `Provider` birliğine DOKUNULMAZ — özel uçlar ayrı listede tutulur.
 * Secret (`apiKey`) settings persist'ine ASLA yazılmaz; keystore'da
 * `custom_<id>` adıyla + bellekte `customSecrets` içinde tutulur.
 */
export interface CustomEndpoint {
  /** `custom_<slug>` — keystore anahtar adı ile aynı. */
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
};

/**
 * Elle eklenen / keşfedilip eklenen model.
 * Registry'e girmez; `resolveModels` ile birleştirilir (id çakışırsa custom kazanır).
 */
export interface CustomModel {
  id: string;
  provider: Provider;
  name: string;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  maxOutput?: number;
  /** models.dev kataloğundan taşınan açıklama/aile (varsa). */
  description?: string;
  family?: string;
  /** Katalog fiyatı (elle girilen `settings.prices` bunu ezebilir). */
  catalogPrice?: ModelPrice;
}

/** API'den keşfedilen (henüz eklenmemiş) model. */
export interface DiscoveredModel {
  id: string;
  source: 'openrouter' | 'ollama' | 'openai' | 'gemini' | 'modelsDev';
  contextWindow?: number;
  fetchedAt: number;
  /** models.dev kaynağında katalog kaydı (yalnız `source='modelsDev'`). */
  catalog?: CatalogEntry;
}

/** Model başına istek parametreleri (boş = sağlayıcı varsayılanı, gönderilmez). */
export interface ModelParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  thinkingBudget?: number;
}

/** 1M token başına USD fiyatı (girdi/çıktı). */
export interface ModelPrice {
  input: number;
  output: number;
  /** Önbellekten okunan girdi (1M token başına USD). */
  cacheRead?: number;
  /** Önbelleğe yazılan girdi (1M token başına USD). */
  cacheWrite?: number;
}

/** models.dev fiyat kırılımı (birim: USD / 1M token). */
export interface CatalogCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
}

/** Düşünme (reasoning) seçeneği — models.dev `reasoning_options`. */
export type ReasoningOption =
  | { type: 'toggle' }
  | { type: 'effort'; values: string[] }
  | { type: 'budget_tokens'; min?: number; max?: number };

/** Giriş/çıkış modaliteleri (text, image, audio, video, pdf). */
export interface CatalogModalities {
  input: string[];
  output: string[];
}

/**
 * models.dev katalog kaydı (tek model).
 * Alan adları normalize edilmiştir (snake_case → camelCase).
 */
export interface CatalogEntry {
  id: string;
  /** MacroCode sağlayıcısı (anthropic, openai, gemini, openrouter, deepseek, xai). */
  provider: string;
  name: string;
  description: string;
  family?: string;
  reasoning: boolean;
  reasoningOptions: ReasoningOption[];
  toolCall: boolean;
  attachment: boolean;
  structuredOutput: boolean;
  temperature: boolean;
  openWeights: boolean;
  releaseDate?: string;
  lastUpdated?: string;
  knowledge?: string;
  canonicalModelId?: string;
  modalities: CatalogModalities;
  contextLimit: number;
  outputLimit: number;
  cost?: CatalogCost;
}

/** models.dev kataloğu — sağlayıcı → model kayıtları. */
export interface ModelsDevCatalog {
  /** Kataloğun çekildiği an (ms). */
  fetchedAt: number;
  /** MacroCode sağlayıcısı → modeller (anthropic, openai, gemini, openrouter, deepseek, xai). */
  providers: Record<string, CatalogEntry[]>;
}

/**
 * Faz 5 — MCP sunucu yapılandırması (metadata; secret HARİÇ persist edilir).
 * Env değerleri bellekte `mcpSecrets` + keystore'da `custom_<id>` adıyla tutulur.
 */
export interface McpServerConfig {
  /** `mcp_<slug>` — keystore anahtar adı `custom_<id>` ile aynı kökten gelir. */
  id: string;
  name: string;
  transport: 'http' | 'stdio';
  /** HTTP/SSE uç adresi (transport http ise). */
  url?: string;
  /** stdio komutu + argümanları (transport stdio ise). */
  command?: string;
  args?: string[];
  /** Env değişken ADLARI (değerler keystore'da, burada asla değer yok). */
  envKeys?: string[];
  enabled: boolean;
  /** İzinli araç adları; null = tümü. */
  allowedTools: string[] | null;
}
