import type { AIProvider, ProviderConfig } from './common';
import { MAX_OUTPUT_TOKEN_CAP, ProviderError, feedSSELines, lookupModel, parseDataUrl, parseJsonPayload, systemTextOf, throwIfHttpError, toUsage, toUsageCount, withoutSystemMessages } from './common';
import { fetchFor } from './rustFetch';
import { sanitizeParams } from './params';
import { accumulateOpenAIToolCalls, toOpenAITools } from '../engine/toolspec';
import type { Model } from '../../types';

export interface OpenAICompatibleOptions {
  name: AIProvider['name'];
  baseUrl: string;
  models: Model[];
  extraHeaders?: (apiKey: string) => Record<string, string>;
  mapRole?: (model: string, role: string) => string;
  validateUrl?: string;
}

/**
 * OpenAI `chat/completions` (stream:true) konuşan tüm sağlayıcılar için fabrika.
 * openai / openrouter / deepseek / xai bu şablonu kullanır — yeni provider
 * eklemek = 1 dosya + registry kaydı.
 */
export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): AIProvider {
  const mapRole = opts.mapRole ?? ((_m, r) => r);
  /** Modelin maxOutput'u, 16k tavanla istek limitine çevrilir (maliyet güvenliği). */
  const maxFor = (model: string, registry?: Model[]): number => {
    const found = lookupModel(model, registry, opts.models);
    const cap = found?.maxOutput ?? 8192;
    return Math.min(cap, MAX_OUTPUT_TOKEN_CAP);
  };
  return {
    name: opts.name,
    models: opts.models,

    async stream(config: ProviderConfig): Promise<void> {
      const { apiKey, model, systemPrompt, messages, onChunk, signal } = config;
      if (!apiKey.trim()) {
        throw new ProviderError('api anahtarı eksik', 401);
      }
      // Özel taban URL (ayarlar) varsa fabrika URL'sini ezer.
      const base = (config.baseUrl?.trim() || opts.baseUrl).replace(/\/+$/, '');
      // Faz 7 A2: compaction özeti / kalıcı sistem mesajları baştaki system
      // mesajına birleştirilir (konuşma ortasındaki system rolü geçersizdir).
      const systemText = [systemPrompt?.trim(), systemTextOf(messages)].filter(Boolean).join('\n\n');
      const apiMessages = [
        ...(systemText ? [{ role: mapRole(model, 'system'), content: systemText }] : []),
        ...withoutSystemMessages(messages).map((m) => {
          if (m.role === 'tool') {
            return {
              role: 'tool',
              tool_call_id: m.toolCallId ?? '',
              content: m.content,
            };
          }
          if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            return {
              role: mapRole(model, 'assistant'),
              content: m.content || null,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args),
                },
              })),
            };
          }
          const imgs = (m.images ?? []).filter((u) => parseDataUrl(u) !== null);
          if (imgs.length === 0) return { role: mapRole(model, m.role), content: m.content };
          return {
            role: mapRole(model, m.role),
            content: [
              { type: 'text', text: m.content },
              ...imgs.map((u) => ({ type: 'image_url', image_url: { url: u } })),
            ],
          };
        }),
      ];
      const tools = config.tools && config.tools.length > 0 ? toOpenAITools(config.tools) : undefined;
      const p = sanitizeParams(config.params);
      const record = lookupModel(model, config.registry, opts.models);
      const maxTokens = Math.min(
        p.maxTokens ?? maxFor(model, config.registry),
        MAX_OUTPUT_TOKEN_CAP,
      );
      // Reasoning modelleri (openai) max_tokens yerine max_completion_tokens ister.
      const reasoning = record?.capabilities.reasoning ?? false;
      const limitField =
        reasoning && opts.name === 'openai' ? 'max_completion_tokens' : 'max_tokens';
      const endpoint = `${base}/chat/completions`;
      // İş 2: özel uç / baseUrlOverride CSP `connect-src` dışındaysa istek Rust'tan çıkar.
      const res = await fetchFor(endpoint, config.fetchImpl)(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...(opts.extraHeaders ? opts.extraHeaders(apiKey) : {}),
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
          [limitField]: maxTokens,
          ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
          ...(p.topP !== undefined ? { top_p: p.topP } : {}),
          stream_options: { include_usage: true },
          // Faz 11: prompt cache — aynı oturumun istekleri aynı önbelleğe
          // yönlendirilir (OpenAI `prompt_cache_key`; DeepSeek otomatik cache'ler).
          ...(config.cachePrompts !== false && config.promptCacheKey
            ? { prompt_cache_key: config.promptCacheKey }
            : {}),
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
        }),
        signal,
      });
      await throwIfHttpError(res);
      const toolDeltas: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }> = [];
      await feedSSELines(
        res.body,
        (payload) => {
          const json = parseJsonPayload(payload);
          if (!json) return;
          if (json.error && typeof json.error === 'object') {
            const msg = (json.error as { message?: string }).message ?? `${opts.name} hata`;
            throw new ProviderError(msg);
          }
          const usage = json.usage as
            | {
                prompt_tokens?: unknown;
                completion_tokens?: unknown;
                reasoning_tokens?: unknown;
                /** OpenAI: cache'li prompt tokenları (prompt'un alt kümesi). */
                prompt_tokens_details?: { cached_tokens?: unknown };
                /** DeepSeek: cache'li prompt tokenları. */
                prompt_cache_hit_tokens?: unknown;
              }
            | undefined;
          if (usage) {
            // o-series: reasoning_tokens completion içinde sayılır → çift sayımı önle.
            const r = toUsageCount(usage.reasoning_tokens);
            const completion = toUsageCount(usage.completion_tokens);
            const cacheRead =
              toUsageCount(usage.prompt_tokens_details?.cached_tokens) ||
              toUsageCount(usage.prompt_cache_hit_tokens);
            const u = toUsage(usage.prompt_tokens, completion - r, r, cacheRead);
            if (u) onChunk({ text: '', done: false, usage: u });
          }
          const choices = json.choices as
            | {
                delta?: {
                  content?: string;
                  reasoning_content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }[]
            | undefined;
          const delta = choices?.[0]?.delta;
          const text = delta?.content;
          if (typeof text === 'string' && text) {
            onChunk({ text, done: false });
          }
          // Faz 4: deepseek/openai-uyumlu reasoning akışı (dim blokta gösterilir).
          if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
            onChunk({ text: '', done: false, reasoning: delta.reasoning_content });
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) toolDeltas.push(tc);
          }
        },
        signal,
      );
      if (toolDeltas.length > 0) {
        const calls = accumulateOpenAIToolCalls(toolDeltas);
        if (calls.length > 0) onChunk({ text: '', done: false, toolCalls: calls });
      }
      onChunk({ text: '', done: true });
    },

    async validateKey(key: string, fetchImpl?: typeof fetch, baseUrl?: string): Promise<boolean> {
      if (!key.trim()) return false;
      try {
        const base = (baseUrl?.trim() || opts.baseUrl).replace(/\/+$/, '');
        const url = opts.validateUrl ?? `${base}/models`;
        // Özel taban URL CSP dışında olabilir → Rust proxy.
        const res = await fetchFor(url, fetchImpl)(url, {
          headers: { authorization: `Bearer ${key}` },
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
