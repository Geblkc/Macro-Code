import { describe, expect, it } from 'vitest';
import {
  CONTEXT_ERR_PERCENT,
  CONTEXT_WARN_PERCENT,
  contextUsage,
  lastRequestTokens,
} from './contextUsage';
import { approxHistoryTokens } from './tokens';
import type { CustomModel, Message } from '../../types';

function msg(over: Partial<Message> = {}): Message {
  return { id: 'm', role: 'assistant', content: '', timestamp: 0, ...over };
}

const SMALL: CustomModel[] = [
  {
    id: 'tiny',
    provider: 'ollama',
    name: 'Tiny',
    capabilities: { tools: true, vision: false, reasoning: false },
    contextWindow: 1000,
  },
];

describe('bağlam göstergesi — contextUsage', () => {
  it('son isteğin (lastRequest) girdi+çıktısını kullanır, kümülatif tokens’ı yok sayar', () => {
    const msgs = [
      msg({ id: 'a', tokens: { input: 190_000, output: 5_000 } }),
      msg({ id: 'b', tokens: { input: 390_000, output: 10_000 }, lastRequest: { input: 150_000, output: 1_000 } }),
    ];
    const ctx = contextUsage(msgs, 'yok-boyle-model');
    expect(ctx.used).toBe(151_000);
    expect(ctx.window).toBe(200_000);
    expect(ctx.percent).toBe(76);
    expect(ctx.level).toBe('warn');
    expect(ctx.compactAt).toBe(75);
    expect(ctx.estimated).toBe(false);
  });

  it('eşikler: %75 uyarı, %90 hata', () => {
    expect(CONTEXT_WARN_PERCENT).toBe(75);
    expect(CONTEXT_ERR_PERCENT).toBe(90);

    const warn = contextUsage([msg({ lastRequest: { input: 149_000, output: 0 } })], 'yok-boyle-model');
    expect(warn.percent).toBe(75);
    expect(warn.level).toBe('warn');

    const err = contextUsage([msg({ lastRequest: { input: 180_000, output: 5_000 } })], 'yok-boyle-model');
    expect(err.percent).toBe(93);
    expect(err.level).toBe('err');
  });

  it('gerçek usage yoksa yaklaşık geçmişe düşer ve estimated=true', () => {
    const msgs = [msg({ content: 'x'.repeat(4000) }), msg({ content: 'y'.repeat(4000) })];
    const ctx = contextUsage(msgs, 'yok-boyle-model');
    expect(ctx.used).toBe(approxHistoryTokens(msgs));
    expect(ctx.estimated).toBe(true);
  });

  it('doluluk %100’e kırpılır', () => {
    const ctx = contextUsage([msg({ content: 'z'.repeat(4000) })], 'tiny', SMALL);
    expect(ctx.window).toBe(1000);
    expect(ctx.percent).toBe(100);
    expect(ctx.level).toBe('err');
  });

  it('lastRequestTokens son sıfır olmayan kaydı döndürür', () => {
    const msgs = [
      msg({ id: 'a', lastRequest: { input: 100, output: 20 } }),
      msg({ id: 'b', lastRequest: { input: 0, output: 0 } }),
    ];
    expect(lastRequestTokens(msgs)).toBe(120);
    expect(lastRequestTokens([msg()])).toBeNull();
  });
});
