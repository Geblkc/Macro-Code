import { useState } from 'react';
import { useT } from '../lib/i18n';
import {
  APPROVAL_BODY_PREVIEW_CHARS,
  APPROVAL_LARGE_PAYLOAD_CHARS,
  type ApprovalDetail,
} from '../lib/engine/approvalDetail';
import { Icon } from './icons';

interface Props {
  /** Onay bekleyen araç çağrısı. */
  callName: string;
  /** L4: tam argüman görünürlüğü — özet + (gerekirse) tam gövde. */
  detail: ApprovalDetail;
  /** Uyarı metni (kod çalıştıran komutlar için). */
  warning?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  /** "Her zaman çalıştır" kutusu işaretlendiğinde çağrılır. */
  onAlways?: () => void;
  always?: boolean;
  /** Enter/Esc kısayol ipuçlarını göster (M1: çoklu bekleyende gizlenir). */
  showKeys?: boolean;
}

export default function ApprovalCard({
  callName,
  detail,
  warning,
  onApprove,
  onReject,
  onAlways,
  always = false,
  showKeys = true,
}: Props) {
  const t = useT();
  const [checked, setChecked] = useState(always);
  const [expanded, setExpanded] = useState(false);

  const body = detail.body && detail.body.length > 0 ? detail.body : null;
  // exec gibi kırpılmaması gereken çağrılar `collapsible: false` gelir.
  const isLong =
    body !== null && detail.collapsible && body.length > APPROVAL_BODY_PREVIEW_CHARS;
  const shownBody =
    body === null
      ? ''
      : isLong && !expanded
        ? `${body.slice(0, APPROVAL_BODY_PREVIEW_CHARS)}…`
        : body;
  const large = detail.bodyChars > APPROVAL_LARGE_PAYLOAD_CHARS;

  return (
    <div className="approval">
      <div className="approval-head">
        <Icon name="alert-triangle" size="sm" />
        {t('approval.pending')}
      </div>

      <div className="approval-cmd">
        <span className="approval-tool">{callName}</span>
        {detail.summary ? ` · ${detail.summary}` : ''}
      </div>

      {body !== null ? (
        <div className="approval-detail">
          <pre className="approval-detail-body">{shownBody}</pre>
          {isLong ? (
            <button
              type="button"
              className="btn btn-sm approval-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t('approval.collapse') : t('approval.showAll')}
            </button>
          ) : null}
          <div className="approval-detail-meta">
            <span className="muted">{t('approval.charCount', { count: detail.bodyChars })}</span>
            {large ? (
              <span className="approval-large">
                {t('approval.largePayload', { count: detail.bodyChars })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {warning ? (
        <div className="approval-warn">
          <Icon name="alert-triangle" size="sm" className="approval-warn-ico" />
          <span>{warning}</span>
        </div>
      ) : null}

      <div className="approval-actions">
        <button className="btn btn-primary btn-sm" onClick={onApprove}>
          {t('approval.approve')} {showKeys ? <span className="kbd">Enter</span> : null}
        </button>
        <button className="btn btn-danger btn-sm" onClick={onReject}>
          {t('approval.reject')} {showKeys ? <span className="kbd">Esc</span> : null}
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
