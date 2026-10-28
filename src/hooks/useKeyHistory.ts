import { useCallback } from 'react';

export interface HistoryState {
  items: string[];
  /** Sondan kacinci oge gosteriliyor; -1 = taslak (yeni girdi). */
  cursor: number;
  draft: string;
}

export const emptyHistory: HistoryState = { items: [], cursor: -1, draft: '' };

/** localStorage anahtarı (geçmişin son `limit` öğesi saklanır). */
const STORAGE_KEY = 'macrocode-keyhistory';

/**
 * Ham localStorage kaydından geçmiş durumunu ayrıştırır (saf — test edilebilir).
 * Bozuk/uygunsuz kayıt → boş geçmiş (uygulama çökmez).
 */
export function parseStoredHistory(raw: string | null, limit = 50): HistoryState {
  if (!raw) return emptyHistory;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return emptyHistory;
    const items = parsed
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .slice(-limit);
    return { items, cursor: -1, draft: '' };
  } catch {
    return emptyHistory;
  }
}

/** Geçmiş öğelerini kalıcı yazar (localStorage kapalı/engelli ise sessiz geç). */
export function persistHistory(items: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  } catch {
    //ota dolu veya erişim engelli — sessizce geç.
  }
}

function loadHistory(limit: number): HistoryState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return parseStoredHistory(raw, limit);
  } catch {
    return emptyHistory;
  }
}

/**
 * Uygulama genelinde tek geçmiş deposu (tek InputBar var; `/reset` komutu
 * buradan `resetKeyHistory()` ile temizler). İlk erişimde localStorage'dan
 * bir kez yüklenir.
 */
let shared: HistoryState | null = null;

/** Geçmişi tamamen temizler (persist dahil) — `/reset` komutuna bağlı. */
export function resetKeyHistory(): void {
  shared = emptyHistory;
  persistHistory([]);
}

/** ↑↓ komut geçmişi (InputBar'da kullanilir). Son 50 öğe localStorage'a yazılır. */
export function useKeyHistory(limit = 50) {
  if (shared === null) shared = loadHistory(limit);

  const push = useCallback(
    (cmd: string) => {
      shared = historyPush(shared ?? emptyHistory, cmd, limit);
      persistHistory(shared.items);
    },
    [limit],
  );

  const move = useCallback((dir: 'up' | 'down', current: string): string => {
    const result = historyMove(shared ?? emptyHistory, dir, current);
    shared = result.state;
    return result.value;
  }, []);

  const reset = useCallback(() => resetKeyHistory(), []);

  return { push, move, reset };
}

/** Komutu gecmise ekler (bos ve art arda tekrarlar yok sayilir, son 50 tutulur). */
export function historyPush(state: HistoryState, cmd: string, limit = 50): HistoryState {
  const trimmed = cmd.trim();
  if (!trimmed) return state;
  if (state.items[state.items.length - 1] === trimmed) {
    return { items: state.items, cursor: -1, draft: '' };
  }
  const items = [...state.items, trimmed];
  while (items.length > limit) items.shift();
  return { items, cursor: -1, draft: '' };
}

export function historyMove(
  state: HistoryState,
  dir: 'up' | 'down',
  current: string,
): { state: HistoryState; value: string } {
  const { items, cursor } = state;
  if (items.length === 0) return { state, value: current };
  if (dir === 'up') {
    const base = cursor === -1 ? { ...state, draft: current } : state;
    const next = Math.min(cursor + 1, items.length - 1);
    return {
      state: { ...base, cursor: next },
      value: items[items.length - 1 - next],
    };
  }
  if (cursor === -1) return { state, value: current };
  const next = cursor - 1;
  return {
    state: { ...state, cursor: next },
    value: next === -1 ? state.draft : items[items.length - 1 - next],
  };
}
