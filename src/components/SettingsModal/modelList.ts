import { hiddenProviders, resolveModels, visibleModels } from '../../lib/providers';
import type { ApiKeys, Model, Provider } from '../../types';
import type { Draft } from './types';

/**
 * Ayarlar ekranında kullanılan ortak model listesi mantığı.
 *
 * **Görünürlük kuralı:** API anahtarı olmayan sağlayıcının modelleri hiçbir
 * listede görünmez (`ollama` hariç — URL yeterli). Bkz. `lib/providers/visibility.ts`.
 */

/** Taslaktaki anahtar durumuna göre sağlayıcı → anahtar haritası. */
export function keyedProviders(draft: Draft): ApiKeys {
  const keys: ApiKeys = {
    anthropic: '',
    openai: '',
    gemini: '',
    ollamaUrl: '',
    openrouter: '',
    deepseek: '',
    xai: '',
  };
  for (const p of Object.keys(draft.secrets) as Provider[]) {
    if (p === 'ollama') continue;
    const sec = draft.secrets[p];
    keys[p] = sec && !sec.deleted ? sec.value.trim() || sec.hint : '';
  }
  return keys;
}

export interface ModelView {
  /** Tüm modeller (registry + katalog + elle eklenenler). */
  all: Model[];
  /** Anahtarı olan sağlayıcıların modelleri. */
  visible: Model[];
  /** Anahtarı olmayan sağlayıcılar (listede gizli). */
  locked: Provider[];
}

/** Taslaktan görünür model listesi + kilitli sağlayıcılar. */
export function modelView(draft: Draft): ModelView {
  const all = resolveModels(draft.customModels);
  const keys = keyedProviders(draft);
  return { all, visible: visibleModels(all, keys), locked: hiddenProviders(all, keys) };
}

/** Arama metni + sağlayıcı süzgeci ile model listesini daraltır. */
export function filterModels(models: Model[], query: string, provider: string): Model[] {
  const q = query.trim().toLowerCase();
  return models.filter((m) => {
    if (provider && m.provider !== provider) return false;
    if (!q) return true;
    const haystack = `${m.id} ${m.name} ${m.description ?? ''} ${m.family ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
}
