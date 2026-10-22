import { useId } from 'react';
import { PROVIDER_DEFS, PROVIDER_IDS } from '../../lib/providers';
import { parseEndpointModels } from '../../lib/providers/custom';
import { useT } from '../../lib/i18n';
import { useSettingsStore } from '../../store/settings';
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
  /** Tüm sağlayıcıları sırayla test et. */
  onTestAll: () => void;
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

/** Bulut sağlayıcıları (anahtar gerektirenler). Ollama ayrı bölümde. */
const CLOUD_PROVIDERS: Provider[] = PROVIDER_IDS.filter((p) => p !== 'ollama');

/** Base URL override destekleyen sağlayıcılar (yalnız OpenAI-uyumlu olanlar). */
const OVERRIDABLE: Provider[] = ['openai', 'openrouter', 'deepseek', 'xai'];

interface SecretRowProps {
  label: string;
  secret: SecretDraft;
  placeholder: string;
  show: boolean;
  test: TestConn;
  /** Bu sağlayıcı aktif mi (rozet). */
  active: boolean;
  /** API anahtarı alınacak konsol bağlantısı. */
  keyUrl?: string;
  keyUrlLabel?: string;
  onInput: (v: string) => void;
  onToggleShow: () => void;
  onTest: () => void;
  onClear: () => void;
  clearTitle: string;
  clearLabel: string;
}

function SecretCard(p: SecretRowProps) {
  const t = useT();
  const inputId = useId();
  const touched = p.secret.value.length > 0;
  const hasKey = touched || p.secret.hint.length > 0;
  const state = p.test;
  const stClass = state === 'ok' ? 'ok' : state === 'invalid' || state === 'network' ? 'err' : 'no';
  const stLabel =
    state === 'ok'
      ? t('settings.providers.state.connected')
      : state === 'invalid'
        ? t('settings.providers.state.invalid')
        : state === 'network'
          ? t('settings.providers.state.network')
          : p.secret.deleted
            ? t('settings.providers.state.toDelete')
            : hasKey
              ? t('settings.providers.state.saved')
              : t('settings.providers.state.noKey');
  const stTitle =
    state === 'ok'
      ? t('settings.providers.state.connectedHint')
      : state === 'invalid'
        ? t('settings.providers.state.invalidHint')
        : state === 'network'
          ? t('settings.providers.state.networkHint')
          : '';

  return (
    <div className="pcard">
      <div className="pcard-head">
        <span className={`status-dot${stClass === 'ok' ? '' : stClass === 'err' ? ' warn' : ' off'}`} />
        <h4>{p.label}</h4>
        {p.active ? <span className="chip on">{t('settings.providers.activeBadge')}</span> : null}
        <span className={`st ${stClass}`} title={stTitle}>
          {stLabel}
        </span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={inputId}>
          {t('settings.providers.apiKey')}
        </label>
        <div className="input-group">
          <input
            id={inputId}
            type={p.show && touched ? 'text' : 'password'}
            className="input"
            value={p.secret.value}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={p.secret.deleted ? `${inputId}-note` : undefined}
            placeholder={touched ? undefined : p.secret.hint || p.placeholder}
            onChange={(e) => p.onInput(e.target.value)}
          />
          <button
            className="mini-btn"
            title={t('settings.providers.showHide')}
            aria-label={t('settings.providers.showHideAria')}
            onClick={p.onToggleShow}
            disabled={!touched}
          >
            <Icon name={p.show && touched ? 'eye-off' : 'eye'} size="sm" />
          </button>
        </div>
        {p.secret.deleted ? (
          <span className="field-note" id={`${inputId}-note`}>
            {t('settings.providers.willDelete')}
          </span>
        ) : null}
      </div>
      <div className="row">
        <button className="btn btn-sm flex-1" onClick={p.onTest}>
          {state === 'testing' ? t('settings.providers.test.testing') : t('common.test')}
        </button>
        {p.secret.deleted ? (
          <button className="btn btn-sm flex-1" onClick={p.onClear}>
            {t('common.undo')}
          </button>
        ) : (
          <button
            className="btn btn-danger btn-sm flex-1"
            title={p.clearTitle}
            disabled={!hasKey}
            onClick={p.onClear}
          >
            {p.clearLabel}
          </button>
        )}
      </div>
      {p.keyUrl ? (
        <a
          className="key-link"
          href={p.keyUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={p.keyUrlLabel ? `${t('settings.providers.getKey')}: ${p.keyUrlLabel}` : undefined}
        >
          <Icon name="key" size="sm" />
          {t('settings.providers.getKey')}
          {p.keyUrlLabel ? <span className="status-dim"> · {p.keyUrlLabel}</span> : null}
        </a>
      ) : null}
    </div>
  );
}

export default function ProvidersTab(props: Props) {
  const t = useT();
  const { draft, patch } = props;
  const activeProvider = useSettingsStore((s) => s.currentProvider);
  const activeEp = draft.activeEndpointId
    ? draft.customs.find((c) => !c.removed && c.id === draft.activeEndpointId)
    : undefined;

  const anyTesting = Object.values(props.tests).some((s) => s === 'testing');

  return (
    <div>
      {/* ── Bulut sağlayıcıları ── */}
      <div className="sec">
        <div className="sec-title">
          {t('settings.providers.cloudSection')}
          <button className="mini-btn" onClick={props.onTestAll} disabled={anyTesting}>
            {anyTesting ? t('settings.providers.test.testing') : t('settings.providers.testAll')}
          </button>
        </div>
        <div className="field-note mb-2">{t('settings.providers.sectionNote')}</div>
        <div className="cards2">
          {CLOUD_PROVIDERS.map((p) => {
            const def = PROVIDER_DEFS[p];
            const s = draft.secrets[p] ?? { value: '', hint: '', deleted: false };
            return (
              <SecretCard
                key={p}
                label={def.label}
                secret={s}
                placeholder={def.placeholder}
                show={!!props.show[p]}
                test={props.tests[p] ?? 'idle'}
                active={activeProvider === p}
                keyUrl={def.keyUrl}
                keyUrlLabel={def.keyUrlLabel}
                onInput={(v) => props.setSecret(p, { value: v, deleted: false })}
                onToggleShow={() => props.toggleShow(p)}
                onTest={() => props.onTest(p)}
                onClear={() =>
                  s.deleted
                    ? props.setSecret(p, { deleted: false })
                    : props.onClearSecret(p)
                }
                clearTitle={t('settings.providers.clearTitle')}
                clearLabel={t('common.clear')}
              />
            );
          })}
        </div>
      </div>

      {/* ── Yerel sağlayıcı ── */}
      <div className="sec">
        <div className="sec-title">{t('settings.providers.localSection')}</div>
        <div className="field-note mb-2">{t('settings.providers.localNote')}</div>
        <div className="cards2">
          {(() => {
            const p = 'ollama' as const;
            const def = PROVIDER_DEFS[p];
            const state = props.tests[p] ?? 'idle';
            const stClass =
              state === 'ok' ? 'ok' : state === 'invalid' || state === 'network' ? 'err' : 'no';
            const stLabel =
              state === 'ok'
                ? t('settings.providers.state.connected')
                : state === 'invalid'
                  ? t('settings.providers.state.rejected')
                  : state === 'network'
                    ? t('settings.providers.state.network')
                    : t('settings.providers.state.notConnected');
            return (
              <div className="pcard" key={p}>
                <div className="pcard-head">
                  <span className={`status-dot${stClass === 'ok' ? '' : stClass === 'err' ? ' warn' : ' off'}`} />
                  <h4>{def.label}</h4>
                  {activeProvider === p ? (
                    <span className="chip on">{t('settings.providers.activeBadge')}</span>
                  ) : null}
                  <span className={`st ${stClass}`}>{stLabel}</span>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="ollama-url">
                    {t('settings.providers.serverAddress')}
                  </label>
                  <input
                    id="ollama-url"
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
                  <button className="btn btn-sm flex-1" onClick={() => props.onTest(p)}>
                    {t('common.test')}
                  </button>
                  <button
                    className="btn btn-sm flex-1"
                    disabled={props.ollamaBusy}
                    onClick={props.onDiscoverOllama}
                  >
                    {props.ollamaBusy
                      ? t('settings.providers.searching')
                      : t('settings.providers.findModels')}
                  </button>
                </div>
                {props.ollamaErr ? <div className="form-err">{props.ollamaErr}</div> : null}
                {props.ollamaFound ? (
                  <div className="field-note">
                    {t('settings.providers.found')}{' '}
                    {props.ollamaFound.length === 0 ? '—' : props.ollamaFound.join(', ')}
                  </div>
                ) : null}
                {def.keyUrl ? (
                  <a
                    className="key-link"
                    href={def.keyUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`${t('settings.providers.getKey')}: ${def.keyUrlLabel ?? ''}`}
                  >
                    <Icon name="download" size="sm" />
                    {t('settings.providers.getKey')}
                    {def.keyUrlLabel ? <span className="status-dim"> · {def.keyUrlLabel}</span> : null}
                  </a>
                ) : null}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Özel taban URL ── */}
      <div className="sec">
        <div className="sec-title">{t('settings.providers.customUrl')}</div>
        <div className="field-note mb-2">{t('settings.providers.customUrlSectionNote')}</div>
        {OVERRIDABLE.map((p) => {
          const current = draft.baseUrlOverride[p] ?? '';
          return (
            <div key={p} className="field">
              <label className="field-label" htmlFor={`baseurl-${p}`}>
                {t('settings.providers.baseUrlFor', { provider: PROVIDER_DEFS[p].label })}
              </label>
              <div className="input-group">
                <input
                  id={`baseurl-${p}`}
                  type="text"
                  className="input"
                  value={current}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={PROVIDER_DEFS[p].defaultBaseUrl}
                  onChange={(e) =>
                    patch({ baseUrlOverride: { ...draft.baseUrlOverride, [p]: e.target.value } })
                  }
                />
                {current ? (
                  <button
                    className="mini-btn"
                    title={t('settings.providers.resetUrlTitle')}
                    onClick={() =>
                      patch({
                        baseUrlOverride: { ...draft.baseUrlOverride, [p]: '' },
                      })
                    }
                  >
                    {t('settings.providers.resetUrl')}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Özel uçlar ── */}
      <div className="sec">
        <div className="sec-title">{t('settings.providers.customSection')}</div>
        <div className="field-note mb-2">{t('settings.providers.customNote')}</div>
        {activeEp ? (
          <div className="field-note mb-2">
            <span className="status-ok">
              {t('settings.providers.activeEndpoint', { name: activeEp.name, model: draft.currentModel })}
            </span>{' '}
            <button className="mini-btn" onClick={props.onBackToBuiltin}>
              {t('settings.providers.backToBuiltin')}
            </button>
          </div>
        ) : null}
        {draft.customs
          .filter((c) => !c.removed)
          .map((c) => {
            const models = parseEndpointModels(c.modelsText);
            const cardId = `endpoint-${c.key}`;
            return (
              <div key={c.key} className="endpoint-card">
                <label className="field">
                  <span className="field-label">
                    {t('settings.providers.name')}
                  </span>
                  <input
                    id={`${cardId}-name`}
                    type="text"
                    className="input"
                    value={c.name}
                    disabled={!c.isNew}
                    title={c.isNew ? undefined : t('settings.providers.nameLocked')}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t('settings.providers.namePlaceholder')}
                    onChange={(e) => props.onPatchCustom(c.key, { name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    {t('settings.providers.baseUrl')}
                  </span>
                  <input
                    id={`${cardId}-url`}
                    type="text"
                    className="input"
                    value={c.baseUrl}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t('settings.providers.baseUrlExample')}
                    onChange={(e) => props.onPatchCustom(c.key, { baseUrl: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    {t('settings.providers.modelsLabel')}
                  </span>
                  <textarea
                    id={`${cardId}-models`}
                    className="input input-area"
                    rows={2}
                    value={c.modelsText}
                    spellCheck={false}
                    placeholder={'model-a\nmodel-b'}
                    onChange={(e) => props.onPatchCustom(c.key, { modelsText: e.target.value })}
                  />
                </label>
                <SecretCard
                  label={t('settings.providers.key')}
                  secret={c.secret}
                  placeholder="sk-…"
                  show={!!props.show[c.key]}
                  test={props.tests[c.key] ?? 'idle'}
                  active={false}
                  onInput={(v) =>
                    props.onPatchCustom(c.key, { secret: { ...c.secret, value: v, deleted: false } })
                  }
                  onToggleShow={() => props.toggleShow(c.key)}
                  onTest={() => props.onTest(c.key)}
                  onClear={() =>
                    props.onPatchCustom(c.key, { secret: { ...c.secret, deleted: !c.secret.deleted } })
                  }
                  clearTitle={t('settings.providers.clearKeyTitle')}
                  clearLabel={t('settings.providers.removeKey')}
                />
                <span className="field-row">
                  <select
                    className="input"
                    aria-label={t('settings.providers.selectModel')}
                    value={
                      models.includes(draft.currentModel) && draft.activeEndpointId === c.id
                        ? draft.currentModel
                        : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) props.onUseEndpointModel(c.id, e.target.value);
                    }}
                  >
                    <option value="">{t('settings.providers.selectModel')}</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button className="mini-btn danger" onClick={() => props.onRemoveEndpoint(c.key)}>
                    {t('settings.providers.remove')}
                  </button>
                </span>
              </div>
            );
          })}
        <div className="field-row mt-2">
          <button className="mini-btn" onClick={props.onAddEndpoint}>
            {t('settings.providers.addCustom')}
          </button>
        </div>
        {props.formError ? <div className="form-err">{props.formError}</div> : null}

        <div className="field-note mt-3">{t('settings.providers.storageNote')}</div>
      </div>
    </div>
  );
}
