import { describe, expect, it } from 'vitest';
import { mergeUsage, sumUsage } from './common';

describe('Faz 7 A4 — kullanım birleştirme', () => {
  it('mergeUsage kümülatif eventlerde max kullanır (tek istek içi)', () => {
    // Anthropic: message_start input=100, message_delta output=20 → message_delta output=35
    const a = mergeUsage(undefined, { input: 100, output: 0 });
    const b = mergeUsage(a, { input: 0, output: 35 });
    expect(b).toMatchObject({ input: 100, output: 35 });
  });

  it('sumUsage turları toplar (çok turlu agent toplamı)', () => {
    const t1 = { input: 100, output: 20 };
    const t2 = { input: 150, output: 30 };
    expect(sumUsage(t1, t2)).toEqual({ input: 250, output: 50 });
  });

  it('sumUsage reasoning ve cache tokenlarını da toplar', () => {
    const t1 = { input: 100, output: 20, reasoning: 5, cacheRead: 60, cacheWrite: 10 };
    const t2 = { input: 150, output: 30, reasoning: 7, cacheRead: 0, cacheWrite: 0 };
    expect(sumUsage(t1, t2)).toEqual({
      input: 250,
      output: 50,
      reasoning: 12,
      cacheRead: 60,
      cacheWrite: 10,
    });
  });

  it('sumUsage boş girdilerde undefined döner', () => {
    expect(sumUsage(undefined, undefined)).toBeUndefined();
    expect(sumUsage({ input: 0, output: 0 }, { input: 0, output: 0 })).toBeUndefined();
  });

  it('sumUsage tek tarafı null ise diğerini korur', () => {
    expect(sumUsage(null, { input: 7, output: 3 })).toEqual({ input: 7, output: 3 });
    expect(sumUsage({ input: 7, output: 3 }, null)).toEqual({ input: 7, output: 3 });
  });

  it('max yerine sum: iki tur aynı input ile toplanır (regresyon)', () => {
    // Eski davranış (max) 100 dönerdi; toplam 200 olmalı.
    const tur1 = { input: 100, output: 10 };
    const tur2 = { input: 100, output: 10 };
    expect(mergeUsage(tur1, tur2).input).toBe(100);
    expect(sumUsage(tur1, tur2)?.input).toBe(200);
  });
});
