import { PROVIDER_DEFS, PROVIDER_IDS } from '../../lib/providers';
import { DEFAULT_OLLAMA_URL } from '../../lib/providers/ollama';
import { parseEndpointModels } from '../../lib/providers/custom';
import type { Provider } from '../../types';
import type { CustomDraft, Draft, SecretDraft, TestConn } from './types';
import { TEST_CONN_LABEL } from './types';

interface Props {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  setSecret: (id: string, p: Partial<SecretDraft>) => void;
  show: Record<string, boolean>;
  toggleShow: (id: string) => void;
  tests: Record<string, TestConn>;
  onTest: (id: string) => void;
  onClearSecret: (id: string) => void;
  ollamaFound: string[] | null;
  ollamaErr: string | null;
  ollamaBusy: boolean;
  onDiscoverOllama: () => void;
  onAddEndpoint: () => void;
  onRemoveEndpoint: (key: string) => void;
  onPatchCustom: (key: string, p: Partial<CustomDraft>) => void;
  onUseEndpointModel: (endpointId: string, model: string) => void;
  onBackToBuiltin: () => void;
  formError: string | null;
}

const OVERRIDABLE: Provider[] = ['openai', 'openrouter', 'deepseek', 'xai'];

function StatusText({ state }: { state: TestConn }) {
  if (state === 'idle' || state === 'testing') {
    return <span className="status-dim">{state === 'testing' ? 'test ediliyor…' : ''}</span>;
  }
  return (
    <span className={state === 'ok' ? 'status-ok' : 'status-err'}>{TEST_CONN_LABEL[state]}</span>
  );
}

interface SecretRowProps {
  label: string;
  fieldId: string;
  secret: SecretDraft;
  placeholder: string;
  show: boolean;
  test: TestConn;
  onInput: (v: string) => void;
  onToggleShow: () => void;
  onTest: () => void;
  onClear: () => void;
  clearTitle: string;
  clearLabel: string;
}

function SecretRow(p: SecretRowProps) {
  const touched = p.secret.value.length > 0;
  const testClass = p.test === 'ok' ? 'test-ok' : p.test === 'invalid' || p.test === 'network' ? 'test-fail' : '';
  return (
    <label className="field">
      <span className="field-label">{p.label}</span>
      <span className="field-row">
        <input
          type={p.show && touched ? 'text' : 'password'}
          className="field-input"
          value={p.secret.value}
          spellCheck={false}
          autoComplete="off"
          placeholder={touched ? undefined : p.secret.hint || p.placeholder}
          onChange={(e) => p.onInput(e.target.value)}
        />
        <button className="mini-btn" title="göster/gizle" onClick={p.onToggleShow} disabled={!touched}>
          {p.show && touched ? 'gizle' : 'göster'}
        </button>
        <button className={`mini-btn ${testClass}`} title="bağlantıyı test et" onClick={p.onTest}>
          test
        </button>
        {p.secret.deleted ? (
          <button className="mini-btn" title="silme işlemini geri al" onClick={p.onClear}>
            geri al
          </button>
        ) : (
          <button
            className="mini-btn danger"
            title={p.clearTitle}
            disabled={!touched && !p.secret.hint}
            onClick={p.onClear}
          >
            {p.clearLabel}
          </button>
        )}
      </span>
      <span className="field-note">
        <StatusText state={p.test} />
        {p.secret.deleted ? ' · kaydet ile keystore’dan silinecek' : ''}
      </span>
    </label>
  );
}

export default function ProvidersTab(props: Props) {
  const { draft, patch } = props;
  const activeEp = draft.activeEndpointId
    ? draft.customs.find((c) => !c.removed && c.id === draft.activeEndpointId)
    : undefined;

  return (
    <div>
      <div className="modal-section-title">API anahtarları</div>

      {PROVIDER_IDS.map((p) => {
        const def = PROVIDER_DEFS[p];
        if (p === 'ollama') {
          const t = props.tests[p] ?? 'idle';
          const testClass = t === 'ok' ? 'test-ok' : t === 'invalid' || t === 'network' ? 'test-fail' : '';
          return (
            <div key={p}>
              <label className="field">
                <span className="field-label">{def.label}</span>
                <span className="field-row">
                  <input
                    type="text"
                    className="field-input"
                    value={draft.ollamaUrl}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={def.placeholder}
                    onChange={(e) => patch({ ollamaUrl: e.target.value })}
                  />
                  <button className={`mini-btn ${testClass}`} title="bağlantıyı test et" onClick={() => props.onTest(p)}>
                    test
                  </button>
                  <button
                    className="mini-btn danger"
                    title="varsayılana dön"
                    disabled={draft.ollamaUrl.trim() === DEFAULT_OLLAMA_URL}
                    onClick={() => patch({ ollamaUrl: DEFAULT_OLLAMA_URL })}
                  >
                    sıfırla
                  </button>
                </span>
                <span className="field-note">
                  <StatusText state={t} />
                </span>
              </label>
              <div className="field-row" style={{ marginBottom: 10 }}>
                <button className="mini-btn" disabled={props.ollamaBusy} onClick={props.onDiscoverOllama}>
                  {props.ollamaBusy ? 'aranıyor…' : 'kurulu modelleri bul'}
                </button>
              </div>
              {props.ollamaErr ? <div className="form-err">{props.ollamaErr}</div> : null}
              {props.ollamaFound ? (
                <div className="field-note" style={{ marginBottom: 10 }}>
                  bulunanlar: {props.ollamaFound.length === 0 ? '—' : props.ollamaFound.join(', ')}
                  <br />
                  kullanmak için terminale <code>/model {'<id>'}</code> yaz.
                </div>
              ) : null}
            </div>
          );
        }
        const s = draft.secrets[p] ?? { value: '', hint: '', deleted: false };
        return (
          <SecretRow
            key={p}
            label={def.label}
            fieldId={p}
            secret={s}
            placeholder={def.placeholder}
            show={!!props.show[p]}
            test={props.tests[p] ?? 'idle'}
            onInput={(v) => props.setSecret(p, { value: v, deleted: false })}
            onToggleShow={() => props.toggleShow(p)}
            onTest={() => props.onTest(p)}
            onClear={() =>
              s.deleted
                ? props.setSecret(p, { deleted: false })
                : props.onClearSecret(p)
            }
            clearTitle="alanı temizle (kaydet ile keystore’dan silinir)"
            clearLabel="sil"
          />
        );
      })}

      <div className="modal-section-title">Özel taban URL (OpenAI uyumlu uçlar)</div>
      <div className="field-note" style={{ marginBottom: 8 }}>
        Proxy / OpenRouter / LM Studio gibi uçlar için. Boş = varsayılan uç.
      </div>
      {OVERRIDABLE.map((p) => (
        <label key={p} className="field">
          <span className="field-label">{PROVIDER_DEFS[p].label} base URL</span>
          <input
            type="text"
            className="field-input"
            value={draft.baseUrlOverride[p] ?? ''}
            spellCheck={false}
            autoComplete="off"
            placeholder="örn: http://localhost:1234/v1"
            onChange={(e) =>
              patch({ baseUrlOverride: { ...draft.baseUrlOverride, [p]: e.target.value } })
            }
          />
        </label>
      ))}

      <div className="modal-section-title">Özel sağlayıcılar</div>
      {activeEp ? (
        <div className="field-note" style={{ marginBottom: 8 }}>
          <span className="status-ok">özel uç aktif: {activeEp.name} · {draft.currentModel}</span>{' '}
          <button className="mini-btn" onClick={props.onBackToBuiltin}>
            yerleşik akışa dön
          </button>
        </div>
      ) : null}
      {draft.customs
        .filter((c) => !c.removed)
        .map((c) => {
          const models = parseEndpointModels(c.modelsText);
          return (
            <div key={c.key} className="endpoint-card">
              <label className="field">
                <span className="field-label">Ad</span>
                <input
                  type="text"
                  className="field-input"
                  value={c.name}
                  disabled={!c.isNew}
                  title={c.isNew ? undefined : 'ad sonradan değişmez (keystore adı sabittir)'}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="örn: Şirket proxy"
                  onChange={(e) => props.onPatchCustom(c.key, { name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Base URL</span>
                <input
                  type="text"
                  className="field-input"
                  value={c.baseUrl}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="https://ornek.com/v1"
                  onChange={(e) => props.onPatchCustom(c.key, { baseUrl: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Modeller (satır başına bir id)</span>
                <textarea
                  className="field-input field-area"
                  rows={2}
                  value={c.modelsText}
                  spellCheck={false}
                  placeholder={'model-a\nmodel-b'}
                  onChange={(e) => props.onPatchCustom(c.key, { modelsText: e.target.value })}
                />
              </label>
              <SecretRow
                label="Anahtar"
                fieldId={c.key}
                secret={c.secret}
                placeholder="sk-…"
                show={!!props.show[c.key]}
                test={props.tests[c.key] ?? 'idle'}
                onInput={(v) => props.onPatchCustom(c.key, { secret: { ...c.secret, value: v, deleted: false } })}
                onToggleShow={() => props.toggleShow(c.key)}
                onTest={() => props.onTest(c.key)}
                onClear={() =>
                  props.onPatchCustom(c.key, { secret: { ...c.secret, deleted: !c.secret.deleted } })
                }
                clearTitle="anahtarı temizle (kaydet ile keystore’dan silinir)"
                clearLabel="sil"
              />
              <span className="field-row">
                <select
                  className="field-input"
                  value={models.includes(draft.currentModel) && draft.activeEndpointId === c.id ? draft.currentModel : ''}
                  onChange={(e) => {
                    if (e.target.value) props.onUseEndpointModel(c.id, e.target.value);
                  }}
                >
                  <option value="">varsayılan model seç…</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button className="mini-btn danger" onClick={() => props.onRemoveEndpoint(c.key)}>
                  kaldır
                </button>
              </span>
            </div>
          );
        })}
      <div className="field-row" style={{ marginTop: 8 }}>
        <button className="mini-btn" onClick={props.onAddEndpoint}>
          + özel sağlayıcı ekle
        </button>
      </div>
      {props.formError ? <div className="form-err">{props.formError}</div> : null}

      <div className="field-note" style={{ marginTop: 12 }}>
        Anahtarlar bu cihazda saklanır (keys.json), cihazdan çıkmaz. Kaydedilen
        anahtar bir daha tam gösterilmez, yalnızca son 4 karakter (••••a1b2).
      </div>
    </div>
  );
}
