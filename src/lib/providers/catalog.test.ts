import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCatalogIndex,
  catalogModels,
  catalogPriceOf,
  enrichModel,
  enrichModels,
  matchCatalogEntry,
  setActiveCatalog,
  toModel,
} from './catalog';
import { resolveModels } from './index';
import type { CatalogEntry, Model, ModelsDevCatalog } from '../../types';

const entry = (over: Partial<CatalogEntry> & { id: string }): CatalogEntry => ({
  provider: 'anthropic',
  name: 'Test Model',
  description: 'test açıklaması',
  reasoning: false,
  reasoningOptions: [],
  toolCall: true,
  attachment: false,
  structuredOutput: false,
  temperature: true,
  openWeights: false,
  modalities: { input: ['text'], output: ['text'] },
  contextLimit: 100000,
  outputLimit: 8000,
  ...over,
});

const model = (over: Partial<Model> & { id: string; provider: Model['provider'] }): Model => ({
  name: over.id,
  contextWindow: 100000,
  supportsVision: false,
  maxOutput: 4096,
  capabilities: { tools: true, vision: false, reasoning: false },
  ...over,
});

const catalog = (providers: Record<string, CatalogEntry[]>): ModelsDevCatalog => ({
  fetchedAt: 1,
  providers,
});

afterEach(() => {
  setActiveCatalog(null);
});

describe('catalog eşleştirme', () => {
  it('doğrudan eşleşme: aynı sağlayıcı + id', () => {
    const index = buildCatalogIndex(catalog({ anthropic: [entry({ id: 'claude-x' })] }));
    const m = model({ id: 'claude-x', provider: 'anthropic' });
    expect(matchCatalogEntry(m, index)?.id).toBe('claude-x');
  });

  it('canonical id ile eşleşir', () => {
    const index = buildCatalogIndex(
      catalog({
        anthropic: [entry({ id: 'claude-x-20260101', canonicalModelId: 'claude-x' })],
      }),
    );
    const m = model({ id: 'claude-x', provider: 'anthropic' });
    expect(matchCatalogEntry(m, index)?.id).toBe('claude-x-20260101');
  });

  it('global id ile eşleşir (başka sağlayıcıda geçiyor)', () => {
    const index = buildCatalogIndex(
      catalog({ deepseek: [entry({ id: 'deepseek-chat', provider: 'deepseek' })] }),
    );
    const m = model({ id: 'deepseek-chat', provider: 'deepseek' });
    expect(matchCatalogEntry(m, index)?.id).toBe('deepseek-chat');
  });

  it('hiçbir aşamada eşleşmezse undefined döner', () => {
    const index = buildCatalogIndex(catalog({ anthropic: [entry({ id: 'başka' })] }));
    const m = model({ id: 'yok', provider: 'ollama' });
    expect(matchCatalogEntry(m, index)).toBeUndefined();
  });

  it('doğrudan eşleşme canonical ve global den önce gelir', () => {
    const index = buildCatalogIndex(
      catalog({
        anthropic: [
          entry({ id: 'x', provider: 'anthropic', contextLimit: 111 }),
          entry({ id: 'x', provider: 'openai', contextLimit: 999 }),
        ],
      }),
    );
    const m = model({ id: 'x', provider: 'anthropic' });
    expect(matchCatalogEntry(m, index)?.contextLimit).toBe(111);
  });
});

describe('catalog zenginleştirme', () => {
  it('limitleri büyütür ama küçültmez', () => {
    const index = buildCatalogIndex(catalog({ anthropic: [entry({ id: 'x', contextLimit: 500000, outputLimit: 64000 })] }));
    const m = model({ id: 'x', provider: 'anthropic', contextWindow: 100000, maxOutput: 4096 });
    const out = enrichModel(m, index);
    expect(out.contextWindow).toBe(500000);
    expect(out.maxOutput).toBe(64000);
  });

  it('küçük katalog limiti yerleşik değeri bozmaz', () => {
    const index = buildCatalogIndex(catalog({ anthropic: [entry({ id: 'x', contextLimit: 1000, outputLimit: 0 })] }));
    const m = model({ id: 'x', provider: 'anthropic', contextWindow: 200000, maxOutput: 8192 });
    const out = enrichModel(m, index);
    expect(out.contextWindow).toBe(200000);
    expect(out.maxOutput).toBe(8192);
  });

  it('yetenekler yalnız kazanır (kapı kapanmaz)', () => {
    const index = buildCatalogIndex(
      catalog({
        anthropic: [
          entry({ id: 'x', reasoning: false, toolCall: false, modalities: { input: ['text'], output: ['text'] } }),
        ],
      }),
    );
    const m = model({
      id: 'x',
      provider: 'anthropic',
      capabilities: { tools: true, vision: true, reasoning: true },
      supportsVision: true,
    });
    const out = enrichModel(m, index);
    expect(out.capabilities.tools).toBe(true);
    expect(out.capabilities.reasoning).toBe(true);
  });

  it('görsel yeteneği katalogdan gelir ve supportsVision eşitlenir', () => {
    const index = buildCatalogIndex(
      catalog({
        openai: [entry({ id: 'x', provider: 'openai', modalities: { input: ['text', 'image'], output: ['text'] } })],
      }),
    );
    const m = model({ id: 'x', provider: 'openai' });
    const out = enrichModel(m, index);
    expect(out.capabilities.vision).toBe(true);
    expect(out.supportsVision).toBe(true);
  });

  it('açıklama, aile ve yayın tarihi katalogdan gelir', () => {
    const index = buildCatalogIndex(
      catalog({
        anthropic: [entry({ id: 'x', description: 'harika model', family: 'claude', releaseDate: '2026-05-01' })],
      }),
    );
    const out = enrichModel(model({ id: 'x', provider: 'anthropic' }), index);
    expect(out.description).toBe('harika model');
    expect(out.family).toBe('claude');
    expect(out.releaseDate).toBe('2026-05-01');
  });

  it('eşleşmeyen model değişmez', () => {
    const index = buildCatalogIndex(catalog({ anthropic: [entry({ id: 'başka' })] }));
    const m = model({ id: 'yok', provider: 'anthropic' });
    expect(enrichModel(m, index)).toBe(m);
  });

  it('katalog fiyatı ModelPrice biçimine çevrilir', () => {
    const e = entry({ id: 'x', cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } });
    expect(catalogPriceOf(e)).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    expect(catalogPriceOf(entry({ id: 'y' }))).toBeUndefined();
  });

  it('enrichModels listeyi zenginleştirir', () => {
    const index = buildCatalogIndex(catalog({ anthropic: [entry({ id: 'x', family: 'claude' })] }));
    const out = enrichModels(
      [model({ id: 'x', provider: 'anthropic' }), model({ id: 'y', provider: 'anthropic' })],
      index,
    );
    expect(out[0].family).toBe('claude');
    expect(out[1].family).toBeUndefined();
  });
});

describe('aktif katalog (global)', () => {
  it('resolveModels yerleşik modelleri katalogla zenginleştirir', () => {
    setActiveCatalog(catalog({ anthropic: [entry({ id: 'claude-opus-5-5', family: 'claude', contextLimit: 2000000 })] }));
    const out = resolveModels([]);
    const m = out.find((x) => x.id === 'claude-opus-5-5');
    expect(m?.family).toBe('claude');
    expect(m?.contextWindow).toBe(2000000);
  });

  it('katalog yoksa liste olduğu gibi kalır', () => {
    setActiveCatalog(null);
    const out = resolveModels([]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.family === undefined)).toBe(true);
  });
});

describe('katalog → registry (toModel / catalogModels)', () => {
  it('toModel limit ve yetenekleri aktarır', () => {
    const m = toModel(
      entry({
        id: 'x',
        name: 'Model X',
        contextLimit: 500000,
        outputLimit: 64000,
        reasoning: true,
        toolCall: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        description: 'açıklama',
        family: 'aile',
        releaseDate: '2026-01-01',
      }),
    );
    expect(m.id).toBe('x');
    expect(m.name).toBe('Model X');
    expect(m.contextWindow).toBe(500000);
    expect(m.maxOutput).toBe(64000);
    expect(m.capabilities).toEqual({ tools: true, vision: true, reasoning: true });
    expect(m.supportsVision).toBe(true);
    expect(m.description).toBe('açıklama');
    expect(m.family).toBe('aile');
    expect(m.releaseDate).toBe('2026-01-01');
  });

  it('toModel katalog fiyatını catalogPrice olarak taşır', () => {
    const m = toModel(entry({ id: 'x', cost: { input: 3, output: 15, cache_read: 0.3 } }));
    expect(m.catalogPrice).toEqual({ input: 3, output: 15, cacheRead: 0.3 });
  });

  it('catalogModels tüm katalog modellerini döndürür', () => {
    const cat = catalog({
      anthropic: [entry({ id: 'a1' })],
      openai: [entry({ id: 'o1', provider: 'openai' })],
    });
    const out = catalogModels(cat);
    expect(out.map((m) => m.id).sort()).toEqual(['a1', 'o1']);
    expect(catalogModels(null)).toEqual([]);
  });

  it('katalog modelleri registry listesine otomatik eklenir', () => {
    setActiveCatalog(
      catalog({
        openai: [entry({ id: 'yeni-model', provider: 'openai', family: 'test' })],
      }),
    );
    const out = resolveModels([]);
    expect(out.some((m) => m.id === 'yeni-model')).toBe(true);
    // Çekirdek modeller korunur (katalog onları silmez).
    expect(out.some((m) => m.id === 'claude-opus-5-5')).toBe(true);
    setActiveCatalog(null);
  });

  it('çekirdek model katalogla çakışırsa çekirdek kazanır', () => {
    setActiveCatalog(
      catalog({
        anthropic: [entry({ id: 'claude-opus-5-5', family: 'katalog-ailesi' })],
      }),
    );
    const out = resolveModels([]);
    const hits = out.filter((m) => m.id === 'claude-opus-5-5');
    expect(hits).toHaveLength(1);
    // Çekirdek satır korunur ama katalog metadata'sı zenginleştirir.
    expect(hits[0].name).toBe('Claude Opus 5.5');
    expect(hits[0].family).toBe('katalog-ailesi');
    setActiveCatalog(null);
  });
});
