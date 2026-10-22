import { useState } from 'react';
import { useT } from '../lib/i18n';
import { Icon } from './icons';

interface Props {
  /** Onay bekleyen araç çağrısı. */
  callName: string;
  /** Komut/argüman gösterimi (kırpılmaz). */
  detail: string;
  /** Uyarı metni (kod çalıştıran komutlar için). */
  warning?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  /** "Her zaman çalıştır" kutusu işaretlendiğinde çağrılır. */
  onAlways?: () => void;
  always?: boolean;
}

export default function ApprovalCard({
  callName,
  detail,
  warning,
  onApprove,
  onReject,
  onAlways,
  always = false,
}: Props) {
  const t = useT();
  const [checked, setChecked] = useState(always);

  return (
    <div className="approval">
      <div className="approval-head">
        <Icon name="alert-triangle" size="sm" />
        {t('approval.pending')}
      </div>

      <div className="approval-cmd">
        <span className="approval-tool">{callName}</span>
        {detail ? ` · ${detail}` : ''}
      </div>

      {warning ? (
        <div className="approval-warn">
          <Icon name="alert-triangle" size="sm" className="approval-warn-ico" />
          <span>{warning}</span>
        </div>
      ) : null}

      <div className="approval-actions">
        <button className="btn btn-primary btn-sm" onClick={onApprove}>
          {t('approval.approve')} <span className="kbd">Enter</span>
        </button>
        <button className="btn btn-danger btn-sm" onClick={onReject}>
          {t('approval.reject')} <span className="kbd">Esc</span>
        </button>
        {onAlways ? (
          <label className="chk">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                setChecked(e.target.checked);
                if (e.target.checked) onAlways?.();
              }}
            />
            {t('approval.alwaysRun')}
          </label>
        ) : null}
      </div>
    </div>
  );
}
