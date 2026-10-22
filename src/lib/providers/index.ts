import type { Model, Provider, ProviderDefinition } from '../../types';
import type { CustomModel } from '../../types';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { ollamaProvider } from './ollama';
import { openaiProvider } from './openai';
import { openrouterProvider } from './openrouter';
import { deepseekProvider } from './deepseek';
import { xaiProvider } from './xai';
import type { AIProvider } from './common';
import { enrichModels, getActiveCatalog, getActiveCatalogIndex, catalogModels } from './catalog';

export * from './common';
export * from './catalog';
export * from './visibility';

export const PROVIDER_DEFS: Record<Provider, ProviderDefinition> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    auth: 'api-key',
    placeholder: 'sk-ant-…',
    defaultModel: 'claude-opus-5-5',
    defaultBaseUrl: 'https://api.anthropic.com',
    needsKey: true,
    openAICompatible: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'console.anthropic.com',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    auth: 'api-key',
    placeholder: 'sk-…',
    defaultModel: 'gpt-6.1-sol',
    defaultBaseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    openAICompatible: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'platform.openai.com',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    auth: 'api-key',
    placeholder: 'AIza…',
    defaultModel: 'gemini-3.8-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    needsKey: true,
    openAICompatible: false,
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyUrlLabel: 'aistudio.google.com',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    auth: 'url',
    placeholder: 'http://localhost:11434',
    defaultModel: 'llama3.3',
    defaultBaseUrl: 'http://localhost:11434',
    needsKey: false,
    openAICompatible: false,
    keyUrl: 'https://ollama.com/download',
    keyUrlLabel: 'ollama.com',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    auth: 'api-key',
    placeholder: 'sk-or-…',
    defaultModel: 'openrouter/auto',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    openAICompatible: true,
    keyUrl: 'https://openrouter.ai/keys',
    keyUrlLabel: 'openrouter.ai',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    auth: 'api-key',
    placeholder: 'sk-…',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    needsKey: true,
    openAICompatible: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyUrlLabel: 'platform.deepseek.com',
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok',
    auth: 'api-key',
    placeholder: 'xai-…',
    defaultModel: 'grok-4.20',
    defaultBaseUrl: 'https://api.x.ai/v1',
    needsKey: true,
    openAICompatible: true,
    keyUrl: 'https://console.x.ai',
    keyUrlLabel: 'console.x.ai',
  },
};

export const PROVIDER_IDS: Provider[] = Object.keys(PROVIDER_DEFS) as Provider[];

export const PROVIDERS: Record<Provider, AIProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
  openrouter: openrouterProvider,
  deepseek: deepseekProvider,
  xai: xaiProvider,
};

export function getProvider(name: Provider): AIProvider {
  const p = PROVIDERS[name as Provider];
  if (!p) {
    const ids = PROVIDER_IDS.join('/');
    const suggestion = suggestProvider(String(name));
    throw new Error(
      `bilinmeyen sağlayıcı: ${name} · ${ids} kullan${suggestion ? ` · bunu mu demek istedin: ${suggestion}?` : ''}`,
    );
  }
  return p;
}

/** Basit yakınlık önerisi (önek + harf örtüşmesi). */
export function suggestProvider(raw: string): Provider | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  if ((PROVIDER_IDS as string[]).includes(q)) return q as Provider;
  const prefix = PROVIDER_IDS.find((id) => id.startsWith(q) || q.startsWith(id));
  if (prefix) return prefix;
  let best: Provider | null = null;
  let bestScore = 0;
  for (const id of PROVIDER_IDS) {
    const setQ = new Set(q);
    let hit = 0;
    for (const ch of id) if (setQ.has(ch)) hit++;
    const score = hit / Math.max(id.length, q.length);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return bestScore >= 0.4 ? best : null;
}

export function getProviderDef(id: Provider): ProviderDefinition {
  return PROVIDER_DEFS[id];
}

export const ALL_MODELS: Model[] = PROVIDER_IDS.flatMap((id) => PROVIDERS[id].models);

/** Elle eklenen modeli registry `Model` biçimine çevirir. */
export function toRegistryModel(c: CustomModel): Model {
  const out: Model = {
    id: c.id,
    name: c.name || c.id,
    provider: c.provider,
    contextWindow: c.contextWindow ?? 128000,
    supportsVision: c.capabilities.vision,
    maxOutput: c.maxOutput ?? 8192,
    capabilities: { ...c.capabilities },
  };
  if (c.description) out.description = c.description;
  if (c.family) out.family = c.family;
  if (c.catalogPrice) out.catalogPrice = { ...c.catalogPrice };
  return out;
}

/**
 * Görünür model listesi: registry + elle eklenenler.
 * Id çakışırsa custom kazanır (kullanıcı geçersiz kılar).
 *
 * models.dev kataloğu yüklüyse:
 *   1. elle yazılmış **çekirdek** modeller katalog metadata'sıyla zenginleşir,
 *   2. katalogdaki **diğer** modeller (6 sağlayıcı, ~480) otomatik listeye girer,
 *   3. elle eklenen (custom) modeller en son eklenir.
 *
 * Katalog yoksa/bozuksa yalnızca çekirdek + custom görünür (offline çalışır).
 */
export function resolveModels(customs: CustomModel[] = []): Model[] {
  const index = getActiveCatalogIndex();
  const core = enrichModels(ALL_MODELS, index);
  // Çekirdek + katalog genişletmesi (çakışmada çekirdek kazanır).
  // Katalog yoksa `core` referansı korunur (ALL_MODELS ile aynı dizi).
  const extra = catalogModels(getActiveCatalog());
  let base = core;
  if (extra.length > 0) {
    const seen = new Set(core.map((m) => m.id));
    base = [...core];
    for (const m of extra) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      base.push(m);
    }
  }
  if (customs.length === 0) return base;
  const over = new Map(customs.map((c) => [c.id, toRegistryModel(c)]));
  const out = base.map((m) => over.get(m.id) ?? m);
  for (const [, m] of over) {
    if (!base.some((r) => r.id === m.id)) out.push(m);
  }
  return out;
}

/** Model açılır listelerde görünsün mü (kapalılar gizlenir, seçili rozet korunur). */
export function isModelEnabled(disabled: string[], id: string): boolean {
  return !disabled.includes(id);
}

export function isKnownModel(id: string, customs: CustomModel[] = []): boolean {
  return resolveModels(customs).some((m) => m.id === id);
}

export function getModel(id: string, customs: CustomModel[] = []): Model | undefined {
  return resolveModels(customs).find((m) => m.id === id);
}

/** Model → sağlayıcı çözümleme (Titlebar / /model için). */
export function getProviderForModel(modelId: string, customs: CustomModel[] = []): Provider | undefined {
  return getModel(modelId, customs)?.provider;
}

export function getModelsForProvider(provider: Provider): Model[] {
  const models = PROVIDERS[provider]?.models ?? [];
  const core = enrichModels(models, getActiveCatalogIndex());
  const extra = catalogModels(getActiveCatalog()).filter((m) => m.provider === provider);
  const seen = new Set(core.map((m) => m.id));
  const merged = [...core];
  for (const m of extra) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    merged.push(m);
  }
  return merged;
}

/** Capability lookup — Agent kararları buradan beslenir. */
export function getCapabilitiesForModel(
  modelId: string,
  customs: CustomModel[] = [],
): Model['capabilities'] | undefined {
  return getModel(modelId, customs)?.capabilities;
}

export function supportsToolsForModel(modelId: string, customs: CustomModel[] = []): boolean {
  return getCapabilitiesForModel(modelId, customs)?.tools ?? false;
}

export function getMaxOutputForModel(modelId: string, customs: CustomModel[] = []): number | undefined {
  return getModel(modelId, customs)?.maxOutput;
}

/**
 * P0-3 — Kaldırılan eski model ID'leri güncel karşılıklarına taşır.
 * Bilinmeyen/özel ID'ler aynen korunur (kullanıcı özel modeli ezilmez).
 */
export const REMOVED_MODEL_MAP: Record<string, string> = {
  'gpt-4o': 'gpt-6.1-sol',
  'gpt-4o-mini': 'gpt-6-luna',
  'o3': 'gpt-6.1-sol',
  'o4-mini': 'gpt-6-luna',
  'claude-sonnet-4-6': 'claude-sonnet-5-5',
  'claude-opus-5': 'claude-opus-5-5',
  'claude-haiku-4-5': 'claude-haiku-5-5',
  'gemini-2.5-pro': 'gemini-3-pro',
  'gemini-2.5-flash': 'gemini-3.8-flash',
  'anthropic/claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5',
};

export function migrateModelId(modelId: string): string {
  return REMOVED_MODEL_MAP[modelId] ?? modelId;
}

/** Session provider/model çiftini registry'ye hizalar (eski ID + tutarsız provider). */
export function migrateProviderModel(
  provider: Provider,
  modelId: string,
): { provider: Provider; model: string } {
  if (!modelId) return { provider, model: modelId };
  const model = migrateModelId(modelId);
  const owner = getProviderForModel(model);
  if (owner && owner !== provider) return { provider: owner, model };
  return { provider, model };
}
