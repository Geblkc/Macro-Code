import { describe, expect, it } from 'vitest';
import { findHits, stepHit, type SearchItem } from './search';

const items: SearchItem[] = [
  { key: 'a', text: 'merhaba dünya' },
  { key: 'b', text: 'MacroCode bir AI terminali' },
  { key: 'c', text: 'MERHABA tekrar' },
  { key: 'd', text: 'kısa' },
];

describe('search — satır bazlı eşleşme', () => {
  it('boş/whitespace sorgu → []', () => {
    expect(findHits(items, '')).toEqual([]);
    expect(findHits(items, '   ')).toEqual([]);
  });

  it('büyük/küçük harf duyarsız eşleşme + sıra korunur', () => {
    expect(findHits(items, 'merhaba').map((h) => h.key)).toEqual(['a', 'c']);
    expect(findHits(items, 'MERHABA').map((h) => h.key)).toEqual(['a', 'c']);
  });

  it('eşleşme yoksa []; indeks orijinal dizide kalır', () => {
    const hits = findHits(items, 'yok böyle bir şey');
    expect(hits).toEqual([]);
    const one = findHits(items, 'ai terminali');
    expect(one).toEqual([{ key: 'b', index: 1 }]);
  });
});

describe('search — tur navigasyonu (stepHit)', () => {
  const hits = findHits(items, 'merhaba'); // a(0), c(2)

  it('boş listede -1', () => {
    expect(stepHit([], 0, 1)).toBe(-1);
  });

  it('başlangıç: current < 0 → ilk (ileri) / son (geri)', () => {
    expect(stepHit(hits, -1, 1)).toBe(0);
    expect(stepHit(hits, -1, -1)).toBe(1);
  });

  it('ileri/geri + wrap-around', () => {
    expect(stepHit(hits, 0, 1)).toBe(1);
    expect(stepHit(hits, 1, 1)).toBe(0); // sarar
    expect(stepHit(hits, 0, -1)).toBe(1); // sarar
    expect(stepHit(hits, 1, -1)).toBe(0);
  });

  it('geçersiz current güvenli tutulur', () => {
    expect(stepHit(hits, 99, 1)).toBe(0);
    expect(stepHit(hits, 99, -1)).toBe(1);
  });
});
