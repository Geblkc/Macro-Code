import { useMemo, useState } from 'react';
import {
  PROVIDER_DEFS,
  PROVIDER_IDS,
  getCapabilitiesForModel,
  hiddenProviders,
  isModelEnabled,
  resolveModels,
  visibleModels,
} from '../../lib/providers';
import ModelPicker from '../ModelPicker';
import { Icon } from '../icons';
import Switch from '../Switch';
import type {
  ApiKeys,
  CustomModel,
  DiscoveredModel,
  ModelCapabilities,
  ModelParams,
  Provider,
} from '../../types';
import type { Draft } from './types';

const EMPTY_KEYS: ApiKeys = {
  anthropic: '',
  openai: '',
  gemini: '',
  ollamaUrl: '',
  openrouter: '',
  deepseek: '',
  xai: '',
};

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
  /** models.dev kataloğu yüklü mü (fiyat/metadata zenginleşmesi). */
  catalogLoaded: boolean;
  /** Katalog fiyatlarını (elle girilenler korunarak) uygula. */
  onApplyCatalogPrices: () => void;
  /** Sağlayıcılar sekmesine geç (anahtar eklemek için). */
  onOpenProviders: () => void;
  formError: string | null;
}

const SOURCES: { id: DiscoveredModel['source']; label: string }[] = [
  { id: 'openrouter', label: 'OpenRouter kataloğu' },
  { id: 'ollama', label: 'Kurulu Ollama modelleri' },
  { id: 'openai', label: 'OpenAI listesi' },
  { id: 'gemini', label: 'Gemini listesi' },
  { id: 'modelsDev', label: 'models.dev kataloğu' },
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

export default function ModelsTab(props: Props) {
  const { draft, patch } = props;
  const [newId, setNewId] = useState('');
  const [newProvider, setNewProvider] = useState<Provider>('openai');
  const [caps, setCaps] = useState<ModelCapabilities>({ tools: true, vision: false, reasoning: false });
  const [localErr, setLocalErr] = useState<string | null>(null);
  // models.dev keşif paneli
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  // model listesi (varsayılan model / açık-kapalı / fiyat) filtreleri
  const [listQuery, setListQuery] = useState('');
  const [listProvider, setListProvider] = useState('');

  const all = resolveModels(draft.customModels);
  // API anahtarı olmayan sağlayıcının modelleri listelenmez.
  const keyed = useMemo(() => {
    const keys = { ...EMPTY_KEYS } as ApiKeys;
    for (const p of PROVIDER_IDS) {
      if (p === 'ollama') continue;
      const sec = draft.secrets[p];
      keys[p] = sec && !sec.deleted ? sec.value.trim() || sec.hint : '';
    }
    return keys;
  }, [draft.secrets]);
  const visible = useMemo(() => visibleModels(all, keyed), [all, keyed]);
  const locked = useMemo(() => hiddenProviders(all, keyed), [all, keyed]);

  // Liste filtresi (yüzlerce model → arama gerekli).
  const filteredAll = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return visible.filter((m) => {
      if (listProvider && m.provider !== listProvider) return false;
      if (!q) return true;
      const haystack = `${m.id} ${m.name} ${m.description ?? ''} ${m.family ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [visible, listQuery, listProvider]);

  const currentDisabled =
    draft.currentModel !== '' && !isModelEnabled(draft.disabledModels, draft.currentModel);
  const modelKnown = all.some((m) => m.id === draft.currentModel);
  const currentCaps = all.find((m) => m.id === draft.currentModel)?.capabilities;

  // Varsayılan model seçimi: filtreli liste + seçili model her zaman görünür.
  const selectModels = useMemo(() => {
    const list = [...filteredAll];
    if (draft.currentModel && !list.some((m) => m.id === draft.currentModel)) {
      const cur = all.find((m) => m.id === draft.currentModel);
      if (cur) list.unshift(cur);
    }
    return list;
  }, [filteredAll, draft.currentModel, all]);

  // models.dev keşfi diğer kaynaklardan farklı: yüzlerce model → arama/filtre.
  const catalogRows = useMemo(
    () => (props.found ?? []).filter((m) => m.source === 'modelsDev'),
    [props.found],
  );
  const isCatalog = catalogRows.length > 0;
  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogRows.filter((m) => {
      if (providerFilter && m.catalog?.provider !== providerFilter) return false;
      if (!q) return true;
      const c = m.catalog;
      const haystack = `${m.id} ${c?.name ?? ''} ${c?.description ?? ''} ${c?.family ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [catalogRows, query, providerFilter]);
  const catalogProviders = useMemo(
    () => [...new Set(catalogRows.map((m) => m.catalog?.provider ?? ''))].filter(Boolean).sort(),
    [catalogRows],
  );

  const addManual = () => {
    const id = newId.trim();
    if (!id) {
      setLocalErr('model id boş olamaz');
      return;
    }
    if (all.some((m) => m.id === id)) {
      setLocalErr(`“${id}” zaten listede`);
      return;
    }
    props.onAddCustom({ id, provider: newProvider, name: id, capabilities: { ...caps } });
    setNewId('');
    setLocalErr(null);
  };

  const params = draft.modelParams[draft.currentModel] ?? {};
  const setParam = (k: keyof ModelParams, raw: string) => {
    const t = raw.trim();
    const num = t === '' ? undefined : Number(t);
    const next = { ...params };
    if (num === undefined || !Number.isFinite(num)) delete next[k];
    else next[k] = num;
    const allParams = { ...draft.modelParams };
    if (Object.keys(next).length === 0) delete allParams[draft.currentModel];
    else allParams[draft.currentModel] = next;
    patch({ modelParams: allParams });
  };
  const numText = (v: number | undefined) => (v === undefined ? '' : String(v));
  const thinkingOn =
    (currentCaps?.reasoning ?? false) && params.thinkingBudget !== undefined;

  const setPrice = (id: string, field: 'input' | 'output' | 'cacheRead', raw: string) => {
    const t = raw.trim();
    const num = t === '' ? undefined : Number(t);
    const allPrices = { ...draft.prices };
    const row = { ...(allPrices[id] ?? { input: 0, output: 0 }) };
    if (num === undefined || !Number.isFinite(num) || num < 0) {
      row[field] = 0;
    } else {
      row[field] = num;
    }
    if (row.input === 0 && row.output === 0) delete allPrices[id];
    else allPrices[id] = row;
    patch({ prices: allPrices });
  };

  return (
    <div>
      <div className="sec">
        <div className="sec-title">
          Modeller
          <span className="chip on">{filteredAll.length} / {visible.length}</span>
        </div>
      <div className="field-note mb-2">
        API anahtarı olmayan sağlayıcının modelleri listelenmez. Aramak için yazın ya da
        sağlayıcıya göre süzün.
      </div>
      <span className="field-row mb-3">
        <input
          type="text"
          className="input flex-2"
          placeholder="model ara (id, ad, aile)…"
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
          <option value="">tüm sağlayıcılar</option>
          {PROVIDER_IDS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_DEFS[p]?.label ?? p}
            </option>
          ))}
        </select>
      </span>
      {locked.length > 0 ? (
        <div className="mb-3">
          {locked.map((p) => (
            <span key={p} className="field-row mb-1">
              <span className="field-label flex-1 m-0">
                <Icon name="key" size="sm" /> {PROVIDER_DEFS[p]?.label ?? p} — anahtar girilmedi
              </span>
              <button className="mini-btn" onClick={props.onOpenProviders}>
                anahtar ekle
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Sağlayıcı</th>
              <th>Yetenek</th>
              <th className="num">Bağlam</th>
              <th className="num">Fiyat /1M</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredAll.slice(0, 200).map((m) => {
              const caps = getCapabilitiesForModel(m.id) ?? m.capabilities;
              const price = draft.prices[m.id];
              const on = isModelEnabled(draft.disabledModels, m.id);
              return (
                <tr key={m.id}>
                  <td className="m">{m.id}</td>
                  <td>{PROVIDER_DEFS[m.provider]?.label ?? m.provider}</td>
                  <td>
                    <span className="caps">
                      <span className={caps?.tools ? 'on' : ''} title="tools">
                        <Icon name="wrench" size="sm" />
                      </span>
                      <span className={caps?.vision ? 'on' : ''} title="görsel">
                        <Icon name="eye" size="sm" />
                      </span>
                      <span className={caps?.reasoning ? 'on' : ''} title="reasoning">
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
                      label={`${m.id} aç / kapat`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filteredAll.length > 200 ? (
        <div className="field-note">
          İlk 200 model gösteriliyor — aramayı ya da sağlayıcı süzgecini daraltın.
        </div>
      ) : null}
      </div>

      <div className="modal-section-title">Varsayılan model</div>
      {draft.activeEndpointId ? (
        <div className="field-note mb-2">
          Özel uç aktif — aşağıdaki liste yerleşik modeller içindir. Uç modelini
          Sağlayıcılar sekmesinden seç.
        </div>
      ) : null}
      <label className="field">
        <span className="field-label">Model</span>
        <ModelPicker
          value={draft.currentModel}
          models={selectModels}
          extraValue={!modelKnown || currentDisabled ? draft.currentModel : undefined}
          placeholder="model ara veya yaz…"
          onChange={(v) => patch({ currentModel: v, activeEndpointId: null })}
        />
      </label>
      {currentDisabled ? (
        <div className="form-err">seçili model kapalı — listeden açabilirsin.</div>
      ) : null}

      <div className="modal-section-title">Listeyi yenile</div>
      <span className="field-row">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            className="mini-btn"
            disabled={props.foundBusy !== null}
            title={`${s.label} — bulunanlar otomatik eklenmez`}
            onClick={() => props.onRefresh(s.id)}
          >
            {props.foundBusy === s.id ? '…' : s.label}
          </button>
        ))}
      </span>
      {props.foundErr ? <div className="form-err">{props.foundErr}</div> : null}
      {props.found ? (
        isCatalog ? (
          <div className="mt-2">
            <div className="field-note mb-1">
              models.dev kataloğu ({catalogRows.length} model) — arama, filtrele ve
              listeye ekle:
            </div>
            <span className="field-row">
              <input
                type="text"
                className="input flex-2"
                placeholder="id, ad, açıklama veya aile ara…"
                value={query}
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="input flex-1"
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
              >
                <option value="">tüm sağlayıcılar</option>
                {catalogProviders.map((p) => (
                  <option key={p} value={p}>
                    {CATALOG_LABELS[p] ?? p}
                  </option>
                ))}
              </select>
            </span>
            <div className="field-note my-1">
              {filteredCatalog.length} sonuç
              {filteredCatalog.length > 60 ? ' (ilk 60 gösteriliyor)' : ''}
            </div>
            {filteredCatalog.length === 0 ? (
              <div className="field-note">—</div>
            ) : (
              filteredCatalog.slice(0, 60).map((m) => {
                const c = m.catalog;
                const badges = c
                  ? `${c.toolCall ? '🛠' : ''}${
                      c.modalities.input.includes('image') ? '👁' : ''
                    }${c.reasoning ? '🧠' : ''}`
                  : '';
                const title = [
                  c?.name,
                  c?.family,
                  c?.description,
                  c ? `${fmtCtx(c.contextLimit)} ctx · ${fmtCtx(c.outputLimit)} çıktı` : '',
                  c?.cost
                    ? `${fmtUsd(c.cost.input)} giriş · ${fmtUsd(c.cost.output)} çıktı${
                        c.cost.cache_read !== undefined
                          ? ` · ${fmtUsd(c.cost.cache_read)} cache`
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
                      {m.id} {badges}
                      {c?.family ? (
                        <span className="status-dim"> ({c.family})</span>
                      ) : null}
                    </span>
                    <button
                      className="mini-btn"
                      disabled={all.some((a) => a.id === m.id)}
                      onClick={() => props.onAddDiscovered(m)}
                    >
                      ekle
                    </button>
                  </span>
                );
              })
            )}
          </div>
        ) : (
          <div className="mt-2">
            <div className="field-note mb-1">
              bulunanlar ({props.found.length}) — ekle ile listeye alınır:
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
                    disabled={all.some((a) => a.id === m.id)}
                    onClick={() => props.onAddDiscovered(m)}
                  >
                    ekle
                  </button>
                </span>
              ))
            )}
          </div>
        )
      ) : null}

      <div className="modal-section-title">Elle model ekle</div>
      <label className="field">
        <span className="field-label">Model id</span>
        <input
          type="text"
          className="input"
          value={newId}
          spellCheck={false}
          autoComplete="off"
          placeholder="örn: claude-sonnet-6-0"
          onChange={(e) => setNewId(e.target.value)}
        />
      </label>
      <span className="field-row">
        <select
          className="input"
          value={newProvider}
          onChange={(e) => setNewProvider(e.target.value as Provider)}
        >
          {PROVIDER_IDS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {(['tools', 'vision', 'reasoning'] as const).map((k) => (
          <button
            key={k}
            className="mini-btn"
            title={`${k} yeteneği`}
            onClick={() => setCaps((c) => ({ ...c, [k]: !c[k] }))}
          >
            {caps[k] ? `${k}✓` : k}
          </button>
        ))}
        <button className="mini-btn" onClick={addManual}>
          ekle
        </button>
      </span>
      {localErr ? <div className="form-err">{localErr}</div> : null}
      {draft.customModels.length > 0 ? (
        <div className="mt-2">
          {draft.customModels.map((c) => (
            <span key={c.id} className="field-row mb-1">
              <span className="field-label flex-1 m-0">
                {c.id} <span className="status-dim">({c.provider}, özel)</span>
              </span>
              <button className="mini-btn danger" onClick={() => props.onRemoveCustom(c.id)}>
                kaldır
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {props.formError ? <div className="form-err">{props.formError}</div> : null}

      <div className="modal-section-title">Model parametreleri</div>
      <div className="field-note mb-2">
        Seçili varsayılan model için (<code>{draft.currentModel || '—'}</code>). Boş = sağlayıcı
        varsayılanı gönderilir.
      </div>
      <span className="field-row">
        <label className="field flex-1">
          <span className="field-label">temperature (0–2)</span>
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
          <span className="field-label">top_p (0–1)</span>
          <input
            type="number"
            className="input"
            min={0}
            max={1}
            step={0.05}
            value={numText(params.topP)}
            disabled={thinkingOn}
            title={thinkingOn ? 'düşünme açıkken top_p gönderilmez' : undefined}
            onChange={(e) => setParam('topP', e.target.value)}
          />
        </label>
      </span>
      <span className="field-row">
        <label className="field flex-1">
          <span className="field-label">max çıktı token</span>
          <input
            type="number"
            className="input"
            min={1}
            step={1}
            value={numText(params.maxTokens)}
            placeholder="boş = model varsayılanı"
            onChange={(e) => setParam('maxTokens', e.target.value)}
          />
        </label>
        <label className="field flex-1">
          <span className="field-label">düşünme bütçesi</span>
          <input
            type="number"
            className="input"
            min={1024}
            step={1024}
            value={numText(params.thinkingBudget)}
            disabled={!(currentCaps?.reasoning ?? false)}
            title={
              currentCaps?.reasoning
                ? 'destekleyen modelde düşünme açılır (temperature 1 olur)'
                : 'yalnızca reasoning rozetli modelde'
            }
            placeholder="boş = kapalı"
            onChange={(e) => setParam('thinkingBudget', e.target.value)}
          />
        </label>
      </span>

      <div className="modal-section-title">Yedek model</div>
      <div className="field-note mb-2">
        Asıl model hata verirse sohbette bir kez denenir. Ajan ve özel uç akışında
        çalışmaz. Farklı bir sağlayıcıdan da seçebilirsin — istek o sağlayıcının
        uçuna, kendi anahtarıyla gider; anahtarı yoksa yedek atlanır.
      </div>
      <label className="field">
        <span className="field-label">Yedek</span>
        <select
          className="input"
          value={draft.fallbackModel}
          onChange={(e) => patch({ fallbackModel: e.target.value })}
        >
          <option value="">kapalı</option>
          {PROVIDER_IDS.map((p) => {
            const models = selectModels.filter(
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

      <div className="modal-section-title">Fiyat tablosu (1M token/USD)</div>
      <div className="field-note mb-2">
        <code>/tokens</code> maliyeti buradan hesaplar. Boş satırlar sayılmaz.
        models.dev kataloğu yüklüyse fiyatlar otomatik dolar; elle girdiğin
        değerler korunur. <strong>cache</strong> sütunu önbellek okuma fiyatıdır
        (boş = girdi fiyatı).
      </div>
      {props.catalogLoaded ? (
        <div className="field-row mb-2">
          <button className="mini-btn" onClick={props.onApplyCatalogPrices}>
            eksik fiyatları katalogdan doldur
          </button>
          <span className="status-dim">elle girilenler ezilmez</span>
        </div>
      ) : null}
      {filteredAll.slice(0, 120).map((m) => {
        const row = draft.prices[m.id];
        return (
          <span key={m.id} className="field-row mb-1">
            <span className="field-label flex-2 m-0">
              {m.id}
              {m.catalogPrice ? <span className="status-dim"> (katalog)</span> : null}
            </span>
            <input
              type="number"
              className="input flex-1"
              min={0}
              step={0.01}
              title="girdi / 1M"
              placeholder="girdi"
              value={row ? String(row.input) : ''}
              onChange={(e) => setPrice(m.id, 'input', e.target.value)}
            />
            <input
              type="number"
              className="input flex-1"
              min={0}
              step={0.01}
              title="çıktı / 1M"
              placeholder="çıktı"
              value={row ? String(row.output) : ''}
              onChange={(e) => setPrice(m.id, 'output', e.target.value)}
            />
            <input
              type="number"
              className="input flex-1"
              min={0}
              step={0.01}
              title="cache okuma / 1M (boş = girdi fiyatı)"
              placeholder="cache"
              value={row && row.cacheRead !== undefined ? String(row.cacheRead) : ''}
              onChange={(e) => setPrice(m.id, 'cacheRead', e.target.value)}
            />
          </span>
        );
      })}

      {filteredAll.length > 120 ? (
        <div className="field-note mb-1">
          ilk 120 satır gösteriliyor — daraltmak için ara/sağlayıcı seç.
        </div>
      ) : null}

      <div className="modal-section-title">Modeller (açık/kapalı)</div>
      <div className="field-note mb-2">
        Kapalı modeller açılır listelerde gizlenir; seçili rozet korunur.
      </div>
      {filteredAll.slice(0, 120).map((m) => {
        const on = isModelEnabled(draft.disabledModels, m.id);
        const isCustom = draft.customModels.some((c) => c.id === m.id);
        const meta = [
          m.description,
          m.family,
          m.releaseDate,
          m.capabilities.tools ? 'tools' : 'no-tools',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <span key={m.id} className="field-row mb-1" title={meta}>
            <span className="field-label flex-1 m-0">
              {m.id}
              {isCustom ? ' (özel)' : ''}
              {m.family && !isCustom ? <span className="status-dim"> ({m.family})</span> : null}
            </span>
            <button
              className="mini-btn"
              title={on ? 'listelerden gizle' : 'listelerde göster'}
              onClick={() => props.onToggleModel(m.id)}
            >
              {on ? 'açık' : 'kapalı'}
            </button>
          </span>
        );
      })}
    </div>
  );
}
