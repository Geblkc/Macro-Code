/**
 * Bağlam göstergesi — tek kaynak.
 *
 * Gerçek kullanım varsa son API isteğinin (`lastRequest`) girdi+çıktısı,
 * yoksa geçmişin yaklaşık token sayısı kullanılır. Agent turlarında
 * `Message.tokens` kümülatif olduğu için bağlam için **kullanılmaz**.
 */
import type { CustomModel, Message } from '../../types';
import {
  approxHistoryTokens,
  compactAtPercent,
  windowFor,
} from './tokens';

export const CONTEXT_WARN_PERCENT = 75;
export const CONTEXT_ERR_PERCENT = 90;

export type ContextLevel = 'ok' | 'warn' | 'err';

export interface ContextUsage {
  /** Son isteğin bağlam boyutu (girdi + çıktı) veya yaklaşık geçmiş. */
  used: number;
  window: number;
  /** 0–100 arası, tavana kırpılmış doluluk. */
  percent: number;
  level: ContextLevel;
  /** Otomatik compaction eşiği (yüzde). */
  compactAt: number;
  /** `true` ise `used` gerçek usage değil, yaklaşık token tahminidir. */
  estimated: boolean;
}

/** En son `lastRequest` taşıyan mesajın bağlam boyutu; yoksa `null`. */
export function lastRequestTokens(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const lr = messages[i].lastRequest;
    if (!lr) continue;
    const total = (lr.input ?? 0) + (lr.output ?? 0);
    if (total > 0) return total;
  }
  return null;
}

export function contextUsage(
  messages: Message[],
  model: string,
  customs: CustomModel[] = [],
): ContextUsage {
  const win = windowFor(model, customs);
  const real = lastRequestTokens(messages);
  const used = Math.max(0, real ?? approxHistoryTokens(messages));
  const percent = win > 0 ? Math.min(100, Math.round((used / win) * 100)) : 0;
  const level: ContextLevel =
    percent >= CONTEXT_ERR_PERCENT ? 'err' : percent >= CONTEXT_WARN_PERCENT ? 'warn' : 'ok';
  return {
    used,
    window: win,
    percent,
    level,
    compactAt: compactAtPercent(model, customs),
    estimated: real === null,
  };
}
