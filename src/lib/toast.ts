/**
 * Toast (kısa bildirim) kanalı — sıfır bağımlılık.
 *
 * React dışı modüllerden de çağrılabilir (`showToast(...)`); React bileşenleri
 * `subscribeToasts` ile abone olur.
 *
 * Kural: hata bildirimleri daha uzun süre kalır (6 sn), başarı 3 sn.
 */

export type ToastKind = 'ok' | 'err' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Otomatik kapanma süresi (ms). `0` = elle kapanır. */
  duration: number;
}

type Listener = (items: ToastItem[]) => void;

/** Aynı anda görünecek azami toast sayısı. */
export const TOAST_LIMIT = 4;

const items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit(): void {
  const snapshot = [...items];
  for (const l of listeners) l(snapshot);
}

/** Toast listesine abone olur (anlık ilk durumla birlikte). */
export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...items]);
  return () => {
    listeners.delete(listener);
  };
}

/** Mevcut toast listesi (snapshot). */
export function toastItems(): ToastItem[] {
  return [...items];
}

/** Toast'u kapatır. */
export function dismissToast(id: number): void {
  const i = items.findIndex((t) => t.id === id);
  if (i < 0) return;
  items.splice(i, 1);
  emit();
}

/** Yeni toast gösterir; `id` döner. */
export function showToast(
  message: string,
  kind: ToastKind = 'info',
  durationMs?: number,
): number {
  const id = ++seq;
  const duration = durationMs ?? (kind === 'err' ? 6000 : 3000);
  items.push({ id, kind, message, duration });
  // En eskiyi at (flood koruması).
  while (items.length > TOAST_LIMIT) items.shift();
  emit();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

/** Kısa yol fonksiyonları. */
export const toast = {
  ok: (message: string, durationMs?: number) => showToast(message, 'ok', durationMs),
  err: (message: string, durationMs?: number) => showToast(message, 'err', durationMs),
  info: (message: string, durationMs?: number) => showToast(message, 'info', durationMs),
};

/** Test amaçlı: tüm toast'ları temizler. */
export function clearToasts(): void {
  items.length = 0;
  emit();
}
