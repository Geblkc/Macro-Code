import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useSettingsStore, clampSidebarWidth } from '../store/settings';
import { Icon } from './icons';

interface Props {
  onOpenSettings: () => void;
  onClear: () => void;
  onExportJson: () => void;
  onImportFile: (file: File) => void;
}

interface Group {
  label: string;
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
    Bugün: [],
    Dün: [],
    'Bu Hafta': [],
    'Daha Eski': [],
  };
  for (const s of sessions) {
    const t = s.updatedAt || today;
    if (t >= today) buckets['Bugün'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
    else if (t >= yesterday) buckets['Dün'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
    else if (t >= week) buckets['Bu Hafta'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
    else buckets['Daha Eski'].push({ id: s.id, name: s.name, count: s.messages.length, updatedAt: t });
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

/** Göreli zaman: 14:32 / dün / 3 gün önce */
function relativeTime(ts: number): string {
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
  if (diff < 2 * day) return 'dün';
  if (diff < 7 * day) return `${Math.floor(diff / day)} gün önce`;
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export default function Sidebar({
  onOpenSettings,
  onClear,
  onExportJson,
  onImportFile,
}: Props) {
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
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Oturumlar">
      <div className="side-head">
        <span className="side-label">Oturumlar</span>
        <span className="count-chip">{sessions.length}</span>
        <button
          className="icon-btn accent"
          title="Yeni oturum"
          aria-label="Yeni oturum"
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
          placeholder="ara…"
          aria-label="Oturumlarda ara"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="side-list">
        {groups.length === 0 && (
          <div className="sidebar-empty">
            {sessions.length === 0 ? 'henüz oturum yok' : 'eşleşme yok'}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="group-head">{g.label}</div>
            {g.items.map((s) => {
              const active = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active}
                  className={`session-item${active ? ' active' : ''}`}
                  onClick={() => store().setActiveSession(s.id)}
                  title={`${s.name} · ${s.count} mesaj`}
                >
                  <span className={`session-dot${active ? ' on' : ''}`} aria-hidden="true" />
                  <span className="session-body">
                    <span className="session-name">{s.name}</span>
                    <span className="session-meta">
                      <span className="smodel">{currentModel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{relativeTime(s.updatedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{s.count}</span>
                    </span>
                  </span>
                  <span className="session-actions">
                    <span
                      className="icon-btn danger"
                      role="button"
                      tabIndex={0}
                      title="oturumu sil"
                      aria-label={`${s.name} oturumunu sil`}
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
          title="Yeni oturum"
        >
          <Icon name="plus" size="sm" />
          <span>Yeni oturum</span>
        </button>
        <button className="btn" onClick={onOpenSettings}>
          <Icon name="settings" size="sm" />
          <span>Ayarlar</span>
        </button>
        <div className="row">
          <button
            className="btn btn-ghost btn-sm"
            style={{ flex: 1 }}
            onClick={onClear}
            title="Görünümü temizle"
            aria-label="Görünümü temizle"
          >
            <Icon name="x" size="sm" />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ flex: 1 }}
            onClick={onExportJson}
            title="aktif oturumu JSON olarak indir"
            aria-label="JSON dışa aktar"
          >
            <Icon name="download" size="sm" />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ flex: 1 }}
            onClick={() => fileRef.current?.click()}
            title="JSON yedeğini içe aktar"
            aria-label="JSON içe aktar"
          >
            <Icon name="upload" size="sm" />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ flex: 1 }}
            onClick={() => setSidebarCollapsed(!collapsed)}
            title={collapsed ? "Sidebar'ı genişlet" : "Sidebarı daralt"}
            aria-label="Sidebarı daralt / genişlet"
          >
            <Icon name="panel" size="sm" />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="JSON yedeği seç"
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
        aria-label="Sidebar genişliğini ayarla"
        onPointerDown={onResizeDown}
        style={{ display: collapsed ? 'none' : undefined }}
      />
    </aside>
  );
}
