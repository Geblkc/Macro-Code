import { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastItem } from '../lib/toast';
import { Icon } from './icons';
import { useT } from '../lib/i18n';

/**
 * Toast konteyneri — uygulama kökünde bir kez mount edilir.
 *
 * `role="status"` + `aria-live="polite"`: ekran okuyucular bildirimi duyurur.
 */
export default function ToastHost() {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.kind}`}>
          <Icon
            name={item.kind === 'ok' ? 'check' : item.kind === 'err' ? 'alert-triangle' : 'info'}
            size="sm"
          />
          <span className="toast-msg">{item.message}</span>
          <button
            className="toast-close"
            onClick={() => dismissToast(item.id)}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <Icon name="x" size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
