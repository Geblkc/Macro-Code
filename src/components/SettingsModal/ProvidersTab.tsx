import { PROVIDER_DEFS, PROVIDER_IDS } from '../../lib/providers';
import { parseEndpointModels } from '../../lib/providers/custom';
import type { Provider } from '../../types';
import type { CustomDraft, Draft, SecretDraft, TestConn } from './types';
import { Icon } from '../icons';

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

function SecretCard(p: SecretRowProps) {
  const touched = p.secret.value.length > 0;
  const hasKey = touched || p.secret.hint.length > 0;
  const state = p.test;
  const stClass = state === 'ok' ? 'ok' : state === 'invalid' || state === 'network' ? 'err' : 'no';
  const stLabel =
    state === 'ok'
      ? 'bağlı'
      : state === 'invalid'
        ? 'anahtar geçersiz'
        : state === 'network'
          ? 'ağ hatası'
          : p.secret.deleted
            ? 'silinecek'
            : hasKey
              ? 'anahtar kayıtlı'
              : 'anahtar yok';
  return (
    <div className="pcard">
      <div className="pcard-head">
        <span className={`status-dot${stClass === 'ok' ? '' : stClass === 'err' ? ' warn' : ' off'}`} />
        <h4>{p.label}</h4>
        <span className={`st ${stClass}`}>{stLabel}</span>
      </div>
      <div className="field">
        <label className="field-label">API anahtarı</label>
        <div className="input-group">
          <input
            type={p.show && touched ? 'text' : 'password'}
            className="input"
            value={p.secret.value}
            spellCheck={false}
            autoComplete="off"
            placeholder={touched ? undefined : p.secret.hint || p.placeholder}
            onChange={(e) => p.onInput(e.target.value)}
          />
          <button
            className="mini-btn"
            title="göster / gizle"
            aria-label="Anahtarı göster / gizle"
            onClick={p.onToggleShow}
            disabled={!touched}
          >
            <Icon name={p.show && touched ? 'eye-off' : 'eye'} size="sm" />
          </button>
        </div>
        {p.secret.deleted ? (
          <span className="field-note">kaydet ile keystore’dan silinecek</span>
        ) : null}
      </div>
      <div className="row">
        <button className="btn btn-sm" style={{ flex: 1 }} onClick={p.onTest}>
          {state === 'testing' ? 'test ediliyor…' : 'Test et'}
        </button>
        {p.secret.deleted ? (
          <button className="btn btn-sm" style={{ flex: 1 }} onClick={p.onClear}>
            Geri al
          </button>
        ) : (
          <button
            className="btn btn-danger btn-sm"
            style={{ flex: 1 }}
            title={p.clearTitle}
            disabled={!hasKey}
            onClick={p.onClear}
          >
            {p.clearLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProvidersTab(props: Props) {
  const { draft, patch } = props;
  const activeEp = draft.activeEndpointId
    ? draft.customs.find((c) => !c.removed && c.id === draft.activeEndpointId)
    : undefined;

  return (
    <div>
      <div className="sec">
        <div className="sec-title">Sağlayıcılar</div>
        <div className="cards2">
          {PROVIDER_IDS.map((p) => {
        const def = PROVIDER_DEFS[p];
        if (p === 'ollama') {
          const t = props.tests[p] ?? 'idle';
          const stClass = t === 'ok' ? 'ok' : t === 'invalid' || t === 'network' ? 'err' : 'no';
          const stLabel =
            t === 'ok'
              ? 'bağlı'
              : t === 'invalid'
                ? 'reddedildi'
                : t === 'network'
                  ? 'ağ hatası'
                  : 'bağlanmadı';
          return (
            <div className="pcard" key={p}>
              <div className="pcard-head">
                <span className={`status-dot${stClass === 'ok' ? '' : stClass === 'err' ? ' warn' : ' off'}`} />
                <h4>{def.label}</h4>
                <span className={`st ${stClass}`}>{stLabel}</span>
              </div>
              <div className="field">
                <label className="field-label">Sunucu adresi</label>
                <input
                  type="text"
                  className="input"
                  value={draft.ollamaUrl}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={def.placeholder}
                  onChange={(e) => patch({ ollamaUrl: e.target.value })}
                />
              </div>
              <div className="row">
                <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => props.onTest(p)}>
                  Test et
                </button>
                <button
                  className="btn btn-sm"
                  style={{ flex: 1 }}
                  disabled={props.ollamaBusy}
                  onClick={props.onDiscoverOllama}
                >
                  {props.ollamaBusy ? 'aranıyor…' : 'Modelleri bul'}
                </button>
              </div>
              {props.ollamaErr ? <div className="form-err">{props.ollamaErr}</div> : null}
              {props.ollamaFound ? (
                <div className="field-note">
                  bulunanlar: {props.ollamaFound.length === 0 ? '—' : props.ollamaFound.join(', ')}
                </div>
              ) : null}
            </div>
          );
        }
        const s = draft.secrets[p] ?? { value: '', hint: '', deleted: false };
        return (
          <SecretCard
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
            clearLabel="Temizle"
          />
        );
          })}
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">Özel taban URL</div>
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
      </div>

      <div className="sec">
        <div className="sec-title">Özel sağlayıcılar</div>
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
              <SecretCard
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
    </div>
  );
}
