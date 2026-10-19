import { describe, expect, it } from 'vitest';
import {
  CACHE_MIN_TOKENS,
  CACHE_MIN_TOKENS_SMALL,
  approxTokens,
  cacheMinTokens,
  cacheableBySize,
  markCacheControl,
  promptCacheKey,
} from './promptCache';
import { buildAnthropicMessages } from './anthropic';
import type { ChatItem } from './common';

describe('Faz 11 — prompt cache', () => {
  it('model eşiği: Haiku daha yüksek', () => {
    expect(cacheMinTokens('claude-opus-5-5')).toBe(CACHE_MIN_TOKENS);
    expect(cacheMinTokens('claude-haiku-5-5')).toBe(CACHE_MIN_TOKENS_SMALL);
  });

  it('kısa önek cache\'lenmez (API 400 döner!)', () => {
    // 1024 token eşiğinin altında → cache_control konmaz.
    expect(cacheableBySize(100, 'claude-opus-5-5')).toBe(false);
    expect(cacheableBySize(CACHE_MIN_TOKENS + 500, 'claude-opus-5-5')).toBe(true);
    // Haiku için eşik daha yüksek.
    expect(cacheableBySize(CACHE_MIN_TOKENS + 500, 'claude-haiku-5-5')).toBe(false);
    expect(cacheableBySize(CACHE_MIN_TOKENS_SMALL + 500, 'claude-haiku-5-5')).toBe(true);
  });

  it('token tahmini char/4', () => {
    expect(approxTokens('abcd')).toBe(1);
    expect(approxTokens('a'.repeat(400))).toBe(100);
  });

  it('markCacheControl: son kullanıcı bloğunu işaretler', () => {
    const msgs = [
      { role: 'user' as const, content: 'merhaba' },
      { role: 'assistant' as const, content: 'selam' },
      { role: 'user' as const, content: 'devam' },
    ];
    markCacheControl(msgs, 'claude-opus-5-5', 5000);
    const last = msgs[2].content as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(last)).toBe(true);
    expect(last[0].cache_control).toEqual({ type: 'ephemeral' });
    // İlk kullanıcı bloğu işaretlenmez.
    expect(typeof msgs[0].content).toBe('string');
  });

  it('markCacheControl: tool_result bloğu varsa ona işaretlenir', () => {
    const msgs = [
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'sonuc' }],
      },
    ];
    markCacheControl(msgs, 'claude-opus-5-5', 5000);
    const blocks = msgs[0].content as unknown as Array<Record<string, unknown>>;
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('markCacheControl: yetersiz büyüklükte dokunmaz', () => {
    const msgs = [{ role: 'user' as const, content: 'kısa' }];
    markCacheControl(msgs, 'claude-opus-5-5', 10);
    expect(typeof msgs[0].content).toBe('string');
  });

  it('buildAnthropicMessages: cache açıkken ve önek büyükken işaret ekler', () => {
    const big = 'x'.repeat(8000); // ~2000 token
    const messages: ChatItem[] = [
      { role: 'user', content: big },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'devam' },
    ];
    const out = buildAnthropicMessages(messages, {
      model: 'claude-opus-5-5',
      cachePrompts: true,
      systemText: '',
    });
    const last = out[out.length - 1].content as Array<Record<string, unknown>>;
    expect(Array.isArray(last)).toBe(true);
    expect(last[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('buildAnthropicMessages: cache kapalıyken işaret yok', () => {
    const big = 'x'.repeat(8000);
    const messages: ChatItem[] = [{ role: 'user', content: big }];
    const out = buildAnthropicMessages(messages, {
      model: 'claude-opus-5-5',
      cachePrompts: false,
      systemText: '',
    });
    expect(typeof out[0].content).toBe('string');
  });

  it('buildAnthropicMessages: önek kısa ise işaret yok (400 koruması)', () => {
    const messages: ChatItem[] = [{ role: 'user', content: 'kısa mesaj' }];
    const out = buildAnthropicMessages(messages, {
      model: 'claude-opus-5-5',
      cachePrompts: true,
      systemText: 'kısa sistem',
    });
    expect(typeof out[0].content).toBe('string');
  });

  it('önbellek anahtarı kararlı ve oturuma özgü', () => {
    const a = promptCacheKey('session-1', 'gpt-6.1-sol');
    const b = promptCacheKey('session-1', 'gpt-6.1-sol');
    const c = promptCacheKey('session-2', 'gpt-6.1-sol');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a.startsWith('mc-')).toBe(true);
  });
});
