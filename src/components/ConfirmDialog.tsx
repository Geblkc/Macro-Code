import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from './icons';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Onay butonu tehlikeli kırmızı olur (silme gibi işlemler). */
  danger?: boolean;
  /** Açılışta odaklanacak buton (varsayılan: onay). */
  initialFocus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Genel onay kutusu (uygulama kökünde tek instance; App'ten `confirmState`
 * ile sürülür — ayarlar modalının kirli kapanışı ve Sidebar oturum silme
 * aynı bileşeni kullanır).
 *
 * - `Escape` → iptal, `Enter` → onay
 * - Odak döngüsü kendi içinde (modalın döngüsü devre dışı kalır)
 * - Tüm tuş olaylarını `stopPropagation` ile modalın Escape/Tab
 *   işleyicisine sızdırmaz.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  initialFocus = 'confirm',
  onConfirm,
  onCancel,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const autoFocusRef = initialFocus === 'cancel' ? cancelRef : confirmRef;
  const onKeyDown = useFocusTrap(rootRef, open, autoFocusRef);

  if (!open) return null;

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    // Diger katmanların (modal/terminal) klavye isleyicisine sizdirmaz.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      const target = e.target as HTMLElement | null;
      // Metin alanlarinda Enter satir atliyor olabilir → onaylama.
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      e.preventDefault();
      onConfirm();
      return;
    }
    onKeyDown(e);
  };

  return (
    <div
      className="confirm-overlay"
      onClick={(e) => {
        // Dis katmanlara sizma (orada da "kapat" isleyicisi var).
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        ref={rootRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="confirm-head">
          <Icon name={danger ? 'alert-triangle' : 'info'} className="confirm-icon" />
          <span className="confirm-title" id="confirm-title">
            {title}
          </span>
        </div>
        <p className="confirm-msg" id="confirm-desc">
          {message}
        </p>
        <div className="confirm-foot">
          <button className="btn" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            ref={confirmRef}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
