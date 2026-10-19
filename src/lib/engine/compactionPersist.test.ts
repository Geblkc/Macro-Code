import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllMemos,
  getMemo,
  memoFromPersisted,
  memoToPersisted,
  resolveMemo,
  setMemo,
  applyMemo,
  type PersistedCompaction,
} from './compactionMemo';

interface Item {
  role: string;
  content: string;
  id?: string;
  ts?: number;
}

describe('Faz 12 B.6 — compaction kalıcılığı', () => {
  beforeEach(() => {
    clearAllMemos();
  });

  it('bellek içi hafıza kalıcı biçime çevrilir ve geri alınır', () => {
    const items: Item[] = [
      { role: 'system', content: '[özet] ...' },
      { role: 'user', content: 'son mesaj', id: 'm3', ts: 30 },
    ];
    setMemo<Item>('s1', 100, items, { coveredIds: ['m1', 'm2'] });
    const form = memoToPersisted(getMemo<Item>('s1')!);
    expect(form.at).toBe(100);
    expect(form.coveredIds).toEqual(['m1', 'm2']);
    expect(form.items).toHaveLength(2);
    expect(form.items[0].content).toBe('[özet] ...');
    expect(form.items[1].id).toBe('m3');
  });

  it('restart sonrası: bellek boş, oturumdaki kalıcı kopya kullanılır', () => {
    // Bellek temiz (restart) ama oturumda kalıcı özet var.
    const form: PersistedCompaction = {
      at: 100,
      items: [{ role: 'system', content: '[özet] ...' }],
      coveredIds: ['m1'],
    };
    const memo = resolveMemo<Item>('s2', form);
    expect(memo).toBeDefined();
    expect(memo!.at).toBe(100);
    // Aynı davranış: özet + özete dahil olmayan mesajlar.
    const history: Item[] = [
      { role: 'user', content: 'eski', id: 'm1' },
      { role: 'user', content: 'yeni', id: 'm9' },
    ];
    const out = applyMemo(memo, history);
    expect(out.map((i) => i.content)).toEqual(['[özet] ...', 'yeni']);
  });

  it('bellekte kayıt varsa kalıcı kopya ezilmez (daha yeni olan kazanır)', () => {
    setMemo<Item>('s3', 999, [{ role: 'system', content: 'bellekteki' }]);
    const form: PersistedCompaction = {
      at: 100,
      items: [{ role: 'system', content: 'kalıcı' }],
    };
    const memo = resolveMemo<Item>('s3', form);
    expect(memo!.at).toBe(999);
    expect((memo!.items[0] as Item).content).toBe('bellekteki');
  });

  it('ne bellekte ne oturumda hafıza yoksa undefined', () => {
    expect(resolveMemo('yok', null)).toBeUndefined();
    expect(resolveMemo('yok', undefined)).toBeUndefined();
  });

  it('memoFromPersisted kalıcı biçimi hafızaya çevirir', () => {
    const form: PersistedCompaction = {
      at: 42,
      items: [{ role: 'system', content: 'x' }],
      coveredIds: ['a'],
    };
    const memo = memoFromPersisted<Item>(form);
    expect(memo.at).toBe(42);
    expect(memo.coveredIds).toEqual(['a']);
  });
});
