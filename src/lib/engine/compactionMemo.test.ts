import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMemo,
  clearAllMemos,
  clearMemo,
  getMemo,
  setMemo,
  type CompactionMemo,
} from './compactionMemo';

interface Item {
  role: string;
  content: string;
  ts?: number;
  id?: string;
}

describe('Faz 9 P9.5 (B3) — compaction hafızası kesimi id tabanlı', () => {
  beforeEach(() => {
    clearAllMemos();
  });

  it('hafıza yoksa geçmiş olduğu gibi döner', () => {
    const items: Item[] = [{ role: 'user', content: 'a', ts: 1, id: 'm1' }];
    expect(applyMemo(undefined, items)).toBe(items);
  });

  it('id kesimi: özete dahil edilen mesajlar tekrarlanmaz', () => {
    const memo: CompactionMemo<Item> = {
      at: 100,
      items: [{ role: 'system', content: '[özet]' }],
      coveredIds: ['m1', 'm2'],
    };
    const items: Item[] = [
      { role: 'user', content: 'özetlenen', ts: 50, id: 'm1' },
      { role: 'assistant', content: 'özetlenen cevap', ts: 60, id: 'm2' },
      { role: 'user', content: 'yeni', ts: 150, id: 'm3' },
    ];
    const out = applyMemo(memo, items);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe('[özet]');
    expect(out[1].content).toBe('yeni');
  });

  it('id kesimi: aynı milisaniyede oluşan mesaj da korunur (eski risk giderilir)', () => {
    // Eski (zaman damgası) kesimde `ts > at` koşulu bu mesajı düşürürdü.
    const memo: CompactionMemo<Item> = {
      at: 100,
      items: [{ role: 'system', content: '[özet]' }],
      coveredIds: ['m1'],
    };
    const items: Item[] = [
      { role: 'user', content: 'özetlenen', ts: 100, id: 'm1' },
      { role: 'assistant', content: 'araç sonucu', ts: 100, id: 'm2' },
    ];
    const out = applyMemo(memo, items);
    expect(out.map((i) => i.content)).toEqual(['[özet]', 'araç sonucu']);
  });

  it('id olmayan öğeler (synthetik) korunur', () => {
    const memo: CompactionMemo<Item> = {
      at: 100,
      items: [{ role: 'system', content: '[özet]' }],
      coveredIds: ['m1'],
    };
    const out = applyMemo(memo, [{ role: 'tool', content: 'sonuç' }]);
    expect(out).toHaveLength(2);
  });

  it('coveredIds yoksa eski zaman damgası kesimine düşülür (geriye uyum)', () => {
    const memo: CompactionMemo<Item> = { at: 100, items: [{ role: 'system', content: '[özet]' }] };
    const items: Item[] = [
      { role: 'user', content: 'eski', ts: 50 },
      { role: 'user', content: 'yeni', ts: 150 },
    ];
    const out = applyMemo(memo, items);
    expect(out).toHaveLength(2);
    expect(out[1].content).toBe('yeni');
  });

  it('setMemo coveredIds saklar, getMemo okur, clearMemo siler', () => {
    const items: Item[] = [{ role: 'system', content: 'özet' }];
    setMemo<Item>('s1', 42, items, { coveredIds: ['x'] });
    expect(getMemo<Item>('s1')?.coveredIds).toEqual(['x']);
    clearMemo('s1');
    expect(getMemo('s1')).toBeUndefined();
  });
});
