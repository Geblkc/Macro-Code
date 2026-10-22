import { useState } from 'react';
import { useT } from '../../lib/i18n';
import Switch from '../Switch';
import { Icon } from '../icons';
import type { McpDiscovery, McpDraft } from './types';
import { maskEnvText } from './types';

interface Props {
  mcps: McpDraft[];
  onPatchMcp: (key: string, p: Partial<McpDraft>) => void;
  onAddMcp: () => void;
  onRemoveMcp: (key: string) => void;
  onDiscoverMcp: (key: string) => void;
  discovered: Record<string, McpDiscovery>;
  formError: string | null;
}

/** Faz 5: MCP sunucu listesi (ad, transport, komut/URL, aktif, keşif, izinler). */
export default function McpTab(props: Props) {
  const t = useT();
  const { mcps, formError } = props;
  // Env değerleri gizli mi? (kart başına)
  const [envVisible, setEnvVisible] = useState<Record<string, boolean>>({});
  const live = mcps.filter((c) => !c.removed);

  return (
    <div>
      <div className="modal-section-title">{t('settings.mcp.section')}</div>
      <div className="field-note mb-2">{t('settings.mcp.note')}</div>
      {live.length === 0 && <div className="field-note">{t('settings.mcp.empty')}</div>}
      {live.map((c) => {
        const info = props.discovered[c.key];
        const allowed = c.allowedText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const toggleAllowed = (name: string, on: boolean) => {
          const next = on ? [...new Set([...allowed, name])] : allowed.filter((n) => n !== name);
          props.onPatchMcp(c.key, { allowedText: next.join(', ') });
        };
        return (
          <div key={c.key} className="endpoint-card">
            <span className="field-row">
              <input
                className="input"
                value={c.name}
                spellCheck={false}
                placeholder={t('settings.mcp.name')}
                aria-label={t('settings.mcp.name')}
                onChange={(e) => props.onPatchMcp(c.key, { name: e.target.value })}
              />
              <label className="field-row gap-1" title={t('settings.mcp.active')}>
                <Switch
                  checked={c.enabled}
                  onChange={(v) => props.onPatchMcp(c.key, { enabled: v })}
                  label={t('settings.mcp.active')}
                />
                <span className="field-label m-0">{t('common.on')}</span>
              </label>
              <button className="mini-btn danger" onClick={() => props.onRemoveMcp(c.key)}>
                {t('settings.mcp.remove')}
              </button>
            </span>
            <span className="field-row">
              <select
                className="input"
                value={c.transport}
                aria-label={t('settings.mcp.transport')}
                onChange={(e) =>
                  props.onPatchMcp(c.key, { transport: e.target.value as McpDraft['transport'] })
                }
              >
                <option value="http">{t('settings.mcp.transportHttp')}</option>
                <option value="stdio">{t('settings.mcp.transportStdio')}</option>
              </select>
              <button
                className="mini-btn"
                disabled={info?.busy}
                onClick={() => props.onDiscoverMcp(c.key)}
                title={t('settings.mcp.discoverTitle')}
              >
                {info?.busy ? '…' : t('settings.mcp.discover')}
              </button>
            </span>
            {c.transport === 'http' ? (
              <label className="field">
                <span className="field-label">{t('settings.mcp.url')}</span>
                <input
                  className="input"
                  value={c.url}
                  spellCheck={false}
                  placeholder={t('settings.mcp.urlPlaceholder')}
                  onChange={(e) => props.onPatchMcp(c.key, { url: e.target.value })}
                />
              </label>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">{t('settings.mcp.command')}</span>
                  <input
                    className="input"
                    value={c.command}
                    spellCheck={false}
                    placeholder={t('settings.mcp.commandPlaceholder')}
                    onChange={(e) => props.onPatchMcp(c.key, { command: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{t('settings.mcp.args')}</span>
                  <textarea
                    className="input input-area"
                    value={c.argsText}
                    spellCheck={false}
                    rows={2}
                    placeholder={'-y\nmcp-paketi'}
                    onChange={(e) => props.onPatchMcp(c.key, { argsText: e.target.value })}
                  />
                </label>
                <div className="field">
                  <div className="field-row">
                    <span className="field-label flex-1 m-0">{t('settings.mcp.env')}</span>
                    <button
                      className="mini-btn"
                      title={
                        envVisible[c.key]
                          ? t('settings.mcp.envHide')
                          : t('settings.mcp.envShow')
                      }
                      onClick={() =>
                        setEnvVisible((m) => ({ ...m, [c.key]: !m[c.key] }))
                      }
                    >
                      <Icon name={envVisible[c.key] ? 'eye-off' : 'eye'} size="sm" />
                      {envVisible[c.key]
                        ? t('settings.mcp.envHide')
                        : t('settings.mcp.envShow')}
                    </button>
                  </div>
                  <textarea
                    className="input input-area"
                    value={
                      envVisible[c.key] ? c.envText : maskEnvText(c.envText)
                    }
                    spellCheck={false}
                    rows={2}
                    readOnly={!envVisible[c.key]}
                    placeholder="API_ANAHTARI=…"
                    onChange={(e) => props.onPatchMcp(c.key, { envText: e.target.value })}
                  />
                  <span className="field-note">{t('settings.mcp.envNote')}</span>
                </div>
              </>
            )}

            {/* Keşif yapıldıysa araç listesinden izin seç; değilse serbest metin. */}
            {info && !info.busy && info.tools.length > 0 ? (
              <div className="field">
                <span className="field-label">{t('settings.mcp.allowedTools')}</span>
                <div className="tool-picker">
                  {info.tools.map((tool) => {
                    const on = allowed.includes(tool.name);
                    return (
                      <label key={tool.name} className="tool-pick" title={tool.description ?? ''}>
                        <Switch
                          checked={on}
                          onChange={(v) => toggleAllowed(tool.name, v)}
                          label={tool.name}
                        />
                        <span className="tool-pick-name">{tool.name}</span>
                      </label>
                    );
                  })}
                </div>
                <span className="field-note">{t('settings.mcp.allowedToolsNote')}</span>
              </div>
            ) : (
              <label className="field">
                <span className="field-label">{t('settings.mcp.allowedTools')}</span>
                <input
                  className="input"
                  value={c.allowedText}
                  spellCheck={false}
                  placeholder={t('settings.mcp.allowedToolsPlaceholder')}
                  onChange={(e) => props.onPatchMcp(c.key, { allowedText: e.target.value })}
                />
                <span className="field-note">{t('settings.mcp.allowedToolsHint')}</span>
              </label>
            )}

            {info && !info.busy && (
              <div className={info.error ? 'form-err' : 'field-note'}>
                {info.error ??
                  t('settings.mcp.discovered', { count: info.count })}
              </div>
            )}
          </div>
        );
      })}
      <span className="field-row mt-2">
        <button className="mini-btn" onClick={props.onAddMcp}>
          {t('settings.mcp.add')}
        </button>
      </span>
      {formError ? <div className="form-err">{formError}</div> : null}
    </div>
  );
}
