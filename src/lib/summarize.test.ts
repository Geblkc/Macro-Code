import { describe, expect, it } from 'vitest';
import { buildSummarizerPrompt, summarizerConfig } from './summarize';
import type { ApiKeys } from '../types';

const KEYS: ApiKeys = {
  anthropic: 'sk-ant-x',
  openai: '',
  gemini: '',
  ollamaUrl: 'http://localhost:11434',
  openrouter: '',
  deepseek: '',
  xai: '',
};

describe('Faz 2 D.3 — özetleyici yapılandırma', () => {
  it('boşsa aktif modeli kullanır', () => {
    const cfg = summarizerConfig({
      currentProvider: 'anthropic',
      currentModel: 'claude-opus-5-5',
      summarizerProvider: '',
      summarizerModel: '',
      apiKeys: KEYS,
      customModels: [],
      baseUrlOverride: {},
    });
    expect(cfg?.provider).toBe('anthropic');
    expect(cfg?.model).toBe('claude-opus-5-5');
  });

  it('doluysa ayrı özetleyiciyi kullanır', () => {
    const cfg = summarizerConfig({
      currentProvider: 'anthropic',
      currentModel: 'claude-opus-5-5',
      summarizerProvider: 'openai',
      summarizerModel: 'gpt-6-luna',
      apiKeys: { ...KEYS, openai: 'sk-x' },
      customModels: [],
      baseUrlOverride: {},
    });
    expect(cfg?.provider).toBe('openai');
    expect(cfg?.model).toBe('gpt-6-luna');
  });

  it('anahtar yoksa null (compaction atlanır)', () => {
    const cfg = summarizerConfig({
      currentProvider: 'openai',
      currentModel: 'gpt-6.1-sol',
      summarizerProvider: '',
      summarizerModel: '',
      apiKeys: { ...KEYS, anthropic: '' },
      customModels: [],
      baseUrlOverride: {},
    });
    expect(cfg).toBeNull();
  });

  it('prompt Türkçe şablonludur', () => {
    const p = buildSummarizerPrompt('geçmiş');
    expect(p).toContain('Türkçe');
    expect(p).toContain('GEÇMİŞ');
  });
});
