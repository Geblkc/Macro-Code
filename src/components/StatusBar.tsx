import { useMemo } from 'react';
import { useSessionStore } from '../store/session';
import { useSettingsStore } from '../store/settings';
import { useWorkspaceStore } from '../store/workspace';
import { sessionCost } from '../lib/pricing';
import { windowFor } from '../lib/engine/tokens';
import { useT } from '../lib/i18n';
import { Icon } from './icons';

interface Props {
  /** Bekleyen onay sayısı (badge + uyarı). */
  pendingCount?: number;
  /** Bekleyen onaya kaydır. */
  onPendingClick?: () => void;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export default function StatusBar({ pendingCount = 0, onPendingClick }: Props) {
  const t = useT();
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const keyStatus = useSettingsStore((s) => s.keyStatus);
  const currentProvider = useSettingsStore((s) => s.currentProvider);
  const currentModel = useSettingsStore((s) => s.currentModel);
  const customModels = useSettingsStore((s) => s.customModels);
  const prices = useSettingsStore((s) => s.prices);
  const mcpServers = useSettingsStore((s) => s.mcpServers);
  const root = useWorkspaceStore((s) => s.root);
  const label = useWorkspaceStore((s) => s.label);
  const approvalMode = useWorkspaceStore((s) => s.approvalMode);

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const model = session?.model || currentModel;
  const provider = session?.provider ?? currentProvider;

  // Token toplamı (giriş + çıkış) ve bağlam kullanımı.
  const { inTok, outTok, ctxUsed, ctxWindow } = useMemo(() => {
    let i = 0;
    let o = 0;
    for (const m of session?.messages ?? []) {
      i += m.tokens?.input ?? 0;
      o += m.tokens?.output ?? 0;
    }
    const win = windowFor(model, customModels);
    return { inTok: i, outTok: o, ctxUsed: i + o, ctxWindow: win };
  }, [session?.messages, model, customModels]);

  const ctxPct = ctxWindow > 0 ? Math.min(100, Math.round((ctxUsed / ctxWindow) * 100)) : 0;
  const ctxClass = ctxPct >= 90 ? 'err' : ctxPct >= 75 ? 'warn' : '';

  // Maliyet (fiyat tablosu varsa).
  const cost = useMemo(() => {
    if (!session || Object.keys(prices).length === 0) return null;
    try {
      const r = sessionCost(session.messages, prices);
      return r.cost > 0 ? r.cost : null;
    } catch {
      return null;
    }
  }, [session, prices]);

  const connected = keyStatus[provider] ?? false;
  const mcpOn = mcpServers.filter((m) => m.enabled).length;
  const approvalLabel =
    approvalMode === 'manual'
      ? t('status.approval.manual')
      : approvalMode === 'auto-read'
        ? t('status.approval.autoRead')
        : t('status.approval.autoEdit');

  return (
    <div className="statusbar" role="status" aria-label={t('status.ariaLabel')}>
      <span className="sb-item strong">
        <span
          className={`status-dot${connected ? '' : ' off'}`}
          aria-hidden="true"
          title={connected ? t('status.connected') : t('status.disconnected')}
        />
        {provider}
      </span>

      <span className="sb-sep" aria-hidden="true" />

      <span className="sb-item" title={model}>
        {model}
      </span>

      {ctxWindow > 0 ? (
        <>
          <span className="sb-sep" aria-hidden="true" />
          <span
            className="sb-item"
            title={t('status.contextUsage', {
              used: fmtCount(ctxUsed),
              total: fmtCount(ctxWindow),
              percent: ctxPct,
            })}
          >
            <span className="ctx-meter" aria-hidden="true">
              <span className={`ctx-fill ${ctxClass}`} style={{ width: `${ctxPct}%` }} />
            </span>
            {fmtCount(ctxUsed)} / {fmtCount(ctxWindow)}
          </span>
        </>
      ) : null}

      {inTok > 0 || outTok > 0 ? (
        <>
          <span className="sb-sep" aria-hidden="true" />
          <span className="sb-item" title={t('status.tokenCounter')}>
            ↑ {fmtCount(inTok)}&nbsp; ↓ {fmtCount(outTok)}
          </span>
        </>
      ) : null}

      {cost !== null ? (
        <span className="sb-item" title={t('status.estimatedCost')}>
          ~${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}
        </span>
      ) : null}

      {pendingCount > 0 ? (
        <>
          <span className="sb-sep" aria-hidden="true" />
          <button
            className="sb-item btn-reset"
            onClick={onPendingClick}
            title={t('status.pendingTitle')}
          >
            <span className="sb-badge">
              <Icon name="alert-triangle" size="sm" />
              {t('status.pendingCount', { count: pendingCount })}
            </span>
          </button>
        </>
      ) : null}

      <span className="sb-item" title={t('status.approvalMode')}>
        <Icon name="activity" size="sm" />
        {approvalLabel}
      </span>

      <span className="sb-right">
        {root ? (
          <span className="sb-item clickable" title={root}>
            <Icon name="folder" size="sm" />
            {label || root.split('/').filter(Boolean).pop() || root}
          </span>
        ) : null}
        {mcpOn > 0 ? (
          <>
            {root ? <span className="sb-sep" aria-hidden="true" /> : null}
            <span className="sb-item" title={t('status.mcpActive', { count: mcpOn })}>
              <Icon name="cpu" size="sm" />
              {mcpOn} MCP
            </span>
          </>
        ) : null}
      </span>
    </div>
  );
}
