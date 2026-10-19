import type { Provider } from '../../types';
import { DEFAULT_OLLAMA_URL } from './ollama';
import { fetchFor } from './rustFetch';

/** Bağlantı testi sonucu: bağlı / geçersiz (anahtar ya da uç reddetti) / ağ hatası. */
export type ValidateResult = 'ok' | 'invalid' | 'network';

export interface ValidateOptions {
  fetchImpl?: typeof fetch;
  /** OpenAI-uyumlu sağlayıcılarda varsayılan yerine bu taban URL denenir. */
  baseUrl?: string;
}

const OPENAI_COMPATIBLE_BASE: Partial<Record<Provider, string>> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
};

/**
 * Sağlayıcı anahtarını 3 durumlu doğrular.
 * Uç bilgisi mevcut `validateKey` gerçeklemeleriyle aynıdır
 * (Ollama `/api/tags`, Gemini `/v1beta/models?key=`, OpenAI-uyumlular `{base}/models`,
 * Anthropic ücretli çağrıdan kaçınmak için biçim denetimi).
 */
export async function validateDetailed(
  provider: Provider,
  key: string,
  opts: ValidateOptions = {},
): Promise<ValidateResult> {
  const f = opts.fetchImpl ?? globalThis.fetch;
  const value = key.trim();

  if (provider === 'ollama') {
    const base = (value || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
    const url = `${base}/api/tags`;
    try {
      const res = await fetchFor(url, opts.fetchImpl)(url);
      return res.ok ? 'ok' : 'invalid';
    } catch {
      return 'network';
    }
  }

  if (provider === 'anthropic') {
    return value.startsWith('sk-ant-') && value.length > 20 ? 'ok' : 'invalid';
  }

  if (provider === 'gemini') {
    if (!value) return 'invalid';
    try {
      const res = await f(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(value)}`,
      );
      return res.ok ? 'ok' : 'invalid';
    } catch {
      return 'network';
    }
  }

  const base = (opts.baseUrl?.trim() || OPENAI_COMPATIBLE_BASE[provider] || '').replace(/\/+$/, '');
  if (!value || !base) return 'invalid';
  const url = `${base}/models`;
  try {
    // Özel taban URL (proxy/Azure/LM Studio) CSP dışında kalabilir → Rust proxy.
    const res = await fetchFor(url, opts.fetchImpl)(url, {
      headers: { authorization: `Bearer ${value}` },
    });
    return res.ok ? 'ok' : 'invalid';
  } catch {
    return 'network';
  }
}
