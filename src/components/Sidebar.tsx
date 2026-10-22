import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useSettingsStore, clampSidebarWidth } from '../store/settings';
import { useT } from '../lib/i18n';
import type { TFn } from '../lib/i18n';
import { Icon } from './icons';

interface Props {
  onOpenSettings: () => void;
  onClear: () => void;
  onExportJson: () => void;
  onImportFile: (file: File) => void;
}

interface Group {
  labelKey: 'sidebar.group.today' | 'sidebar.group.yesterday' | 'sidebar.group.thisWeek' | 'sidebar.group.older';
  items: { id: string; name: string; count: number; updatedAt: number }[];
}

/** Oturumları yakınlığa göre gruplandırır. */
function groupSessions(
  sessions: { id: string; name: string; messages: unknown[]; updatedAt: number }[],
): Group[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const yesterday = today - 86_400_000;
  const week = today - 6 * 86_400_000;

  const buckets: Record<string, Group['items']> = {
    'sidebar.group.today': [],
    'sidebar.group.yesterday': [],
    'sidebar.group.thisWeek': [],
    'sidebar.group.older': [],
  };
  for (const s of sessions) {
    const t = s.updatedAt || today;
    if (t >= today) buckets['sidebar.group.today'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
    else if (t >= yesterday) buckets['sidebar.group.yesterday'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
    else if (t >= week) buckets['sidebar.group.thisWeek'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
    else buckets['sidebar.group.older'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([labelKey, items]) => ({ labelKey: labelKey as Group['labelKey'], items }));
}

/** Göreli zaman: 14:32 / dün / 3 gün önce */
function relativeTime(ts: number, t: TFn): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < 2 * day) return t('sidebar.time.yesterday');
  if (diff < 7 * day) return t('sidebar.time.daysAgo', { count: Math.floor(diff / day) });
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export default function Sidebar({
  onOpenSettings,
  onClear,
  onExportJson,
  onImportFile,
}: Props) {
  const t = useT();
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const currentModel = useSettingsStore((s) => s.currentModel);
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const store = useSessionStore.getState;

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return sessions;
    return sessions.filter((s) => s.name.toLocaleLowerCase('tr').includes(q));
  }, [sessions, query]);

  const groups = useMemo(() => groupSessions(filtered), [filtered]);

  // Sidebar genişliği CSS değişkenine yazılır.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
  }, [sidebarWidth]);

  // Sürükleme ile yeniden boyutlandırma.
  const onResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startW: sidebarWidth };
      const onMove = (ev: PointerEvent) => {
        const ref = resizeRef.current;
        if (!ref) return;
        setSidebarWidth(clampSidebarWidth(ref.startW + (ev.clientX - ref.startX)));
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [sidebarWidth, setSidebarWidth],
  );

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label={t('sidebar.ariaLabel')}>
      <div className="side-head">
        <span className="side-label">{t('sidebar.title')}</span>
        <span className="count-chip">{sessions.length}</span>
        <button
          className="icon-btn accent"
          title={t('sidebar.newSession')}
          aria-label={t('sidebar.newSession')}
          onClick={() => store().createSession()}
        >
          <Icon name="plus" />
        </button>
      </div>

      <div className="side-search">
        <Icon name="search" size="sm" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder={t('sidebar.searchPlaceholder')}
          aria-label={t('sidebar.searchAria')}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="side-list">
        {groups.length === 0 && (
          <div className="sidebar-empty">
            {sessions.length === 0 ? t('sidebar.empty') : t('sidebar.noMatch')}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.labelKey}>
            <div className="group-head">{t(g.labelKey)}</div>
            {g.items.map((s) => {
              const active = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active}
                  className={`session-item${active ? ' active' : ''}`}
                  onClick={() => store().setActiveSession(s.id)}
                  title={t('sidebar.messageCount', { name: s.name, count: s.count })}
                >
                  <span className={`session-dot${active ? ' on' : ''}`} aria-hidden="true" />
                  <span className="session-body">
                    <span className="session-name">{s.name}</span>
                    <span className="session-meta">
                      <span className="smodel">{currentModel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{relativeTime(s.updatedAt, t)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{s.count}</span>
                    </span>
                  </span>
                  <span className="session-actions">
                    <span
                      className="icon-btn danger"
                      role="button"
                      tabIndex={0}
                      title={t('sidebar.deleteSession')}
                      aria-label={t('sidebar.deleteSessionAria', { name: s.name })}
                      onClick={(e) => {
                        e.stopPropagation();
                        store().deleteSession(s.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          store().deleteSession(s.id);
                        }
                      }}
                    >
                      <Icon name="x" size="sm" />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="side-foot">
        <button
          className="btn side-btn-new"
          onClick={() => store().createSession()}
          title={t('sidebar.newSession')}
        >
          <Icon name="plus" size="sm" />
          <span>{t('sidebar.newSession')}</span>
        </button>
        <button className="btn" onClick={onOpenSettings}>
          <Icon name="settings" size="sm" />
          <span>{t('sidebar.settings')}</span>
        </button>
        <div className="row">
          <button
            className="btn btn-ghost btn-sm flex-1"
            onClick={onClear}
            title={t('sidebar.clearView')}
            aria-label={t('sidebar.clearView')}
          >
            <Icon name="x" size="sm" />
          </button>
          <button
            className="btn btn-ghost btn-sm flex-1"
            onClick={onExportJson}
            title={t('sidebar.exportJson')}
            aria-label={t('sidebar.exportJsonAria')}
          >
            <Icon name="download" size="sm" />
          </button>
          <button
            className="btn btn-ghost btn-sm flex-1"
            onClick={() => fileRef.current?.click()}
            title={t('sidebar.importJson')}
            aria-label={t('sidebar.importJsonAria')}
          >
            <Icon name="upload" size="sm" />
          </button>
          <button
            className="btn btn-ghost btn-sm flex-1"
            onClick={() => setSidebarCollapsed(!collapsed)}
            title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            aria-label={t('sidebar.collapseAria')}
          >
            <Icon name="panel" size="sm" />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label={t('sidebar.pickBackup')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImportFile(file);
          }}
        />
      </div>

      <div
        className="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resize')}
        onPointerDown={onResizeDown}
      />
    </aside>
  );
}
