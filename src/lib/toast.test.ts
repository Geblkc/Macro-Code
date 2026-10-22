import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearToasts,
  dismissToast,
  showToast,
  subscribeToasts,
  toast,
  toastItems,
  TOAST_LIMIT,
} from './toast';

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

describe('toast — bildirim kanalı', () => {
  it('mesaj ekler ve listeye yansıtır', () => {
    showToast('kaydedildi', 'ok');
    expect(toastItems()).toHaveLength(1);
    expect(toastItems()[0].message).toBe('kaydedildi');
    expect(toastItems()[0].kind).toBe('ok');
  });

  it('aboneye anlık bildirim gönderir', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToasts((items) => seen.push(items.length));
    showToast('a');
    showToast('b');
    unsubscribe();
    showToast('c');
    // 1 (ilk anlık) + 2 (iki ekleme) = 3 bildirim; abonelik kesildikten sonra yok.
    expect(seen).toEqual([0, 1, 2]);
  });

  it('dismiss ile kaldırılır', () => {
    const id = showToast('x');
    dismissToast(id);
    expect(toastItems()).toHaveLength(0);
  });

  it('bilinmeyen id için dismiss no-op', () => {
    showToast('x');
    dismissToast(9999);
    expect(toastItems()).toHaveLength(1);
  });

  it('flood koruması: en fazla TOAST_LIMIT bildirim', () => {
    for (let i = 0; i < TOAST_LIMIT + 3; i++) showToast(`m${i}`);
    expect(toastItems()).toHaveLength(TOAST_LIMIT);
    // En eski atılır.
    expect(toastItems()[0].message).toBe('m3');
  });

  it('hata bildirimi daha uzun süre kalır', () => {
    toast.err('hata');
    expect(toastItems()[0].duration).toBe(6000);
    toast.ok('tamam');
    expect(toastItems()[1].duration).toBe(3000);
  });

  it('süre sonunda otomatik kapanır', () => {
    vi.useFakeTimers();
    showToast('kapanacak', 'ok', 1000);
    expect(toastItems()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(toastItems()).toHaveLength(0);
  });

  it('süre 0 ise elle kapanır (zamanlayıcı yok)', () => {
    vi.useFakeTimers();
    const id = showToast('kalıcı', 'info', 0);
    vi.advanceTimersByTime(60_000);
    expect(toastItems()).toHaveLength(1);
    dismissToast(id);
    expect(toastItems()).toHaveLength(0);
  });

  it('kısa yol fonksiyonları doğru türü üretir', () => {
    toast.ok('a');
    toast.err('b');
    toast.info('c');
    expect(toastItems().map((t) => t.kind)).toEqual(['ok', 'err', 'info']);
  });
});
