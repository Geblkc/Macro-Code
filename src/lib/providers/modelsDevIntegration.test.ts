import { describe, expect, it } from 'vitest';
import { parseModelsDev } from './modelsDev';
import { buildCatalogIndex, matchCatalogEntry, setActiveCatalog } from './catalog';
import { ALL_MODELS, resolveModels } from './index';
import type { Model, ModelsDevCatalog } from '../../types';

/**
 * models.dev GERÇEK verisinden alınmış fixture (kısaltılmış).
 *
 * Kapsam: her sağlayıcıdan birkaç model + eşleşmeyen id'ler
 * (`deepseek-chat` yalnız üçüncü tarafta, `grok-4.20` hiçbir yerde yok).
 */
const FIXTURE = {
  anthropic: {
    models: {
      'claude-opus-5-5': {
        id: 'claude-opus-5-5',
        name: 'Claude Opus 5.5',
        description: 'Claude model for long-running agentic coding and knowledge work',
        family: 'claude-opus',
        attachment: true,
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
        tool_call: true,
        structured_output: true,
        temperature: false,
        knowledge: '2026-06',
        release_date: '2026-09-22',
        last_updated: '2026-09-22',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        open_weights: false,
        limit: { context: 1000000, output: 128000 },
        cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
      },
    },
  },
  openai: {
    models: {
      'gpt-6.1-sol': {
        id: 'gpt-6.1-sol',
        name: 'GPT-6.1 Sol',
        description: 'Flagship reasoning model',
        family: 'gpt-6',
        attachment: true,
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
        tool_call: true,
        structured_output: true,
        temperature: true,
        knowledge: '2026-05',
        release_date: '2026-09-29',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        limit: { context: 1050000, output: 128000 },
        cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
      },
    },
  },
  google: {
    models: {
      'gemini-3.8-flash': {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        description: 'Fast multimodal model',
        family: 'gemini-flash',
        attachment: true,
        reasoning: true,
        reasoning_options: [{ type: 'budget_tokens', min: 0, max: 24576 }],
        tool_call: true,
        structured_output: true,
        temperature: true,
        knowledge: '2026-05',
        release_date: '2026-09-02',
        modalities: { input: ['text', 'image', 'audio', 'video', 'pdf'], output: ['text'] },
        open_weights: false,
        limit: { context: 1048576, output: 65536 },
        cost: { input: 0.75, output: 3.75, cache_read: 0.075, input_audio: 0.75 },
      },
    },
  },
  openrouter: {
    models: {
      'openrouter/auto': {
        id: 'openrouter/auto',
        name: 'Auto',
        description: 'Automatically selects the best model',
        reasoning: false,
        tool_call: true,
        temperature: true,
        release_date: '2025-01-01',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: false,
        limit: { context: 1000000, output: 32000 },
        cost: { input: 0, output: 0 },
      },
    },
  },
  deepseek: {
    models: {
      'deepseek-v4-flash': {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        description: 'Fast DeepSeek V4 lane',
        family: 'deepseek-flash',
        reasoning: true,
        tool_call: true,
        structured_output: true,
        temperature: true,
        release_date: '2026-04-24',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.098, output: 0.196, cache_read: 0.028 },
      },
    },
  },
  xai: {
    models: {
      'grok-4.7': {
        id: 'grok-4.7',
        name: 'Grok 4.7',
        description: 'xAI flagship',
        reasoning: true,
        tool_call: true,
        temperature: true,
        release_date: '2026-09-21',
        modalities: { input: ['text', 'image'], output: ['text'] },
        open_weights: false,
        limit: { context: 500000, output: 500000 },
        cost: { input: 2, output: 6, cache_read: 0.5 },
      },
    },
  },
  // `deepseek-chat` models.dev'de doğrudan DeepSeek altında DEĞİL —
  // yalnız üçüncü taraf sağlayıcılarda listeleniyor (global eşleşme senaryosu).
  'nano-gpt': {
    models: {
      'deepseek-chat': {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        description: 'General purpose chat model',
        reasoning: false,
        tool_call: true,
        temperature: true,
        release_date: '2025-01-01',
        modalities: { input: ['text'], output: ['text'] },
        open_weights: true,
        limit: { context: 131072, output: 8192 },
        cost: { input: 0.19, output: 0.71, cache_read: 0.06 },
      },
    },
  },
} as unknown;

const catalog: ModelsDevCatalog = parseModelsDev(FIXTURE);
const index = buildCatalogIndex(catalog);

const builtin = (id: string): Model | undefined => ALL_MODELS.find((m) => m.id === id);

describe('models.dev gerçek veri entegrasyonu', () => {
  it('katalog yalnızca eşleşen sağlayıcıları içerir', () => {
    expect(Object.keys(catalog.providers).sort()).toEqual([
      'anthropic',
      'deepseek',
      'gemini',
      'openai',
      'openrouter',
      'xai',
    ]);
  });

  it('anthropic modeli fiyat ve metadata ile eşleşir', () => {
    const m = builtin('claude-opus-5-5');
    expect(m).toBeDefined();
    const e = matchCatalogEntry(m as Model, index);
    expect(e?.id).toBe('claude-opus-5-5');
    expect(e?.cost?.input).toBe(4);
    expect(e?.cost?.output).toBe(20);
    expect(e?.cost?.cache_read).toBe(0.2);
    expect(e?.reasoningOptions[0]).toEqual({
      type: 'effort',
      values: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  it('gemini models.dev `google` anahtarından gelir', () => {
    const m = builtin('gemini-3.8-flash');
    const e = matchCatalogEntry(m as Model, index);
    expect(e?.provider).toBe('gemini');
    expect(e?.contextLimit).toBe(1048576);
  });

  it('openrouter/auto eşleşir', () => {
    const m = builtin('openrouter/auto');
    expect(matchCatalogEntry(m as Model, index)?.id).toBe('openrouter/auto');
  });

  it('kapsam dışı sağlayıcıdaki modeller kataloğa girmez', () => {
    // `deepseek-chat` models.dev'de yalnız üçüncü taraf sağlayıcılarda listeleniyor;
    // katalog 6 yerleşik sağlayıcıyla sınırlı olduğu için eşleşmez.
    const m = builtin('deepseek-chat');
    expect(m).toBeDefined();
    expect(matchCatalogEntry(m as Model, index)).toBeUndefined();
    expect(catalog.providers['nano-gpt']).toBeUndefined();
  });

  it('katalogda olmayan modeller eşleşmez (yerleşik değerler kalır)', () => {
    // `grok-4.20` ve `llama3.3` fixture'da yok.
    expect(matchCatalogEntry(builtin('grok-4.20') as Model, index)).toBeUndefined();
    expect(matchCatalogEntry(builtin('llama3.3') as Model, index)).toBeUndefined();
  });

  it('zenginleştirme yerleşik limitleri küçültmez', () => {
    setActiveCatalog(catalog);
    const out = resolveModels([]);
    const opus = out.find((m) => m.id === 'claude-opus-5-5');
    // Yerleşik 1M ctx / 128k out — katalogla aynı, düşmez.
    expect(opus?.contextWindow).toBe(1000000);
    expect(opus?.maxOutput).toBe(128000);
    expect(opus?.family).toBe('claude-opus');
    expect(opus?.catalogPrice).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
    });
    setActiveCatalog(null);
  });

  it('eşleşmeyen modeller zenginleşmeden kalır', () => {
    setActiveCatalog(catalog);
    const out = resolveModels([]);
    const llama = out.find((m) => m.id === 'llama3.3');
    expect(llama?.family).toBeUndefined();
    expect(llama?.catalogPrice).toBeUndefined();
    expect(llama?.contextWindow).toBe(128000);
    setActiveCatalog(null);
  });

  it('zenginleştirilmiş modeller registry invariantlarını korur', () => {
    setActiveCatalog(catalog);
    for (const m of resolveModels([])) {
      expect(typeof m.capabilities.tools).toBe('boolean');
      expect(typeof m.capabilities.vision).toBe('boolean');
      expect(typeof m.capabilities.reasoning).toBe('boolean');
      expect(m.maxOutput).toBeGreaterThan(0);
      expect(m.supportsVision).toBe(m.capabilities.vision);
    }
    setActiveCatalog(null);
  });
});
