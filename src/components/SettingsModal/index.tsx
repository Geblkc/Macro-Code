import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ALL_MODELS, PROVIDER_IDS } from '../../lib/providers';
import { listOllamaModels, DEFAULT_OLLAMA_URL } from '../../lib/providers/ollama';
import { validateDetailed } from '../../lib/providers/validate';
import {
  SOURCE_PROVIDER,
  discoverGemini,
  discoverOllama as discoverOllamaModels,
  discoverOpenAI,
  discoverOpenRouter,
} from '../../lib/providers/discovery';
import { makeEndpointId, parseEndpointModels } from '../../lib/providers/custom';
import { catalogPriceOf } from '../../lib/providers/catalog';
import type { CustomEndpoint, CustomModel, DiscoveredModel, McpServerConfig, Provider } from '../../types';
import { fieldOf, isTauri, useSettingsStore } from '../../store/settings';
import ProvidersTab from './ProvidersTab';
import ModelsTab from './ModelsTab';
import ChatTab from './ChatTab';
import McpTab from './McpTab';
import LangTab from './LangTab';
import AboutTab from './AboutTab';
import type { CustomDraft, Draft, McpDraft, SecretDraft, TabId, TestConn } from './types';
import { TABS, emptySecret, maskLast4, parseEnvText, serializeEnv } from './types';
import { McpClient } from '../../lib/engine/mcp/client';
import { createHttpTransport } from '../../lib/engine/mcp/transports/http';
import { createStdioTransport } from '../../lib/engine/mcp/transports/stdio';
import { makeMcpServerId } from '../../lib/engine/mcp/registry';

interface Props {
  open: boolean;
  onClose: () => void;
}

function blankDraft(): Draft {
  const secrets: Record<string, SecretDraft> = {};
  for (const p of PROVIDER_IDS) {
    if (p === 'ollama') continue;
    secrets[p] = emptySecret();
  }
  return {
    secrets,
    ollamaUrl: DEFAULT_OLLAMA_URL,
    baseUrlOverride: {},
    customs: [],
    activeEndpointId: null,
    currentModel: '',
    customModels: [],
    disabledModels: [],
    modelParams: {},
    fallbackModel: '',
    prices: {},
    systemPrompt: '',
    fontSize: 13,
    summarizerProvider: '',
    summarizerModel: '',
    showThinking: true,
    cachePrompts: true,
    mcps: [],
    customAllowList: [],
    auditEnabled: true,
  };
}

export default function SettingsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<TabId>('providers');
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [initial, setInitial] = useState<Draft>(blankDraft);
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [tests, setTests] = useState<Record<string, TestConn>>({});
  const [ollamaFound, setOllamaFound] = useState<string[] | null>(null);
  const [ollamaErr, setOllamaErr] = useState<string | null>(null);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [found, setFound] = useState<DiscoveredModel[] | null>(null);
  const [foundErr, setFoundErr] = useState<string | null>(null);
  const [foundBusy, setFoundBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mcpFound, setMcpFound] = useState<Record<string, { count: number; error: string | null; busy: boolean }>>({});
  // models.dev kataloğu yüklü mü (fiyat/metadata zenginleşmesi).
  const catalog = useSettingsStore((s) => s.modelsDevCatalog);

  const patch = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setFormError(null);
  };
  const setSecret = (id: string, p: Partial<SecretDraft>) =>
    setDraft((d) => ({ ...d, secrets: { ...d.secrets, [id]: { ...d.secrets[id], ...p } } }));
  const patchCustom = (key: string, p: Partial<CustomDraft>) =>
    setDraft((d) => ({
      ...d,
      customs: d.customs.map((c) => (c.key === key ? { ...c, ...p } : c)),
    }));
  const patchMcp = (key: string, p: Partial<McpDraft>) =>
    setDraft((d) => ({
      ...d,
      mcps: d.mcps.map((c) => (c.key === key ? { ...c, ...p } : c)),
    }));

  // Açılışta taslağı kur: secret'lar için yalnızca maskeli ipucu çekilir.
  useEffect(() => {
    if (!open) return;
    const s = useSettingsStore.getState();
    const next = blankDraft();
    next.ollamaUrl = s.apiKeys.ollamaUrl || DEFAULT_OLLAMA_URL;
    next.baseUrlOverride = { ...s.baseUrlOverride };
    next.activeEndpointId = s.activeEndpointId;
    next.currentModel = s.currentModel;
    next.customModels = s.customModels.map((m) => ({ ...m, capabilities: { ...m.capabilities } }));
    next.disabledModels = [...s.disabledModels];
    next.modelParams = JSON.parse(JSON.stringify(s.modelParams)) as Draft['modelParams'];
    next.fallbackModel = s.fallbackModel;
    next.prices = JSON.parse(JSON.stringify(s.prices)) as Draft['prices'];
    next.systemPrompt = s.systemPrompt;
    next.fontSize = s.fontSize;
    next.summarizerProvider = s.summarizerProvider;
    next.summarizerModel = s.summarizerModel;
    next.showThinking = s.showThinking;
    next.cachePrompts = s.cachePrompts;
    next.customAllowList = [...s.customAllowList];
    next.auditEnabled = s.auditEnabled;
    next.mcps = s.mcpServers.map((m) => ({
      key: m.id,
      id: m.id,
      isNew: false,
      name: m.name,
      transport: m.transport,
      url: m.url ?? '',
      command: m.command ?? '',
      argsText: (m.args ?? []).join('\n'),
      envText: serializeEnv(m.envKeys ?? [], s.mcpSecrets[m.id] ?? {}),
      enabled: m.enabled,
      allowedText: (m.allowedTools ?? []).join(', '),
      removed: false,
    }));
    next.customs = s.customEndpoints.map((e) => ({
      key: e.id,
      id: e.id,
      isNew: false,
      name: e.name,
      baseUrl: e.baseUrl,
      modelsText: e.models.join('\n'),
      secret: emptySecret(),
      removed: false,
    }));
    const memorySecrets: Record<string, string> = {};
    for (const p of PROVIDER_IDS) {
      if (p === 'ollama') continue;
      memorySecrets[p] = s.apiKeys[fieldOf(p)] ?? '';
    }
    for (const e of s.customEndpoints) {
      memorySecrets[e.id] = s.customSecrets[e.id] ?? '';
    }
    setDraft(next);
    setInitial(JSON.parse(JSON.stringify(next)) as Draft);
    setTab('providers');
    setTests({});
    setShow({});
    setOllamaFound(null);
    setOllamaErr(null);
    setFound(null);
    setFoundErr(null);
    setFoundBusy(null);
    setMcpFound({});
    setFormError(null);
    void (async () => {
      // Tauri'de ipucu keystore'dan (`key_hint` tam değeri dönmez);
      // tarayıcı-dev'de bellekten maskelenir.
      const ids = [...PROVIDER_IDS.filter((p) => p !== 'ollama'), ...s.customEndpoints.map((e) => e.id)];
      const hints: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            hints[id] = isTauri()
              ? await invoke<string>('key_hint', { provider: id })
              : maskLast4(memorySecrets[id] ?? '');
          } catch {
            hints[id] = '';
          }
        }),
      );
      setDraft((d) => {
        const secrets = { ...d.secrets };
        for (const [id, hint] of Object.entries(hints)) {
          if (id in secrets) secrets[id] = { ...secrets[id], hint };
        }
        const customs = d.customs.map((c) =>
          hints[c.id] !== undefined ? { ...c, secret: { ...c.secret, hint: hints[c.id] } } : c,
        );
        return { ...d, secrets, customs };
      });
      setInitial((prev) => {
        const secrets = { ...prev.secrets };
        for (const [id, hint] of Object.entries(hints)) {
          if (id in secrets) secrets[id] = { ...secrets[id], hint };
        }
        const customs = prev.customs.map((c) =>
          hints[c.id] !== undefined ? { ...c, secret: { ...c.secret, hint: hints[c.id] } } : c,
        );
        return { ...prev, secrets, customs };
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const memoryValue = (id: string): string => {
    const s = useSettingsStore.getState();
    if ((PROVIDER_IDS as string[]).includes(id) && id !== 'ollama') {
      return s.apiKeys[fieldOf(id as Provider)] ?? '';
    }
    return s.customSecrets[id] ?? '';
  };

  const testKey = async (id: string) => {
    setTests((t) => ({ ...t, [id]: 'testing' }));
    setFormError(null);
    try {
      if (id === 'ollama') {
        const r = await validateDetailed('ollama', draft.ollamaUrl);
        setTests((t) => ({ ...t, [id]: r }));
        return;
      }
      if ((PROVIDER_IDS as string[]).includes(id)) {
        const p = id as Provider;
        const sec = draft.secrets[id];
        const value = sec?.value || memoryValue(id);
        if (!value.trim()) {
          setTests((t) => ({ ...t, [id]: 'idle' }));
          setFormError('önce anahtar gir (kayıtlı anahtar test edilemiyorsa yeniden yaz)');
          return;
        }
        const r = await validateDetailed(p, value, {
          baseUrl: draft.baseUrlOverride[p]?.trim() || undefined,
        });
        setTests((t) => ({ ...t, [id]: r }));
        return;
      }
      const card = draft.customs.find((c) => c.key === id);
      if (!card) return;
      const value = card.secret.value || memoryValue(card.id);
      if (!value.trim() || !card.baseUrl.trim()) {
        setTests((t) => ({ ...t, [id]: 'idle' }));
        setFormError('önce base URL ve anahtar gir');
        return;
      }
      const r = await validateDetailed('openai', value, { baseUrl: card.baseUrl.trim() });
      setTests((t) => ({ ...t, [id]: r }));
    } catch {
      setTests((t) => ({ ...t, [id]: 'network' }));
    }
  };

  const clearSecret = (id: string) => setSecret(id, { value: '', deleted: true });

  const discoverOllama = () => {
    setOllamaBusy(true);
    setOllamaErr(null);
    void (async () => {
      try {
        setOllamaFound(await listOllamaModels(draft.ollamaUrl));
      } catch (e) {
        setOllamaFound(null);
        setOllamaErr(e instanceof Error ? e.message : 'liste alınamadı');
      } finally {
        setOllamaBusy(false);
      }
    })();
  };

  const addEndpoint = () =>
    setDraft((d) => ({
      ...d,
      customs: [
        ...d.customs,
        {
          key: `new-${Date.now()}`,
          isNew: true,
          id: '',
          name: '',
          baseUrl: '',
          modelsText: '',
          secret: emptySecret(),
          removed: false,
        },
      ],
    }));

  const removeEndpoint = (key: string) => patchCustom(key, { removed: true });

  const addMcp = () =>
    setDraft((d) => ({
      ...d,
      mcps: [
        ...d.mcps,
        {
          key: `new-${Date.now()}`,
          isNew: true,
          id: '',
          name: '',
          transport: 'http' as const,
          url: '',
          command: '',
          argsText: '',
          envText: '',
          enabled: true,
          allowedText: '',
          removed: false,
        },
      ],
    }));

  const removeMcp = (key: string) => patchMcp(key, { removed: true });

  const discoverMcp = (key: string) => {
    const card = draft.mcps.find((c) => c.key === key);
    if (!card) return;
    setMcpFound((m) => ({ ...m, [key]: { count: 0, error: null, busy: true } }));
    void (async () => {
      const fail = (msg: string) =>
        setMcpFound((m) => ({ ...m, [key]: { count: 0, error: msg, busy: false } }));
      try {
        const transport =
          card.transport === 'stdio'
            ? (() => {
                if (!isTauri()) throw new Error('stdio yalnızca Tauri’de çalışır');
                if (!card.command.trim()) throw new Error('önce komut gir');
                const { values } = parseEnvText(card.envText);
                return createStdioTransport({
                  serverId: card.id || 'kesif',
                  command: card.command.trim(),
                  args: card.argsText.split('\n').map((s) => s.trim()).filter(Boolean),
                  env: values,
                });
              })()
            : (() => {
                if (!/^https?:\/\/.+/.test(card.url.trim())) throw new Error('önce http(s) URL gir');
                return createHttpTransport({ url: card.url.trim() });
              })();
        const client = new McpClient(transport);
        try {
          await client.initialize();
          const tools = await client.listTools();
          setMcpFound((m) => ({ ...m, [key]: { count: tools.length, error: null, busy: false } }));
        } finally {
          await client.close().catch(() => {});
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : 'keşif başarısız');
      }
    })();
  };

  const useEndpointModel = (endpointId: string, model: string) =>
    patch({ activeEndpointId: endpointId, currentModel: model });

  const backToBuiltin = () => patch({ activeEndpointId: null });

  const refreshModels = (source: DiscoveredModel['source']) => {
    setFoundBusy(source);
    setFoundErr(null);
    void (async () => {
      try {
        const st = useSettingsStore.getState();
        let models: DiscoveredModel[];
        if (source === 'modelsDev') {
          // models.dev kataloğu: 6 sağlayıcıya kırpılmış ~500 model.
          const catalog = await st.refreshModelsDevCatalog();
          const fetchedAt = catalog.fetchedAt;
          models = Object.entries(catalog.providers).flatMap(([, entries]) =>
            entries.map((e) => ({
              id: e.id,
              source: 'modelsDev' as const,
              contextWindow: e.contextLimit || undefined,
              fetchedAt,
              catalog: e,
            })),
          );
        } else if (source === 'openrouter') {
          models = await discoverOpenRouter();
        } else if (source === 'ollama') {
          models = await discoverOllamaModels(draft.ollamaUrl);
        } else if (source === 'openai') {
          if (!st.apiKeys.openai.trim()) throw new Error('önce openai anahtarı gir');
          models = await discoverOpenAI(st.apiKeys.openai, draft.baseUrlOverride.openai ?? '');
        } else {
          if (!st.apiKeys.gemini.trim()) throw new Error('önce gemini anahtarı gir');
          models = await discoverGemini(st.apiKeys.gemini);
        }
        setFound(models);
        // models.dev sonucu kalıcı yazılmaz (yüzlerce kayıt + kendi önbelleği var).
        if (source !== 'modelsDev') st.setDiscovered(models);
      } catch (e) {
        setFound(null);
        setFoundErr(e instanceof Error ? e.message : 'liste alınamadı');
      } finally {
        setFoundBusy(null);
      }
    })();
  };

  const addCustomModel = (m: CustomModel) =>
    setDraft((d) => ({
      ...d,
      customModels: d.customModels.some((c) => c.id === m.id)
        ? d.customModels.map((c) => (c.id === m.id ? m : c))
        : [...d.customModels, m],
    }));

  const addDiscovered = (m: DiscoveredModel) => {
    // models.dev kaydı: sağlayıcı eşlemesi + katalog metadata'sı taşınır.
    if (m.source === 'modelsDev') {
      const c = m.catalog;
      const provider = (c?.provider as Provider) ?? 'openai';
      addCustomModel({
        id: m.id,
        provider,
        name: c?.name ?? m.id,
        capabilities: {
          tools: c?.toolCall ?? true,
          vision: c?.modalities.input.includes('image') ?? false,
          reasoning: c?.reasoning ?? false,
        },
        ...(c?.contextLimit ? { contextWindow: c.contextLimit } : {}),
        ...(c?.outputLimit ? { maxOutput: c.outputLimit } : {}),
        ...(c?.description ? { description: c.description } : {}),
        ...(c?.family ? { family: c.family } : {}),
        ...(catalogPriceOf(c) ? { catalogPrice: catalogPriceOf(c) } : {}),
      });
      return;
    }
    addCustomModel({
      id: m.id,
      provider: SOURCE_PROVIDER[m.source],
      name: m.id,
      capabilities: { tools: true, vision: false, reasoning: false },
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
    });
  };

  const removeCustomModel = (id: string) =>
    setDraft((d) => ({ ...d, customModels: d.customModels.filter((c) => c.id !== id) }));

  /** Katalog fiyatlarını uygular (elle girilenler korunur). */
  const applyCatalogPrices = () => {
    const st = useSettingsStore.getState();
    if (!st.modelsDevCatalog) return;
    st.setModelsDevCatalog(st.modelsDevCatalog);
  };

  const save = async () => {
    // MCP doğrulama (id'ler keystore kuralına uymalı: mcp_<slug>).
    const keptMcps = draft.mcps.filter((c) => !c.removed);
    const usedMcpIds = new Set<string>();
    const mcpFinals: {
      card: McpDraft;
      id: string;
      config: McpServerConfig;
      env: Record<string, string>;
    }[] = [];
    for (const c of keptMcps) {
      const name = c.name.trim();
      if (!name) {
        setFormError('mcp sunucu adı boş olamaz');
        return;
      }
      let id = c.isNew ? makeMcpServerId(name) : c.id;
      let n = 2;
      while (usedMcpIds.has(id)) id = `${c.isNew ? makeMcpServerId(name) : c.id}-${n++}`;
      usedMcpIds.add(id);
      const allowed = c.allowedText.split(',').map((s) => s.trim()).filter(Boolean);
      if (c.transport === 'http') {
        if (!/^https?:\/\/.+/.test(c.url.trim())) {
          setFormError(`“${name}”: URL http(s) ile başlamalı`);
          return;
        }
        mcpFinals.push({
          card: c,
          id,
          config: {
            id,
            name,
            transport: 'http',
            url: c.url.trim(),
            enabled: c.enabled,
            allowedTools: allowed.length > 0 ? allowed : null,
          },
          env: {},
        });
      } else {
        if (!c.command.trim()) {
          setFormError(`“${name}”: komut boş olamaz`);
          return;
        }
        const { keys, values } = parseEnvText(c.envText);
        mcpFinals.push({
          card: c,
          id,
          config: {
            id,
            name,
            transport: 'stdio',
            command: c.command.trim(),
            args: c.argsText.split('\n').map((s) => s.trim()).filter(Boolean),
            envKeys: keys,
            enabled: c.enabled,
            allowedTools: allowed.length > 0 ? allowed : null,
          },
          env: values,
        });
      }
    }

    // Özel uç doğrulama (id'ler keystore kuralına uymalı).
    const kept = draft.customs.filter((c) => !c.removed);
    const usedIds = new Set<string>();
    const finals: { card: CustomDraft; id: string; models: string[] }[] = [];
    for (const c of kept) {
      const name = c.name.trim();
      if (!name) {
        setFormError('özel uç adı boş olamaz');
        return;
      }
      if (!/^https?:\/\/.+/.test(c.baseUrl.trim())) {
        setFormError(`“${name}”: base URL http(s) ile başlamalı`);
        return;
      }
      const models = parseEndpointModels(c.modelsText);
      if (models.length === 0) {
        setFormError(`“${name}”: en az bir model id gir`);
        return;
      }
      let id = c.isNew ? makeEndpointId(name) : c.id;
      let n = 2;
      while (usedIds.has(id)) id = `${c.isNew ? makeEndpointId(name) : c.id}-${n++}`;
      usedIds.add(id);
      finals.push({ card: c, id, models });
    }

    const st = useSettingsStore.getState();
    const apiKeys = { ...st.apiKeys };
    for (const p of PROVIDER_IDS) {
      if (p === 'ollama') continue;
      const sec = draft.secrets[p];
      if (!sec) continue;
      if (sec.deleted) apiKeys[fieldOf(p)] = '';
      else if (sec.value.trim()) apiKeys[fieldOf(p)] = sec.value;
    }
    apiKeys.ollamaUrl = draft.ollamaUrl.trim() || DEFAULT_OLLAMA_URL;
    const baseUrlOverride = { ...draft.baseUrlOverride };
    for (const k of Object.keys(baseUrlOverride) as Provider[]) {
      if (!baseUrlOverride[k]?.trim()) delete baseUrlOverride[k];
      else baseUrlOverride[k] = baseUrlOverride[k].trim();
    }
    const endpoints: CustomEndpoint[] = finals.map((f) => ({
      id: f.id,
      name: f.card.name.trim(),
      baseUrl: f.card.baseUrl.trim().replace(/\/+$/, ''),
      models: f.models,
    }));
    const mcpServers: McpServerConfig[] = mcpFinals.map((f) => f.config);
    const activeEndpointId =
      draft.activeEndpointId && endpoints.some((e) => e.id === draft.activeEndpointId)
        ? draft.activeEndpointId
        : null;

    useSettingsStore.setState({
      apiKeys,
      baseUrlOverride,
      customEndpoints: endpoints,
      activeEndpointId,
      customModels: draft.customModels,
      disabledModels: draft.disabledModels,
      modelParams: draft.modelParams,
      fallbackModel: draft.fallbackModel,
      prices: draft.prices,
      mcpServers,
    });
    const s = useSettingsStore.getState();
    s.setSystemPrompt(draft.systemPrompt);
    s.setSummarizerProvider(draft.summarizerProvider);
    s.setSummarizerModel(draft.summarizerModel.trim());
    s.setShowThinking(draft.showThinking);
    s.setCachePrompts(draft.cachePrompts);
    s.setCustomAllowList(draft.customAllowList);
    s.setAuditEnabled(draft.auditEnabled);
    const known = ALL_MODELS.find((m) => m.id === draft.currentModel);
    if (known) {
      s.setProvider(known.provider);
      s.setModel(known.id);
    } else if (draft.currentModel.trim()) {
      s.setModel(draft.currentModel.trim());
    }
    s.setFontSize(draft.fontSize);

    // MCP env bellek senkronu (değerler keystore'a ayrıca yazılır).
    for (const f of mcpFinals) {
      if (Object.keys(f.env).length > 0) s.setMcpEnv(f.id, f.env);
      else s.clearMcpEnv(f.id);
    }
    for (const c of draft.mcps) {
      if (c.removed && !c.isNew) s.clearMcpEnv(c.id);
    }

    // Secret bellek senkronu.
    for (const f of finals) {
      if (f.card.secret.deleted) s.clearCustomSecret(f.id);
      else if (f.card.secret.value.trim()) s.setCustomSecret(f.id, f.card.secret.value);
    }
    for (const c of draft.customs) {
      if (c.removed && !c.isNew) s.clearCustomSecret(c.id);
    }

    // Keystore senkronu (Tauri).
    if (isTauri()) {
      const jobs: Promise<unknown>[] = [];
      for (const p of PROVIDER_IDS) {
        if (p === 'ollama') {
          jobs.push(
            invoke('set_api_key', { provider: 'ollamaUrl', key: apiKeys.ollamaUrl }).catch(() => {}),
          );
          continue;
        }
        const sec = draft.secrets[p];
        if (!sec) continue;
        if (sec.deleted) jobs.push(invoke('delete_api_key', { provider: p }).catch(() => {}));
        else if (sec.value.trim()) {
          jobs.push(invoke('set_api_key', { provider: p, key: sec.value }).catch(() => {}));
        }
      }
      for (const f of finals) {
        if (f.card.secret.deleted) {
          jobs.push(invoke('delete_api_key', { provider: f.id }).catch(() => {}));
        } else if (f.card.secret.value.trim()) {
          jobs.push(invoke('set_api_key', { provider: f.id, key: f.card.secret.value }).catch(() => {}));
        }
      }
      for (const f of mcpFinals) {
        if (Object.keys(f.env).length > 0) {
          jobs.push(
            invoke('set_api_key', { provider: `custom_${f.id}`, key: JSON.stringify(f.env) }).catch(() => {}),
          );
        } else {
          jobs.push(invoke('delete_api_key', { provider: `custom_${f.id}` }).catch(() => {}));
        }
      }
      for (const c of draft.customs) {
        if (c.removed && !c.isNew && c.id) {
          jobs.push(invoke('delete_api_key', { provider: c.id }).catch(() => {}));
        }
      }
      for (const c of draft.mcps) {
        if (c.removed && !c.isNew && c.id) {
          jobs.push(invoke('delete_api_key', { provider: `custom_${c.id}` }).catch(() => {}));
        }
      }
      await Promise.allSettled(jobs);
    }

    useSettingsStore.setState({
      keyStatus: Object.fromEntries(
        PROVIDER_IDS.map((p) => {
          if (p === 'ollama') return [p, true];
          const sec = draft.secrets[p];
          if (!sec) return [p, false];
          if (sec.deleted) return [p, false];
          if (sec.value.trim()) return [p, true];
          return [p, sec.hint.length > 0];
        }),
      ) as Record<Provider, boolean>,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          /// settings{dirty && <span className="unsaved" title="kaydedilmemiş değişiklik"> •</span>}
        </div>
        <div className="settings-layout">
          <div className="settings-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab-btn${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="settings-content" role="tabpanel">
            {tab === 'providers' && (
              <ProvidersTab
                draft={draft}
                patch={patch}
                setSecret={setSecret}
                show={show}
                toggleShow={(id) => setShow((m) => ({ ...m, [id]: !m[id] }))}
                tests={tests}
                onTest={(id) => void testKey(id)}
                onClearSecret={clearSecret}
                ollamaFound={ollamaFound}
                ollamaErr={ollamaErr}
                ollamaBusy={ollamaBusy}
                onDiscoverOllama={discoverOllama}
                onAddEndpoint={addEndpoint}
                onRemoveEndpoint={removeEndpoint}
                onPatchCustom={patchCustom}
                onUseEndpointModel={useEndpointModel}
                onBackToBuiltin={backToBuiltin}
                formError={formError}
              />
            )}
            {tab === 'models' && (
              <ModelsTab
                draft={draft}
                patch={patch}
                onToggleModel={(id) =>
                  patch({
                    disabledModels: draft.disabledModels.includes(id)
                      ? draft.disabledModels.filter((m) => m !== id)
                      : [...draft.disabledModels, id],
                  })
                }
                found={found}
                foundErr={foundErr}
                foundBusy={foundBusy}
                onRefresh={refreshModels}
                onAddDiscovered={addDiscovered}
                onAddCustom={addCustomModel}
                onRemoveCustom={removeCustomModel}
                catalogLoaded={catalog !== null}
                onApplyCatalogPrices={applyCatalogPrices}
                onOpenProviders={() => setTab('providers')}
                formError={formError}
              />
            )}
            {tab === 'chat' && <ChatTab draft={draft} patch={patch} />}
            {tab === 'mcp' && (
              <McpTab
                mcps={draft.mcps}
                onPatchMcp={patchMcp}
                onAddMcp={addMcp}
                onRemoveMcp={removeMcp}
                onDiscoverMcp={discoverMcp}
                discovered={mcpFound}
                formError={formError}
              />
            )}
            {tab === 'lang' && <LangTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
        <div className="modal-actions">
          <button className="sidebar-btn" onClick={onClose}>
            vazgeç
          </button>
          <button className="sidebar-btn primary" disabled={!dirty} onClick={() => void save()}>
            kaydet
          </button>
        </div>
      </div>
    </div>
  );
}
