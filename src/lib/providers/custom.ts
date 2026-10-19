import type { AIProvider } from './common';
import type { CustomEndpoint, Model } from '../../types';
import { createOpenAICompatibleProvider } from './openaiCompatible';

/**
 * OpenAI-uyumlu özel uçlar (proxy, OpenRouter, LM Studio...).
 * `Provider` birliğine dokunulmaz; uçlar settings'te ayrı listede durur,
 * secret'ları keystore'da `custom_<slug>` adıyla tutulur.
 */

/** Türkçe karakterleri ASCII karşılığına çevirir (slug için). */
const TR_MAP: Record<string, string> = {
  Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u',
  Ö: 'o', ö: 'o', Ç: 'c', ç: 'c', I: 'i', ı: 'i', İ: 'i',
};

/** Görünen addan keystore-uyumlu id üretir (`custom_<slug>`, küçük harf). */
export function makeEndpointId(name: string): string {
  const ascii = name
    .trim()
    .split('')
    .map((ch) => TR_MAP[ch] ?? ch)
    .join('');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `custom_${slug || 'uc'}`;
}

/** Serbest metinden model listesi çıkarır (satır/virgül ayrımlı, tekilleştirilmiş). */
export function parseEndpointModels(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Özel ucu sohbet akışı için OpenAI-uyumlu provider'a çevirir.
 * Modellerin `provider` alanı taşıma işaretidir (`'openai`) — bu modeller
 * `ALL_MODELS`'a KAYDEDİLMEZ, ayrı listelenir. Sohbet akışı içindir (agent dışı).
 */
export function buildCustomProvider(endpoint: CustomEndpoint): AIProvider {
  const models: Model[] = endpoint.models.map((id) => ({
    id,
    name: id,
    provider: 'openai',
    contextWindow: 128000,
    supportsVision: false,
    maxOutput: 8192,
    capabilities: { tools: false, vision: false, reasoning: false },
  }));
  return createOpenAICompatibleProvider({
    name: 'openai',
    baseUrl: endpoint.baseUrl,
    models,
  });
}
