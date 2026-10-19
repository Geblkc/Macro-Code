import { describe, expect, it, vi } from 'vitest';
import { MAX_OUTPUT_TOKEN_CAP, OLLAMA_MAX_OUTPUT_CAP, lookupModel } from './common';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { ollamaProvider } from './ollama';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import { resolveModels } from './index';
import type { Model } from '../../types';
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
const textPayload = (content: string) => data({ choices: [{ delta: { content } }] });

/** Gövdede yakalanan istekler için yardımcı. */
function capture(fetchImpl: ReturnType<typeof vi.fn>) {
  return (i: number): Record<string, unknown> => {
    const [, opts] = fetchImpl.mock.calls[i] as unknown as [string, RequestInit];
    return JSON.parse(String(opts.body)) as Record<string, unknown>;
  };
}

describe('lookupModel — İş 3: registry > sabit liste', () => {
  const builtin: Model[] = [
    {
      id: 'm1',
      name: 'M1',
      provider: 'anthropic',
      contextWindow: 1000,
      supportsVision: false,
      maxOutput: 4096,
      capabilities: { tools: false, vision: false, reasoning: false },
    },
  ];
  const custom: Model = {
    id: 'm1',
    name: 'M1 özel',
    provider: 'anthropic',
    contextWindow: 2000,
    supportsVision: true,
    maxOutput: 32000,
    capabilities: { tools: true, vision: true, reasoning: true },
  };

  it('registry verilirse o kazanır (çakışmada özel model)', () => {
    expect(lookupModel('m1', [custom, ...builtin], builtin)?.maxOutput).toBe(32000);
  });

  it('registry yoksa sabit listeye düşer', () => {
    expect(lookupModel('m1', undefined, builtin)?.maxOutput).toBe(4096);
  });

  it('hiçbiri yoksa undefined (çağıran fallback uygular)', () => {
    expect(lookupModel('yok', undefined, builtin)).toBeUndefined();
  });
});

describe('openaiCompatible — registry maxOutput + reasoning', () => {
  const prov = createOpenAICompatibleProvider({
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-dahili',
        name: 'dahili',
        provider: 'openai',
        contextWindow: 1000,
        supportsVision: false,
        maxOutput: 8192,
        capabilities: { tools: false, vision: false, reasoning: false },
      },
    ],
  });

  it('registry’deki özel model maxOutput’u kullanılır (16k tavanıyla)', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const customModel: Model = {
      id: 'benim-model',
      name: 'benim-model',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: false,
      maxOutput: 64000,
      capabilities: { tools: true, vision: false, reasoning: false },
    };
    await prov.stream({
      apiKey: 'k',
      model: 'benim-model',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [customModel],
    });
    // 64000 kayıt dışı; tavan 16384.
    expect(capture(fetchImpl)(0).max_tokens).toBe(16384);
  });

  it('registry yoksa 8192 default’u korunur', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await prov.stream({
      apiKey: 'k',
      model: 'bilinmeyen',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(capture(fetchImpl)(0).max_tokens).toBe(8192);
  });

  it('registry’deki reasoning model max_completion_tokens alır', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const customModel: Model = {
      id: 'benim-reasoner',
      name: 'benim-reasoner',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: false,
      maxOutput: 16384,
      capabilities: { tools: false, vision: false, reasoning: true },
    };
    await prov.stream({
      apiKey: 'k',
      model: 'benim-reasoner',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [customModel],
    });
    const body = capture(fetchImpl)(0);
    expect(body.max_completion_tokens).toBe(16384);
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('anthropic — registry maxOutput + thinking', () => {
  it('registry’deki model maxOutput’u kullanılır', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const customModel: Model = {
      id: 'benim-claude',
      name: 'benim-claude',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      maxOutput: 32000,
      capabilities: { tools: true, vision: true, reasoning: true },
    };
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'benim-claude',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [customModel],
    });
    // 32000 → 16384 tavanı.
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(16384);
  });

  it('registry’de reasoning true ise thinking gönderilir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const customModel: Model = {
      id: 'benim-reasoner-claude',
      name: 'r',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: false,
      maxOutput: 8192,
      capabilities: { tools: false, vision: false, reasoning: true },
    };
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'benim-reasoner-claude',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [customModel],
      params: { thinkingBudget: 2048 },
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('cache tokenları toplam prompt içinde normalize edilir', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        data({
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 600,
              output_tokens: 0,
              cache_read_input_tokens: 300,
              cache_creation_input_tokens: 100,
            },
          },
        }),
        'data: [DONE]',
      ]),
    );
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'benim-claude',
      messages: [],
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const u = chunks.find((c) => c.usage)?.usage;
    // Toplam prompt = 600 + 300 (okuma) + 100 (yazma).
    expect(u?.input).toBe(1000);
    expect(u?.cacheRead).toBe(300);
    expect(u?.cacheWrite).toBe(100);
  });
});

describe('gemini / ollama — registry maxOutput', () => {
  const geminiCustom: Model = {
    id: 'benim-gemini',
    name: 'g',
    provider: 'gemini',
    contextWindow: 1000000,
    supportsVision: true,
    maxOutput: 65536,
    capabilities: { tools: false, vision: true, reasoning: false },
  };

  it('gemini registry maxOutput kullanır', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await geminiProvider.stream({
      apiKey: 'AIza-test',
      model: 'benim-gemini',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [geminiCustom],
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    // 65536 kayıt; tavana (16384) kırpılır — İş 4.
    expect((body.generationConfig as Record<string, unknown>).maxOutputTokens).toBe(16384);
  });

  it('gemini registry değeri tavanın altındaysa aynen kullanılır', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const small: Model = {
      id: 'benim-gemini-kucuk',
      name: 'g',
      provider: 'gemini',
      contextWindow: 1000000,
      supportsVision: true,
      maxOutput: 4096,
      capabilities: { tools: false, vision: true, reasoning: false },
    };
    await geminiProvider.stream({
      apiKey: 'AIza-test',
      model: 'benim-gemini-kucuk',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [small],
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect((body.generationConfig as Record<string, unknown>).maxOutputTokens).toBe(4096);
  });

  it('ollama registry maxOutput kullanır', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const ollamaCustom: Model = {
      id: 'benim-yerel',
      name: 'y',
      provider: 'ollama',
      contextWindow: 32000,
      supportsVision: false,
      maxOutput: 2048,
      capabilities: { tools: false, vision: false, reasoning: false },
    };
    await ollamaProvider.stream({
      apiKey: 'http://localhost:11434',
      model: 'benim-yerel',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [ollamaCustom],
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect((body.options as Record<string, unknown>).num_predict).toBe(2048);
  });
});

describe('resolveModels(customModels) — registry birleştirme', () => {
  it('çakışan id’de özel model kazanır ve capability taşır', () => {
    const customs = [
      {
        id: 'claude-opus-5-5',
        name: 'özelleştirilmiş',
        provider: 'anthropic' as const,
        capabilities: { tools: false, vision: false, reasoning: false },
        maxOutput: 2048,
      },
    ];
    const merged = resolveModels(customs);
    const hit = merged.find((m) => m.id === 'claude-opus-5-5');
    expect(hit?.maxOutput).toBe(2048);
    expect(hit?.capabilities.tools).toBe(false);
  });

  it('yeni id’ler listeye eklenir', () => {
    const merged = resolveModels([
      {
        id: 'tamamen-yeni',
        name: 'yeni',
        provider: 'ollama' as const,
        capabilities: { tools: true, vision: false, reasoning: false },
      },
    ]);
    expect(merged.some((m) => m.id === 'tamamen-yeni')).toBe(true);
  });
});

describe('registry akışı chunk taşır (davranış korunur)', () => {
  it('text akışı registry ile bozulmaz', async () => {
    const chunks: StreamChunk[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([textPayload('mer'), textPayload('haba'), 'data: [DONE]']),
    );
    const prov = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    });
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'selam' }],
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [],
    });
    expect(chunks.map((c) => c.text).join('')).toBe('merhaba');
  });
});

describe('İş 4 — çıktı tavanı tutarlılığı (MAX_OUTPUT_TOKEN_CAP)', () => {
  it('tavan tek sabittir', () => {
    expect(MAX_OUTPUT_TOKEN_CAP).toBe(16384);
    expect(OLLAMA_MAX_OUTPUT_CAP).toBe(8192);
  });

  it('gemini 131072 registry değeri 16384’e kırparelır (eski asimetri)', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const pro: Model = {
      id: 'gemini-3-pro',
      name: 'p',
      provider: 'gemini',
      contextWindow: 1000000,
      supportsVision: true,
      maxOutput: 131072,
      capabilities: { tools: true, vision: true, reasoning: true },
    };
    await geminiProvider.stream({
      apiKey: 'AIza-test',
      model: 'gemini-3-pro',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      registry: [pro],
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect((body.generationConfig as Record<string, unknown>).maxOutputTokens).toBe(16384);
  });

  it('anthropic’te kullanıcı maxTokens girdisi de tavana tabidir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      params: { maxTokens: 120000 },
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(16384);
  });

  it('openai-uyumlu kullanıcı maxTokens girdisi de tavana tabidir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    const prov = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    });
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      params: { maxTokens: 999999 },
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(16384);
  });

  it('ollama kendi (düşük) tavanını korur', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await ollamaProvider.stream({
      apiKey: 'http://localhost:11434',
      model: 'llama3.3',
      messages: [],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      params: { maxTokens: 100000 },
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect((body.options as Record<string, unknown>).num_predict).toBe(8192);
  });
});
