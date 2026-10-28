import { useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
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
import { Icon } from './icons';
import ModelDropdown from './ModelDropdown';

interface Props {
  sessionName: string;
  sessionProvider?: Provider;
  sessionModel?: string;
  /** Ayarları aç (anahtar ekle satırı). */
  onOpenSettings?: () => void;
  /** /root tek yol: '' = diyalog, 'off', '1..5' (App'te kodlanır). */
  onRootCommand?: (arg: string) => void;
}

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
  onRootCommand,
}: Props) {
  const t = useT();
  const provider = useSettingsStore((s) => s.currentProvider);
  const model = useSettingsStore((s) => s.currentModel);
  const customModels = useSettingsStore((s) => s.customModels);
  const disabledModels = useSettingsStore((s) => s.disabledModels);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const workspaceLabel = useWorkspaceStore((s) => s.label);
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const recent = useWorkspaceStore((s) => s.recent ?? []);
  const removeRecent = useWorkspaceStore((s) => s.removeRecent);
  const [open, setOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);

  // Rozet aktif KONUSMANIN modelini gosterir (global varsayilani degil).
  const displayProvider = sessionProvider ?? provider;
  const displayModel = sessionModel || model;
  const differs = displayModel !== model;
  const keyMissing = !hasProviderKey(displayProvider, apiKeys);

  const all = useMemo(() => resolveModels(customModels), [customModels]);

  // Görünür modeller: anahtarı olmayan sağlayıcının ve devre dışı modellerin
  // listesi panelde görünmez (süzgeç tüketicide kalır — Faz 7 paneli paylaşır).
  const visible = useMemo(
    () =>
      visibleModels(all, apiKeys).filter((m) => isModelEnabled(disabledModels, m.id)),
    [all, apiKeys, disabledModels],
  );

  // Anahtari olmayan ama modeli bulunan saglayicilar ("anahtar ekle" satirlari).
  const locked = useMemo(() => hiddenProviders(all, apiKeys), [all, apiKeys]);

  // Workspace menüsü: Esc ile kapat; model menüsüyle aynı anda açık kalmasın.
  useEffect(() => {
    if (!wsOpen) return;
    setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setWsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wsOpen]);

  const select = (m: Model) => {
    const settings = useSettingsStore.getState();
    settings.setProvider(m.provider);
    settings.setModel(m.id);
    // Secim aktif konusmaya da yansir (yoksa rozet ile davranis uyusmazdi).
    // Panel kapanışını ModelDropdown kendisi yapar (onClose).
    const activeId = useSessionStore.getState().activeSessionId;
    if (activeId) {
      useSessionStore.getState().updateSessionModel(activeId, { provider: m.provider, model: m.id });
    }
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
          <button
            className={`workspace-chip${wsOpen ? ' open' : ''}`}
            title={workspaceRoot}
            aria-label={t('titlebar.workspace', { name: workspaceLabel || workspaceRoot })}
            aria-haspopup="menu"
            aria-expanded={wsOpen}
            onClick={() => setWsOpen((v) => !v)}
          >
            <Icon name="folder" size="sm" />
            {workspaceLabel || workspaceRoot.split('/').filter(Boolean).pop() || workspaceRoot}
            <Icon name="chevron-down" size="sm" />
          </button>
        ) : null}

        {wsOpen && onRootCommand ? (
          <>
            <div className="dropdown-backdrop" onClick={() => setWsOpen(false)} />
            <div className="ws-menu" role="menu" aria-label={t('titlebar.workspaceMenu')}>
              <button role="menuitem" className="ws-menu-item" onClick={() => { setWsOpen(false); onRootCommand(''); }}>
                <Icon name="folder" size="sm" />
                {t('workspace.pick')}
              </button>
              {recent.length > 0 ? (
                <>
                  <div className="ws-menu-title">{t('workspace.recents')}</div>
                  {recent.map((entry, i) => (
                    <div key={entry.root} className="ws-menu-row" role="none">
                      <button
                        role="menuitem"
                        className="ws-menu-item"
                        title={entry.root}
                        onClick={() => { setWsOpen(false); onRootCommand(String(i + 1)); }}
                      >
                        <Icon name="folder" size="sm" />
                        <span className="ws-menu-label">{entry.label}</span>
                        <span className="ws-menu-path">{entry.root}</span>
                      </button>
                      <button
                        className="ws-menu-x"
                        aria-label={t('workspace.removeRecent', { name: entry.label })}
                        title={t('workspace.removeRecent', { name: entry.label })}
                        onClick={() => removeRecent(entry.root)}
                      >
                        <Icon name="x" size="sm" />
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <div className="ws-menu-title">{t('workspace.recentsNone')}</div>
              )}
              <button role="menuitem" className="ws-menu-item danger" onClick={() => { setWsOpen(false); onRootCommand('off'); }}>
                <Icon name="x" size="sm" />
                {t('workspace.remove')}
              </button>
            </div>
          </>
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

        {/* Faz 7: ortak ModelDropdown paneli (arama + gruplama + kilitli satırlar). */}
        <ModelDropdown
          open={open}
          onClose={() => setOpen(false)}
          models={visible}
          locked={locked}
          activeModel={displayModel}
          onSelect={select}
          onOpenSettings={onOpenSettings}
        />
      </span>
    </div>
  );
}
