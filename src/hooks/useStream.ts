import { useCallback, useRef } from 'react';
import {
  ProviderError,
  formatProviderError,
  getProvider,
  getProviderForModel,
  mergeUsage,
  resolveModels,
  withRetry,
} from '../lib/providers';
import type { ChatItem, RetryInfo, StreamChunk } from '../lib/providers';
import { buildCustomProvider } from '../lib/providers/custom';
import { DEFAULT_OLLAMA_URL } from '../lib/providers/ollama';
import type { ApiKeys, CustomModel, Provider } from '../types';
import { createId, useSessionStore } from '../store/session';
import { providerNeedsKey, useSettingsStore } from '../store/settings';
import { compactionLimitFor } from '../lib/engine/tokens';
import { compactHistory, shouldCompact } from '../lib/engine/compact';
import { applyMemo, memoToPersisted, resolveMemo, setMemo } from '../lib/engine/compactionMemo';
import { makeSummarizeFn, summarizerConfig } from '../lib/summarize';
import { logError, logInfo } from '../lib/logger';
import { promptCacheKey } from '../lib/providers/promptCache';
import { useT } from '../lib/i18n';
import type { UsageLike } from '../lib/engine/types';

export { providerNeedsKey };

export function apiKeyFor(provider: Provider, keys: ApiKeys): string {
  if (provider === 'ollama') return keys.ollamaUrl || DEFAULT_OLLAMA_URL;
  return (keys[provider as keyof ApiKeys] as string) ?? '';
}

/**
 * Yedek hedef çözümleme (saf). Sağlayıcı modelin sahibinden alınır — aksi halde
 * istek yanlış API'ye (ör. Anthropic'e `gpt-6.1-sol`) gider ve kesin 4xx olur.
 * Karşılığı olmayan model ya da o sağlayıcının anahtarı eksikse `null` (yedek atlanır).
 */
export function resolveFallbackTarget(opts: {
  /** Özel uç aktifse yedek akışı hiç kullanılmaz. */
  endpointActive: boolean;
  currentModel: string;
  fallbackModel: string;
  customModels: CustomModel[];
  apiKeys: ApiKeys;
}): { provider: Provider; model: string } | null {
  if (opts.endpointActive) return null;
  const id = opts.fallbackModel.trim();
  if (!id || id === opts.currentModel.trim()) return null;
  const provider = getProviderForModel(id, opts.customModels);
  if (!provider) return null;
  if (providerNeedsKey(provider) && !apiKeyFor(provider, opts.apiKeys).trim()) return null;
  return { provider, model: id };
}

/**
 * AI mesaj gonderimi. Basari/abort'ta `null`, hatada terminal `err` satiri doner.
 * Girdi `text` slash komutu icermemelidir (ayristirma Faz 4'te InputBar/Terminal'de).
 */
export function useStream() {
  const t = useT();
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (
      text: string,
      images?: string[],
      onFallback?: (modelId: string) => void,
      onSys?: (line: string) => void,
      /** Retry başlarken bilgi, akış bitince `null` (geri sayım satırını temizler). */
      onRetry?: (info: RetryInfo | null) => void,
    ): Promise<string | null> => {
    const trimmed = text.trim();
    if (!trimmed && (!images || images.length === 0)) return null;
    if (useSessionStore.getState().isStreaming) return null;

    let session = useSessionStore.getState().getActiveSession();
    if (!session) {
      session = useSessionStore.getState().createSession();
    }
    const sessionId = session.id;
    const store = useSessionStore.getState;
    const settings = useSettingsStore.getState();

    const providerName: Provider = session.provider ?? settings.currentProvider;
    const model = session.model || settings.currentModel;
    const systemPrompt = session.systemPrompt || settings.systemPrompt || undefined;

    // Özel uç akışı (ayarlarda seçildiyse yerleşik sağlayıcıyı ezer; sohbet içindir).
    const endpoint = settings.activeEndpointId
      ? (settings.customEndpoints.find((e) => e.id === settings.activeEndpointId) ?? null)
      : null;

    /** Gönderim hedefi: sağlayıcı + model. Yedek model farklı sağlayıcıdan seçilebilir. */
    let doStream: (
      target: { provider: Provider; model: string },
      messages: ChatItem[],
      onChunk: (chunk: StreamChunk) => void,
      signal: AbortSignal,
    ) => Promise<void>;
    // Faz 11: prompt cache — önbellek anahtarı oturuma bağlı (aynı oturumun
    // istekleri aynı önbelleğe yönlendirilir).
    const cacheKey = promptCacheKey(sessionId, model);
    const cacheOn = settings.cachePrompts !== false;
    if (endpoint) {
      if (!endpoint.models.includes(model)) {
        return `✗ ${endpoint.name} için “${model}” tanımlı değil · ayarlardan varsayılan model seç`;
      }
      const key = settings.customSecrets[endpoint.id] ?? '';
      if (!key.trim()) {
        return t('errors.apiKeyMissing');
      }
      const custom = buildCustomProvider(endpoint);
      doStream = (target, messages, onChunk, signal) =>
        custom.stream({
          apiKey: key,
          model: target.model,
          systemPrompt,
          messages,
          onChunk,
          signal,
          params: settings.modelParams[target.model],
          registry: resolveModels(settings.customModels),
          ...(cacheOn ? { cachePrompts: true, promptCacheKey: cacheKey } : {}),
        });
    } else {
      const apiKey = apiKeyFor(providerName, settings.apiKeys);
      if (providerNeedsKey(providerName) && !apiKey.trim()) {
        return t('errors.apiKeyMissing');
      }
      // Hedef sağlayıcı çağıra göre çözülür: birincil akışta session sağlayıcısı,
      // yedek akışta yedek modelin sahibi kullanılır (anahtar/URL de ona göre çekilir).
      doStream = (target, messages, onChunk, signal) => {
        const key = apiKeyFor(target.provider, settings.apiKeys);
        if (providerNeedsKey(target.provider) && !key.trim()) {
          throw new ProviderError('api anahtarı eksik', 401);
        }
        const override = settings.baseUrlOverride[target.provider]?.trim();
        const baseUrl = target.provider === 'ollama' ? key : override || undefined;
        return getProvider(target.provider).stream({
          apiKey: key,
          model: target.model,
          systemPrompt,
          messages,
          onChunk,
          signal,
          baseUrl,
          params: settings.modelParams[target.model],
          registry: resolveModels(settings.customModels),
          ...(cacheOn ? { cachePrompts: true, promptCacheKey: cacheKey } : {}),
        });
      };
    }
    // Yedek model: yalnızca yerleşik akışta, tek deneme. Sağlayıcısı ayrıca
    // çözülür — registry'de karşılığı olmayan ya da anahtarı eksik sağlayıcıda
    // yedek devre dışı bırakılır (yanlış API'ye istek gitmesin).
    const fallbackTarget = resolveFallbackTarget({
      endpointActive: !!endpoint,
      currentModel: model,
      fallbackModel: settings.fallbackModel,
      customModels: settings.customModels,
      apiKeys: settings.apiKeys,
    });

    const userId = createId();
    const assistantId = createId();
    const now = Date.now();
    store().setStreaming(true);
    store().addMessage(sessionId, {
      id: userId,
      role: 'user',
      content: trimmed,
      timestamp: now,
      model,
      provider: providerName,
      ...(images && images.length > 0 ? { images: [...images] } : {}),
    });
    store().addMessage(sessionId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: now,
      model,
      provider: providerName,
    });

    // Gecmis: sondaki bos placeholder haric tutulur (gorseller korunur).
    // Faz 7: compaction hafızası varsa "özet + o özetten sonraki mesajlar" kullanılır
    // (aynı özet her turda yeniden yapılmaz).
    const sess = store().getActiveSession();
    // Faz 12 B.6: bellekte yoksa oturumdaki kalıcı kopya (restart sonrası).
    const memo = resolveMemo<ChatItem>(sessionId, sess?.compaction);
    const sessionMessages = sess?.messages ?? [];
    const tail = sessionMessages
      .filter((m) => m.id !== assistantId && (m.content.length > 0 || (m.images?.length ?? 0) > 0))
      .map((m) => ({
        role: m.role,
        content: m.content,
        ts: m.timestamp,
        id: m.id,
        ...(m.images && m.images.length > 0 ? { images: [...m.images] } : {}),
      }));
    const history: ChatItem[] = applyMemo(memo, tail);

    // Faz 2: gönderim öncesi otomatik compaction (özet kendi başına tur başlatmaz).
    let effHistory = history;
    try {
      const limit = compactionLimitFor(model, settings.customModels);
      if (shouldCompact(history, limit)) {
        const cfg = summarizerConfig({
          currentProvider: providerName,
          currentModel: model,
          summarizerProvider: settings.summarizerProvider,
          summarizerModel: settings.summarizerModel,
          apiKeys: settings.apiKeys,
          customModels: settings.customModels,
          baseUrlOverride: settings.baseUrlOverride,
        });
        if (cfg) {
          effHistory = await compactHistory({
            history,
            budget: limit,
            summarize: makeSummarizeFn(cfg),
          });
          if (effHistory !== history) {
            // Faz 9 P9.5: kesim id tabanlı (zaman damgası riski).
            const memoForm = {
              at: Date.now(),
              items: effHistory,
              coveredIds: history
                .map((h) => h.id)
                .filter((x): x is string => typeof x === 'string'),
            };
            setMemo(sessionId, memoForm.at, effHistory, {
              coveredIds: memoForm.coveredIds,
            });
            // Faz 12 B.6: özet oturuma kalıcı yazılır (restart sonrası tekrar özetlenmez).
            store().setCompaction(sessionId, memoToPersisted(memoForm));
            onSys?.(t('agent.compacted'));
          }
        }
      }
    } catch {
      effHistory = history;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let usage: UsageLike | null = null;
    // Text/reasoning/tool çağrısı aktıysa retry aynı içeriği ikinci kez yazar.
    let sawOutput = false;
    // Retry satırı, yeniden bağlanılan akıştan ilk veri gelince kaldırılır.
    let pendingRetry = false;
    const onChunk = (chunk: StreamChunk) => {
      if (pendingRetry) {
        pendingRetry = false;
        onRetry?.(null);
      }
      // Usage event'leri kümülatiftir (Anthropic: message_start input,
      // message_delta output) — üzerine yazma, max ile birleştir.
      if (chunk.usage && (chunk.usage.input > 0 || chunk.usage.output > 0 || (chunk.usage.reasoning ?? 0) > 0)) {
        usage = mergeUsage(usage, chunk.usage);
      }
      if (chunk.text) {
        sawOutput = true;
        store().updateLastMessage(sessionId, chunk.text);
      }
      // Faz 4: reasoning dim blokta birikir (kalıcı mesaj alanında).
      if (chunk.reasoning) {
        sawOutput = true;
        store().appendReasoning(sessionId, assistantId, chunk.reasoning);
      }
      if (chunk.toolCalls && chunk.toolCalls.length > 0) sawOutput = true;
    };
    // onChunk içindeki atama TS'in akış daraltmasına yansımaz; okuyucu ile al.
    const currentUsage = (): UsageLike | null => usage;
    const reportRetry = (info: RetryInfo) => {
      pendingRetry = true;
      onRetry?.(info);
    };
    logInfo('stream.start', { provider: providerName, model, messages: effHistory.length });
    try {
      try {
        // G6: aynı modelde retry (429/5xx/ağ), sonra yedek model tek deneme.
        await withRetry(
          () => doStream({ provider: providerName, model }, effHistory, onChunk, ctrl.signal),
          {
            retries: 2,
            ...(onRetry ? { onRetry: reportRetry } : {}),
            shouldRetry: () => !sawOutput,
          },
        );
      } catch (first) {
        // Yedek model: tek retry — metin/araç çıktısı aktıysa karışmasın diye denenmez.
        // Hedef sağlayıcı yedek modelin sahibidir (ayrı anahtar/URL çekilir).
        if (ctrl.signal.aborted || !fallbackTarget || sawOutput) throw first;
        onFallback?.(fallbackTarget.model);
        await withRetry(
          () => doStream(fallbackTarget, effHistory, onChunk, ctrl.signal),
          {
            retries: 2,
            ...(onRetry ? { onRetry: reportRetry } : {}),
            shouldRetry: () => !sawOutput,
          },
        );
      }
      const doneUsage = currentUsage();
      if (doneUsage) {
        store().setMessageUsage(sessionId, assistantId, doneUsage);
        store().setMessageLastRequest(sessionId, assistantId, {
          input: doneUsage.input,
          output: doneUsage.output,
        });
      }
      logInfo('stream.done', { provider: providerName, model, usage: doneUsage });
      return null;
    } catch (err) {
      logError('stream.error', {
        provider: providerName,
        model,
        error: err instanceof Error ? err.message : String(err),
      });
      // Kısmi yanıt ekranda kalmışsa o ana kadarki kullanım da kaydedilmeli
      // (maliyet/bağlam sayaçları eksik kalmasın). Boş placeholder silinirse
      // yazma zaten etkisizdir.
      const partialUsage = currentUsage();
      if (partialUsage) {
        store().setMessageUsage(sessionId, assistantId, partialUsage);
        store().setMessageLastRequest(sessionId, assistantId, {
          input: partialUsage.input,
          output: partialUsage.output,
        });
      }
      if (ctrl.signal.aborted) {
        return null;
      }
      // Bos kalan assistant placeholder gecmisi kirletmesin.
      const msgs = store().getActiveSession()?.messages ?? [];
      const last = msgs[msgs.length - 1];
      if (last && last.id === assistantId && last.content === '') {
        store().removeMessage(sessionId, assistantId);
      }
      return formatProviderError(err);
    } finally {
      store().setStreaming(false);
      if (abortRef.current === ctrl) abortRef.current = null;
      try {
        onRetry?.(null);
      } catch {
        // UI temizliği akışı bozmaz.
      }
    }
  }, [t]);

  return { send, abort };
}
