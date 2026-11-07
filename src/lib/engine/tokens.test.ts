import { describe, expect, it } from 'vitest';
import {
  approxHistoryTokens,
  approxMessageTokens,
  budgetFor,
  compactAtPercent,
  compactionLimitFor,
  CONTEXT_COMPACT_RATIO,
  windowFor,
} from './tokens';

describe('Faz 2 — token tahmini', () => {
  it('bilinen örneklerde bant aralığı (±%30)', () => {
    const len = 400;
    const t = approxMessageTokens({ content: 'a'.repeat(len) });
    const plain = len / 4;
    expect(t).toBeGreaterThanOrEqual(plain * 0.7);
    expect(t).toBeLessThanOrEqual(plain * 1.3 + 16);
  });

  it('tool JSON sayılır', () => {
    const base = approxMessageTokens({ content: 'x'.repeat(40) });
    const withTool = approxMessageTokens({
      content: 'x'.repeat(40),
      toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a'.repeat(400) } }],
    });
    expect(withTool - base).toBeGreaterThanOrEqual(400 / 4);
  });

  it('görsel ekler', () => {
    const base = approxMessageTokens({ content: 'merhaba' });
    const withImg = approxMessageTokens({ content: 'merhaba', images: ['data:...'] });
    expect(withImg - base).toBeGreaterThanOrEqual(1000);
  });

  it('windowFor: bilinen registry, bilinmeyende 200_000', () => {
    expect(windowFor('claude-opus-5-5')).toBe(1_000_000);
    expect(windowFor('yok-boyle-model')).toBe(200_000);
  });

  it('budgetFor: window × factor (default 0.6)', () => {
    expect(budgetFor('claude-opus-5-5')).toBe(600_000);
    expect(budgetFor('yok-boyle-model')).toBe(120_000);
    expect(budgetFor('claude-opus-5-5', [], 0.5)).toBe(500_000);
  });

  it('compactionLimitFor: büyük pencerede tam %75', () => {
    expect(CONTEXT_COMPACT_RATIO).toBe(0.75);
    // 200k (bilinmeyen model) → 150k
    expect(compactionLimitFor('yok-boyle-model')).toBe(150_000);
    expect(compactAtPercent('yok-boyle-model')).toBe(75);
    // 1M → 750k
    expect(compactionLimitFor('claude-opus-5-5')).toBe(750_000);
    expect(compactAtPercent('claude-opus-5-5')).toBe(75);
  });

  it('compactionLimitFor: küçük pencerede çıktı payı eşiği düşürür', () => {
    const small = [
      {
        id: 'tiny',
        provider: 'ollama' as const,
        name: 'Tiny',
        capabilities: { tools: true, vision: false, reasoning: false },
        contextWindow: 32_000,
      },
    ];
    // 32k - 16k rezerv = 16k → %50
    expect(compactionLimitFor('tiny', small)).toBe(16_000);
    expect(compactAtPercent('tiny', small)).toBe(50);
  });

  it('approxHistoryTokens toplar', () => {
    const h = [{ content: 'a'.repeat(400) }, { content: 'b'.repeat(400) }];
    expect(approxHistoryTokens(h)).toBe(
      approxMessageTokens(h[0]) + approxMessageTokens(h[1]),
    );
  });
});
