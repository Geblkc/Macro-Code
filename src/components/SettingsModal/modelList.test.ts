import { describe, expect, it } from 'vitest';
import { filterModels, keyedProviders, modelView } from './modelList';
import type { Draft } from './types';
import type { Model } from '../../types';

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    secrets: {
      anthropic: { value: 'sk-test', hint: '••••1234', deleted: false },
      openai: { value: '', hint: '', deleted: false },
      gemini: { value: '', hint: '', deleted: false },
      openrouter: { value: '', hint: '', deleted: false },
      deepseek: { value: '', hint: '', deleted: false },
      xai: { value: '', hint: '', deleted: false },
    },
    ollamaUrl: 'http://localhost:11434',
    baseUrlOverride: {},
    customs: [],
    activeEndpointId: null,
    currentModel: 'claude-opus-5-5',
    customModels: [],
    disabledModels: [],
    modelParams: {},
    fallbackModel: '',
    prices: {},
    systemPrompt: '',
    fontSize: 13,
    summarizerProvider: '',
    summarizerModel: '',
    showThinking: true,
    cachePrompts: true,
    mcps: [],
    customAllowList: [],
    auditEnabled: true,
    contrast: 'normal',
    uiFont: 'mono',
    clockFormat: '24h',
    showTimestamps: true,
    language: 'auto',
    ...overrides,
  };
}

const MODELS: Model[] = [
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    provider: 'openai',
    contextWindow: 1_050_000,
    supportsVision: true,
    maxOutput: 128_000,
    capabilities: { tools: true, vision: true, reasoning: true },
  },
  {
    id: 'llama3.3',
    name: 'Llama 3.3',
    provider: 'ollama',
    contextWindow: 128_000,
    supportsVision: false,
    maxOutput: 4_096,
    capabilities: { tools: false, vision: false, reasoning: false },
  },
];

describe('keyedProviders — API anahtarı görünürlüğü', () => {
  it('yazılan anahtarı kullanır', () => {
    expect(keyedProviders(draft()).anthropic).toBe('sk-test');
  });

  it('ipucu (kayıtlı anahtar) varsa onu kullanır', () => {
    const d = draft();
    d.secrets.anthropic = { value: '', hint: '••••abcd', deleted: false };
    expect(keyedProviders(d).anthropic).toBe('••••abcd');
  });

  it('silinmiş anahtar görünmez', () => {
    const d = draft();
    d.secrets.anthropic = { value: 'sk-test', hint: '••••1234', deleted: true };
    expect(keyedProviders(d).anthropic).toBe('');
  });

  it('ollama URL anahtarı olarak sayılmaz', () => {
    expect(keyedProviders(draft()).ollamaUrl).toBe('');
  });
});

describe('modelView — görünür model listesi', () => {
  it('anahtarı olmayan sağlayıcının modellerini gizler', () => {
    const view = modelView(draft());
    const openaiVisible = view.visible.some((m) => m.provider === 'openai');
    expect(openaiVisible).toBe(false);
  });

  it('anahtarı olan sağlayıcı modellerini listeler', () => {
    const view = modelView(draft());
    expect(view.visible.some((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('anahtarsız sağlayıcıları kilitli olarak bildirir', () => {
    const view = modelView(draft());
    expect(view.locked).toContain('openai');
    expect(view.locked).not.toContain('anthropic');
  });

  it('ollama anahtarsız olsa da listelenir (URL yeterli)', () => {
    const view = modelView(draft());
    expect(view.visible.some((m) => m.provider === 'ollama')).toBe(true);
  });
});

describe('filterModels — arama + sağlayıcı süzgeci', () => {
  it('boş sorgu ve boş sağlayıcı tümünü geçirir', () => {
    expect(filterModels(MODELS, '', '')).toHaveLength(MODELS.length);
  });

  it('sağlayıcıya göre süzer', () => {
    expect(filterModels(MODELS, '', 'openai')).toHaveLength(1);
  });

  it('kimliğe göre arar (büyük/küçük harf duyarsız)', () => {
    expect(filterModels(MODELS, 'GPT-6', '')).toHaveLength(1);
  });

  it('ad ve aile alanlarında arar', () => {
    expect(filterModels(MODELS, 'llama 3.3', '')).toHaveLength(1);
  });

  it('eşleşme yoksa boş döner', () => {
    expect(filterModels(MODELS, 'bulunamayacak-bir-model', '')).toHaveLength(0);
  });

  it('sağlayıcı ve arama birlikte uygulanır', () => {
    expect(filterModels(MODELS, 'llama', 'openai')).toHaveLength(0);
  });
});
