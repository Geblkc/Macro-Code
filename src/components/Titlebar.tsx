import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  PROVIDER_DEFS,
  getCapabilitiesForModel,
  hasProviderKey,
  hiddenProviders,
  isModelEnabled,
  resolveModels,
  visibleModels,
} from '../lib/providers';
import type { Model, Provider } from '../types';
import { isTauri, useSettingsStore } from '../store/settings';
import { useSessionStore } from '../store/session';

interface Props {
  sessionName: string;
  sessionProvider?: Provider;
  sessionModel?: string;
  /** Ayarları aç (anahtar ekle satırı). */
  onOpenSettings?: () => void;
}

export default function Titlebar({
  sessionName,
  sessionProvider,
  sessionModel,
  onOpenSettings,
}: Props) {
  const provider = useSettingsStore((s) => s.currentProvider);
  const model = useSettingsStore((s) => s.currentModel);
  const customModels = useSettingsStore((s) => s.customModels);
  const disabledModels = useSettingsStore((s) => s.disabledModels);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Rozet aktif KONUSMANIN modelini gosterir (global varsayilani degil).
  const displayProvider = sessionProvider ?? provider;
  const displayModel = sessionModel || model;
  const differs = displayModel !== model;
  const keyMissing = !hasProviderKey(displayProvider, apiKeys);

  const all = useMemo(() => resolveModels(customModels), [customModels]);

  const groups = useMemo(() => {
    // Anahtarı olmayan saglayicinin modelleri listelenmez.
    const visible = visibleModels(all, apiKeys).filter((m) =>
      isModelEnabled(disabledModels, m.id),
    );
    const q = query.trim().toLowerCase();
    const filtered = q
      ? visible.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            (m.family ?? '').toLowerCase().includes(q),
        )
      : visible;
    const map = new Map<string, Model[]>();
    for (const m of filtered) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return [...map.entries()];
  }, [all, apiKeys, disabledModels, query]);

  // Anahtari olmayan ama modeli bulunan saglayicilar ("anahtar ekle" satirlari).
  const locked = useMemo(() => hiddenProviders(all, apiKeys), [all, apiKeys]);

  // Dropdown acilinca arama kutusuna odaklan.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery('');
  }, [open]);

  const select = (m: Model) => {
    const settings = useSettingsStore.getState();
    settings.setProvider(m.provider);
    settings.setModel(m.id);
    // Secim aktif konusmaya da yansir (yoksa rozet ile davranis uyusmazdi).
    const activeId = useSessionStore.getState().activeSessionId;
    if (activeId) {
      useSessionStore.getState().updateSessionModel(activeId, { provider: m.provider, model: m.id });
    }
    setOpen(false);
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      {isTauri() ? (
        <span className="traffic no-drag" role="group" aria-label="Pencere denetimleri">
          <button className="tl-btn" title="kapat" aria-label="Kapat" onClick={() => void getCurrentWindow().close().catch(() => {})}>
            <i className="tl tl-r" /><span className="tl-sym" aria-hidden="true">×</span>
          </button>
          <button className="tl-btn" title="küçült" aria-label="Küçült" onClick={() => void getCurrentWindow().minimize().catch(() => {})}>
            <i className="tl tl-y" /><span className="tl-sym" aria-hidden="true">−</span>
          </button>
          <button className="tl-btn" title="büyüt / eski boy" aria-label="Büyüt" onClick={() => void getCurrentWindow().toggleMaximize().catch(() => {})}>
            <i className="tl tl-y" /><span className="tl-sym" aria-hidden="true">+</span>
          </button>
        </span>
      ) : (
        <span className="traffic" aria-hidden="true">
          <i className="tl tl-r" />
          <i className="tl tl-y" />
          <i className="tl tl-y" />
        </span>
      )}
      <span className="titlebar-center">
        <img className="titlebar-logo" src="macrocode-logo.svg" alt="" aria-hidden="true" draggable={false} />
        macrocode — {sessionName}
      </span>
      <span className="titlebar-right no-drag">
        <button
          className="model-badge"
          title={
            differs
              ? `${displayProvider} / ${displayModel} (bu konuşma) · varsayılan: ${model}`
              : `${displayProvider} / ${displayModel}`
          }
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          [{displayModel}{keyMissing ? ' 🔑' : ''} ▾]
        </button>
        {open && (
          <>
            <div className="dropdown-backdrop" onClick={() => setOpen(false)} />
            <div className="model-dropdown" role="listbox">
              <div className="model-search-row">
                <input
                  ref={searchRef}
                  className="model-search"
                  type="text"
                  placeholder="model ara (id, ad, aile)…"
                  value={query}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setOpen(false);
                    }
                  }}
                />
              </div>
              {groups.length === 0 ? (
                <div className="model-group-title">
                  {query ? 'eşleşen model yok' : 'görünür model yok'}
                </div>
              ) : (
                groups.map(([p, models]) => (
                  <div key={p} className="model-group">
                    <div className="model-group-title">{PROVIDER_DEFS[p as Provider]?.label ?? p}</div>
                    {models.map((m) => {
                      const caps = getCapabilitiesForModel(m.id);
                      const badges = caps
                        ? `${caps.tools ? '🛠' : ''}${caps.vision ? '👁' : ''}${caps.reasoning ? '🧠' : ''}`
                        : '';
                      const meta = [
                        m.description,
                        m.family,
                        `${m.contextWindow} ctx`,
                        caps ? (caps.tools ? 'tools' : 'no-tools') : '',
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <button
                          key={m.id}
                          role="option"
                          aria-selected={m.id === displayModel}
                          className={`model-item${m.id === displayModel ? ' active' : ''}`}
                          title={`${m.name} · ${meta}`}
                          onClick={() => select(m)}
                        >
                          {m.id}{badges ? ` ${badges}` : ''}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
              {locked.length > 0 ? (
                <div className="model-group">
                  <div className="model-group-title">anahtar gereken sağlayıcılar</div>
                  {locked.map((p) => (
                    <button
                      key={p}
                      className="model-item model-item-lock"
                      title={`${PROVIDER_DEFS[p as Provider]?.label ?? p} için API anahtarı gir`}
                      onClick={() => {
                        setOpen(false);
                        onOpenSettings?.();
                      }}
                    >
                      🔑 {PROVIDER_DEFS[p]?.label ?? p} — anahtar ekle
                    </button>
                  ))}                </div>
              ) : null}
            </div>
          </>
        )}
      </span>
    </div>
  );
}
