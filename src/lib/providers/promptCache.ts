/**
 * Faz 11 — prompt cache (önbellek) desteği.
 *
 * **Durum:** Token *sayacı* tarafı hazırdı (`cache_read_input_tokens` /
 * `cached_tokens` okunuyor, `pricing.ts` cache'li kısım için ayrı fiyat
 * uyguluyor) — ama **istek tarafı** eksikti: hiçbir yerde `cache_control`
 * işareti gönderilmiyordu, yani önbellek hiç dolmuyor ve `cacheRead` hep 0'dı.
 *
 * Anthropic'in kuralı: `cache_control` işareti, **önek en az 1024 token**
 * (Haiku'da 2048) olduğunda çalışır; daha kısa önekte API isteği **reddeder**
 * ("prompt caching is only supported for prompts of at least 1024 tokens").
 * Bu yüzden işaret yalnızca tahmin edilen önek yeterince büyükse konur.
 */

/** Opus/Sonnet/Gemini için en küçük cache'lenebilir önek (token). */
export const CACHE_MIN_TOKENS = 1024;
/** Haiku (küçük bağlam) için daha yüksek eşik. */
export const CACHE_MIN_TOKENS_SMALL = 2048;
/** Tahmin hatasına karşı güvenlik payı (token). */
const CACHE_SAFETY_MARGIN = 160;

/** Modelin cache eşiği (token). */
export function cacheMinTokens(model: string): number {
  return /haiku/i.test(model) ? CACHE_MIN_TOKENS_SMALL : CACHE_MIN_TOKENS;
}

/** Kaba token tahmini (char/4 — gerçek tokenizer yok). */
export function approxTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
}

/** Eşik + güvenlik payı geçilmiş mi? */
export function cacheableBySize(
  approxTokenCount: number,
  model: string,
): boolean {
  return approxTokenCount >= cacheMinTokens(model) + CACHE_SAFETY_MARGIN;
}

/** `cache_control` işareti (Anthropic biçimi). */
export const EPHEMERAL = { type: 'ephemeral' } as const;

/**
 * Anthropic mesaj dizisinde **son kullanıcı/tool bloğuna** `cache_control`
 * koyar (önek bu noktaya kadar önbelleğe alınır).
 *
 * - İşaret yalnızca önek yeterince büyükse konur (yoksa API 400 döner).
 * - `content` metin ise blok dizisine çevrilir.
 * - Tool sonucu bloğu varsa doğrudan onun üzerine işaretlenir.
 */
export function markCacheControl<T extends { role: string; content: unknown }>(
  messages: T[],
  model: string,
  approxPrefixTokens: number,
): T[] {
  if (messages.length === 0) return messages;
  if (!cacheableBySize(approxPrefixTokens, model)) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const content = m.content;
    if (typeof content === 'string') {
      m.content = [
        { type: 'text', text: content, cache_control: { ...EPHEMERAL } },
      ];
      return messages;
    }
    if (Array.isArray(content) && content.length > 0) {
      const blocks = content as Array<Record<string, unknown>>;
      // Son metin bloğunu işaretle (yoksa son tool_result bloğunu).
      let target = -1;
      for (let b = blocks.length - 1; b >= 0; b--) {
        if (blocks[b]?.type === 'text') {
          target = b;
          break;
        }
      }
      if (target === -1) {
        for (let b = blocks.length - 1; b >= 0; b--) {
          if (blocks[b]?.type === 'tool_result') {
            target = b;
            break;
          }
        }
      }
      if (target >= 0) {
        blocks[target] = { ...blocks[target], cache_control: { ...EPHEMERAL } };
      }
      return messages;
    }
    return messages;
  }
  return messages;
}

/**
 * OpenAI-uyumlu sağlayıcılar için önbellek anahtarı.
 * OpenAI, aynı konuşmanın isteklerini aynı makineye yönlendirerek prompt
 * cache'in isabetini artırır (`prompt_cache_key`, ≤ 64 karakter).
 * Anahtar oturuma bağlıdır → farklı oturumlar birbirinin cache'ini kullanmaz.
 */
export function promptCacheKey(sessionId: string, model: string): string {
  const raw = `${sessionId}:${model}`;
  // Basit, kararlı hash (FNV-1a 32-bit) — kısa ve çakışma riski düşük.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `mc-${h.toString(36)}`;
}
