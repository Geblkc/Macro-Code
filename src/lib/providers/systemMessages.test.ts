import { describe, expect, it, vi } from 'vitest';
import { systemTextOf, withoutSystemMessages } from './common';
import { anthropicProvider, buildAnthropicMessages } from './anthropic';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import type { ChatItem } from './common';

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l + '\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

const SUMMARY = '[özet · 2026-01-01] önceki turda X yapıldı, sonra Y değiştirildi.';

const WITH_SUMMARY: ChatItem[] = [
  { role: 'system', content: SUMMARY },
  { role: 'user', content: 'devam et' },
  { role: 'assistant', content: 'tamam' },
];

describe('Faz 7 A2 — sistem rolü mesajları (compaction özeti)', () => {
  it('systemTextOf yalnızca system mesajlarını birleştirir', () => {
    expect(systemTextOf(WITH_SUMMARY)).toBe(SUMMARY);
    expect(systemTextOf([{ role: 'user', content: 'x' }])).toBe('');
  });

  it('withoutSystemMessages sistem mesajlarını ayıklar', () => {
    expect(withoutSystemMessages(WITH_SUMMARY).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('Anthropic: system mesajı messages dizisine girmez', () => {
    const out = buildAnthropicMessages(WITH_SUMMARY);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(out)).not.toContain('özet ·');
  });

  it('Anthropic: özet istek gövdesinin system alanına taşınır', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}']),
    );
    await anthropicProvider.stream({
      apiKey: 'sk-ant-test-key',
      model: 'claude-opus-5-5',
      systemPrompt: 'SEN SİSTEM',
      messages: WITH_SUMMARY,
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as { system?: string; messages: Array<{ role: string }> };
    expect(body.system).toContain('SEN SİSTEM');
    expect(body.system).toContain(SUMMARY);
    expect(body.messages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('OpenAI-uyumlu: özet baştaki system mesajına birleşir', async () => {
    const prov = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    });
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]']));
    await prov.stream({
      apiKey: 'k',
      model: 'm',
      systemPrompt: 'SEN SİSTEM',
      messages: WITH_SUMMARY,
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(opts.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('SEN SİSTEM');
    expect(body.messages[0].content).toContain(SUMMARY);
    // Konuşma ortasında system rolü kalmaz
    expect(body.messages.filter((m) => m.role === 'system')).toHaveLength(1);
  });
});
