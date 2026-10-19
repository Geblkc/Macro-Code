import type { Message, ModelPrice } from '../types';

/** Tek mesajın USD maliyeti (1M token başına fiyatla). Fiyat/tokens yoksa 0. */
export function costForMessage(
  tokens: { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } | undefined,
  price: ModelPrice | undefined,
): number {
  return costForTokens(tokens, price);
}

/**
 * Faz 4: reasoning tokenleri output fiyatından maliyete dahildir.
 *
 * Cache kademeleri: `input` **toplam** prompt token sayısıdır (cache'li kısım
 * dahil). `cacheRead`/`cacheWrite` o toplamın içindeki cache kısımlarıdır ve
 * kendi fiyatlarıyla hesaplanır; fiyat tanımlı değilse girdi fiyatına düşer.
 */
export function costForTokens(
  usage:
    | { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }
    | undefined,
  price: ModelPrice | undefined,
): number {
  if (!usage || !price) return 0;
  const cacheRead = Math.min(usage.cacheRead ?? 0, usage.input);
  const cacheWrite = Math.min(usage.cacheWrite ?? 0, Math.max(0, usage.input - cacheRead));
  const billable = Math.max(0, usage.input - cacheRead - cacheWrite);
  const readPrice = price.cacheRead ?? price.input;
  const writePrice = price.cacheWrite ?? price.input;
  return (
    (billable * price.input +
      cacheRead * readPrice +
      cacheWrite * writePrice +
      usage.output * price.output +
      (usage.reasoning ?? 0) * price.output) /
    1_000_000
  );
}

/** Kısa USD gösterimi (küçük tutarlar 4 ondalık). */
export function formatCost(usd: number): string {
  if (!(usd > 0)) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export interface PricedUsage {
  cost: number;
  /** Fiyatı bilinen usage'lı mesaj sayısı. */
  priced: number;
}

/** Oturumun toplam maliyeti (fiyatı bilinmeyen mesajlar atlanır). */
export function sessionCost(
  messages: Message[],
  prices: Record<string, ModelPrice>,
): PricedUsage {
  let cost = 0;
  let priced = 0;
  for (const m of messages) {
    if (
      !m.tokens ||
      (m.tokens.input <= 0 && m.tokens.output <= 0 && (m.tokens.reasoning ?? 0) <= 0)
    )
      continue;
    const price = m.model ? prices[m.model] : undefined;
    if (!price) continue;
    priced += 1;
    cost += costForMessage(m.tokens, price);
  }
  return { cost, priced };
}
