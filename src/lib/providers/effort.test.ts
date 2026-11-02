import { describe, expect, it, vi } from 'vitest';
import type { Model } from '../../types';
import {
  effortThinkingBudget,
  effortValuesForModel,
  geminiThinkingLevel,
  isEffortCommand,
  normalizeEffort,
} from './effort';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import type { StreamChunk } from './common';

function model(over: Partial<Model> = {}): Model {
  return {
    id: 'test-model',
    name: 'Test',
    provider: 'openai',
    contextWindow: 128000,
    supportsVision: false,
    maxOutput: 8192,
    capabilities: { tools: true, vision: false, reasoning: true },
    ...over,
  };
}

function sseResponse(): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('data: [DONE]\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe('efor yardımcıları', () => {
  it('normalizeEffort kırpar, küçültür, geçersizi atar', () => {
    expect(normalizeEffort(' HIGH ')).toBe('high');
    expect(normalizeEffort('xhigh')).toBe('xhigh');
    expect(normalizeEffort('')).toBeUndefined();
    expect(normalizeEffort('   ')).toBeUndefined();
    expect(normalizeEffort(42)).toBeUndefined();
    expect(normalizeEffort('x'.repeat(33))).toBeUndefined();
  });

  it('katalog effort değerlerini tekilleştirir', () => {
    const m = model({
      reasoningOptions: [
        { type: 'toggle' },
        { type: 'effort', values: ['low', 'HIGH', 'low', 'max'] },
      ],
    });
    expect(effortValuesForModel(m)).toEqual(['low', 'high', 'max']);
  });

  it('efor seçeneği yoksa güvenli fallback döner', () => {
    expect(effortValuesForModel(model())).toEqual(['low', 'medium', 'high']);
    expect(effortValuesForModel(undefined)).toEqual(['low', 'medium', 'high']);
  });

  it('reasoning kapalı ve Ollama desteklemez', () => {
    expect(
      effortValuesForModel(model({ capabilities: { tools: true, vision: false, reasoning: false } })),
    ).toEqual([]);
    expect(effortValuesForModel(model({ provider: 'ollama' }))).toEqual([]);
  });

  it('slash yazımları: /effort, /efforts, /effors', () => {
    expect(isEffortCommand('/effort')).toBe(true);
    expect(isEffortCommand('/efforts')).toBe(true);
    expect(isEffortCommand('/effors')).toBe(true);
    expect(isEffortCommand('  /EFFORT  ')).toBe(true);
    expect(isEffortCommand('/effort high')).toBe(true);
    expect(isEffortCommand('/effor')).toBe(false);
    expect(isEffortCommand('effort')).toBe(false);
    expect(isEffortCommand('/model')).toBe(false);
  });

  it('Gemini seviye ve bütçe eşlemesi', () => {
    expect(geminiThinkingLevel('low')).toBe('low');
    expect(geminiThinkingLevel('medium')).toBe('medium');
    expect(geminiThinkingLevel('minimal')).toBe('low');
    expect(geminiThinkingLevel('xhigh')).toBe('high');
    expect(effortThinkingBudget('low')).toBe(2048);
    expect(effortThinkingBudget('medium')).toBe(8192);
    expect(effortThinkingBudget('max')).toBe(24576);
    expect(effortThinkingBudget('bilinmeyen')).toBe(16384);
  });
});

describe('efor istek gövdesine yansır', () => {
  it('OpenAI-uyumlu reasoning_effort gönderir', async () => {
    const prov = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    });
    const fetchImpl = vi.fn(async () => sseResponse());
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [],
      params: { reasoningEffort: 'high' },
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe('high');
    expect(body.reasoning).toBeUndefined();
  });

  it('OpenRouter birleşik reasoning nesnesi gönderir', async () => {
    const prov = createOpenAICompatibleProvider({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [],
    });
    const fetchImpl = vi.fn(async () => sseResponse());
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      messages: [],
      params: { reasoningEffort: 'medium' },
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('Anthropic output_config.effort gönderir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse());
    const chunks: StreamChunk[] = [];
    await anthropicProvider.stream({
      apiKey: 'k',
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'selam' }],
      params: { reasoningEffort: 'xhigh' },
      onChunk: (c) => chunks.push(c),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.output_config).toEqual({ effort: 'xhigh' });
    expect(body.thinking).toBeUndefined();
  });

  it('Gemini 3 thinkingConfig.thinkingLevel gönderir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse());
    await geminiProvider.stream({
      apiKey: 'k',
      model: 'gemini-3-pro',
      messages: [{ role: 'user', content: 'selam' }],
      params: { reasoningEffort: 'low' },
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      generationConfig?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(body.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('Gemini 4 thinkingConfig.thinkingLevel gönderir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse());
    await geminiProvider.stream({
      apiKey: 'k',
      model: 'gemini-4-argon',
      messages: [{ role: 'user', content: 'selam' }],
      params: { reasoningEffort: 'medium' },
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      generationConfig?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(body.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
  });

  it('Gemini 2.5 thinkingConfig.thinkingBudget gönderir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse());
    await geminiProvider.stream({
      apiKey: 'k',
      model: 'gemini-2.5-flash-image',
      messages: [{ role: 'user', content: 'selam' }],
      params: { reasoningEffort: 'low' },
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      generationConfig?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(body.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 2048 });
  });
});
