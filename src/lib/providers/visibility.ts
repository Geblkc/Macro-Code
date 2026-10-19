import type { ApiKeys, Model, Provider } from '../../types';

/**
 * Model görünürlüğü — **API anahtarı olmayan sağlayıcının modelleri listelenmez**.
 *
 * Kural:
 * - `ollama` → daima görünür (anahtar değil, URL gerekir).
 * - Diğer yerleşik sağlayıcılar → `apiKeys[provider]` boşsa gizli.
 * - Gizli sağlayıcı için arayüz "🔑 … — anahtar ekle" satırı gösterir.
 *
 * Mantık saf fonksiyonlarda tutulur (UI'dan bağımsız) → test edilebilir.
 */

/** Sağlayıcı için anahtar durumu. */
export function hasProviderKey(provider: Provider, apiKeys: ApiKeys | undefined): boolean {
  if (provider === 'ollama') return true;
  const key = apiKeys?.[provider];
  return typeof key === 'string' && key.trim().length > 0;
}

/** Model listesi → anahtarı olmayan sağlayıcıların modellerini gizler. */
export function visibleModels(
  models: Model[],
  apiKeys: ApiKeys | undefined,
): Model[] {
  return models.filter((m) => hasProviderKey(m.provider, apiKeys));
}

/**
 * Anahtarı olmayan ama modeli bulunan sağlayıcılar (sıralı).
 * Arayüzde "anahtar ekle" satırı üretmek için kullanılır.
 */
export function hiddenProviders(
  models: Model[],
  apiKeys: ApiKeys | undefined,
): Provider[] {
  const seen = new Set<Provider>();
  for (const m of models) {
    if (hasProviderKey(m.provider, apiKeys)) continue;
    seen.add(m.provider);
  }
  return [...seen];
}

/** Model id'si görünür listede var mı? */
export function isModelVisible(
  modelId: string,
  models: Model[],
  apiKeys: ApiKeys | undefined,
): boolean {
  return visibleModels(models, apiKeys).some((m) => m.id === modelId);
}
