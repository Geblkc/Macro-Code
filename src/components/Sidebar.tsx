import { useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../store/session';

interface Props {
  onOpenSettings: () => void;
  onClear: () => void;
  onExportJson: () => void;
  onImportFile: (file: File) => void;
}

export default function Sidebar({ onOpenSettings, onClear, onExportJson, onImportFile }: Props) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const store = useSessionStore.getState;

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return sessions;
    return sessions.filter((s) => s.name.toLocaleLowerCase('tr').includes(q));
  }, [sessions, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-title">SESSIONS</div>
      {sessions.length > 3 && (
        <input
          className="sidebar-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder="ara…"
          aria-label="Session ara"
          spellCheck={false}
          autoComplete="off"
        />
      )}
      <div className="sidebar-list">
        {filtered.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              aria-current={active}
              aria-label={`${s.name} · ${s.messages.length} mesaj`}
              className={`session-item${active ? ' active' : ''}`}
              onClick={() => store().setActiveSession(s.id)}
              onKeyDown={(e) => {
                if ((e.target as HTMLElement).closest('.session-del')) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  store().setActiveSession(s.id);
                }
              }}
              title={`${s.name} · ${s.messages.length} mesaj`}
            >
              <span className="session-prefix" aria-hidden="true">&gt;</span>
              <span className="session-name">{s.name}</span>
              <span className="session-count">{s.messages.length}</span>
              {sessions.length > 1 && (
                <button
                  className="session-del"
                  title="session'ı sil"
                  aria-label={`${s.name} session'ını sil`}
                  onClick={(e) => {
                    e.stopPropagation();
                    store().deleteSession(s.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div className="sidebar-empty">henüz session yok</div>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <div className="sidebar-empty">eşleşme yok</div>
        )}
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-btn" onClick={() => store().createSession()}>
          + new session
        </button>
        <button className="sidebar-btn" onClick={onOpenSettings}>
          ⚙ settings
        </button>
        <button className="sidebar-btn" onClick={onClear}>
          ✕ clear
        </button>
        <button className="sidebar-btn" onClick={onExportJson} title="aktif session'ı JSON olarak indir">
          ⤓ json
        </button>
        <button className="sidebar-btn" onClick={() => fileRef.current?.click()} title="JSON yedeğini içe aktar">
          ⤒ içe aktar
        </button>
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
    </aside>
  );
}
