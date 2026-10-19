import type { AIProvider, ChatItem, ProviderConfig, ThinkingBlock } from './common';
import {
  MAX_OUTPUT_TOKEN_CAP,
  ProviderError,
  feedSSELines,
  lookupModel,
  parseDataUrl,
  parseJsonPayload,
  systemTextOf,
  throwIfHttpError,
  toUsage,
  toUsageCount,
} from './common';
import { sanitizeParams } from './params';
import { approxTokens, cacheableBySize, markCacheControl } from './promptCache';
import { safeParseArgs, toAnthropicTools } from '../engine/toolspec';
import { createToolCallId } from '../engine/types';
import { isTauriRuntime, streamAnthropicViaRust } from './rustStream';

const MODELS: AIProvider['models'] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'anthropic', contextWindow: 1000000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'anthropic', contextWindow: 1000000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'anthropic', contextWindow: 1000000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: false } },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', provider: 'anthropic', contextWindow: 1000000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
];

/**
 * ChatItem[] → Anthropic messages (saf, test edilebilir).
 * Rust proxy ile fetch yolu AYNI gövdeyi gönderir (çift yol kalkar, fallback kalır).
 * Thinking blokları tool_use öncesinde imzalarıyla aynen taşınır (Anthropic sıra kuralı).
 *
 * Faz 7 A2: `role: 'system'` mesajlar (compaction özeti) buraya **girmez** —
 * Anthropic'in `messages` dizisinde system rolü yoktur; bu mesajlar istek
 * gövdesinin `system` alanına taşınır (`systemTextOf`).
 */
export function buildAnthropicMessages(
  rawMessages: ChatItem[],
  opts: { model?: string; cachePrompts?: boolean; systemText?: string } = {},
): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const m of rawMessages) {
    if (m.role === 'system') {
      // Sistem metni `system` alanında taşınır (aşağıda `systemTextOf`).
      continue;
    }
    if (m.role === 'tool') {
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as Array<unknown>).push(toolResultBlock);
      } else {
        out.push({
          role: 'user',
          content: [toolResultBlock],
        });
      }
    } else if (m.role === 'assistant') {
      if ((m.toolCalls && m.toolCalls.length > 0) || (m.thinking && m.thinking.length > 0)) {
        const blocks: Array<Record<string, unknown>> = [];
        for (const t of m.thinking ?? []) {
          blocks.push({ type: 'thinking', thinking: t.thinking, signature: t.signature });
        }
        if (m.content) {
          blocks.push({ type: 'text', text: m.content });
        }
        for (const tc of m.toolCalls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'user') {
      const imgs = (m.images ?? [])
        .map(parseDataUrl)
        .filter((p): p is { mime: string; data: string } => p !== null)
        .map((p) => ({
          type: 'image',
          source: { type: 'base64', media_type: p.mime, data: p.data },
        }));
      if (imgs.length === 0) {
        out.push({ role: 'user', content: m.content });
      } else {
        out.push({
          role: 'user',
          content: [{ type: 'text', text: m.content }, ...imgs],
        });
      }
    }
  }
  // Faz 11: prompt cache — önek (system + mesajlar) yeterince büyükse son
  // kullanıcı bloğu `cache_control` ile işaretlenir (API kısa önekte 400 döner).
  if (opts.cachePrompts && opts.model) {
    const prefixTokens = approxTokens(opts.systemText ?? '') + approxTokens(
      rawMessages.map((m) => m.content ?? '').join('\n'),
    );
    if (cacheableBySize(prefixTokens, opts.model)) {
      markCacheControl(out as Array<{ role: string; content: unknown }>, opts.model, prefixTokens);
    }
  }
  return out;
}

export const anthropicProvider: AIProvider = {
  name: 'anthropic',
  models: MODELS,

  async stream(config: ProviderConfig): Promise<void> {
    const { apiKey, model, systemPrompt, messages, onChunk, signal } = config;
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (!apiKey.trim()) {
      throw new ProviderError('api anahtarı eksik', 401);
    }
    const record = lookupModel(model, config.registry, MODELS);
    const registryMax = record?.maxOutput;
    const p = sanitizeParams(config.params);
    // Kullanıcının maxTokens girdisi de tavana tabidir (tutarlılık: openai-uyumlu
    // sağlayıcılar zaten böyle yapıyordu).
    const maxTokens = Math.min(
      p.maxTokens ?? registryMax ?? 4096,
      MAX_OUTPUT_TOKEN_CAP,
    );
    // Thinking yalnızca reasoning capability'li modelde anlamlıdır. Thinking'te
    // temperature 1'e sabitlenir ve top_p gönderilmez (API 400 verir).
    const hasThinking = p.thinkingBudget !== undefined && (record?.capabilities.reasoning ?? false);
    const thinkingCfg = hasThinking
      ? { type: 'enabled', budget_tokens: p.thinkingBudget as number }
      : undefined;
    const tools = config.tools && config.tools.length > 0 ? toAnthropicTools(config.tools) : undefined;
    // Faz 7 A2: compaction özeti ve kalıcı sistem mesajları istek gövdesinin
    // `system` alanına taşınır (Anthropic `messages` dizisinde system rolü yok).
    const systemText = [systemPrompt?.trim(), systemTextOf(messages)].filter(Boolean).join('\n\n');
    // Faz 11: prompt cache. `system` blok dizisi hâline getirilir ve son bloğa
    // `cache_control` konur (yalnızca önek ≥ eşik ise — kısa önekte API 400 döner).
    const cacheOn = config.cachePrompts !== false;
    const systemTokens = approxTokens(systemText);
    const systemCacheable = cacheOn && cacheableBySize(systemTokens, model);
    const systemBody: unknown = systemCacheable
      ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
      : systemText;
    const msgOpts = {
      model,
      cachePrompts: cacheOn,
      systemText,
    };
    // Faz 4 (K7): Tauri'de tool'lu/görsel/thinking dahil TEK Rust yolu; test
    // enjeksiyonu (`fetchImpl`) veya tarayıcı-dev doğrudan fetch kullanır.
    // Rust yolu yanıt başlamadan düşerse (TLS/ağ) fetch'e geri dönülür;
    // metin akmaya başladıysa düşme (içerik iki kez eklenmesin).
    if (config.fetchImpl === undefined && isTauriRuntime()) {
      let sawContent = false;
      try {
        await streamAnthropicViaRust({
          apiKey,
          model,
          maxTokens,
          systemPrompt: systemText || undefined,
          messages: buildAnthropicMessages(messages, msgOpts),
          tools,
          thinking: thinkingCfg,
          temperature: hasThinking ? 1 : p.temperature,
          topP: hasThinking ? undefined : p.topP,
          onChunk: (c) => {
            if (c.text || c.reasoning) sawContent = true;
            onChunk(c);
          },
          signal,
        });
        return;
      } catch (e) {
        if (sawContent) throw e;
        if (signal?.aborted) throw e;
      }
    }
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Tarayici/webview'den dogrudan erisim icin Anthropic'in istedigi baslik.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(p.temperature !== undefined || hasThinking
          ? { temperature: hasThinking ? 1 : p.temperature }
          : {}),
        ...(p.topP !== undefined && !hasThinking ? { top_p: p.topP } : {}),
        ...(thinkingCfg ? { thinking: thinkingCfg } : {}),
        ...(systemText ? { system: systemBody } : {}),
        messages: buildAnthropicMessages(messages, msgOpts),
        stream: true,
        ...(tools ? { tools } : {}),
      }),
      signal,
    });
    await throwIfHttpError(res);
    // tool_use birikimi: content_block_start (tool_use) + input_json_delta
    const toolStarts = new Map<number, { id: string; name: string }>();
    const toolJson = new Map<number, string>();
    // thinking birikimi: thinking_delta + signature_delta (imzalı geri gönderim için)
    const thinkingText = new Map<number, string>();
    const thinkingSig = new Map<number, string>();
    await feedSSELines(
      res.body,
      (payload) => {
        const json = parseJsonPayload(payload);
        if (!json) return;
        if (json.type === 'error' && json.error && typeof json.error === 'object') {
          const msg = (json.error as { message?: string }).message ?? 'anthropic hata';
          throw new ProviderError(msg);
        }
        // message_start: { message: { usage: { input_tokens, output_tokens,
        //   cache_read_input_tokens, cache_creation_input_tokens } } }
        // Anthropic `input_tokens` cache'li kısmı İÇERMEZ; toplam prompt
        // = input + cache_read + cache_creation olarak normalize edilir.
        const startUsage = (
          json.message as
            | {
                usage?: {
                  input_tokens?: unknown;
                  output_tokens?: unknown;
                  cache_read_input_tokens?: unknown;
                  cache_creation_input_tokens?: unknown;
                };
              }
            | undefined
        )?.usage;
        if (json.type === 'message_start' && startUsage) {
          const cacheRead = toUsageCount(startUsage.cache_read_input_tokens);
          const cacheWrite = toUsageCount(startUsage.cache_creation_input_tokens);
          const totalInput =
            toUsageCount(startUsage.input_tokens) + cacheRead + cacheWrite;
          const u = toUsage(
            totalInput,
            startUsage.output_tokens,
            undefined,
            cacheRead,
            cacheWrite,
          );
          if (u) onChunk({ text: '', done: false, usage: u });
        }
        // message_delta: { usage: { output_tokens } } (kumulatif)
        const deltaUsage = json.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
        if (json.type === 'message_delta' && deltaUsage) {
          const u = toUsage(deltaUsage.input_tokens, deltaUsage.output_tokens);
          if (u) onChunk({ text: '', done: false, usage: u });
        }
        if (json.type === 'content_block_start') {
          const block = json.content_block as { type?: string; id?: string; name?: string } | undefined;
          const index = typeof json.index === 'number' ? json.index : -1;
          if (block?.type === 'tool_use' && index >= 0) {
            toolStarts.set(index, {
              id: typeof block.id === 'string' ? block.id : createToolCallId(),
              name: typeof block.name === 'string' ? block.name : '',
            });
            if (!toolJson.has(index)) toolJson.set(index, '');
          }
        }
        const delta = json.delta as { type?: string; text?: string; thinking?: string; signature?: string; partial_json?: string } | undefined;
        if (json.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
          onChunk({ text: delta.text, done: false });
        }
        // Faz 4: extended thinking akışı (dim blokta gösterilir).
        if (json.type === 'content_block_delta' && delta?.type === 'thinking_delta' && delta.thinking) {
          const index = typeof json.index === 'number' ? json.index : -1;
          if (index >= 0) thinkingText.set(index, (thinkingText.get(index) ?? '') + delta.thinking);
          onChunk({ text: '', done: false, reasoning: delta.thinking });
        }
        if (json.type === 'content_block_delta' && delta?.type === 'signature_delta' && delta.signature) {
          const index = typeof json.index === 'number' ? json.index : -1;
          if (index >= 0) thinkingSig.set(index, (thinkingSig.get(index) ?? '') + delta.signature);
        }
        if (json.type === 'content_block_delta' && delta?.type === 'input_json_delta') {
          const index = typeof json.index === 'number' ? json.index : -1;
          if (index >= 0 && typeof delta.partial_json === 'string') {
            toolJson.set(index, (toolJson.get(index) ?? '') + delta.partial_json);
          }
        }
      },
      signal,
    );
    const thinking: ThinkingBlock[] = [...thinkingText.entries()].map(([idx, thinking]) => ({
      thinking,
      signature: thinkingSig.get(idx) ?? '',
    }));
    if (thinking.length > 0) onChunk({ text: '', done: false, thinking });
    if (toolStarts.size > 0) {
      const calls = [...toolStarts.entries()]
        .filter(([, s]) => !!s.name)
        .map(([idx, s]) => ({
          id: s.id,
          name: s.name,
          args: safeParseArgs(toolJson.get(idx) ?? ''),
        }));
      if (calls.length > 0) onChunk({ text: '', done: false, toolCalls: calls });
    }
    onChunk({ text: '', done: true });
  },

  async validateKey(key: string): Promise<boolean> {
    // Ucretli test cagrisindan kacinmak icin format kontrolu.
    return key.trim().startsWith('sk-ant-') && key.trim().length > 20;
  },
};
