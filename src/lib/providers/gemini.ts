import type { AIProvider, ProviderConfig } from './common';
import { MAX_OUTPUT_TOKEN_CAP, ProviderError, feedSSELines, lookupModel, parseDataUrl, parseJsonPayload, throwIfHttpError, toUsage } from './common';
import { sanitizeParams } from './params';
import { geminiFunctionCallToToolCall, toGeminiTools } from '../engine/toolspec';
import { createToolCallId } from '../engine/types';

const MODELS: AIProvider['models'] = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'gemini', contextWindow: 1000000, supportsVision: true, maxOutput: 65536, capabilities: { tools: true, vision: true, reasoning: true } },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'gemini', contextWindow: 1000000, supportsVision: true, maxOutput: 65536, capabilities: { tools: true, vision: true, reasoning: true } },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'gemini', contextWindow: 1000000, supportsVision: true, maxOutput: 131072, capabilities: { tools: true, vision: true, reasoning: true } },
  // Faz 12: "Nano Banana" görsel modelleri (models.dev verisiyle).
  // Not: çıktıları **görsel** — uygulama yalnızca metin çıktısı işler.
  { id: 'gemini-2.5-flash-image', name: 'Nano Banana', provider: 'gemini', contextWindow: 32768, supportsVision: true, maxOutput: 32768, capabilities: { tools: false, vision: true, reasoning: true } },
  { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', provider: 'gemini', contextWindow: 65536, supportsVision: true, maxOutput: 32768, capabilities: { tools: false, vision: true, reasoning: true } },
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', provider: 'gemini', contextWindow: 131072, supportsVision: true, maxOutput: 32768, capabilities: { tools: false, vision: true, reasoning: true } },
];

export const geminiProvider: AIProvider = {
  name: 'gemini',
  models: MODELS,

  async stream(config: ProviderConfig): Promise<void> {
    const { apiKey, model, systemPrompt, messages, onChunk, signal } = config;
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (!apiKey.trim()) {
      throw new ProviderError('api anahtarı eksik', 401);
    }
    const systemExtra = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content);
    const systemText = [systemPrompt?.trim(), ...systemExtra].filter(Boolean).join('\n\n');
    const buildGeminiContents = (rawMessages: typeof messages) => {
      const out: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
      for (const m of rawMessages) {
        if (m.role === 'tool') {
          const funcPart = {
            functionResponse: {
              name: m.toolName || 'tool',
              response: { output: m.content },
            },
          };
          const last = out[out.length - 1];
          if (last && last.role === 'function') {
            last.parts.push(funcPart);
          } else {
            out.push({
              role: 'function',
              parts: [funcPart],
            });
          }
        } else if (m.role === 'assistant') {
          const parts: Array<Record<string, unknown>> = [];
          if (m.content) {
            parts.push({ text: m.content });
          }
          if (m.toolCalls && m.toolCalls.length > 0) {
            for (const tc of m.toolCalls) {
              parts.push({
                functionCall: {
                  name: tc.name,
                  args: tc.args,
                },
              });
            }
          }
          out.push({ role: 'model', parts });
        } else if (m.role === 'user') {
          const parts: Array<Record<string, unknown>> = [
            { text: m.content },
            ...(m.images ?? [])
              .map(parseDataUrl)
              .filter((p): p is { mime: string; data: string } => p !== null)
              .map((p) => ({ inline_data: { mime_type: p.mime, data: p.data } })),
          ];
          out.push({ role: 'user', parts });
        }
      }
      return out;
    };
    const contents = buildGeminiContents(messages);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;
    const tools = config.tools && config.tools.length > 0 ? toGeminiTools(config.tools) : undefined;
    const p = sanitizeParams(config.params);
    // İş 4: 16k tavanı artık Gemini için de geçerli (registry 65k/131k reklam
    // eder; istekte hepsi tek tavana kırpılır — openai-uyumlu ile aynı kural).
    const maxOutputTokens = Math.min(
      p.maxTokens ?? lookupModel(model, config.registry, geminiProvider.models)?.maxOutput ?? 8192,
      MAX_OUTPUT_TOKEN_CAP,
    );
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(systemText ? { system_instruction: { parts: [{ text: systemText }] } } : {}),
        contents,
        generationConfig: {
          maxOutputTokens,
          ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
          ...(p.topP !== undefined ? { topP: p.topP } : {}),
        },
        ...(tools ? { tools } : {}),
      }),
      signal,
    });
    await throwIfHttpError(res);
    const pendingCalls: { name?: string; args?: Record<string, unknown> }[] = [];
    await feedSSELines(
      res.body,
      (payload) => {
        const json = parseJsonPayload(payload);
        if (!json) return;
        if (json.error && typeof json.error === 'object') {
          const msg = (json.error as { message?: string }).message ?? 'gemini hata';
          throw new ProviderError(msg);
        }
        const meta = json.usageMetadata as
          | {
              promptTokenCount?: unknown;
              candidatesTokenCount?: unknown;
              /** Cache'li prompt tokenları (context caching). */
              cachedContentTokenCount?: unknown;
            }
          | undefined;
        if (meta) {
          const u = toUsage(
            meta.promptTokenCount,
            meta.candidatesTokenCount,
            undefined,
            meta.cachedContentTokenCount,
          );
          if (u) onChunk({ text: '', done: false, usage: u });
        }
        const candidates = json.candidates as
          | { content?: { parts?: { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }[] } }[]
          | undefined;
        const parts = candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) onChunk({ text: part.text, done: false });
          if (part.functionCall) pendingCalls.push(part.functionCall);
        }
      },
      signal,
    );
    if (pendingCalls.length > 0) {
      const calls = pendingCalls
        .map((fc) => geminiFunctionCallToToolCall(fc, createToolCallId()))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (calls.length > 0) onChunk({ text: '', done: false, toolCalls: calls });
    }
    onChunk({ text: '', done: true });
  },

  async validateKey(key: string, fetchImpl?: typeof fetch): Promise<boolean> {
    if (!key.trim()) return false;
    try {
      const f = fetchImpl ?? globalThis.fetch;
      const res = await f(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      return res.ok;
    } catch {
      return false;
    }
  },
};
