import { useCallback, useRef } from 'react';

export interface HistoryState {
  items: string[];
  /** Sondan kacinci oge gosteriliyor; -1 = taslak (yeni girdi). */
  cursor: number;
  draft: string;
}

export const emptyHistory: HistoryState = { items: [], cursor: -1, draft: '' };

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

/** ↑↓ komut gecmisi (InputBar'da kullanilir). Deger InputBar'da tutulur. */
export function useKeyHistory(limit = 50) {
  const ref = useRef<HistoryState>(emptyHistory);

  const push = useCallback(
    (cmd: string) => {
      ref.current = historyPush(ref.current, cmd, limit);
    },
    [limit],
  );

  const move = useCallback((dir: 'up' | 'down', current: string): string => {
    const result = historyMove(ref.current, dir, current);
    ref.current = result.state;
    return result.value;
  }, []);

  const reset = useCallback(() => {
    ref.current = { ...ref.current, cursor: -1, draft: '' };
  }, []);

  return { push, move, reset };
}
