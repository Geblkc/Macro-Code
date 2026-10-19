import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import { anthropicProvider, buildAnthropicMessages } from './anthropic';
import type { StreamChunk } from './common';

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l + '\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

const data = (obj: unknown) => `data: ${JSON.stringify(obj)}`;

describe('Faz 4 — reasoning/thinking akışları', () => {
  const prov = createOpenAICompatibleProvider({
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [],
  });

  it('reasoning_content dim blok olarak akar', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        data({ choices: [{ delta: { reasoning_content: 'önce düşün ' } }] }),
        data({ choices: [{ delta: { reasoning_content: 'sonra karar' } }] }),
        data({ choices: [{ delta: { content: 'yanıt' } }] }),
        'data: [DONE]',
      ]),
    );
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 's' }],
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(chunks.filter((c) => c.reasoning).map((c) => c.reasoning).join('')).toBe(
      'önce düşün sonra karar',
    );
    expect(chunks.map((c) => c.text).join('')).toBe('yanıt');
  });

  it('o-series reasoning_tokens outputa eklenmez, ayrı alanda taşınır', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        data({ usage: { prompt_tokens: 10, completion_tokens: 20, reasoning_tokens: 8 } }),
        'data: [DONE]',
      ]),
    );
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [],
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const u = chunks.find((c) => c.usage)?.usage;
    expect(u).toMatchObject({ input: 10, output: 12, reasoning: 8 });
  });

  it('anthropic thinking_delta + signature birikir', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse([
        data({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan: ' } }),
        data({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'oku' } }),
        data({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig1' } }),
        data({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'tamam' } }),
        'data: [DONE]',
      ]),
    );
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test-anahtari-1234567890',
      model: 'claude-sonnet-5-5',
      messages: [{ role: 'user', content: 's' }],
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(chunks.filter((c) => c.reasoning).map((c) => c.reasoning).join('')).toBe('plan: oku');
    expect(chunks.find((c) => c.thinking)?.thinking).toEqual([
      { thinking: 'plan: oku', signature: 'sig1' },
    ]);
    expect(chunks.map((c) => c.text).join('')).toBe('tamam');
  });

  it('buildAnthropicMessages: thinking imzalı taşınır, sıra korunur', () => {
    const out = buildAnthropicMessages([
      {
        role: 'assistant',
        content: 'bakıyorum',
        thinking: [{ thinking: 'plan', signature: 's1' }],
        toolCalls: [{ id: 't1', name: 'read_file', args: { path: 'a' } }],
      },
      { role: 'tool', content: 'içerik', toolCallId: 't1', toolName: 'read_file' },
    ]);
    expect(out).toHaveLength(2);
    const blocks = (out[0].content as Array<{ type: string }>).map((b) => b.type);
    expect(blocks).toEqual(['thinking', 'text', 'tool_use']);
    expect(out[0].content).toMatchObject([
      { type: 'thinking', thinking: 'plan', signature: 's1' },
      { type: 'text' },
      { type: 'tool_use' },
    ]);
    expect(out[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1' }],
    });
  });
});
