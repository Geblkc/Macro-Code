import type { DiscoveredModel, Provider } from '../../types';
import { listOllamaModels } from './ollama';
import { fetchFor } from './rustFetch';

/** Keşif kaynağı → modelin bağlanacağı yerleşik sağlayıcı. */
export const SOURCE_PROVIDER: Record<
  Exclude<DiscoveredModel['source'], 'modelsDev'>,
  Provider
> = {
  openrouter: 'openrouter',
  ollama: 'ollama',
  openai: 'openai',
  gemini: 'gemini',
};

const now = () => Date.now();

interface OpenRouterEntry {
  id?: unknown;
  context_length?: unknown;
}

function asDiscovered(
  ids: { id: string; contextWindow?: number }[],
  source: DiscoveredModel['source'],
): DiscoveredModel[] {
  const seen = new Set<string>();
  const out: DiscoveredModel[] = [];
  for (const e of ids) {
    if (!e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, source, contextWindow: e.contextWindow, fetchedAt: now() });
  }
  return out;
}

/** OpenRouter model kataloğu (anahtarsız public uç). */
export async function discoverOpenRouter(fetchImpl?: typeof fetch): Promise<DiscoveredModel[]> {
  const f = fetchImpl ?? globalThis.fetch;
  const res = await f('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`openrouter listesi alınamadı (http ${res.status})`);
  const json = (await res.json()) as { data?: OpenRouterEntry[] };
  const rows = Array.isArray(json.data) ? json.data : [];
  return asDiscovered(
    rows
      .filter((r) => typeof r.id === 'string')
      .map((r) => ({
        id: r.id as string,
        contextWindow: typeof r.context_length === 'number' ? r.context_length : undefined,
      })),
    'openrouter',
  );
}

/** Kurulu Ollama modelleri. */
export async function discoverOllama(
  baseUrl: string,
  fetchImpl?: typeof fetch,
): Promise<DiscoveredModel[]> {
  const names = await listOllamaModels(baseUrl, fetchImpl);
  return asDiscovered(names.map((id) => ({ id })), 'ollama');
}

/** OpenAI model listesi (kayıtlı anahtar + özel base URL ile). */
export async function discoverOpenAI(
  apiKey: string,
  baseUrl: string,
  fetchImpl?: typeof fetch,
): Promise<DiscoveredModel[]> {
  const base = (baseUrl.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${base}/models`;
  // Özel taban URL CSP dışında kalabilir → Rust proxy.
  const res = await fetchFor(url, fetchImpl)(url, {
    headers: { authorization: `Bearer ${apiKey.trim()}` },
  });
  if (!res.ok) throw new Error(`openai listesi alınamadı (http ${res.status})`);
  const json = (await res.json()) as { data?: { id?: unknown }[] };
  const rows = Array.isArray(json.data) ? json.data : [];
  return asDiscovered(
    rows.filter((r) => typeof r?.id === 'string').map((r) => ({ id: r.id as string })),
    'openai',
  );
}

/** Gemini model listesi (`models/<id>` öneki kırpılır). */
export async function discoverGemini(
  apiKey: string,
  fetchImpl?: typeof fetch,
): Promise<DiscoveredModel[]> {
  if (!apiKey.trim()) throw new Error('önce gemini anahtarı gir');
  const f = fetchImpl ?? globalThis.fetch;
  const res = await f(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`,
  );
  if (!res.ok) throw new Error(`gemini listesi alınamadı (http ${res.status})`);
  const json = (await res.json()) as { models?: { name?: unknown }[] };
  const rows = Array.isArray(json.models) ? json.models : [];
  return asDiscovered(
    rows
      .filter((r) => typeof r?.name === 'string')
      .map((r) => ({ id: (r.name as string).replace(/^models\//, '') })),
    'gemini',
  );
}
