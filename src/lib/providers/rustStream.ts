import { Channel, invoke } from '@tauri-apps/api/core';
import { ProviderError, type StreamChunk, type ThinkingBlock, type TokenUsage } from './common';
import { isTauri as isTauriRuntime } from '../tauri';

export { isTauriRuntime };

interface RustStreamEvent {
  text: string;
  done: boolean;
  error?: string;
  usage?: TokenUsage;
  /** Faz 4: thinking metni (dim blok). */
  reasoning?: string;
  /** Faz 4: birikmiş tool çağrıları (final). */
  tool_calls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  /** Faz 4: imzalı thinking blokları (final). */
  thinking?: ThinkingBlock[];
}

interface RustStreamArgs {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  /** Anthropic-format mesajlar (buildAnthropicMessages çıktısı). */
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  thinking?: { type: string; budget_tokens: number };
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  onChunk: (chunk: StreamChunk) => void;
  signal?: AbortSignal;
}

function toProviderError(err: unknown): ProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/^http (\d+):?\s?([\s\S]*)$/);
  if (m) {
    const status = Number(m[1]);
    const detail = (m[2] || `http ${status}`).slice(0, 300);
    return new ProviderError(detail || `http ${status}`, status);
  }
  if (msg.startsWith('ag hatasi:')) return new TypeError(msg);
  return new ProviderError(msg);
}

/**
 * Anthropic akisini Rust proxy (`stream_anthropic`) uzerinden surer.
 * WebView CORS'una takilmaz; `fetch` yedegi anthropic.ts'te durur.
 */
export async function streamAnthropicViaRust(args: RustStreamArgs): Promise<void> {
  const { apiKey, model, systemPrompt, messages, tools, thinking, temperature, topP, maxTokens, onChunk, signal } = args;
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  signal?.addEventListener('abort', onAbort);

  try {
    let pendingError: string | null = null;
    const channel = new Channel<RustStreamEvent>((msg) => {
      if (aborted) return;
      if (msg.error) {
        pendingError = msg.error;
        return;
      }
      if (msg.usage && (msg.usage.input > 0 || msg.usage.output > 0)) {
        onChunk({ text: '', done: false, usage: msg.usage });
      }
      if (msg.reasoning) onChunk({ text: '', done: false, reasoning: msg.reasoning });
      if (msg.text) onChunk({ text: msg.text, done: false });
      if (msg.thinking && msg.thinking.length > 0) {
        onChunk({ text: '', done: false, thinking: msg.thinking });
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        onChunk({
          text: '',
          done: false,
          toolCalls: msg.tool_calls.map((t) => ({ id: t.id, name: t.name, args: t.input })),
        });
      }
    });

    try {
      await invoke('stream_anthropic', {
        api_key: apiKey,
        model,
        system_prompt: systemPrompt ?? null,
        messages,
        tools: tools ?? null,
        thinking: thinking ?? null,
        temperature: temperature ?? null,
        top_p: topP ?? null,
        max_tokens: maxTokens ?? null,
        on_chunk: channel,
      });
    } catch (err) {
      if (signal?.aborted || aborted) throw new DOMException('aborted', 'AbortError');
      throw toProviderError(err);
    }
    if (signal?.aborted || aborted) throw new DOMException('aborted', 'AbortError');
    if (pendingError) throw new ProviderError(pendingError);
    onChunk({ text: '', done: true });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
