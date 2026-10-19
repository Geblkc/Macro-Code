import type {
  CatalogEntry,
  Model,
  ModelPrice,
  ModelsDevCatalog,
  Provider,
} from '../../types';

/**
 * models.dev kataloğu → yerleşik model eşleştirme + metadata zenginleştirme.
 *
 * Eşleştirme 3 aşamalıdır (ilk bulunan kazanır):
 *   1. **Doğrudan** — aynı sağlayıcıda aynı id (`anthropic:claude-opus-5-5`).
 *      En güvenilir yol: fiyat ve limitler o sağlayıcının kendi verisidir.
 *   2. **Canonical** — model id, katalogdaki `canonical_model_id` ile eşleşir.
 *   3. **Global id** — id kapsamdaki başka bir sağlayıcıda geçiyor.
 *      (Kapsam 6 yerleşik sağlayıcıyla sınırlıdır: `models.dev`'deki 3. taraf
 *      sağlayıcılar — nano-gpt, aihubmix… — kataloga ALINMAZ.)
 *   4. Hiçbiri tutmuyorsa **yerleşik değerler aynen korunur** — katalog
 *      hiçbir modeli eksiltmez, sadece zenginleştirir.
 */

export interface CatalogIndex {
  /** `provider:id` → kayıt. */
  byProviderId: Map<string, CatalogEntry>;
  /** `id` → kayıtlar (farklı sağlayıcılarda aynı id). */
  byId: Map<string, CatalogEntry[]>;
  /** `canonical_model_id` → kayıt. */
  byCanonical: Map<string, CatalogEntry>;
}

const EMPTY_INDEX: CatalogIndex = {
  byProviderId: new Map(),
  byId: new Map(),
  byCanonical: new Map(),
};

/** Katalogdan arama indeksi kurar (yoksa boş indeks). */
export function buildCatalogIndex(catalog: ModelsDevCatalog | null | undefined): CatalogIndex {
  if (!catalog) return { byProviderId: new Map(), byId: new Map(), byCanonical: new Map() };
  const byProviderId = new Map<string, CatalogEntry>();
  const byId = new Map<string, CatalogEntry[]>();
  const byCanonical = new Map<string, CatalogEntry>();
  for (const entries of Object.values(catalog.providers ?? {})) {
    for (const e of entries) {
      // Anahtar kaydın KENDİ sağlayıcısından gelir (katalog anahtarı değil).
      byProviderId.set(`${e.provider}:${e.id}`, e);
      const list = byId.get(e.id);
      if (list) list.push(e);
      else byId.set(e.id, [e]);
      if (e.canonicalModelId && !byCanonical.has(e.canonicalModelId)) {
        byCanonical.set(e.canonicalModelId, e);
      }
    }
  }
  return { byProviderId, byId, byCanonical };
}

/**
 * Yerleşik modelle eşleşen katalog kaydı.
 * Sıra: doğrudan → canonical → global id.
 */
export function matchCatalogEntry(model: Model, index: CatalogIndex): CatalogEntry | undefined {
  const direct = index.byProviderId.get(`${model.provider}:${model.id}`);
  if (direct) return direct;
  const canonical = index.byCanonical.get(model.id);
  if (canonical) return canonical;
  const global = index.byId.get(model.id);
  if (global && global.length > 0) return global[0];
  return undefined;
}

/** Katalog fiyatını `ModelPrice` biçimine çevirir (fiyat yoksa undefined). */
export function catalogPriceOf(entry: CatalogEntry | undefined): ModelPrice | undefined {
  if (!entry?.cost) return undefined;
  const input = entry.cost.input;
  const output = entry.cost.output;
  if (input === undefined && output === undefined) return undefined;
  const price: ModelPrice = {
    input: input ?? 0,
    output: output ?? 0,
  };
  if (entry.cost.cache_read !== undefined) price.cacheRead = entry.cost.cache_read;
  if (entry.cost.cache_write !== undefined) price.cacheWrite = entry.cost.cache_write;
  return price;
}

/**
 * Katalog kaydını registry `Model` biçimine çevirir.
 * Sadece katalogda olan sağlayıcılar (anthropic/openai/gemini/openrouter/deepseek/xai).
 */
export function toModel(entry: CatalogEntry): Model {
  const vision = entry.modalities.input.includes('image');
  const model: Model = {
    id: entry.id,
    name: entry.name,
    provider: entry.provider as Provider,
    contextWindow: entry.contextLimit,
    supportsVision: vision,
    maxOutput: entry.outputLimit,
    capabilities: {
      tools: entry.toolCall,
      vision,
      reasoning: entry.reasoning,
    },
    modalities: entry.modalities,
  };
  if (entry.description) model.description = entry.description;
  if (entry.family) model.family = entry.family;
  if (entry.releaseDate) model.releaseDate = entry.releaseDate;
  if (entry.knowledge) model.knowledge = entry.knowledge;
  if (entry.reasoningOptions.length > 0) model.reasoningOptions = entry.reasoningOptions;
  if (entry.structuredOutput) model.structuredOutput = true;
  if (entry.openWeights) model.openWeights = true;
  const price = catalogPriceOf(entry);
  if (price) model.catalogPrice = price;
  return model;
}

/**
 * Katalogdaki TÜM modelleri registry `Model` listesine çevirir.
 * models.dev 6 sağlayıcıda ~480 model sunar — elle yazılmış registry'nin
 * otomatik genişletilmiş hali.
 */
export function catalogModels(catalog: ModelsDevCatalog | null): Model[] {
  if (!catalog) return [];
  const out: Model[] = [];
  for (const entries of Object.values(catalog.providers ?? {})) {
    for (const e of entries) out.push(toModel(e));
  }
  return out;
}

/**
 * Tek modeli katalogla zenginleştirir.
 *
 * Güvenli kurallar:
 * - `contextWindow` / `maxOutput` **küçülmez** (yeni daha büyük limit gelirse artar).
 * - `capabilities.tools` ve `capabilities.reasoning` yalnız **kazanır** (kapı açılır,
 *   kapanmaz) — ajan/görsel kontrolleri katalog verisiyle bozulmaz.
 * - `supportsVision` ve `capabilities.vision` **her zaman eşit** kalır
 *   (registry testi bu invariantı zorunlu tutuyor).
 */
export function enrichModel(model: Model, index: CatalogIndex): Model {
  const entry = matchCatalogEntry(model, index);
  if (!entry) return model;

  const vision = model.capabilities.vision || entry.modalities.input.includes('image');
  const next: Model = {
    ...model,
    contextWindow: Math.max(model.contextWindow, entry.contextLimit || 0),
    maxOutput: Math.max(model.maxOutput, entry.outputLimit || 0),
    supportsVision: vision,
    capabilities: {
      tools: model.capabilities.tools || entry.toolCall,
      vision,
      reasoning: model.capabilities.reasoning || entry.reasoning,
    },
  };
  if (entry.description) next.description = entry.description;
  if (entry.family) next.family = entry.family;
  if (entry.releaseDate) next.releaseDate = entry.releaseDate;
  if (entry.knowledge) next.knowledge = entry.knowledge;
  next.modalities = entry.modalities;
  if (entry.reasoningOptions.length > 0) next.reasoningOptions = entry.reasoningOptions;
  if (entry.structuredOutput) next.structuredOutput = true;
  if (entry.openWeights) next.openWeights = true;
  const price = catalogPriceOf(entry);
  if (price) next.catalogPrice = price;
  return next;
}

/** Model listesini katalogla zenginleştirir (eşleşmeyenler değişmez). */
export function enrichModels(models: Model[], index: CatalogIndex): Model[] {
  if (index.byProviderId.size === 0 && index.byId.size === 0) return models;
  return models.map((m) => enrichModel(m, index));
}

/**
 * Aktif katalog (module seviyesi singleton).
 *
 * Neden singleton: `resolveModels`/`getModel`/`supportsToolsForModel` gibi
 * yardımcılar onlarca yerde çağrılıyor; katalogu her çağrıya parametre
 * olarak geçirmek yerine tek noktadan beslenir. Testlerde
 * `setActiveCatalog(null)` ile sıfırlanır.
 */
let activeCatalog: ModelsDevCatalog | null = null;
let activeIndex: CatalogIndex = EMPTY_INDEX;

/** Aktif katalogu değiştirir (yenileyince çağrılır). */
export function setActiveCatalog(catalog: ModelsDevCatalog | null): void {
  activeCatalog = catalog;
  activeIndex = buildCatalogIndex(catalog);
}

/** Aktif katalog (yoksa null). */
export function getActiveCatalog(): ModelsDevCatalog | null {
  return activeCatalog;
}

/** Aktif katalog indeksi. */
export function getActiveCatalogIndex(): CatalogIndex {
  return activeIndex;
}

/** Katalogdaki tüm modeller (sağlayıcı → liste düzleştirilmiş). */
export function allCatalogEntries(catalog: ModelsDevCatalog | null): CatalogEntry[] {
  if (!catalog) return [];
  const out: CatalogEntry[] = [];
  for (const entries of Object.values(catalog.providers ?? {})) out.push(...entries);
  return out;
}

/**
 * Bir model id'si için katalog fiyatı (eşleşme 4 aşamalı).
 * `prices` tablosunu otomatik doldurmak için kullanılır.
 */
export function catalogPriceForModel(
  model: Model,
  index: CatalogIndex = getActiveCatalogIndex(),
): ModelPrice | undefined {
  return catalogPriceOf(matchCatalogEntry(model, index));
}

/** Sağlayıcı etiketi (models.dev anahtarı → görünen ad). */
export const CATALOG_PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  xai: 'xAI',
};
