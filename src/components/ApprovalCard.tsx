import { useState } from 'react';
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
  const [checked, setChecked] = useState(always);

  return (
    <div className="approval">
      <div className="approval-head">
        <Icon name="alert-triangle" size="sm" />
        Onay bekleniyor
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
          Onayla <span className="kbd">Enter</span>
        </button>
        <button className="btn btn-danger btn-sm" onClick={onReject}>
          Reddet <span className="kbd">Esc</span>
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
            Bu komutu her zaman çalıştır
          </label>
        ) : null}
      </div>
    </div>
  );
}
