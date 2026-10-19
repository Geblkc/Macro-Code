import { describe, expect, it } from 'vitest';
import {
  buildTranscript,
  compactHistory,
  compactSessionMessages,
  COMPACTION_THRESHOLD,
  splitAtCompactionPoint,
  shouldCompact,
} from './compact';
import { approxHistoryTokens } from './tokens';
import type { AgentHistoryItem } from './agent';
import type { Message } from '../../types';

function item(role: string, chars: number, extra: Partial<AgentHistoryItem> = {}): AgentHistoryItem {
  return { role, content: 'x'.repeat(chars), ...extra };
}

describe('Faz 2 — compaction', () => {
  it('eşik altında tetiklenmez', () => {
    const h = [item('user', 100), item('assistant', 100)];
    // ~ (8+25)*2 = 66 token; bütçe 1000 → %75 = 750
    expect(shouldCompact(h, 1000)).toBe(false);
    expect(COMPACTION_THRESHOLD).toBe(0.75);
  });

  it('eşik üstünde tetiklenir', () => {
    const h = [item('user', 4000), item('assistant', 4000)];
    expect(shouldCompact(h, 1000)).toBe(true);
  });

  it('split: son mesaj korunur, keep bütçe içinde', () => {
    const h = [
      item('user', 4000),
      item('assistant', 4000),
      item('user', 400),
      item('assistant', 400),
    ];
    const { keep, drop } = splitAtCompactionPoint(h, 300);
    expect(keep.length).toBeGreaterThan(0);
    expect(drop.length).toBeGreaterThan(0);
    expect(keep[keep.length - 1]).toBe(h[h.length - 1]);
    expect(approxHistoryTokens(keep)).toBeLessThanOrEqual(300 + 1100);
  });

  it('split: tool çiftini koparmaz', () => {
    const h = [
      item('user', 100),
      item('assistant', 50, { toolCalls: [{ id: 'k1', name: 'read_file', args: {} }] }),
      item('tool', 4000, { toolCallId: 'k1', toolName: 'read_file' }),
    ];
    const { keep, drop } = splitAtCompactionPoint(h, 1000);
    // tool sonucu keep'teyse eşleşen assistant da keep'te olmalı
    const keepIds = new Set(
      keep.flatMap((m) => [...(m.toolCalls ?? []).map((c) => c.id), ...(m.toolCallId ? [m.toolCallId] : [])]),
    );
    if (keep.some((m) => m.toolCallId === 'k1')) {
      expect(keepIds.has('k1')).toBe(true);
    }
    expect(drop.length).toBeGreaterThan(0);
  });

  it('mock özetleyiciyle eski mesajlar azalır', async () => {
    const h = [item('user', 4000), item('assistant', 4000), item('user', 200)];
    const out = await compactHistory({
      history: h,
      budget: 1000,
      summarize: async () => 'karar: x · dosya: a.ts · sonraki: y',
      nowTs: 1720000000000,
    });
    expect(out[0].role).toBe('system');
    expect(out[0].content).toContain('[özet');
    expect(out.length).toBeLessThan(h.length + 1);
    expect(out[out.length - 1].content).toBe(h[h.length - 1].content);
  });

  it('bütünleşme: 200 mesajlık oturum bütçe içinde gider', async () => {
    const big: AgentHistoryItem[] = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `mesaj-${i} ` + 'y'.repeat(400),
    }));
    const budget = 6000;
    expect(shouldCompact(big, budget)).toBe(true);
    const out = await compactHistory({
      history: big,
      budget,
      summarize: async () => 'özet metni',
      nowTs: 1720000000000,
    });
    expect(approxHistoryTokens(out)).toBeLessThanOrEqual(budget);
  });

  it('transcript tool JSON kırpılır', () => {
    const t = buildTranscript([
      item('assistant', 10, { toolCalls: [{ id: 'c', name: 'exec', args: { cmd: 'x'.repeat(1000) } }] }),
    ]);
    expect(t).toContain('tool ▸ exec');
    expect(t.length).toBeLessThanOrEqual(12_000 + 300);
  });

  it('compactSessionMessages: kalıcı, özet başa, kuyruk korunur', async () => {
    const msgs: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `içerik-${i} ` + 'z'.repeat(400),
      timestamp: i,
    }));
    const budget = 800;
    const { messages: next, dropped, kept } = await compactSessionMessages(
      msgs,
      budget,
      async () => 'özet',
      1720000000000,
    );
    expect(dropped).toBeGreaterThan(0);
    expect(next[0].role).toBe('system');
    expect(next[0].content).toContain('[özet');
    expect(next.slice(1).map((m) => m.id)).toEqual(msgs.slice(msgs.length - kept).map((m) => m.id));
  });
});
