import type { AIProvider, ProviderConfig } from './common';
import { OLLAMA_MAX_OUTPUT_CAP, ProviderError, feedSSELines, lookupModel, parseDataUrl, parseJsonPayload, systemTextOf, throwIfHttpError, toUsage, withoutSystemMessages } from './common';
import { fetchFor } from './rustFetch';
import { sanitizeParams } from './params';

const MODELS: AIProvider['models'] = [
  { id: 'llama3.1', name: 'Llama 3.1', provider: 'ollama', contextWindow: 128000, supportsVision: false, maxOutput: 4096, capabilities: { tools: false, vision: false, reasoning: false } },
  { id: 'llama3.3', name: 'Llama 3.3', provider: 'ollama', contextWindow: 128000, supportsVision: false, maxOutput: 4096, capabilities: { tools: false, vision: false, reasoning: false } },
  { id: 'mistral', name: 'Mistral', provider: 'ollama', contextWindow: 32000, supportsVision: false, maxOutput: 4096, capabilities: { tools: false, vision: false, reasoning: false } },
  { id: 'qwen2.5', name: 'Qwen 2.5', provider: 'ollama', contextWindow: 32000, supportsVision: false, maxOutput: 4096, capabilities: { tools: false, vision: false, reasoning: false } },
  { id: 'qwen3', name: 'Qwen 3', provider: 'ollama', contextWindow: 32768, supportsVision: false, maxOutput: 4096, capabilities: { tools: false, vision: false, reasoning: true } },
  { id: 'codellama', name: 'Code Llama', provider: 'ollama', contextWindow: 16000, supportsVision: false, maxOutput: 4096, capabilities: { tools: false, vision: false, reasoning: false } },
];

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/** apiKey alani URL tasiyorsa onu kullanir (ProviderConfig spec disi degisiklik gerektirmez). */
export function resolveOllamaBase(config: ProviderConfig): string {
  const raw = (config.baseUrl ?? config.apiKey ?? '').trim() || DEFAULT_OLLAMA_URL;
  return raw.replace(/\/+$/, '');
}

export const ollamaProvider: AIProvider = {
  name: 'ollama',
  models: MODELS,

  async stream(config: ProviderConfig): Promise<void> {
    const { model, systemPrompt, messages, onChunk, signal } = config;
    const base = resolveOllamaBase(config);
    const p = sanitizeParams(config.params);
    // Faz 7 A2: sistem mesajları (compaction özeti) system alanına taşınır.
    const systemText = [systemPrompt?.trim(), systemTextOf(messages)].filter(Boolean).join('\n\n');
    const numPredict = Math.min(
      p.maxTokens ??
        lookupModel(model, config.registry, ollamaProvider.models)?.maxOutput ??
        4096,
      OLLAMA_MAX_OUTPUT_CAP,
    );
    const url = `${base}/api/chat`;
    // İş 2: uzak (LAN/hosted) Ollama CSP `connect-src` dışında kalır → Rust proxy.
    const res = await fetchFor(url, config.fetchImpl)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          // Faz 7 A2: sistem mesajları (compaction özeti) system alanına taşınır.
          ...(systemText
            ? [{ role: 'system', content: systemText }]
            : []),
          ...withoutSystemMessages(messages).map((m) => {
            if (m.role === 'tool') {
              return { role: 'tool', content: m.content };
            }
            if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
              return {
                role: 'assistant',
                content: m.content,
                tool_calls: m.toolCalls.map((tc) => ({
                  function: { name: tc.name, arguments: tc.args },
                })),
              };
            }
            const imgs = (m.images ?? [])
              .map(parseDataUrl)
              .filter((p): p is { mime: string; data: string } => p !== null)
              .map((p) => p.data);
            return {
              role: m.role,
              content: m.content,
              ...(imgs.length > 0 ? { images: imgs } : {}),
            };
          }),
        ],
        stream: true,
        options: {
          num_predict: numPredict,
          ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
          ...(p.topP !== undefined ? { top_p: p.topP } : {}),
        },
      }),
      signal,
    });
    await throwIfHttpError(res);
    await feedSSELines(
      res.body,
      (payload) => {
        const json = parseJsonPayload(payload);
        if (!json) return;
        if (typeof json.error === 'string' && json.error) {
          throw new ProviderError(json.error);
        }
        const u = toUsage(json.prompt_eval_count, json.eval_count);
        if (u) onChunk({ text: '', done: false, usage: u });
        const message = json.message as { content?: string } | undefined;
        if (message && typeof message.content === 'string' && message.content) {
          onChunk({ text: message.content, done: false });
        }
        if (json.done === true) {
          onChunk({ text: '', done: true });
          return true;
        }
      },
      signal,
    );
    onChunk({ text: '', done: true });
  },

  async validateKey(key: string, fetchImpl?: typeof fetch): Promise<boolean> {
    const base = (key.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
    const url = `${base}/api/tags`;
    try {
      const res = await fetchFor(url, fetchImpl)(url);
      return res.ok;
    } catch {
      return false;
    }
  },
};

/**
 * Kurulu Ollama modellerini listeler (`GET {base}/api/tags`).
 * Başarısızlıkta hata fırlatır (çağıran kullanıcıya gösterir).
 */
export async function listOllamaModels(
  baseUrl: string,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  const base = (baseUrl.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const url = `${base}/api/tags`;
  const res = await fetchFor(url, fetchImpl)(url);
  if (!res.ok) throw new Error(`ollama listesi alınamadı (http ${res.status})`);
  const json = (await res.json()) as { models?: { name?: unknown }[] };
  const names = (json.models ?? [])
    .map((m) => (typeof m?.name === 'string' ? m.name : ''))
    .filter((n): n is string => n.length > 0);
  return [...new Set(names)];
}
