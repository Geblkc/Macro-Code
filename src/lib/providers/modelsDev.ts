import type {
  CatalogCost,
  CatalogEntry,
  CatalogModalities,
  ModelsDevCatalog,
  ReasoningOption,
} from '../../types';
import { fetchFor } from './rustFetch';
import { t } from '../i18n/core';

/**
 * models.dev — açık model kataloğu.
 *
 * `https://models.dev/api.json` ham olarak ~5.8 MB (232 sağlayıcı / 9061 model)
 * gelir. MacroCode yalnızca **yerleşik sağlayıcılarıyla eşleşen** kayıtları
 * saklar (bkz. `MODELS_DEV_PROVIDERS`) — böylece katalog ~500 modele iner ve
 * uygulamada arama/filtre yapılabilir.
 *
 * Ağ yolu `fetchFor` üzerinden geçer: Tauri'de CSP `connect-src` dışındaki host
 * Rust `proxy_fetch` komutuna yönlendirilir (`rustFetch.ts`), böylece
 * `tauri.conf.json` ile senkron tutulacak yeni bir host gerekmez.
 */

/** models.dev API kökü. */
export const MODELS_DEV_URL = 'https://models.dev/api.json';

/**
 * MacroCode sağlayıcısı → models.dev sağlayıcı anahtarı.
 * `ollama` burada YOK: models.dev yerel modelleri listelemez (Ollama keşfi
 * `discoverOllama(baseUrl)` ile yapılır).
 */
export const MODELS_DEV_PROVIDERS: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
  openrouter: 'openrouter',
  deepseek: 'deepseek',
  xai: 'xai',
};

/** Katalogun bayat sayılma süresi (24 saat). */
export const MODELS_DEV_TTL_MS = 24 * 60 * 60 * 1000;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean {
  return v === true;
}

function modalities(raw: unknown): CatalogModalities {
  const o = (raw ?? {}) as { input?: unknown; output?: unknown };
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return { input: list(o.input), output: list(o.output) };
}

function reasoningOptions(raw: unknown): ReasoningOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ReasoningOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue;
    const r = o as { type?: unknown; values?: unknown; min?: unknown; max?: unknown };
    if (r.type === 'toggle') {
      out.push({ type: 'toggle' });
    } else if (r.type === 'effort') {
      const values = Array.isArray(r.values)
        ? r.values.filter((v): v is string => typeof v === 'string')
        : [];
      out.push({ type: 'effort', values });
    } else if (r.type === 'budget_tokens') {
      const min = num(r.min);
      const max = num(r.max);
      out.push({
        type: 'budget_tokens',
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      });
    }
  }
  return out;
}

function cost(raw: unknown): CatalogCost | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const input = num(c.input);
  const output = num(c.output);
  if (input === undefined && output === undefined) return undefined;
  const cacheRead = num(c.cache_read);
  const cacheWrite = num(c.cache_write);
  const reasoning = num(c.reasoning);
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

/**
 * Bir model kaydı sohbet için uygun mu?
 * - `status` deprecated/beta/alpha ise elenir (yalnız `active` ve alan yok).
 * - Girişte `text` olmalı, çıkışta `text` olmalı (görsel/video-only modeller elenir).
 * - Çıktı limiti > 0 olmalı (gömme/görsel modelleri elenir).
 */
export function isChatModel(entry: {
  status?: string;
  modalities: CatalogModalities;
  outputLimit: number;
}): boolean {
  if (entry.status && entry.status !== 'active') return false;
  if (!entry.modalities.input.includes('text')) return false;
  if (!entry.modalities.output.includes('text')) return false;
  if (!(entry.outputLimit > 0)) return false;
  return true;
}

/**
 * Ham models.dev modelini normalize edilmiş katalog kaydına çevirir.
 * `provider` = **MacroCode** sağlayıcısı (models.dev'in `google` anahtarı
 * `gemini` olur).
 */
export function toCatalogEntry(provider: string, raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id);
  if (!id) return null;
  const limit = (m.limit ?? {}) as { context?: unknown; output?: unknown };
  const contextLimit = num(limit.context) ?? 0;
  const outputLimit = num(limit.output) ?? 0;
  const entry: CatalogEntry = {
    id,
    provider,
    name: str(m.name) ?? id,
    description: str(m.description) ?? '',
    reasoning: bool(m.reasoning),
    reasoningOptions: reasoningOptions(m.reasoning_options),
    toolCall: bool(m.tool_call),
    attachment: bool(m.attachment),
    structuredOutput: bool(m.structured_output),
    temperature: bool(m.temperature),
    openWeights: bool(m.open_weights),
    modalities: modalities(m.modalities),
    contextLimit,
    outputLimit,
  };
  const family = str(m.family);
  if (family) entry.family = family;
  const releaseDate = str(m.release_date);
  if (releaseDate) entry.releaseDate = releaseDate;
  const lastUpdated = str(m.last_updated);
  if (lastUpdated) entry.lastUpdated = lastUpdated;
  const knowledge = str(m.knowledge);
  if (knowledge) entry.knowledge = knowledge;
  const canonical = str(m.canonical_model_id);
  if (canonical) entry.canonicalModelId = canonical;
  const c = cost(m.cost);
  if (c) entry.cost = c;
  return entry;
}

/**
 * Ham models.dev yanıtını kataloğa çevirir.
 * Yalnızca `MODELS_DEV_PROVIDERS` içindeki sağlayıcılar alınır ve sohbet
 * için uygun olmayan kayıtlar elenir.
 */
export function parseModelsDev(raw: unknown, now: number = Date.now()): ModelsDevCatalog {
  const providers: Record<string, CatalogEntry[]> = {};
  if (!raw || typeof raw !== 'object') return { fetchedAt: now, providers };
  const root = raw as Record<string, unknown>;
  for (const [macroProvider, devProvider] of Object.entries(MODELS_DEV_PROVIDERS)) {
    const p = root[devProvider] as { models?: unknown } | undefined;
    const models = p?.models;
    if (!models || typeof models !== 'object') continue;
    const rows: CatalogEntry[] = [];
    for (const [id, m] of Object.entries(models as Record<string, unknown>)) {
      // Bazı kayıtlarda `id` alanı yok; anahtar id'dir.
      const raw = (m ?? {}) as Record<string, unknown>;
      const entry = toCatalogEntry(macroProvider, raw.id ? raw : { ...raw, id });
      if (!entry) continue;
      const status = str(raw.status);
      if (!isChatModel({ ...entry, status })) continue;
      rows.push(entry);
    }
    if (rows.length > 0) providers[macroProvider] = rows;
  }
  return { fetchedAt: now, providers };
}

/**
 * models.dev kataloğunu çeker.
 * `fetchImpl` verilirse (test) o, yoksa `fetchFor` (Tauri'da Rust proxy) kullanılır.
 */
export async function fetchModelsDevCatalog(
  fetchImpl?: typeof fetch,
): Promise<ModelsDevCatalog> {
  const res = await fetchFor(MODELS_DEV_URL, fetchImpl)(MODELS_DEV_URL, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(t('errors.catalogFailed', { status: res.status }));
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error(t('errors.catalogInvalid'));
  }
  return parseModelsDev(raw);
}

/** Katalog bayat mı? (TTL aşıldıysa yenilenmeli). */
export function isStale(catalog: ModelsDevCatalog | null, now: number = Date.now()): boolean {
  if (!catalog) return true;
  return now - catalog.fetchedAt > MODELS_DEV_TTL_MS;
}

/** Katalog önbelleğinin localStorage anahtarı (zustand persist'inden ayrı). */
export const MODELS_DEV_CACHE_KEY = 'macrocode-modelsdev-catalog';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Katalog önbelleğini okur (yoksa null).
 * Bozuk veri sessizce yok sayılır — katalog kritik değildir.
 */
export function loadCachedCatalog(): ModelsDevCatalog | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(MODELS_DEV_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelsDevCatalog>;
    if (!parsed || typeof parsed !== 'object' || !parsed.providers) return null;
    if (typeof parsed.fetchedAt !== 'number') return null;
    return { fetchedAt: parsed.fetchedAt, providers: parsed.providers };
  } catch {
    return null;
  }
}

/** Katalog önbelleğini yazar (başarısızsa sessizce geç — kota dolabilir). */
export function saveCachedCatalog(catalog: ModelsDevCatalog): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(MODELS_DEV_CACHE_KEY, JSON.stringify(catalog));
  } catch {
    // Kota doldu / kota kapalı — önbellek opsiyoneldir.
  }
}
