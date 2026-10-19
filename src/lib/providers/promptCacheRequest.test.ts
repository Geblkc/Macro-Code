import { describe, expect, it, vi } from 'vitest';
import { anthropicProvider } from './anthropic';
import { createOpenAICompatibleProvider } from './openaiCompatible';

function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l + '\n'));
        c.close();
      },
    }),
    { status: 200 },
  );
}

describe('Faz 11 — istek gövdesinde prompt cache', () => {
  it('Anthropic: system bloğu cache_control içerir (önek büyükse)', async () => {
    const big = 'x'.repeat(9000); // ~2250 token
    const fetchImpl = vi.fn(async () =>
      sse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}']),
    );
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      systemPrompt: big,
      messages: [{ role: 'user', content: 'devam' }],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cachePrompts: true,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as {
      system: unknown;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(Array.isArray(body.system)).toBe(true);
    const sys = body.system as Array<Record<string, unknown>>;
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
    // Son kullanıcı bloğu da işaretli.
    const last = body.messages[body.messages.length - 1].content as unknown as Array<
      Record<string, unknown>
    >;
    expect(last[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('Anthropic: kısa önekte cache_control YOK (API 400 koruması)', async () => {
    const fetchImpl = vi.fn(async () =>
      sse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}']),
    );
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      systemPrompt: 'kısa',
      messages: [{ role: 'user', content: 'selam' }],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cachePrompts: true,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as { system: unknown };
    expect(typeof body.system).toBe('string');
  });

  it('Anthropic: cachePrompts=false → gövdede cache yok', async () => {
    const big = 'x'.repeat(9000);
    const fetchImpl = vi.fn(async () =>
      sse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}']),
    );
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      systemPrompt: big,
      messages: [{ role: 'user', content: 'devam' }],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cachePrompts: false,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as { system: unknown };
    expect(typeof body.system).toBe('string');
  });

  it('OpenAI-uyumlu: prompt_cache_key gönderilir', async () => {
    const prov = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    });
    const fetchImpl = vi.fn(async () => sse(['data: [DONE]']));
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'selam' }],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cachePrompts: true,
      promptCacheKey: 'mc-abc123',
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as { prompt_cache_key?: string };
    expect(body.prompt_cache_key).toBe('mc-abc123');
  });

  it('OpenAI-uyumlu: cache kapalıyken anahtar gönderilmez', async () => {
    const prov = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    });
    const fetchImpl = vi.fn(async () => sse(['data: [DONE]']));
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'selam' }],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cachePrompts: false,
      promptCacheKey: 'mc-abc123',
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as { prompt_cache_key?: string };
    expect(body.prompt_cache_key).toBeUndefined();
  });
});
