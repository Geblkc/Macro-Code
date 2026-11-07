import type { Message, ModelPrice } from '../types';

/** Sürümlenmiş fiyat kaydı: bir fiyatın ne zaman değiştirildiği */
export interface PriceVersion {
  /** Fiyatın geçerli olduğu başlangıç tarihi (epoch ms). */
  from: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Kullanıcı elle düzenlediyse true. Elle düzenlenen fiyatlar katalogla güncellenmez. */
  manual?: boolean;
}

export interface PriceTable {
  /** Model kimliği */
  modelId: string;
  /** Versiyonlar, en yeni ilkelerde sıralanmış. */
  versions: PriceVersion[];
  /** Kullanıcının elle yaptığı düzenleme var mı (hiç versiyon yoksa) */
  manual?: boolean;
}

/** Tüm modele ait fiyat tablosu (anahtar: model id). */
export interface PriceRegistry {
  [modelId: string]: PriceTable;
}

export interface PricedUsage {
  cost: number;
  /** Fiyatı bilinen usage'lı mesaj sayısı. */
  priced: number;
}

/** Yeni bir fiyat versiyonu ekler (eski versiyonlar geçmiş için korunur). */
export function setPriceVersion(
  registry: PriceRegistry,
  modelId: string,
  price: ModelPrice,
  options?: { manual?: boolean; from?: number },
): PriceRegistry {
  const from = options?.from ?? Date.now();
  const prev = registry[modelId];
  const versions: PriceVersion[] = prev
    ? [...prev.versions]
    : [];

  // Mevcut son versiyonu kapatma süresi olarak şimdiyi koy (bir sonraki versiyon var ise)
  if (versions.length > 0) {
    versions[versions.length - 1].from = from;
  }

  versions.push({
    from,
    input: price.input,
    output: price.output,
    cacheRead: price.cacheRead,
    cacheWrite: price.cacheWrite,
    manual: options?.manual ?? false,
  });

  return {
    ...registry,
    [modelId]: {
      modelId,
      versions,
      manual: options?.manual ?? prev?.manual ?? false,
    },
  };
}

/** Verilen tarihte geçerli fiyatı döndürür (varsayılan: şimdi). */
export function priceAt(
  registry: PriceRegistry | undefined | null,
  modelId: string,
  at = Date.now(),
): ModelPrice | undefined {
  if (!registry) return undefined;
  const table = registry[modelId];
  if (!table) return undefined;
  const versions = table.versions;
  if (versions.length === 0) return undefined;
  // En yeni versiyona doğru sıralı, verilen tarihten önceki en son versiyonu seç.
  let best = versions[0];
  for (const v of versions) {
    if (v.from <= at) {
      best = v;
      break;
    }
  }
  return {
    input: best.input,
    output: best.output,
    cacheRead: best.cacheRead,
    cacheWrite: best.cacheWrite,
  };
}

/** Meşcut fiyatı döndürür (şimdiki). */
export function currentPrice(
  registry: PriceRegistry | undefined | null,
  modelId: string,
): ModelPrice | undefined {
  return priceAt(registry, modelId, Date.now());
}

/** Maliyet hesaplar (1M token bazlı). */
export function costForTokens(
  usage: {
    input: number;
    output: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
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

/** USD formatı (küçük tutarlar 4 ondalık). */
export function formatCost(usd: number): string {
  if (!(usd > 0)) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Tek mesajın USD maliyeti (1M token başına fiyatla). Fiyat/tokens yoksa 0. */
export function costForMessage(
  tokens: { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } | undefined,
  price: ModelPrice | undefined,
): number {
  if (!tokens) return 0;
  return costForTokens(tokens, price);
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

export function formatTokens(tokens: number): string {
  if (!(tokens > 0)) return '0';
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/** Token cinsinden kırılım özeti. */
export interface TokenBreakdown {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export function sumTokens(usage: {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): TokenBreakdown {
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const reasoning = usage.reasoning ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
  };
}

/** Bütçe durum hesapla. */
export interface BudgetStatus {
  limit: number;
  spent: number;
  remaining: number;
  percent: number;
  at80: boolean; // %80'e ulaştı / geçti
  exceeded: boolean;
}

export function computeBudget(limit: number, spent: number): BudgetStatus {
  const remaining = Math.max(0, limit - spent);
  const percent = limit > 0 ? (spent / limit) * 100 : 0;
  return {
    limit,
    spent,
    remaining,
    percent,
    at80: percent >= 80,
    exceeded: spent >= limit,
  };
}

/** Aylık tahmin: gunluk ortalama bazlı "ay sonu ~$X". */
export function monthlyProjection(
  spentThisMonth: number,
  daysElapsed: number,
): { projected: number; dailyAverage: number } {
  const dailyAverage = daysElapsed > 0 ? spentThisMonth / daysElapsed : 0;
  const daysInMonth = 30;
  const projected = dailyAverage * daysInMonth;
  return { projected, dailyAverage };
}
