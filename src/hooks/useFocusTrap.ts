import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

/**
 * Odaklanabilir öğeler için ortak seçici.
 * `tabindex="-1"` öğeler odak döngüsüne katılmaz (yalnız programatik odak).
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Görünür (gizlenmemiş) odaklanabilir öğeleri listeler. */
export function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * `Tab`/`Shift+Tab` tuşunu kök içinde döngüye sokar.
 *
 * React `onKeyDown` içinden çağrılır (native `addEventListener` DEĞİL) —
 * böylece iç içe diyaloglar (ayarlar → onay kutusu) üstteki tuşu
 * yakalayıp `stopPropagation()` ile iptal edebilir.
 */
export function cycleFocus(root: HTMLElement | null, e: ReactKeyboardEvent): void {
  if (e.key !== 'Tab' || !root) return;
  const items = focusableElements(root);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const current = document.activeElement;
  if (e.shiftKey) {
    if (current === first || !root.contains(current)) {
      e.preventDefault();
      last.focus();
    }
  } else if (current === last || !root.contains(current)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Modal içinde odak döngüsü + açılışta odaklama + kapanışta odak geri dönüşü.
 *
 * - `active` true olduğunda ilk odaklanabilir öğeye (veya `autoFocusRef`) odaklanır.
 * - Kapanınca odak, modal açılmadan önceki öğeye geri döner.
 * - Döngü `onKeyDown` ile sürülür: `cycleFocus` + kullanıcı `onKeyDown`'u.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  autoFocusRef?: RefObject<HTMLElement | null>,
): (e: ReactKeyboardEvent) => void {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    // Açılıştan önceki odak → kapanışta geri dönülür.
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target =
      autoFocusRef?.current ??
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      focusableElements(root)[0] ??
      null;
    // Odak yalnızca görünür bir öğeye verilir (gizli sekmeler hariç).
    if (target && target.getClientRects().length > 0) target.focus();

    return () => {
      const previous = restoreRef.current;
      restoreRef.current = null;
      if (previous && previous.isConnected) previous.focus();
    };
  }, [ref, active, autoFocusRef]);

  return (e: ReactKeyboardEvent) => cycleFocus(ref.current, e);
}
