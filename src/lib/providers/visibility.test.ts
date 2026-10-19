import { describe, expect, it } from 'vitest';
import { hasProviderKey, hiddenProviders, isModelVisible, visibleModels } from './visibility';
import type { ApiKeys, Model, Provider } from '../../types';

const keys = (over: Partial<ApiKeys> = {}): ApiKeys => ({
  anthropic: '',
  openai: '',
  gemini: '',
  ollamaUrl: 'http://localhost:11434',
  openrouter: '',
  deepseek: '',
  xai: '',
  ...over,
});

const model = (id: string, provider: Provider): Model => ({
  id,
  name: id,
  provider,
  contextWindow: 100000,
  supportsVision: false,
  maxOutput: 4096,
  capabilities: { tools: true, vision: false, reasoning: false },
});

const MODELS: Model[] = [
  model('claude-opus-5-5', 'anthropic'),
  model('gpt-6.1-sol', 'openai'),
  model('llama3.3', 'ollama'),
  model('openrouter/auto', 'openrouter'),
];

describe('model görünürlüğü (API anahtarı kuralı)', () => {
  it('ollama anahtarsız da görünür (URL yeterli)', () => {
    expect(hasProviderKey('ollama', keys())).toBe(true);
    const out = visibleModels(MODELS, keys());
    expect(out.map((m) => m.id)).toEqual(['llama3.3']);
  });

  it('anahtarı olmayan sağlayıcının modelleri gizlenir', () => {
    const out = visibleModels(MODELS, keys({ anthropic: 'sk-ant-x' }));
    expect(out.map((m) => m.id)).toEqual(['claude-opus-5-5', 'llama3.3']);
  });

  it('boşluklu anahtar sayılmaz', () => {
    expect(hasProviderKey('openai', keys({ openai: '   ' }))).toBe(false);
    expect(hasProviderKey('openai', keys({ openai: ' sk-abc ' }))).toBe(true);
  });

  it('gizli sağlayıcılar listelenir (anahtar ekle satırı için)', () => {
    const out = hiddenProviders(MODELS, keys({ openai: 'sk-abc' }));
    expect(out).toEqual(['anthropic', 'openrouter']);
  });

  it('tüm anahtarlar girilmişse gizli sağlayıcı kalmaz', () => {
    const all = keys({
      anthropic: 'a',
      openai: 'b',
      gemini: 'c',
      openrouter: 'd',
      deepseek: 'e',
      xai: 'f',
    });
    expect(hiddenProviders(MODELS, all)).toEqual([]);
    expect(visibleModels(MODELS, all)).toHaveLength(MODELS.length);
  });

  it('apiKeys tanımsızsa yalnız ollama görünür', () => {
    const out = visibleModels(MODELS, undefined);
    expect(out.map((m) => m.id)).toEqual(['llama3.3']);
  });

  it('isModelVisible görünürlüğü kontrol eder', () => {
    expect(isModelVisible('claude-opus-5-5', MODELS, keys())).toBe(false);
    expect(isModelVisible('claude-opus-5-5', MODELS, keys({ anthropic: 'k' }))).toBe(true);
    expect(isModelVisible('llama3.3', MODELS, keys())).toBe(true);
  });
});
