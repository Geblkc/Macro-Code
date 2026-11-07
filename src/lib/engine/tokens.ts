/**
 * Faz 2 — Token tahmini (provider bağımsız).
 * Gerçek tokenizer yok → tahmin: chars/4 + mesaj overhead + tool JSON + görsel.
 */
import type { CustomModel } from '../../types';
import { getModel } from '../providers';

export interface TokenCountable {
  content: string;
  images?: string[];
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  thinking?: Array<{ thinking: string; signature: string }>;
}

export const MESSAGE_OVERHEAD_TOKENS = 8;
export const IMAGE_TOKENS = 1000;
export const UNKNOWN_MODEL_WINDOW = 200_000;

/** Otomatik compaction, pencere doluluğunun bu oranında tetiklenir. */
export const CONTEXT_COMPACT_RATIO = 0.75;

/**
 * Tek istekte üretilebilecek azami çıktı (provider tavanı).
 * Compaction eşiği hesaplanırken yanıt için bu kadar pay ayrılır.
 */
const COMPACT_OUTPUT_RESERVE = 16_384;

export function approxMessageTokens(m: TokenCountable): number {
  let n = MESSAGE_OVERHEAD_TOKENS + Math.ceil((m.content ?? '').length / 4);
  if (m.images?.length) n += m.images.length * IMAGE_TOKENS;
  if (m.toolCalls?.length) {
    for (const c of m.toolCalls) {
      n += MESSAGE_OVERHEAD_TOKENS + Math.ceil(JSON.stringify(c.args ?? {}).length / 4);
    }
  }
  if (m.thinking?.length) {
    for (const t of m.thinking) {
      n += Math.ceil((t.thinking.length + t.signature.length) / 4);
    }
  }
  return n;
}

export function approxHistoryTokens(h: TokenCountable[]): number {
  let total = 0;
  for (const m of h) total += approxMessageTokens(m);
  return total;
}

/** Modelin contextWindow'u registry'den; bilinmiyorsa 200_000 varsayımı. */
export function windowFor(model: string, customs: CustomModel[] = []): number {
  return getModel(model, customs)?.contextWindow ?? UNKNOWN_MODEL_WINDOW;
}

/** Bütçe: window × factor (default 0.6 — yanıt + tool sonuçları için pay). */
export function budgetFor(model: string, customs: CustomModel[] = [], factor = 0.6): number {
  return Math.floor(windowFor(model, customs) * factor);
}

/**
 * Otomatik compaction'ın tetikleneceği token limiti.
 *
 * Hedef pencere oranı %75; ancak yanıt için `COMPACT_OUTPUT_RESERVE` kadar
 * pay bırakılır. Küçük pencerelerde (ör. 32k) bu koruma eşiği otomatik olarak
 * aşağı çeker; 200k'lık modellerde sonuç tam %75'tir.
 */
export function compactionLimitFor(model: string, customs: CustomModel[] = []): number {
  const win = windowFor(model, customs);
  if (win <= 0) return 0;
  const reserve = Math.min(COMPACT_OUTPUT_RESERVE, Math.floor(win / 2));
  const ratio = Math.min(CONTEXT_COMPACT_RATIO, (win - reserve) / win);
  return Math.floor(win * Math.max(0.1, ratio));
}

/** Bağlam göstergesindeki "otomatik özet %N'te" değeri. */
export function compactAtPercent(model: string, customs: CustomModel[] = []): number {
  const win = windowFor(model, customs);
  if (win <= 0) return 0;
  return Math.min(100, Math.round((compactionLimitFor(model, customs) / win) * 100));
}
