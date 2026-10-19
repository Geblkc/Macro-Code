import { describe, expect, it } from 'vitest';
import {
  MODELS_DEV_URL,
  fetchModelsDevCatalog,
  isChatModel,
  isStale,
  parseModelsDev,
  toCatalogEntry,
} from './modelsDev';
import type { ModelsDevCatalog } from '../../types';

const jsonFetch = (payload: unknown, ok = true, status = 200) =>
  (async () => ({
    ok,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;

/** models.dev biçiminde ham sağlayıcı kaydı. */
const devModel = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  name: 'Model 1',
  description: 'açıklama',
  family: 'test',
  attachment: false,
  reasoning: true,
  reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
  tool_call: true,
  temperature: true,
  release_date: '2026-01-01',
  last_updated: '2026-02-01',
  modalities: { input: ['text', 'image'], output: ['text'] },
  open_weights: true,
  limit: { context: 200000, output: 64000 },
  cost: { input: 3, output: 15, cache_read: 0.3 },
  ...over,
});

describe('models.dev kataloğu', () => {
  it('yalnızca eşleşen sağlayıcıları alır', () => {
    const cat = parseModelsDev({
      anthropic: { models: { 'claude-x': devModel({ id: 'claude-x' }) } },
      openai: { models: { 'gpt-x': devModel({ id: 'gpt-x' }) } },
      google: { models: { 'gemini-x': devModel({ id: 'gemini-x' }) } },
      // Listede olmayan sağlayıcılar yok sayılır.
      nanoGpt: { models: { 'x': devModel() } },
    });
    // Anahtarlar MacroCode sağlayıcı adlarıdır (models.dev `google` → `gemini`).
    expect(Object.keys(cat.providers).sort()).toEqual(['anthropic', 'gemini', 'openai']);
    expect(cat.providers.anthropic[0].id).toBe('claude-x');
    expect(cat.providers.gemini[0].provider).toBe('gemini');
  });

  it('ollama katalogda yok (yerel modeller models.dev listesinde değil)', () => {
    const cat = parseModelsDev({ ollama: { models: { 'llama3.3': devModel() } } });
    expect(cat.providers.ollama).toBeUndefined();
  });

  it('sohbet için uygun olmayan modelleri eler', () => {
    // Yalnız görsel üreten, deprecated ve çıktısı olmayan modeller elenir.
    const cat = parseModelsDev({
      openai: {
        models: {
          'gpt-ok': devModel({ id: 'gpt-ok' }),
          'gpt-image': devModel({
            id: 'gpt-image',
            modalities: { input: ['text'], output: ['image'] },
          }),
          'gpt-eski': devModel({ id: 'gpt-eski', status: 'deprecated' }),
          'gpt-beta': devModel({ id: 'gpt-beta', status: 'beta' }),
          'gpt-sifir': devModel({ id: 'gpt-sifir', limit: { context: 100, output: 0 } }),
        },
      },
    });
    expect(cat.providers.openai.map((e) => e.id)).toEqual(['gpt-ok']);
  });

  it('alanları normalize eder (limit, cost, modalities)', () => {
    const entry = toCatalogEntry('openai', devModel());
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      id: 'm1',
      provider: 'openai',
      name: 'Model 1',
      family: 'test',
      reasoning: true,
      toolCall: true,
      attachment: false,
      structuredOutput: false,
      temperature: true,
      openWeights: true,
      contextLimit: 200000,
      outputLimit: 64000,
    });
    expect(entry?.modalities.input).toEqual(['text', 'image']);
    expect(entry?.cost).toEqual({ input: 3, output: 15, cache_read: 0.3 });
    expect(entry?.reasoningOptions).toEqual([{ type: 'effort', values: ['low', 'high'] }]);
    expect(entry?.releaseDate).toBe('2026-01-01');
  });

  it('reasoning seçeneklerini çevirir (toggle/budget_tokens)', () => {
    const entry = toCatalogEntry(
      'openai',
      devModel({
        reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', min: 1024, max: 32768 }],
      }),
    );
    expect(entry?.reasoningOptions).toEqual([
      { type: 'toggle' },
      { type: 'budget_tokens', min: 1024, max: 32768 },
    ]);
  });

  it('isChatModel kurallarını uygular', () => {
    const ok = { modalities: { input: ['text'], output: ['text'] }, outputLimit: 100 };
    expect(isChatModel(ok)).toBe(true);
    expect(isChatModel({ ...ok, status: 'deprecated' })).toBe(false);
    expect(isChatModel({ ...ok, modalities: { input: ['image'], output: ['text'] } })).toBe(false);
    expect(isChatModel({ ...ok, outputLimit: 0 })).toBe(false);
  });

  it('ağ hatasını fırlatır', async () => {
    await expect(fetchModelsDevCatalog(jsonFetch({}, false, 503))).rejects.toThrow(
      /models\.dev kataloğu alınamadı/,
    );
  });

  it('bozuk JSON hatasını fırlatır', async () => {
    const bad = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('parse yok');
      },
    })) as unknown as typeof fetch;
    await expect(fetchModelsDevCatalog(bad)).rejects.toThrow(/çözümlenemedi/);
  });

  it('kataloğu çeker ve döndürür', async () => {
    const f = jsonFetch({ openai: { models: { 'gpt-x': devModel({ id: 'gpt-x' }) } } });
    const cat = await fetchModelsDevCatalog(f);
    expect(cat.providers.openai[0].id).toBe('gpt-x');
    expect(cat.fetchedAt).toBeGreaterThan(0);
  });

  it('bayatlık TTL ile belirlenir', () => {
    const now = 1_000_000;
    const fresh: ModelsDevCatalog = { fetchedAt: now, providers: {} };
    expect(isStale(fresh, now)).toBe(false);
    expect(isStale(fresh, now + 25 * 60 * 60 * 1000)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });

  it('models.dev adresi sabit', () => {
    expect(MODELS_DEV_URL).toBe('https://models.dev/api.json');
  });
});
