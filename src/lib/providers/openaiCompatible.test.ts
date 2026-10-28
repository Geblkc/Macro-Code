import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import { PROVIDERS, PROVIDER_IDS, PROVIDER_DEFS, ALL_MODELS, suggestProvider, getProvider } from './index';
import type { StreamChunk } from './common';
import { ProviderError } from './common';

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

function textPayload(content: string) {
  return data({ choices: [{ delta: { content } }] });
}

describe('openaiCompatible fabrikası', () => {
  const prov = createOpenAICompatibleProvider({
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
  });

  it('text delta + done akışı', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([textPayload('mer'), textPayload('haba'), 'data: [DONE]']),
    );
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'selam' }],
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(chunks.map((c) => c.text).join('')).toBe('merhaba');
    expect(chunks[chunks.length - 1].done).toBe(true);
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('usage chunk taşır', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([data({ usage: { prompt_tokens: 10, completion_tokens: 4 } }), 'data: [DONE]']),
    );
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [],
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(chunks.some((c) => c.usage?.input === 10 && c.usage?.output === 4)).toBe(true);
  });

  it('cache okuma tokenları usage içinde taşınır', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        data({
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 4,
            prompt_tokens_details: { cached_tokens: 400 },
          },
        }),
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
    expect(u?.input).toBe(1000);
    expect(u?.cacheRead).toBe(400);
  });

  it('deepseek cache_hit tokenları da okunur', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        data({ usage: { prompt_tokens: 500, completion_tokens: 10, prompt_cache_hit_tokens: 250 } }),
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
    expect(chunks.find((c) => c.usage)?.usage?.cacheRead).toBe(250);
  });

  it('parçalı tool_call birikir', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"pa' } }] } }] }),
        data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } }] }),
        'data: [DONE]',
      ]),
    );
    const { CORE_TOOLS } = await import('../engine/toolspec');
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [],
      tools: CORE_TOOLS,
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const tc = chunks.find((c) => c.toolCalls)?.toolCalls;
    expect(tc).toHaveLength(1);
    expect(tc![0].name).toBe('read_file');
    expect(tc![0].args).toMatchObject({ path: 'a.txt' });
  });

  it('error payload ProviderError fırlatır', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([data({ error: { message: 'kota bitti' } })]),
    );
    await expect(
      prov.stream({
        apiKey: 'k',
        model: 'm',
        messages: [],
        onChunk: () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('kota bitti');
  });

  it('SSE error objesindeki sayısal code status olarak aktarılır', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([data({ error: { message: 'Insufficient Balance', code: 402 } })]),
    );
    const err = await prov
      .stream({
        apiKey: 'k',
        model: 'm',
        messages: [],
        onChunk: () => {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(402);
    expect((err as ProviderError).message).toBe('Insufficient Balance');
  });

  it('boş anahtar 401, validateKey ağ hatasında false', async () => {
    await expect(
      prov.stream({ apiKey: '  ', model: 'm', messages: [], onChunk: () => {} }),
    ).rejects.toThrow();
    const okFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const failFetch = vi.fn(async () => new Response('{}', { status: 401 }));
    const errFetch = vi.fn(async () => {
      throw new TypeError('ağ');
    });
    expect(await prov.validateKey('k', okFetch as unknown as typeof fetch)).toBe(true);
    expect(await prov.validateKey('k', failFetch as unknown as typeof fetch)).toBe(false);
    expect(await prov.validateKey('k', errFetch as unknown as typeof fetch)).toBe(false);
    expect(await prov.validateKey('  ')).toBe(false);
  });

  it('görsel varsa image_url partı eklenir', async () => {
    const p = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    });
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const img = 'data:image/jpeg;base64,/9j/abc';
    await p.stream({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'bu ne?', images: [img, 'bozuk-veri'] }],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      messages: { role: string; content: unknown }[];
    };
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'bu ne?' },
      { type: 'image_url', image_url: { url: img } },
    ]);
  });

  it('yerel tool_calls ve tool sonuçları OpenAI formatında iletilir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [
        { role: 'user', content: 'dosya oku' },
        {
          role: 'assistant',
          content: 'hemen bakıyorum',
          toolCalls: [{ id: 'tc1', name: 'read_file', args: { path: 'a.txt' } }],
        },
        {
          role: 'tool',
          toolCallId: 'tc1',
          toolName: 'read_file',
          content: 'dosya içeriği',
        },
      ],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'dosya oku' });
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: 'hemen bakıyorum',
      tool_calls: [
        {
          id: 'tc1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"a.txt"}',
          },
        },
      ],
    });
    expect(body.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'tc1',
      content: 'dosya içeriği',
    });
  });

  it('model maxOutput istek limitine yansır (16k tavan)', async () => {    const p = createOpenAICompatibleProvider({
      name: 'xai',
      baseUrl: 'https://api.x.ai/v1',
      models: [
        { id: 'grok-4.20', name: 'Grok', provider: 'xai', contextWindow: 256000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },
      ],
    });
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await p.stream({
      apiKey: 'k',
      model: 'grok-4.20',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, number>;
    expect(body.max_tokens).toBe(16384);
  });

  it('extraHeaders + mapRole uygulanır', async () => {    const p = createOpenAICompatibleProvider({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [],
      extraHeaders: () => ({ 'HTTP-Referer': 'https://macrocode.app' }),
      mapRole: (_m, r) => (r === 'system' ? 'developer' : r),
    });
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await p.stream({
      apiKey: 'k',
      model: 'm',
      systemPrompt: 'sys',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['HTTP-Referer']).toBe('https://macrocode.app');
    const body = JSON.parse(opts.body as string) as { messages: { role: string }[] };
    expect(body.messages[0].role).toBe('developer');
  });
});

describe('registry bütünlüğü (7 provider)', () => {
  it('her provider kayıtlı, modelli, default model geçerli', () => {
    expect(PROVIDER_IDS).toHaveLength(7);
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id], id).toBeDefined();
      expect(PROVIDERS[id].models.length, id).toBeGreaterThan(0);
      const def = PROVIDER_DEFS[id];
      expect(def.defaultModel, id).toBeTruthy();
      expect(
        PROVIDERS[id].models.some((m) => m.id === def.defaultModel),
        `${id} default`,
      ).toBe(true);
    }
  });

  it('tüm modellerde capability + maxOutput dolu', () => {
    expect(ALL_MODELS.length).toBeGreaterThan(10);
    for (const m of ALL_MODELS) {
      expect(typeof m.capabilities.tools, m.id).toBe('boolean');
      expect(typeof m.capabilities.vision, m.id).toBe('boolean');
      expect(typeof m.capabilities.reasoning, m.id).toBe('boolean');
      expect(m.maxOutput, m.id).toBeGreaterThan(0);
      expect(m.supportsVision, m.id).toBe(m.capabilities.vision);
    }
  });

  it('suggestProvider yazım hatasında en yakını önerir', () => {
    expect(suggestProvider('openai')).toBe('openai');
    expect(suggestProvider('open')).toBe('openai');
    expect(suggestProvider('gemin')).toBe('gemini');
    expect(suggestProvider('')).toBeNull();
    expect(() => getProvider('opneai' as never)).toThrow('bunu mu demek istedin');
  });
});
