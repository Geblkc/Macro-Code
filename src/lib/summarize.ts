/**
 * Faz 2 D.3 — Özetleyici model yapılandırması + çağrısı.
 * Boş bırakılırsa aktif model kullanılır (K4).
 */
import { getProvider, getProviderForModel, resolveModels } from './providers';
import { providerNeedsKey } from '../store/settings';
import { DEFAULT_OLLAMA_URL } from './providers/ollama';
import { withRetry } from './providers/common';
import type { ApiKeys, CustomModel, Model, Provider } from '../types';

export interface SummarizerSnapshot {
  currentProvider: Provider;
  currentModel: string;
  summarizerProvider: Provider | '';
  summarizerModel: string;
  apiKeys: ApiKeys;
  customModels: CustomModel[];
  baseUrlOverride: Partial<Record<Provider, string>>;
}

export interface SummarizerConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** İş 3: registry + özel modeller (maxOutput/capability kararları için). */
  registry?: Model[];
}

/** Özetleyici anahtarı yoksa `null` (çağrı tarafı compaction'ı atlar). */
export function summarizerConfig(s: SummarizerSnapshot): SummarizerConfig | null {
  const model = s.summarizerModel.trim() || s.currentModel;
  const provider =
    s.summarizerProvider || getProviderForModel(model, s.customModels) || s.currentProvider;
  const apiKey =
    provider === 'ollama' ? s.apiKeys.ollamaUrl || DEFAULT_OLLAMA_URL : (s.apiKeys[provider] ?? '');
  if (providerNeedsKey(provider) && !apiKey.trim()) return null;
  const override = s.baseUrlOverride[provider]?.trim();
  return {
    provider,
    model,
    apiKey,
    registry: resolveModels(s.customModels),
    ...(provider === 'ollama' ? { baseUrl: apiKey } : override ? { baseUrl: override } : {}),
  };
}

const SUMMARIZER_SYSTEM =
  'Sen bir sohbet özetleyicisisin. Türkçe yaz. Sadece özet metnini döndür, giriş cümlesi kurma.';

export function buildSummarizerPrompt(transcript: string): string {
  return (
    'Aşağıdaki uzun sohbet/agent geçmişinin kısa bir özetini Türkçe yaz. Şunları kapsa:\n' +
    '1. Verilen kararlar ve varılan sonuçlar\n' +
    '2. Değişen/oluşturulan dosyalar (tool çağrılarından görünen edit_file/propose_patch/write_file)\n' +
    '3. Açık kalan işler ve sonraki adım\n' +
    'En fazla 1500 karakter.\n\nGEÇMİŞ:\n' +
    transcript
  );
}

/** Transcript'i özetleyen async fonksiyon üretir (compaction'a enjekte edilir). */
export function makeSummarizeFn(cfg: SummarizerConfig): (transcript: string) => Promise<string> {
  return async (transcript: string) => {
    let out = '';
    await withRetry(
      () =>
        getProvider(cfg.provider).stream({
          apiKey: cfg.apiKey,
          model: cfg.model,
          systemPrompt: SUMMARIZER_SYSTEM,
          messages: [{ role: 'user', content: buildSummarizerPrompt(transcript) }],
          onChunk: (c) => {
            if (c.text) out += c.text;
          },
          ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
          ...(cfg.registry ? { registry: cfg.registry } : {}),
        }),
      { retries: 2 },
    );
    const text = out.trim();
    if (!text) throw new Error('özetleyici boş döndü');
    return text;
  };
}
