import type { McpDraft } from './types';

interface Props {
  mcps: McpDraft[];
  onPatchMcp: (key: string, p: Partial<McpDraft>) => void;
  onAddMcp: () => void;
  onRemoveMcp: (key: string) => void;
  onDiscoverMcp: (key: string) => void;
  discovered: Record<string, { count: number; error: string | null; busy: boolean }>;
  formError: string | null;
}

/** Faz 5: MCP sunucu listesi (ad, transport, komut/URL, aktif, keşif, izinler). */
export default function McpTab(props: Props) {
  const { mcps, formError } = props;
  const live = mcps.filter((c) => !c.removed);
  return (
    <div>
      <div className="modal-section-title">MCP sunucuları</div>
      <div className="field-note mb-2">
        Araçlar <span className="status-dim">mcp:sunucu:araç</span> adıyla agent&apos;a girer ve her
        zaman onay ister. Secret&apos;lar bu cihazda saklanır (keys.json).
      </div>
      {live.length === 0 && <div className="field-note">henüz sunucu yok — aşağıdan ekle.</div>}
      {live.map((c) => {
        const info = props.discovered[c.key];
        return (
          <div key={c.key} className="endpoint-card">
            <span className="field-row">
              <input
                className="input"
                value={c.name}
                spellCheck={false}
                placeholder="sunucu adı"
                onChange={(e) => props.onPatchMcp(c.key, { name: e.target.value })}
              />
              <label className="field-row gap-1" title="aktif">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => props.onPatchMcp(c.key, { enabled: e.target.checked })}
                />
                <span className="field-label m-0">açık</span>
              </label>
              <button className="mini-btn" onClick={() => props.onRemoveMcp(c.key)}>
                kaldır
              </button>
            </span>
            <span className="field-row">
              <select
                className="input"
                value={c.transport}
                onChange={(e) =>
                  props.onPatchMcp(c.key, { transport: e.target.value as McpDraft['transport'] })
                }
              >
                <option value="http">HTTP/SSE</option>
                <option value="stdio">stdio (komut)</option>
              </select>
              <button
                className="mini-btn"
                disabled={info?.busy}
                onClick={() => props.onDiscoverMcp(c.key)}
                title="araçları keşfet (kaydetmeden dener)"
              >
                {info?.busy ? '…' : 'keşfet'}
              </button>
            </span>
            {c.transport === 'http' ? (
              <label className="field">
                <span className="field-label">URL</span>
                <input
                  className="input"
                  value={c.url}
                  spellCheck={false}
                  placeholder="https://…/mcp"
                  onChange={(e) => props.onPatchMcp(c.key, { url: e.target.value })}
                />
              </label>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">Komut</span>
                  <input
                    className="input"
                    value={c.command}
                    spellCheck={false}
                    placeholder="npx — örn: mcp-server-dosya"
                    onChange={(e) => props.onPatchMcp(c.key, { command: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Argümanlar (satır başına bir)</span>
                  <textarea
                    className="input input-area"
                    value={c.argsText}
                    spellCheck={false}
                    rows={2}
                    placeholder={'-y\nmcp-paketi'}
                    onChange={(e) => props.onPatchMcp(c.key, { argsText: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Ortam (ANAHTAR=değer, satır başına bir)</span>
                  <textarea
                    className="input input-area"
                    value={c.envText}
                    spellCheck={false}
                    rows={2}
                    placeholder="API_ANAHTARI=…"
                    onChange={(e) => props.onPatchMcp(c.key, { envText: e.target.value })}
                  />
                </label>
              </>
            )}
            <label className="field">
              <span className="field-label">İzinli araçlar (virgüllü, boş = tümü)</span>
              <input
                className="input"
                value={c.allowedText}
                spellCheck={false}
                placeholder="oku, yaz"
                onChange={(e) => props.onPatchMcp(c.key, { allowedText: e.target.value })}
              />
            </label>
            {info && !info.busy && (
              <div className={info.error ? 'form-err' : 'field-note'}>
                {info.error ?? `${info.count} araç bulundu`}
              </div>
            )}
          </div>
        );
      })}
      <span className="field-row mt-2">
        <button className="mini-btn" onClick={props.onAddMcp}>
          + sunucu ekle
        </button>
      </span>
      {formError ? <div className="form-err">{formError}</div> : null}
    </div>
  );
}
