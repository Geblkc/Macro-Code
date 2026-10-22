import { useState } from 'react';
import { PROVIDER_DEFS, PROVIDER_IDS, getCapabilitiesForModel } from '../../lib/providers';
import { useT } from '../../lib/i18n';
import Segmented from '../Segmented';
import type { ModelParams } from '../../types';
import type { Draft } from './types';
import { filterModels, modelView } from './modelList';

interface Props {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  /** models.dev kataloğu yüklü mü (fiyat/metadata zenginleşmesi). */
  catalogLoaded: boolean;
  /** Katalog fiyatlarını (elle girilenler korunarak) uygula. */
  onApplyCatalogPrices: () => void;
}

/** Model parametreleri + yedek model + fiyat tablosu. */
export default function ParamsTab({
  draft,
  patch,
  catalogLoaded,
  onApplyCatalogPrices,
}: Props) {
  const t = useT();
  const [sub, setSub] = useState<'model' | 'prices'>('model');
  // Fiyat tablosu kendi arama/süzgecini kullanır (model listesinden bağımsız).
  const [priceQuery, setPriceQuery] = useState('');
  const [priceProvider, setPriceProvider] = useState('');
  const [priceLimit, setPriceLimit] = useState(60);

  const view = modelView(draft);
  const priceRows = filterModels(view.visible, priceQuery, priceProvider);

  const params = draft.modelParams[draft.currentModel] ?? {};
  const currentCaps =
    view.all.find((m) => m.id === draft.currentModel)?.capabilities ??
    getCapabilitiesForModel(draft.currentModel);

  const setParam = (k: keyof ModelParams, raw: string) => {
    const trimmed = raw.trim();
    const num = trimmed === '' ? undefined : Number(trimmed);
    const next = { ...params };
    if (num === undefined || !Number.isFinite(num)) delete next[k];
    else next[k] = num;
    const allParams = { ...draft.modelParams };
    if (Object.keys(next).length === 0) delete allParams[draft.currentModel];
    else allParams[draft.currentModel] = next;
    patch({ modelParams: allParams });
  };
  const numText = (v: number | undefined) => (v === undefined ? '' : String(v));
  const thinkingOn = (currentCaps?.reasoning ?? false) && params.thinkingBudget !== undefined;

  /** Seçili modelin parametrelerini temizler (sağlayıcı varsayılanına döner). */
  const resetParams = () => {
    const allParams = { ...draft.modelParams };
    delete allParams[draft.currentModel];
    patch({ modelParams: allParams });
  };

  const setPrice = (id: string, field: 'input' | 'output' | 'cacheRead', raw: string) => {
    const trimmed = raw.trim();
    const num = trimmed === '' ? undefined : Number(trimmed);
    const allPrices = { ...draft.prices };
    const row = { ...(allPrices[id] ?? { input: 0, output: 0 }) };
    if (num === undefined || !Number.isFinite(num) || num < 0) row[field] = 0;
    else row[field] = num;
    if (row.input === 0 && row.output === 0) delete allPrices[id];
    else allPrices[id] = row;
    patch({ prices: allPrices });
  };

  return (
    <div>
      <Segmented
        ariaLabel={t('settings.params.section')}
        value={sub}
        onChange={(id) => setSub(id as 'model' | 'prices')}
        items={[
          { id: 'model', label: t('settings.params.sub.model'), icon: 'sliders' },
          { id: 'prices', label: t('settings.params.sub.prices'), icon: 'coins' },
        ]}
      />

      <div hidden={sub !== 'model'}>
        <div className="sec">
          <div className="sec-title">{t('settings.params.modelSection')}</div>
          <div className="field-note mb-2">
            {t('settings.params.paramsNote', { model: draft.currentModel || '—' })}
          </div>

          <div className="field-row mb-3">
            <button className="mini-btn" onClick={resetParams} disabled={!draft.currentModel}>
              {t('settings.params.reset')}
            </button>
            <span className="status-dim">{t('settings.params.resetNote')}</span>
          </div>

          <span className="field-row">
            <label className="field flex-1">
              <span className="field-label">{t('settings.params.temperature')}</span>
              <input
                type="number"
                className="input"
                min={0}
                max={2}
                step={0.1}
                value={numText(params.temperature)}
                onChange={(e) => setParam('temperature', e.target.value)}
              />
            </label>
            <label className="field flex-1">
              <span className="field-label">{t('settings.params.topP')}</span>
              <input
                type="number"
                className="input"
                min={0}
                max={1}
                step={0.05}
                value={numText(params.topP)}
                disabled={thinkingOn}
                title={thinkingOn ? t('settings.params.topPDisabled') : undefined}
                onChange={(e) => setParam('topP', e.target.value)}
              />
            </label>
          </span>
          <span className="field-row">
            <label className="field flex-1">
              <span className="field-label">{t('settings.params.maxTokens')}</span>
              <input
                type="number"
                className="input"
                min={1}
                step={1}
                value={numText(params.maxTokens)}
                placeholder={t('settings.params.emptyDefault')}
                onChange={(e) => setParam('maxTokens', e.target.value)}
              />
            </label>
            <label className="field flex-1">
              <span className="field-label">{t('settings.params.thinkingBudget')}</span>
              <input
                type="number"
                className="input"
                min={1024}
                step={1024}
                value={numText(params.thinkingBudget)}
                disabled={!(currentCaps?.reasoning ?? false)}
                title={
                  currentCaps?.reasoning
                    ? t('settings.params.thinkingSupported')
                    : t('settings.params.thinkingOnly')
                }
                placeholder={t('settings.params.thinkingOff')}
                onChange={(e) => setParam('thinkingBudget', e.target.value)}
              />
            </label>
          </span>
        </div>

        <div className="sec">
          <div className="sec-title">{t('settings.params.fallback')}</div>
          <div className="field-note mb-2">{t('settings.params.fallbackNote')}</div>
          <label className="field">
            <span className="field-label">{t('settings.params.fallbackLabel')}</span>
            <select
              className="input"
              value={draft.fallbackModel}
              onChange={(e) => patch({ fallbackModel: e.target.value })}
            >
              <option value="">{t('settings.params.fallbackOff')}</option>
              {PROVIDER_IDS.map((p) => {
                const models = view.visible.filter(
                  (m) => m.provider === p && m.id !== draft.currentModel,
                );
                if (models.length === 0) return null;
                return (
                  <optgroup key={p} label={PROVIDER_DEFS[p]?.label ?? p}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
        </div>
      </div>

      <div hidden={sub !== 'prices'}>
        <div className="sec">
          <div className="sec-title">{t('settings.params.priceSection')}</div>
          <div className="field-note mb-2">{t('settings.params.priceNote')}</div>

          {catalogLoaded ? (
            <div className="field-row mb-3">
              <button className="mini-btn" onClick={onApplyCatalogPrices}>
                {t('settings.params.priceFill')}
              </button>
              <span className="status-dim">{t('settings.params.priceManualKept')}</span>
            </div>
          ) : null}

          <span className="field-row mb-3">
            <input
              type="text"
              className="input flex-2"
              placeholder={t('settings.params.priceSearchPlaceholder')}
              value={priceQuery}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setPriceQuery(e.target.value)}
            />
            <select
              className="input flex-1"
              value={priceProvider}
              onChange={(e) => setPriceProvider(e.target.value)}
            >
              <option value="">{t('settings.params.allProviders')}</option>
              {PROVIDER_IDS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_DEFS[p]?.label ?? p}
                </option>
              ))}
            </select>
          </span>

          <div className="price-head">
            <span className="price-head-model">{t('settings.params.column.model')}</span>
            <span>{t('settings.params.column.input')}</span>
            <span>{t('settings.params.column.output')}</span>
            <span>{t('settings.params.column.cache')}</span>
          </div>

          {priceRows.slice(0, priceLimit).map((m) => {
            const row = draft.prices[m.id];
            return (
              <span key={m.id} className="field-row mb-1">
                <span className="field-label flex-2 m-0">
                  {m.id}
                  {m.catalogPrice ? (
                    <span className="status-dim">{t('settings.params.priceCatalogMarker')}</span>
                  ) : null}
                </span>
                <input
                  type="number"
                  className="input flex-1"
                  min={0}
                  step={0.01}
                  title={t('settings.params.priceInputTitle')}
                  aria-label={t('settings.params.priceInputTitle')}
                  placeholder={t('settings.params.priceInput')}
                  value={row ? String(row.input) : ''}
                  onChange={(e) => setPrice(m.id, 'input', e.target.value)}
                />
                <input
                  type="number"
                  className="input flex-1"
                  min={0}
                  step={0.01}
                  title={t('settings.params.priceOutputTitle')}
                  aria-label={t('settings.params.priceOutputTitle')}
                  placeholder={t('settings.params.priceOutput')}
                  value={row ? String(row.output) : ''}
                  onChange={(e) => setPrice(m.id, 'output', e.target.value)}
                />
                <input
                  type="number"
                  className="input flex-1"
                  min={0}
                  step={0.01}
                  title={t('settings.params.priceCacheTitle')}
                  aria-label={t('settings.params.priceCacheTitle')}
                  placeholder={t('settings.params.priceCache')}
                  value={row && row.cacheRead !== undefined ? String(row.cacheRead) : ''}
                  onChange={(e) => setPrice(m.id, 'cacheRead', e.target.value)}
                />
              </span>
            );
          })}

          {priceRows.length === 0 ? (
            <div className="field-note">{t('settings.params.priceEmpty')}</div>
          ) : null}

          <div className="field-row mt-2">
            {priceRows.length > priceLimit ? (
              <button className="mini-btn" onClick={() => setPriceLimit((l) => l + 60)}>
                {t('settings.params.showMore')}
              </button>
            ) : null}
            <span className="status-dim">
              {t('settings.params.shownOf', {
                shown: Math.min(priceLimit, priceRows.length),
                total: priceRows.length,
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
