import { describe, expect, it } from 'vitest';
import { costForMessage, costForTokens, formatCost, sessionCost } from './pricing';
import { tokenSummaryLine } from './commands';
import type { Message, Session } from '../types';

const msg = (over: Partial<Message>): Message => ({
  id: Math.random().toString(36).slice(2),
  role: 'user',
  content: 'merhaba',
  timestamp: Date.now(),
  ...over,
});

const sessionWith = (messages: Message[]): Session => ({
  id: 's1',
  name: 'test',
  createdAt: 0,
  updatedAt: 0,
  messages,
  provider: 'openai',
  model: 'gpt-6.1-sol',
  systemPrompt: '',
});

describe('pricing', () => {
  it('costForMessage 1M birimiyle hesaplar', () => {
    // 1000 girdi × $3 + 500 çıktı × $15 = $0.0105
    expect(costForMessage({ input: 1000, output: 500 }, { input: 3, output: 15 })).toBeCloseTo(
      0.0105,
      6,
    );
    expect(costForMessage(undefined, { input: 3, output: 15 })).toBe(0);
    expect(costForMessage({ input: 1, output: 1 }, undefined)).toBe(0);
  });

  it('formatCost kısa gösterir', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(-1)).toBe('$0');
    expect(formatCost(0.00001)).toBe('$0.0000');
    expect(formatCost(0.0105)).toBe('$0.01');
    expect(formatCost(1.5)).toBe('$1.50');
  });

  it('sessionCost fiyatsız mesajları atlar', () => {
    const messages = [
      msg({ role: 'assistant', model: 'm1', tokens: { input: 1000, output: 1000 } }),
      msg({ role: 'assistant', model: 'm2', tokens: { input: 1000, output: 1000 } }),
      msg({ role: 'assistant', model: 'm1' }),
    ];
    const { cost, priced } = sessionCost(messages, { m1: { input: 1, output: 1 } });
    expect(priced).toBe(1);
    expect(cost).toBeCloseTo(0.002, 6);
  });

  it('Faz 4: reasoning tokenleri output fiyatından maliyete dahildir', () => {
    // 1000 girdi × $3 + 500 çıktı × $15 + 200 reasoning × $15 = $0.0135
    expect(
      costForTokens({ input: 1000, output: 500, reasoning: 200 }, { input: 3, output: 15 }),
    ).toBeCloseTo(0.0135, 6);
    expect(costForMessage({ input: 0, output: 0, reasoning: 100 }, { input: 3, output: 15 })).toBeCloseTo(
      0.0015,
      6,
    );
  });

  it('Faz 4: sessionCost reasoning dahil toplam verir', () => {
    const messages = [
      msg({ role: 'assistant', model: 'm1', tokens: { input: 1000, output: 1000, reasoning: 500 } }),
      msg({ role: 'assistant', model: 'm9', tokens: { input: 1000, output: 1000 } }),
    ];
    const { cost, priced } = sessionCost(messages, { m1: { input: 1, output: 1 } });
    // (1000 + 1000 + 500) / 1M = 0.0025
    expect(priced).toBe(1);
    expect(cost).toBeCloseTo(0.0025, 6);
    const line = tokenSummaryLine(sessionWith(messages), { m1: { input: 1, output: 1 } });
    expect(line).toContain('reasoning');
    expect(line).toContain('maliyet');
  });

  it('tokenSummaryLine fiyatlı tam/Kısmi gösterir', () => {
    const s = sessionWith([
      msg({ role: 'assistant', model: 'm1', tokens: { input: 1000000, output: 0 } }),
    ]);
    const full = tokenSummaryLine(s, { m1: { input: 3, output: 15 } });
    expect(full).toContain('maliyet ~$3.00');
    expect(full).not.toContain('kısmi');

    const s2 = sessionWith([
      msg({ role: 'assistant', model: 'm1', tokens: { input: 1000000, output: 0 } }),
      msg({ role: 'assistant', model: 'm9', tokens: { input: 1000000, output: 0 } }),
    ]);
    expect(tokenSummaryLine(s2, { m1: { input: 3, output: 15 } })).toContain('kısmi fiyat');

    // Fiyatsız çağrı eski çıktıyı verir.
    expect(tokenSummaryLine(s)).not.toContain('maliyet');
  });

  it('cache okuma fiyatı kendi kademesinden hesaplanır', () => {
    // 600 normal girdi × $3 + 400 cache girdi × $0.3 = $0.0018 + $0.00012
    const price = { input: 3, output: 15, cacheRead: 0.3 };
    expect(
      costForTokens({ input: 1000, output: 0, cacheRead: 400 }, price),
    ).toBeCloseTo(0.00192, 8);
  });

  it('cache yazma fiyatı kendi kademesinden hesaplanır', () => {
    const price = { input: 3, output: 15, cacheWrite: 3.75 };
    // 800 normal × $3 + 200 yazma × $3.75 = $0.0024 + $0.00075
    expect(
      costForTokens({ input: 1000, output: 0, cacheWrite: 200 }, price),
    ).toBeCloseTo(0.00315, 8);
  });

  it('cache fiyatı tanımlı değilse girdi fiyatına düşer', () => {
    // 600 × $3 + 400 × $3 = $0.003
    expect(
      costForTokens({ input: 1000, output: 0, cacheRead: 400 }, { input: 3, output: 15 }),
    ).toBeCloseTo(0.003, 8);
  });

  it('cache tokenları input sınırını aşamaz', () => {
    // cacheRead input'tan büyükse fazlası sayılmaz (aşırı veri koruması).
    expect(
      costForTokens({ input: 100, output: 0, cacheRead: 5000 }, { input: 3, output: 15 }),
    ).toBeCloseTo(0.0003, 8);
  });
});
