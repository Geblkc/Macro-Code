import { describe, expect, it } from 'vitest';
import { apiKeyFor, resolveFallbackTarget } from './useStream';
import type { ApiKeys } from '../types';

const KEYS: ApiKeys = {
  anthropic: 'sk-ant-test',
  openai: '',
  gemini: '',
  ollamaUrl: 'http://localhost:11434',
  openrouter: '',
  deepseek: '',
  xai: '',
};

const base = {
  endpointActive: false,
  currentModel: 'claude-opus-5-5',
  fallbackModel: '',
  customModels: [],
  apiKeys: KEYS,
};

describe('resolveFallbackTarget — yedek modelin SAHİBİ çözülür (İş 1)', () => {
  it('fallback farklı sağlayıcıdan → o sağlayıcı döner', () => {
    // Eski davranış: istek hâlâ Anthropic'e `model: "gpt-6.1-sol"` ile gidiyordu.
    expect(
      resolveFallbackTarget({ ...base, fallbackModel: 'gpt-6.1-sol', apiKeys: { ...KEYS, openai: 'sk-test' } }),
    ).toEqual({ provider: 'openai', model: 'gpt-6.1-sol' });
  });

  it('fallback aynı sağlayıcıdan → aynı sağlayıcı döner', () => {
    expect(
      resolveFallbackTarget({ ...base, fallbackModel: 'claude-haiku-5-5' }),
    ).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5' });
  });

  it('fallback yedek modelin anahtarı yoksa null (yanlış API isteği gitmez)', () => {
    // openai anahtarı boş → yedek devre dışı
    expect(resolveFallbackTarget({ ...base, fallbackModel: 'gpt-6.1-sol' })).toBeNull();
  });

  it('fallback anahtarı doluysa aktif', () => {
    expect(
      resolveFallbackTarget({
        ...base,
        fallbackModel: 'grok-4.20',
        apiKeys: { ...KEYS, xai: 'xai-test' },
      }),
    ).toEqual({ provider: 'xai', model: 'grok-4.20' });
  });

  it('ollama anahtar istemez → her zaman uygun', () => {
    expect(
      resolveFallbackTarget({ ...base, fallbackModel: 'llama3.3' }),
    ).toEqual({ provider: 'ollama', model: 'llama3.3' });
  });

  it('fallback kapalı → null', () => {
    expect(resolveFallbackTarget(base)).toBeNull();
  });

  it('fallback = aktif model → null (kendine fallback olmaz)', () => {
    expect(
      resolveFallbackTarget({ ...base, fallbackModel: 'claude-opus-5-5' }),
    ).toBeNull();
  });

  it('özel uç aktifken yedek yok sayılır', () => {
    expect(
      resolveFallbackTarget({
        ...base,
        endpointActive: true,
        fallbackModel: 'claude-haiku-5-5',
      }),
    ).toBeNull();
  });

  it('registry’de karşılığı olmayan model → null (bilinmeyen sağlayıcı)', () => {
    expect(
      resolveFallbackTarget({ ...base, fallbackModel: 'var-olmayan-model-9' }),
    ).toBeNull();
  });

  it('custom model üzerinden çözüm yapılır (anahtar şartı korunur)', () => {
    const customModels = [
      {
        id: 'benim-proxy-model',
        name: 'benim-proxy-model',
        provider: 'deepseek' as const,
        capabilities: { tools: true, vision: false, reasoning: false },
      },
    ];
    // deepseek anahtarı boş → null
    expect(
      resolveFallbackTarget({ ...base, fallbackModel: 'benim-proxy-model', customModels }),
    ).toBeNull();
    // anahtar dolu → custom model kendi sağlayıcısıyla döner
    expect(
      resolveFallbackTarget({
        ...base,
        fallbackModel: 'benim-proxy-model',
        customModels,
        apiKeys: { ...KEYS, deepseek: 'sk-test' },
      }),
    ).toEqual({ provider: 'deepseek', model: 'benim-proxy-model' });
  });

  it('boşluklu/boş değerler güvenli şekilde elenir', () => {
    expect(resolveFallbackTarget({ ...base, fallbackModel: '   ' })).toBeNull();
    expect(resolveFallbackTarget({ ...base, fallbackModel: '  claude-opus-5-5  ' })).toBeNull();
  });
});

describe('apiKeyFor — ollama anahtar alanı URL taşır', () => {
  it('ollama → ollamaUrl', () => {
    expect(apiKeyFor('ollama', KEYS)).toBe('http://localhost:11434');
  });

  it('diğerleri → kendi alanı', () => {
    expect(apiKeyFor('anthropic', KEYS)).toBe('sk-ant-test');
    expect(apiKeyFor('xai', KEYS)).toBe('');
  });

  it('ollamaUrl boşsa fabrika URL’sine düşer', () => {
    expect(apiKeyFor('ollama', { ...KEYS, ollamaUrl: '' })).toBe('http://localhost:11434');
  });
});
