import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  PROVIDER_DEFS,
  getCapabilitiesForModel,
  getModel,
  hasProviderKey,
  hiddenProviders,
  isModelEnabled,
  resolveModels,
  visibleModels,
} from '../lib/providers';
import type { Model, Provider } from '../types';
import { isTauri, useSettingsStore } from '../store/settings';
import { useSessionStore } from '../store/session';
import { useWorkspaceStore } from '../store/workspace';
import { useT } from '../lib/i18n';
import { Icon, type IconName } from './icons';

interface Props {
  sessionName: string;
  sessionProvider?: Provider;
  sessionModel?: string;
  /** Ayarları aç (anahtar ekle satırı). */
  onOpenSettings?: () => void;
}

const CAP_ICONS: { key: 'tools' | 'vision' | 'reasoning'; icon: IconName; labelKey: 'titlebar.capTools' | 'titlebar.capVision' | 'titlebar.capReasoning' }[] = [
  { key: 'tools', icon: 'wrench', labelKey: 'titlebar.capTools' },
  { key: 'vision', icon: 'eye', labelKey: 'titlebar.capVision' },
  { key: 'reasoning', icon: 'spark', labelKey: 'titlebar.capReasoning' },
];

/** Platform tespiti: macOS'ta traffic light, diğerinde kare düğmeler. */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Mac|iPhone|iPad/.test(ua);
}

export default function Titlebar({
  sessionName,
  sessionProvider,
  sessionModel,
  onOpenSettings,
}: Props) {
  const t = useT();
  const provider = useSettingsStore((s) => s.currentProvider);
  const model = useSettingsStore((s) => s.currentModel);
  const customModels = useSettingsStore((s) => s.customModels);
  const disabledModels = useSettingsStore((s) => s.disabledModels);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const workspaceLabel = useWorkspaceStore((s) => s.label);
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  // Düz liste (klavye gezinmesi için).
  const flat = useMemo(() => groups.flatMap(([, models]) => models), [groups]);

  // Dropdown acilinca arama kutusuna odaklan.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  // Klavye ile gezinme: oklar / home / end / enter / esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCursor(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setCursor(Math.max(0, flat.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const m = flat[cursor];
        if (m) {
          select(m);
          return;
        }
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, cursor]);

  // Kursor görünür kıldığında listeye kaydır.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

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

  const displayName =
    getModel(displayModel, customModels)?.name ?? displayModel;
  const mac = isMac();

  return (
    <div className="titlebar" data-tauri-drag-region>
      {isTauri() ? (
        mac ? (
          <span className="traffic no-drag" role="group" aria-label={t('titlebar.windowControls')}>
            <button
              className="tl-btn"
              title={t('titlebar.close')}
              aria-label={t('titlebar.close')}
              onClick={() => void getCurrentWindow().close().catch(() => {})}
            >
              <i className="tl tl-r" />
            </button>
            <button
              className="tl-btn"
              title={t('titlebar.minimize')}
              aria-label={t('titlebar.minimize')}
              onClick={() => void getCurrentWindow().minimize().catch(() => {})}
            >
              <i className="tl tl-y" />
            </button>
            <button
              className="tl-btn"
              title={t('titlebar.maximize')}
              aria-label={t('titlebar.maximize')}
              onClick={() => void getCurrentWindow().toggleMaximize().catch(() => {})}
            >
              <i className="tl tl-g" />
            </button>
          </span>
        ) : (
          <span className="winctl no-drag" role="group" aria-label={t('titlebar.windowControls')}>
            <button
              title={t('titlebar.minimize')}
              aria-label={t('titlebar.minimize')}
              onClick={() => void getCurrentWindow().minimize().catch(() => {})}
            >
              <Icon name="chevron-down" size="sm" className="rot-90" />
            </button>
            <button
              title={t('titlebar.maximize')}
              aria-label={t('titlebar.maximize')}
              onClick={() => void getCurrentWindow().toggleMaximize().catch(() => {})}
            >
              <Icon name="panel" size="sm" />
            </button>
            <button
              title={t('titlebar.close')}
              aria-label={t('titlebar.close')}
              onClick={() => void getCurrentWindow().close().catch(() => {})}
            >
              <Icon name="x" size="sm" />
            </button>
          </span>
        )
      ) : (
        <span className="traffic" aria-hidden="true">
          <i className="tl tl-r" />
          <i className="tl tl-y" />
          <i className="tl tl-g" />
        </span>
      )}

      <span className="identity">
        <img
          className="titlebar-logo"
          src="macrocode-logo.svg"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <span className="app-name">MacroCode</span>
        <span className="dot-sep" aria-hidden="true">
          ·
        </span>
        <span className="session-name" title={sessionName}>
          {sessionName}
        </span>
      </span>

      <span className="titlebar-right no-drag">
        {workspaceRoot ? (
          <span
            className="workspace-chip"
            title={workspaceRoot}
            aria-label={t('titlebar.workspace', { name: workspaceLabel || workspaceRoot })}
          >
            <Icon name="folder" size="sm" />
            {workspaceLabel || workspaceRoot.split('/').filter(Boolean).pop() || workspaceRoot}
          </span>
        ) : null}

        <button
          className="model-pill"
          title={
            differs
              ? `${displayProvider} / ${displayModel} (${t('titlebar.thisChat')}) · ${t('titlebar.defaultModel', { model })}`
              : `${displayProvider} / ${displayModel}`
          }
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`status-dot${keyMissing ? ' warn' : ''}`} aria-hidden="true" />
          <span className="mname">{displayName}</span>
          <span className="mprov">{displayProvider}</span>
          <Icon name="chevron-down" size="sm" />
        </button>

        {open && (
          <>
            <div className="dropdown-backdrop" onClick={() => setOpen(false)} />
            <div className="model-dropdown" role="listbox" aria-label={t('titlebar.modelSelect')}>
              <div className="model-search-row">
                <Icon name="search" size="sm" />
                <input
                  ref={searchRef}
                  className="model-search"
                  type="text"
                  placeholder={t('titlebar.searchPlaceholder')}
                  value={query}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCursor(0);
                  }}
                />
              </div>
              <div className="model-dropdown-list" ref={listRef}>
                {groups.length === 0 ? (
                  <div className="model-group-title">
                    {query ? t('titlebar.noMatch') : t('titlebar.noVisible')}
                  </div>
                ) : (
                  groups.map(([p, models]) => (
                    <div key={p} className="model-group">
                      <div className="model-group-title">
                        {PROVIDER_DEFS[p as Provider]?.label ?? p}
                      </div>
                      {models.map((m) => {
                        const caps = getCapabilitiesForModel(m.id);
                        const idx = flat.indexOf(m);
                        return (
                          <button
                            key={m.id}
                            role="option"
                            aria-selected={m.id === displayModel}
                            data-idx={idx}
                            className={`model-item${m.id === displayModel ? ' active' : ''}${
                              idx === cursor ? ' cursor' : ''
                            }`}
                            title={m.description || m.name}
                            onMouseEnter={() => setCursor(idx)}
                            onClick={() => select(m)}
                          >
                            <span className="mid">{m.id}</span>
                            {caps ? (
                              <span className="cap">
                                {CAP_ICONS.map((c) => (
                                  <span
                                    key={c.key}
                                    className={caps[c.key] ? 'on' : 'off'}
                                    title={t(c.labelKey)}
                                  >
                                    <Icon name={c.icon} size="sm" />
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
                {locked.length > 0 ? (
                  <div className="model-group">
                    <div className="model-group-title">{t('titlebar.lockedProviders')}</div>
                    {locked.map((p) => (
                      <button
                        key={p}
                        className="model-item model-item-lock"
                        title={t('titlebar.needKey', { provider: PROVIDER_DEFS[p as Provider]?.label ?? p })}
                        onClick={() => {
                          setOpen(false);
                          onOpenSettings?.();
                        }}
                      >
                        <Icon name="key" size="sm" />
                        {PROVIDER_DEFS[p]?.label ?? p} — {t('titlebar.addKey')}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </span>
    </div>
  );
}
