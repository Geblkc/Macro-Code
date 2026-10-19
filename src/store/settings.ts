import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { ApiKeys, CustomEndpoint, CustomModel, DiscoveredModel, McpServerConfig, Model, ModelParams, ModelPrice, ModelsDevCatalog, Provider } from '../types';
import { ALL_MODELS, PROVIDER_DEFS, PROVIDER_IDS, toRegistryModel } from '../lib/providers';
import { buildCatalogIndex, catalogPriceOf, matchCatalogEntry, setActiveCatalog } from '../lib/providers/catalog';
import { fetchModelsDevCatalog, loadCachedCatalog, saveCachedCatalog } from '../lib/providers/modelsDev';
import { isTauri } from '../lib/tauri';

export { isTauri };

export const DEFAULT_MODELS: Record<Provider, string> = Object.fromEntries(
  PROVIDER_IDS.map((p) => [p, PROVIDER_DEFS[p].defaultModel]),
) as Record<Provider, string>;

const EMPTY_KEYS: ApiKeys = {
  anthropic: '',
  openai: '',
  gemini: '',
  ollamaUrl: 'http://localhost:11434',
  openrouter: '',
  deepseek: '',
  xai: '',
};

/** Provider -> keystore anahtar adi (`ollama` URL saklar). */
export function storeKeyOf(provider: Provider): string {
  return provider === 'ollama' ? 'ollamaUrl' : provider;
}

/** Provider -> ApiKeys alani. */
export function fieldOf(provider: Provider): keyof ApiKeys {
  return provider === 'ollama' ? 'ollamaUrl' : (provider as keyof ApiKeys);
}

export function providerNeedsKey(provider: Provider): boolean {
  return PROVIDER_DEFS[provider]?.needsKey ?? true;
}

interface SettingsStore {
  apiKeys: ApiKeys;
  currentProvider: Provider;
  currentModel: string;
  systemPrompt: string;
  fontSize: number;
  /** key_status sonucu: hangi saglayici bagli (deger degil, var/yok). */
  keyStatus: Record<Provider, boolean>;
  /** Yerleşik sağlayıcıda özel taban URL (proxy/Azure-benzeri uçlar). */
  baseUrlOverride: Partial<Record<Provider, string>>;
  /** OpenAI-uyumlu özel uçlar (metadata; secret HARİÇ — persist edilir). */
  customEndpoints: CustomEndpoint[];
  /** Aktif özel uç id'si; null = yerleşik sağlayıcı akışı. */
  activeEndpointId: string | null;
  /** Özel uç secret'ları — SADECE bellek. Persist'e yazılmaz (bkz. partialize). */
  customSecrets: Record<string, string>;
  /** Elle eklenen modeller (registry ile birleştirilir, çakışırsa custom kazanır). */
  customModels: CustomModel[];
  /** Açılır listelerde gizlenen model id'leri (seçili rozet korunur). */
  disabledModels: string[];
  /** Model başına istek parametreleri (boş = sağlayıcı varsayılanı). */
  modelParams: Record<string, ModelParams>;
  /** Yedek model id'si (boş = kapalı; sohbet akışında tek retry). */
  fallbackModel: string;
  /** 1M token başına USD fiyatı (girdi/çıktı); eksikse maliyet hesaplanmaz. */
  prices: Record<string, ModelPrice>;
  /** API'den keşfedilen, henüz eklenmemiş modeller. */
  discovered: DiscoveredModel[];
  /**
   * models.dev kataloğu (bellekte tutulur, persist EDİLMEZ — 500+ model).
   * Yerleşik modellerin metadata'sını zenginleştirir ve katalog fiyatlarını
   * `prices` tablosunu otomatik doldurmak için kaynak olur.
   */
  modelsDevCatalog: ModelsDevCatalog | null;
  /** Faz 2 (K4): özetleyici sağlayıcı — boş = aktif sağlayıcı. */
  summarizerProvider: Provider | '';
  /** Faz 2 (K4): özetleyici model — boş = aktif model. */
  summarizerModel: string;
  /** Faz 4: reasoning/thinking bloğunu terminalde göster (default true). */
  showThinking: boolean;
  /**
   * Faz 11: prompt cache (önbellek) — sağlayıcı tarafında önek önbelleğe alınır,
   * maliyet düşer (varsayılan açık; kapalıysa `cache_control` gönderilmez).
   */
  cachePrompts: boolean;
  /** Faz 5: MCP sunucuları (metadata; secret HARİÇ — persist edilir). */
  mcpServers: McpServerConfig[];
  /** MCP env değerleri — SADECE bellek. Persist'e yazılmaz (bkz. partialize). */
  mcpSecrets: Record<string, Record<string, string>>;
  /** Faz 6: kullanıcı shell uzantıları ("docker ps" satırları). */
  customAllowList: string[];
  /** Faz 6: denetim kaydı tutulsun mu (default true). */
  auditEnabled: boolean;
  /** Görünüm: yüksek kontrast paleti (token override). */
  contrast: ContrastMode;
  /** Görünüm: arayüz kabuğunun fontu (monospace ↔ Inter). */
  uiFont: UiFontMode;
  /** Görünüm: saat biçimi (terminal zaman damgaları). */
  clockFormat: ClockFormat;
  /** Görünüm: sidebar genişliği (px). */
  sidebarWidth: number;
  /** Görünüm: sidebar daraltılmış mı (ikon rayı). */
  sidebarCollapsed: boolean;

  setApiKey: (provider: Provider, key: string) => void;
  setProvider: (provider: Provider) => void;
  setModel: (model: string) => void;
  setSystemPrompt: (prompt: string) => void;
  setFontSize: (size: number) => void;
  setBaseUrlOverride: (provider: Provider, url: string) => void;
  setCustomEndpoints: (list: CustomEndpoint[]) => void;
  setCustomSecret: (id: string, key: string) => void;
  clearCustomSecret: (id: string) => void;
  setActiveEndpoint: (id: string | null) => void;
  setCustomModels: (list: CustomModel[]) => void;
  toggleModel: (id: string) => void;
  setModelParams: (id: string, params: ModelParams) => void;
  setFallbackModel: (id: string) => void;
  setPrice: (id: string, price: ModelPrice) => void;
  /** Fiyat tablosunu toplu güncelle (katalog fiyatlarını uygular). */
  setPrices: (prices: Record<string, ModelPrice>) => void;
  setDiscovered: (list: DiscoveredModel[]) => void;
  /** models.dev kataloğunu yükle (global katalog da güncellenir). */
  setModelsDevCatalog: (catalog: ModelsDevCatalog | null) => void;
  /** models.dev kataloğunu önbellekten yükle (boot; ağ trafiği üretmez). */
  loadModelsDevCatalog: () => void;
  /** models.dev kataloğunu ağdan yenile — fiyatlar otomatik dolar. */
  refreshModelsDevCatalog: (fetchImpl?: typeof fetch) => Promise<ModelsDevCatalog>;
  setSummarizerProvider: (p: Provider | '') => void;
  setSummarizerModel: (id: string) => void;
  setShowThinking: (v: boolean) => void;
  /** Faz 11: prompt cache açık/kapalı. */
  setCachePrompts: (v: boolean) => void;
  setMcpServers: (list: McpServerConfig[]) => void;
  setMcpEnv: (serverId: string, env: Record<string, string>) => void;
  clearMcpEnv: (serverId: string) => void;
  setCustomAllowList: (list: string[]) => void;
  setAuditEnabled: (v: boolean) => void;
  setContrast: (v: ContrastMode) => void;
  setUiFont: (v: UiFontMode) => void;
  setClockFormat: (v: ClockFormat) => void;
  setSidebarWidth: (px: number) => void;
  setSidebarCollapsed: (v: boolean) => void;
  loadFromStore: () => Promise<void>;
  saveToStore: () => Promise<void>;
}

const noopStorage = {
  getItem: (_name: string): string | null => null,
  setItem: (_name: string, _value: string): void => {},
  removeItem: (_name: string): void => {},
};

const EMPTY_STATUS = Object.fromEntries(PROVIDER_IDS.map((p) => [p, false])) as Record<Provider, boolean>;

/* ── Görünüm tipleri ── */

/** Yüksek kontrast paleti. */
export type ContrastMode = 'normal' | 'high';
/** Arayüz kabuğu fontu. */
export type UiFontMode = 'mono' | 'inter';
/** Saat biçimi (terminal zaman damgaları). */
export type ClockFormat = '24h' | '12h';

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 240;

/** Sidebar genişliğini güvenli aralığa sıkıştır. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_DEFAULT;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)));
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      apiKeys: { ...EMPTY_KEYS },
      currentProvider: 'anthropic',
      currentModel: DEFAULT_MODELS.anthropic,
      systemPrompt: '',
      fontSize: 13,
      keyStatus: { ...EMPTY_STATUS },
      baseUrlOverride: {},
      customEndpoints: [],
      activeEndpointId: null,
      customSecrets: {},
      customModels: [],
      disabledModels: [],
      modelParams: {},
      fallbackModel: '',
      prices: {},
      discovered: [],
      modelsDevCatalog: null,
      summarizerProvider: '',
      summarizerModel: '',
      showThinking: true,
      cachePrompts: true,
      mcpServers: [],
      mcpSecrets: {},
      customAllowList: [],
      auditEnabled: true,
      contrast: 'normal',
      uiFont: 'mono',
      clockFormat: '24h',
      sidebarWidth: SIDEBAR_DEFAULT,
      sidebarCollapsed: false,

      setApiKey: (provider, key) => {
        const field = fieldOf(provider);
        set((s) => ({ apiKeys: { ...s.apiKeys, [field]: key } }));
        // Kalici yazma arka planda; hata sessizce yoksayilir (boot'ta tekrar denenecek).
        void get().saveToStore().catch(() => {});
      },

      setProvider: (provider) =>
        set({ currentProvider: provider, currentModel: DEFAULT_MODELS[provider] }),

      setModel: (model) => set({ currentModel: model }),

      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),

      setFontSize: (size) =>
        set({ fontSize: Math.min(20, Math.max(10, Math.round(size))) }),

      setBaseUrlOverride: (provider, url) =>
        set((s) => {
          const next = { ...s.baseUrlOverride };
          if (url.trim()) next[provider] = url.trim();
          else delete next[provider];
          return { baseUrlOverride: next };
        }),

      setCustomEndpoints: (list) => set({ customEndpoints: list }),

      setCustomSecret: (id, key) =>
        set((s) => ({ customSecrets: { ...s.customSecrets, [id]: key } })),

      clearCustomSecret: (id) =>
        set((s) => {
          if (!(id in s.customSecrets)) return s;
          const next = { ...s.customSecrets };
          delete next[id];
          return { customSecrets: next };
        }),

      setActiveEndpoint: (id) => set({ activeEndpointId: id }),

      setCustomModels: (list) => set({ customModels: list }),

      toggleModel: (id) =>
        set((s) => ({
          disabledModels: s.disabledModels.includes(id)
            ? s.disabledModels.filter((m) => m !== id)
            : [...s.disabledModels, id],
        })),

      setModelParams: (id, params) =>
        set((s) => {
          const cleaned: ModelParams = {};
          if (params.temperature !== undefined && Number.isFinite(params.temperature)) {
            cleaned.temperature = params.temperature;
          }
          if (params.maxTokens !== undefined && Number.isFinite(params.maxTokens) && params.maxTokens > 0) {
            cleaned.maxTokens = Math.floor(params.maxTokens);
          }
          if (params.topP !== undefined && Number.isFinite(params.topP)) {
            cleaned.topP = params.topP;
          }
          if (
            params.thinkingBudget !== undefined &&
            Number.isFinite(params.thinkingBudget) &&
            params.thinkingBudget > 0
          ) {
            cleaned.thinkingBudget = Math.floor(params.thinkingBudget);
          }
          const next = { ...s.modelParams };
          if (Object.keys(cleaned).length === 0) delete next[id];
          else next[id] = cleaned;
          return { modelParams: next };
        }),

      setFallbackModel: (id) => set({ fallbackModel: id }),

      setPrice: (id, price) =>
        set((s) => {
          const valid =
            Number.isFinite(price.input) &&
            Number.isFinite(price.output) &&
            price.input >= 0 &&
            price.output >= 0;
          const next = { ...s.prices };
          if (!valid || (price.input === 0 && price.output === 0)) delete next[id];
          else {
            const row: ModelPrice = { input: price.input, output: price.output };
            if (price.cacheRead !== undefined) row.cacheRead = price.cacheRead;
            if (price.cacheWrite !== undefined) row.cacheWrite = price.cacheWrite;
            next[id] = row;
          }
          return { prices: next };
        }),

      setPrices: (prices) => set({ prices: { ...prices } }),

      setDiscovered: (list) => set({ discovered: list }),

      setModelsDevCatalog: (catalog) => {
        // Global katalog: `resolveModels`/`getModel` zenginleştirmeyi bundan okur.
        setActiveCatalog(catalog);
        set((s) => {
          const next = { ...s.prices };
          if (catalog) {
            const index = buildCatalogIndex(catalog);
            const candidates: Model[] = [
              ...ALL_MODELS,
              ...s.customModels.map((c) => toRegistryModel(c)),
            ];
            for (const m of candidates) {
              // Elle girilmiş fiyat KAZANIR (katalog onu ezmaz).
              if (next[m.id]) continue;
              const price = catalogPriceOf(matchCatalogEntry(m, index));
              if (price) next[m.id] = price;
            }
          }
          return { modelsDevCatalog: catalog, prices: next };
        });
      },

      loadModelsDevCatalog: () => {
        const cached = loadCachedCatalog();
        if (cached) get().setModelsDevCatalog(cached);
      },

      refreshModelsDevCatalog: async (fetchImpl) => {
        const catalog = await fetchModelsDevCatalog(fetchImpl);
        saveCachedCatalog(catalog);
        get().setModelsDevCatalog(catalog);
        return catalog;
      },

      setSummarizerProvider: (p) => set({ summarizerProvider: p }),

      setSummarizerModel: (id) => set({ summarizerModel: id }),

      setShowThinking: (v) => set({ showThinking: v }),

      setCachePrompts: (v) => set({ cachePrompts: v }),

      setMcpServers: (list) => set({ mcpServers: list }),

      setMcpEnv: (serverId, env) =>
        set((s) => ({ mcpSecrets: { ...s.mcpSecrets, [serverId]: { ...env } } })),

      clearMcpEnv: (serverId) =>
        set((s) => {
          if (!(serverId in s.mcpSecrets)) return s;
          const next = { ...s.mcpSecrets };
          delete next[serverId];
          return { mcpSecrets: next };
        }),

      setCustomAllowList: (list) =>
        set({
          customAllowList: [...new Set(list.map((s) => s.trim()).filter(Boolean))],
        }),

      setAuditEnabled: (v) => set({ auditEnabled: v }),

      setContrast: (v) => set({ contrast: v }),
      setUiFont: (v) => set({ uiFont: v }),
      setClockFormat: (v) => set({ clockFormat: v }),
      setSidebarWidth: (px) => set({ sidebarWidth: clampSidebarWidth(px) }),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      loadFromStore: async () => {
        if (!isTauri()) return;
        const next: Partial<ApiKeys> = {};
        for (const p of PROVIDER_IDS) {
          try {
            const value = await invoke<string>('get_api_key', {
              provider: storeKeyOf(p),
            });
            if (value) next[fieldOf(p)] = value;
          } catch {
            // Tek saglayici hatasi digerlerini engellemez.
          }
        }
        if (Object.keys(next).length > 0) {
          set((s) => ({ apiKeys: { ...s.apiKeys, ...next } }));
        }
        // Özel uç secret'ları: metadata persist'ten gelir, değerler keystore'dan.
        try {
          const secrets: Record<string, string> = {};
          for (const ep of get().customEndpoints) {
            try {
              const value = await invoke<string>('get_api_key', { provider: ep.id });
              if (value) secrets[ep.id] = value;
            } catch {
              // Tek uç hatası diğerlerini engellemez.
            }
          }
          if (Object.keys(secrets).length > 0) {
            set((s) => ({ customSecrets: { ...s.customSecrets, ...secrets } }));
          }
        } catch {
          // Secret yüklenemezse sessiz geç (boot mesajı genel uyarı gösterir).
        }
        // MCP env değerleri: metadata persist'ten gelir, değerler keystore'dan.
        // Anahtar adı `custom_<serverId>` (custom_ öneki keystore kuralına uyar).
        try {
          const envs: Record<string, Record<string, string>> = {};
          for (const srv of get().mcpServers) {
            try {
              const raw = await invoke<string>('get_api_key', { provider: `custom_${srv.id}` });
              if (raw.trim()) {
                const parsed = JSON.parse(raw) as unknown;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  envs[srv.id] = parsed as Record<string, string>;
                }
              }
            } catch {
              // Tek sunucu hatası diğerlerini engellemez.
            }
          }
          if (Object.keys(envs).length > 0) {
            set((s) => ({ mcpSecrets: { ...s.mcpSecrets, ...envs } }));
          }
        } catch {
          // Sessiz geç.
        }
        try {
          const status = await invoke<Record<string, boolean>>('key_status');
          const mapped = { ...EMPTY_STATUS };
          for (const p of PROVIDER_IDS) {
            const k = storeKeyOf(p);
            if (k in status) mapped[p] = !!status[k];
          }
          set({ keyStatus: mapped });
        } catch {
          // Status alinamazsa boot mesaji genel uyari gosterir.
        }
      },

      saveToStore: async () => {
        if (!isTauri()) return;
        const { apiKeys } = get();
        for (const p of PROVIDER_IDS) {
          const value = apiKeys[fieldOf(p)].trim();
          if (!value) continue;
          // Idempotent yazma: degismemis degerin tekrar yazilmasi zararsiz.
          try {
            await invoke('set_api_key', { provider: storeKeyOf(p), key: value });
          } catch {
            // Hata Terminal'e Faz 4'te err satiri olarak yansir; burada yut.
          }
        }
        // Özel uç secret'ları (boş olanlar yazılmaz; silme modal üzerinden).
        const { customSecrets } = get();
        for (const [id, key] of Object.entries(customSecrets)) {
          if (!key.trim()) continue;
          try {
            await invoke('set_api_key', { provider: id, key: key.trim() });
          } catch {
            // Sessiz geç (modal senkronu hatayı ayrıca yönetir).
          }
        }
        // MCP env blob'ları (`custom_<serverId>` adıyla JSON).
        const { mcpSecrets } = get();
        for (const [id, env] of Object.entries(mcpSecrets)) {
          if (Object.keys(env).length === 0) continue;
          try {
            await invoke('set_api_key', { provider: `custom_${id}`, key: JSON.stringify(env) });
          } catch {
            // Sessiz geç.
          }
        }
      },
    }),
    {
      name: 'macrocode-settings',
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined' ? localStorage : noopStorage,
      ),
      // Tauri'de secret'lar duz metin localStorage'a DUSMEZ; sadece
      // keystore + kod ici state'te tutulur. Tarayici-dev'de kolaylik icin saklanir.
      // KURAL: buraya yeni secret alani eklenirse Tauri dalında SIFIRLANMALIDIR
      // (customSecrets dahil — özel uç anahtarları da localStorage'a düşmez).
      // `modelsDevCatalog` ayrı bir localStorage anahtarında tutulur (bkz.
      // `lib/providers/modelsDev.ts` — 500+ model, zustand persist'ine sığmaz).
      partialize: (s) =>
        isTauri()
          ? {
              currentProvider: s.currentProvider,
              currentModel: s.currentModel,
              systemPrompt: s.systemPrompt,
              fontSize: s.fontSize,
              apiKeys: { ...EMPTY_KEYS, ollamaUrl: s.apiKeys.ollamaUrl },
              keyStatus: s.keyStatus,
              baseUrlOverride: s.baseUrlOverride,
              customEndpoints: s.customEndpoints,
              activeEndpointId: s.activeEndpointId,
              customSecrets: {},
              customModels: s.customModels,
              disabledModels: s.disabledModels,
              modelParams: s.modelParams,
              fallbackModel: s.fallbackModel,
              prices: s.prices,
              discovered: s.discovered,
              summarizerProvider: s.summarizerProvider,
              summarizerModel: s.summarizerModel,
              showThinking: s.showThinking,
              cachePrompts: s.cachePrompts,
              mcpServers: s.mcpServers,
              mcpSecrets: {},
              customAllowList: s.customAllowList,
              auditEnabled: s.auditEnabled,
              contrast: s.contrast,
              uiFont: s.uiFont,
              clockFormat: s.clockFormat,
              sidebarWidth: s.sidebarWidth,
              sidebarCollapsed: s.sidebarCollapsed,
            }
          : { ...s, modelsDevCatalog: null },
    },
  ),
);
