import { useState } from 'react';
import { PROVIDER_DEFS, PROVIDER_IDS, getCapabilitiesForModel, isModelEnabled } from '../../lib/providers';
import ModelPicker from '../ModelPicker';
import { Icon } from '../icons';
import Segmented from '../Segmented';
import Switch from '../Switch';
import { useT } from '../../lib/i18n';
import type { TranslationKey } from '../../lib/i18n/locales/tr';
import type { CustomModel, DiscoveredModel, ModelCapabilities, Provider } from '../../types';
import type { Draft } from './types';
import { filterModels, modelView } from './modelList';

interface Props {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  onToggleModel: (id: string) => void;
  found: DiscoveredModel[] | null;
  foundErr: string | null;
  foundBusy: string | null;
  onRefresh: (source: DiscoveredModel['source']) => void;
  onAddDiscovered: (m: DiscoveredModel) => void;
  onAddCustom: (m: CustomModel) => void;
  onRemoveCustom: (id: string) => void;
  /** Sağlayıcılar sekmesine geç (anahtar eklemek için). */
  onOpenProviders: () => void;
  formError: string | null;
}

const SOURCES: { id: DiscoveredModel['source']; labelKey: TranslationKey }[] = [
  { id: 'openrouter', labelKey: 'settings.models.source.openrouter' },
  { id: 'ollama', labelKey: 'settings.models.source.ollama' },
  { id: 'openai', labelKey: 'settings.models.source.openai' },
  { id: 'gemini', labelKey: 'settings.models.source.gemini' },
  { id: 'modelsDev', labelKey: 'settings.models.source.modelsDev' },
];

/** models.dev sağlayıcı anahtarı → okunabilir etiket. */
const CATALOG_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Gemini',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  xai: 'xAI',
};

function fmtCtx(n: number): string {
  if (!n) return '—';
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function fmtUsd(n: number | undefined): string {
  if (n === undefined) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Model yönetimi — üç alt sekme:
 * **Liste** (varsayılan model + aç/kapa) · **Katalog & keşif** · **Elle ekle**.
 *
 * Önceden altı ayrı iş tek sayfadaydı; parametreler ve fiyatlar artık
 * `ParamsTab`'da, keşif ile elle ekleme ayrı alt sekmelerde.
 */
export default function ModelsTab(props: Props) {
  const t = useT();
  const { draft, patch } = props;
  const [sub, setSub] = useState<'list' | 'catalog' | 'manual'>('list');

  // Liste alt sekmesi
  const [listQuery, setListQuery] = useState('');
  const [listProvider, setListProvider] = useState('');
  const [listLimit, setListLimit] = useState(100);

  // Katalog alt sekmesi
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('');

  // Elle ekle alt sekmesi
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState<Provider>('openai');
  const [newContext, setNewContext] = useState('');
  const [newMaxOutput, setNewMaxOutput] = useState('');
  const [caps, setCaps] = useState<ModelCapabilities>({ tools: true, vision: false, reasoning: false });
  const [localErr, setLocalErr] = useState<string | null>(null);

  const view = modelView(draft);
  const filteredAll = filterModels(view.visible, listQuery, listProvider);

  const currentDisabled =
    draft.currentModel !== '' && !isModelEnabled(draft.disabledModels, draft.currentModel);
  const modelKnown = view.all.some((m) => m.id === draft.currentModel);

  // Varsayılan model seçimi: filtreli liste + seçili model her zaman görünür.
  const selectModels = (() => {
    const list = [...filteredAll];
    if (draft.currentModel && !list.some((m) => m.id === draft.currentModel)) {
      const cur = view.all.find((m) => m.id === draft.currentModel);
      if (cur) list.unshift(cur);
    }
    return list;
  })();

  // models.dev keşfi diğer kaynaklardan farklı: yüzlerce model → arama/filtre.
  const catalogRows = (props.found ?? []).filter((m) => m.source === 'modelsDev');
  const isCatalog = catalogRows.length > 0;
  const filteredCatalog = catalogRows.filter((m) => {
    if (providerFilter && m.catalog?.provider !== providerFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const c = m.catalog;
    const haystack = `${m.id} ${c?.name ?? ''} ${c?.description ?? ''} ${c?.family ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
  const catalogProviders = [...new Set(catalogRows.map((m) => m.catalog?.provider ?? ''))]
    .filter(Boolean)
    .sort();

  const addManual = () => {
    const id = newId.trim();
    if (!id) {
      setLocalErr(t('settings.models.error.idEmpty'));
      return;
    }
    if (view.all.some((m) => m.id === id)) {
      setLocalErr(t('settings.models.error.duplicate', { id }));
      return;
    }
    const ctx = Number(newContext.trim());
    const maxOut = Number(newMaxOutput.trim());
    props.onAddCustom({
      id,
      provider: newProvider,
      name: newName.trim() || id,
      capabilities: { ...caps },
      ...(newContext.trim() && Number.isFinite(ctx) && ctx > 0 ? { contextWindow: ctx } : {}),
      ...(newMaxOutput.trim() && Number.isFinite(maxOut) && maxOut > 0 ? { maxOutput: maxOut } : {}),
    });
    setNewId('');
    setNewName('');
    setNewContext('');
    setNewMaxOutput('');
    setLocalErr(null);
  };

  return (
    <div>
      <Segmented
        ariaLabel={t('settings.models.section')}
        value={sub}
        onChange={(id) => setSub(id as 'list' | 'catalog' | 'manual')}
        items={[
          { id: 'list', label: t('settings.models.sub.list'), icon: 'list-checks' },
          { id: 'catalog', label: t('settings.models.sub.catalog'), icon: 'search' },
          { id: 'manual', label: t('settings.models.sub.manual'), icon: 'plus' },
        ]}
      />

      {/* ── Liste ── */}
      <div hidden={sub !== 'list'}>
        <div className="sec">
          <div className="sec-title">{t('settings.models.default')}</div>
          {draft.activeEndpointId ? (
            <div className="field-note mb-2">{t('settings.models.endpointActiveNote')}</div>
          ) : null}
          <label className="field">
            <span className="field-label">{t('settings.models.modelLabel')}</span>
            <ModelPicker
              value={draft.currentModel}
              models={selectModels}
              extraValue={!modelKnown || currentDisabled ? draft.currentModel : undefined}
              placeholder={t('settings.models.pickerPlaceholder')}
              onChange={(v) => patch({ currentModel: v, activeEndpointId: null })}
            />
          </label>
          {currentDisabled ? (
            <div className="form-err">{t('settings.models.selectedDisabled')}</div>
          ) : null}
        </div>

        <div className="sec">
          <div className="sec-title">
            {t('settings.models.section')}
            <span className="chip on">
              {filteredAll.length} / {view.visible.length}
            </span>
          </div>
          <div className="field-note mb-2">{t('settings.models.listNote')}</div>
          <span className="field-row mb-3">
            <input
              type="text"
              className="input flex-2"
              placeholder={t('titlebar.searchPlaceholder')}
              value={listQuery}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setListQuery(e.target.value)}
            />
            <select
              className="input flex-1"
              value={listProvider}
              onChange={(e) => setListProvider(e.target.value)}
            >
              <option value="">{t('settings.models.allProviders')}</option>
              {PROVIDER_IDS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_DEFS[p]?.label ?? p}
                </option>
              ))}
            </select>
          </span>
          {view.locked.length > 0 ? (
            <div className="mb-3">
              {view.locked.map((p) => (
                <span key={p} className="field-row mb-1">
                  <span className="field-label flex-1 m-0">
                    <Icon name="key" size="sm" />{' '}
                    {t('settings.models.noKeyEntered', { provider: PROVIDER_DEFS[p]?.label ?? p })}
                  </span>
                  <button className="mini-btn" onClick={props.onOpenProviders}>
                    {t('settings.models.noKeyHint')}
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('settings.models.column.model')}</th>
                  <th>{t('settings.models.column.provider')}</th>
                  <th>{t('settings.models.column.caps')}</th>
                  <th className="num">{t('settings.models.column.context')}</th>
                  <th className="num">{t('settings.models.column.price')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredAll.slice(0, listLimit).map((m) => {
                  const mCaps = getCapabilitiesForModel(m.id) ?? m.capabilities;
                  const price = draft.prices[m.id];
                  const on = isModelEnabled(draft.disabledModels, m.id);
                  return (
                    <tr key={m.id}>
                      <td className="m">
                        <span className="model-name">{m.name}</span>
                        <span className="model-id">{m.id}</span>
                      </td>
                      <td>{PROVIDER_DEFS[m.provider]?.label ?? m.provider}</td>
                      <td>
                        <span className="caps">
                          <span className={mCaps?.tools ? 'on' : ''} title={t('titlebar.capTools')}>
                            <Icon name="wrench" size="sm" />
                          </span>
                          <span className={mCaps?.vision ? 'on' : ''} title={t('titlebar.capVision')}>
                            <Icon name="eye" size="sm" />
                          </span>
                          <span className={mCaps?.reasoning ? 'on' : ''} title={t('titlebar.capReasoning')}>
                            <Icon name="spark" size="sm" />
                          </span>
                        </span>
                      </td>
                      <td className="num">{fmtCtx(m.contextWindow)}</td>
                      <td className="num">
                        {price ? `${fmtUsd(price.input)} / ${fmtUsd(price.output)}` : '—'}
                      </td>
                      <td>
                        <Switch
                          checked={on}
                          onChange={() => props.onToggleModel(m.id)}
                          label={t('settings.models.toggleLabel', { model: m.id })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="field-row mt-2">
            {filteredAll.length > listLimit ? (
              <button className="mini-btn" onClick={() => setListLimit((l) => l + 100)}>
                {t('settings.models.showMore')}
              </button>
            ) : null}
            <span className="status-dim">
              {t('settings.models.shownOf', {
                shown: Math.min(listLimit, filteredAll.length),
                total: filteredAll.length,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* ── Katalog & keşif ── */}
      <div hidden={sub !== 'catalog'}>
        <div className="sec">
          <div className="sec-title">{t('settings.models.refreshSection')}</div>
          <div className="field-note mb-2">{t('settings.models.refreshNote')}</div>
          <span className="field-row mb-3">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                className="mini-btn"
                disabled={props.foundBusy !== null}
                title={t('settings.models.sourceNote', { source: t(s.labelKey) })}
                onClick={() => props.onRefresh(s.id)}
              >
                {props.foundBusy === s.id ? '…' : t(s.labelKey)}
              </button>
            ))}
          </span>
          {props.foundErr ? <div className="form-err">{props.foundErr}</div> : null}

          {props.found ? (
            isCatalog ? (
              <div className="mt-2">
                <div className="field-note mb-2">
                  {t('settings.models.catalogNote', { count: catalogRows.length })}
                </div>
                <span className="field-row mb-3">
                  <input
                    type="text"
                    className="input flex-2"
                    placeholder={t('settings.models.catalogSearchPlaceholder')}
                    value={query}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    className="input flex-1"
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value)}
                  >
                    <option value="">{t('settings.models.allProviders')}</option>
                    {catalogProviders.map((p) => (
                      <option key={p} value={p}>
                        {CATALOG_LABELS[p] ?? p}
                      </option>
                    ))}
                  </select>
                </span>
                <div className="field-note my-1">
                  {t('settings.models.resultsCount', { count: filteredCatalog.length })}
                  {filteredCatalog.length > 60 ? t('settings.models.firstSixty') : ''}
                </div>
                {filteredCatalog.length === 0 ? (
                  <div className="field-note">—</div>
                ) : (
                  filteredCatalog.slice(0, 60).map((m) => {
                    const c = m.catalog;
                    const title = [
                      c?.name,
                      c?.family,
                      c?.description,
                      c
                        ? t('settings.models.catalogCtxOut', {
                            ctx: fmtCtx(c.contextLimit),
                            out: fmtCtx(c.outputLimit),
                          })
                        : '',
                      c?.cost
                        ? `${t('settings.models.catalogCost', {
                            input: fmtUsd(c.cost.input),
                            output: fmtUsd(c.cost.output),
                          })}${
                            c.cost.cache_read !== undefined
                              ? t('settings.models.catalogCostCache', { cache: fmtUsd(c.cost.cache_read) })
                              : ''
                          }`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <span
                        key={`${m.source}:${m.id}`}
                        className="field-row mb-1"
                        title={title}
                      >
                        <span className="field-label flex-2 m-0">
                          {m.id}
                          <span className="caps inline">
                            <span className={c?.toolCall ? 'on' : ''} title={t('titlebar.capTools')}>
                              <Icon name="wrench" size="sm" />
                            </span>
                            <span
                              className={c?.modalities.input.includes('image') ? 'on' : ''}
                              title={t('titlebar.capVision')}
                            >
                              <Icon name="eye" size="sm" />
                            </span>
                            <span className={c?.reasoning ? 'on' : ''} title={t('titlebar.capReasoning')}>
                              <Icon name="spark" size="sm" />
                            </span>
                          </span>
                          {c?.family ? <span className="status-dim"> ({c.family})</span> : null}
                        </span>
                        <button
                          className="mini-btn"
                          disabled={view.all.some((a) => a.id === m.id)}
                          onClick={() => props.onAddDiscovered(m)}
                        >
                          {t('settings.models.addToList')}
                        </button>
                      </span>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="mt-2">
                <div className="field-note mb-1">
                  {t('settings.models.foundNote', { count: props.found.length })}
                </div>
                {props.found.length === 0 ? (
                  <div className="field-note">—</div>
                ) : (
                  props.found.slice(0, 30).map((m) => (
                    <span key={`${m.source}:${m.id}`} className="field-row mb-1">
                      <span className="field-label flex-1 m-0">
                        {m.id} <span className="status-dim">({m.source})</span>
                      </span>
                      <button
                        className="mini-btn"
                        disabled={view.all.some((a) => a.id === m.id)}
                        onClick={() => props.onAddDiscovered(m)}
                      >
                        {t('settings.models.addToList')}
                      </button>
                    </span>
                  ))
                )}
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* ── Elle ekle ── */}
      <div hidden={sub !== 'manual'}>
        <div className="sec">
          <div className="sec-title">{t('settings.models.addCustom')}</div>
          <div className="field-note mb-2">{t('settings.models.addCustomNote')}</div>

          <label className="field">
            <span className="field-label">{t('settings.models.addCustomId')}</span>
            <input
              type="text"
              className="input"
              value={newId}
              spellCheck={false}
              autoComplete="off"
              placeholder={t('settings.models.idPlaceholder')}
              onChange={(e) => setNewId(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">{t('settings.models.addCustomName')}</span>
            <input
              type="text"
              className="input"
              value={newName}
              spellCheck={false}
              autoComplete="off"
              placeholder={t('settings.models.addCustomNamePlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>

          <span className="field-row mb-3">
            <label className="field flex-1">
              <span className="field-label">{t('settings.models.addCustomProvider')}</span>
              <select
                className="input"
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value as Provider)}
              >
                {PROVIDER_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_DEFS[p]?.label ?? p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field flex-1">
              <span className="field-label">{t('settings.models.addCustomContext')}</span>
              <input
                type="number"
                className="input"
                min={0}
                step={1000}
                value={newContext}
                placeholder={t('settings.models.addCustomContextPlaceholder')}
                onChange={(e) => setNewContext(e.target.value)}
              />
            </label>
            <label className="field flex-1">
              <span className="field-label">{t('settings.models.addCustomMaxOutput')}</span>
              <input
                type="number"
                className="input"
                min={0}
                step={1000}
                value={newMaxOutput}
                placeholder={t('settings.models.addCustomMaxOutputPlaceholder')}
                onChange={(e) => setNewMaxOutput(e.target.value)}
              />
            </label>
          </span>

          <div className="field">
            <span className="field-label">{t('settings.models.addCustomCaps')}</span>
            <span className="field-row">
              {(['tools', 'vision', 'reasoning'] as const).map((k) => (
                <button
                  key={k}
                  className={`mini-btn${caps[k] ? ' on' : ''}`}
                  title={t('settings.models.capTitle', { cap: k })}
                  aria-pressed={caps[k]}
                  onClick={() => setCaps((c) => ({ ...c, [k]: !c[k] }))}
                >
                  <Icon name={k === 'tools' ? 'wrench' : k === 'vision' ? 'eye' : 'spark'} size="sm" />
                  {t('settings.models.capLabel', { cap: k })}
                </button>
              ))}
            </span>
          </div>

          <button className="mini-btn mt-2" onClick={addManual}>
            {t('common.add')}
          </button>
          {localErr ? <div className="form-err">{localErr}</div> : null}
        </div>

        {draft.customModels.length > 0 ? (
          <div className="sec">
            <div className="sec-title">{t('settings.models.customListTitle')}</div>
            {draft.customModels.map((c) => (
              <span key={c.id} className="field-row mb-1">
                <span className="field-label flex-1 m-0">
                  {c.name !== c.id ? `${c.name} · ` : ''}
                  {c.id}{' '}
                  <span className="status-dim">
                    {t('settings.models.customMarker', { provider: c.provider })}
                  </span>
                </span>
                <button className="mini-btn danger" onClick={() => props.onRemoveCustom(c.id)}>
                  {t('settings.models.remove')}
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {props.formError ? <div className="form-err">{props.formError}</div> : null}
    </div>
  );
}
