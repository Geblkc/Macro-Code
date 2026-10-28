import { describe, expect, it } from 'vitest';
import {
  emptyHistory,
  historyPush,
  parseStoredHistory,
} from './useKeyHistory';

describe('parseStoredHistory — localStorage persist ayrıştırma (Faz 3)', () => {
  it('null / bozuk JSON / uygunsuz tip → boş geçmiş', () => {
    expect(parseStoredHistory(null)).toEqual(emptyHistory);
    expect(parseStoredHistory('{bozuk')).toEqual(emptyHistory);
    expect(parseStoredHistory('42')).toEqual(emptyHistory);
    expect(parseStoredHistory('{"a":1}')).toEqual(emptyHistory);
  });

  it('geçerli dizi → öğeler korunur, cursor/draft sıfırlanır', () => {
    const state = parseStoredHistory(JSON.stringify(['/a', '/b']));
    expect(state.items).toEqual(['/a', '/b']);
    expect(state.cursor).toBe(-1);
    expect(state.draft).toBe('');
  });

  it('boş/whitespace ve sayısal öğeler elenir', () => {
    const state = parseStoredHistory(JSON.stringify(['/a', '', '  ', 7, null, '/b']));
    expect(state.items).toEqual(['/a', '/b']);
  });

  it('limit aşılırsa en yeniler korunur (son N öğe)', () => {
    const state = parseStoredHistory(JSON.stringify(['/1', '/2', '/3', '/4', '/5']), 3);
    expect(state.items).toEqual(['/3', '/4', '/5']);
  });
});

describe('historyPush — persist öncesi davranış sözleşmesi', () => {
  it('limit aşılında en eskiler düşer; son tekrar yok sayılır', () => {
    let state = emptyHistory;
    for (let i = 0; i < 55; i++) state = historyPush(state, `/c${i}`);
    expect(state.items).toHaveLength(50);
    expect(state.items[0]).toBe('/c5');

    // Aynı komut tekrar → öğe eklenmez, cursor temizlenir.
    const dup = historyPush(state, '/c54');
    expect(dup.items).toHaveLength(50);
    expect(dup.cursor).toBe(-1);
    expect(dup.draft).toBe('');
  });

  it('boş komut durumu değiştirmez', () => {
    const state = historyPush(emptyHistory, '   ');
    expect(state).toBe(emptyHistory);
  });
});
