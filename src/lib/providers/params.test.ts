import { describe, expect, it } from 'vitest';
import { sanitizeParams } from './params';

describe('sanitizeParams', () => {
  it('boş tanımsız döner', () => {
    expect(sanitizeParams(undefined)).toEqual({});
    expect(sanitizeParams({})).toEqual({});
  });

  it('geçerli alanları geçirir', () => {
    expect(sanitizeParams({ temperature: 0.7, maxTokens: 2048.9, topP: 0.9 })).toEqual({
      temperature: 0.7,
      maxTokens: 2048,
      topP: 0.9,
    });
  });

  it('thinking topPyi ezer', () => {
    expect(sanitizeParams({ topP: 0.9, thinkingBudget: 4000 })).toEqual({ thinkingBudget: 4000 });
  });

  it('geçersizleri atar', () => {
    expect(
      sanitizeParams({ temperature: NaN, maxTokens: -5, topP: Infinity, thinkingBudget: 0 }),
    ).toEqual({});
  });
});
