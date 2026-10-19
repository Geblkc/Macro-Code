import { describe, expect, it } from 'vitest';
import {
  ALL_MODELS,
  getCapabilitiesForModel,
  isKnownModel,
  isModelEnabled,
  resolveModels,
} from './index';
import type { CustomModel } from '../../types';

const custom = (over: Partial<CustomModel> & { id: string }): CustomModel => ({
  provider: 'openai',
  name: over.id,
  capabilities: { tools: true, vision: false, reasoning: false },
  ...over,
});

describe('resolveModels', () => {
  it('customsuz registry listesini döner', () => {
    expect(resolveModels()).toBe(ALL_MODELS);
    expect(resolveModels([])).toBe(ALL_MODELS);
  });

  it('yeni id eklenir', () => {
    const out = resolveModels([custom({ id: 'yeni-model' })]);
    expect(out.some((m) => m.id === 'yeni-model')).toBe(true);
    expect(out.length).toBe(ALL_MODELS.length + 1);
  });

  it('çakışmada custom kazanır', () => {
    const target = ALL_MODELS[0].id;
    const out = resolveModels([custom({ id: target, capabilities: { tools: false, vision: true, reasoning: false } })]);
    expect(out.filter((m) => m.id === target)).toHaveLength(1);
    expect(out.find((m) => m.id === target)?.capabilities.vision).toBe(true);
  });

  it('lookup customs ile çalışır', () => {
    expect(isKnownModel('yeni-model')).toBe(false);
    expect(isKnownModel('yeni-model', [custom({ id: 'yeni-model' })])).toBe(true);
    expect(getCapabilitiesForModel('yeni-model', [custom({ id: 'yeni-model' })])?.tools).toBe(true);
  });

  it('isModelEnabled liste üyeliğine bakar', () => {
    expect(isModelEnabled([], 'x')).toBe(true);
    expect(isModelEnabled(['x'], 'x')).toBe(false);
    expect(isModelEnabled(['x'], 'y')).toBe(true);
  });
});
