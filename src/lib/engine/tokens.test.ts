import { describe, expect, it } from 'vitest';
import {
  approxHistoryTokens,
  approxMessageTokens,
  budgetFor,
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

  it('approxHistoryTokens toplar', () => {
    const h = [{ content: 'a'.repeat(400) }, { content: 'b'.repeat(400) }];
    expect(approxHistoryTokens(h)).toBe(
      approxMessageTokens(h[0]) + approxMessageTokens(h[1]),
    );
  });
});
