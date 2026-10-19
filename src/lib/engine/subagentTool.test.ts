import { describe, expect, it } from 'vitest';
import { createAgentRun } from './agent';
import type { AgentEvent } from './types';
import { SUBAGENT_BLOCKED_TOOLS } from './subagent';

const TASK = 'X dosyasını incele';

/**
 * Koordinatör ve alt-agent aynı `streamImpl` mock'unu paylaşır; mock hangi
 * çağıran olduğunu son kullanıcı mesajından ayırt eder.
 */
function makeStream(turn: { parentTurn: number }) {
  return async ({
    messages,
    onChunk,
  }: {
    messages: Array<{ role: string; content: string }>;
    onChunk: (c: {
      text: string;
      done: boolean;
      toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    }) => void;
  }) => {
    const last = messages[messages.length - 1];
    const isSub = last?.role === 'user' && String(last.content).includes(TASK);
    if (isSub) {
      onChunk({ text: 'alt-ajan bulgusu', done: false });
      onChunk({ text: '', done: true });
      return;
    }
    if (turn.parentTurn === 1) {
      turn.parentTurn += 1;
      onChunk({
        text: '',
        done: false,
        toolCalls: [{ id: 'sa1', name: 'subagent', args: { task: TASK } }],
      });
      onChunk({ text: '', done: true });
    } else {
      onChunk({ text: 'koordinatör cevabı', done: false });
      onChunk({ text: '', done: true });
    }
  };
}

describe('Faz 8 L1 — subagent aracı agent döngüsünde çalışır', () => {
  it('subagent çağrısı çalıştırılır ve sonucu tool sonucu olarak döner', async () => {
    const events: AgentEvent[] = [];
    const run = createAgentRun([{ role: 'user', content: 'araştır' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      summarize: async () => 'özet',
      streamImpl: makeStream({ parentTurn: 1 }),
      runToolImpl: async () => 'alt-ajan bulgusu',
    });
    const r = await run.step();
    expect(r.kind).toBe('done');
    const results = events.filter((e) => e.k === 'tool_result');
    expect(results).toHaveLength(1);
    const res = results[0];
    expect(res.k === 'tool_result' && res.ok).toBe(true);
    expect(res.k === 'tool_result' && res.output).toContain('alt-ajan bulgusu');
  });

  it('alt-agent metni ana akışa ikinci kez akmaz', async () => {
    const events: AgentEvent[] = [];
    const run = createAgentRun([{ role: 'user', content: 'araştır' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      summarize: async () => 'özet',
      streamImpl: makeStream({ parentTurn: 1 }),
      runToolImpl: async () => 'alt-ajan bulgusu',
    });
    await run.step();
    const texts = events
      .filter((e) => e.k === 'text')
      .map((e) => (e.k === 'text' ? e.delta : ''))
      .join('');
    // Alt-agent metni akışa göndermez; koordinatör metni bir kez akar.
    expect(texts).not.toContain('alt-ajan bulgusu');
    expect(texts).toContain('koordinatör cevabı');
  });

  it('yazma araçları alt-agent için yasaklı', () => {
    expect(SUBAGENT_BLOCKED_TOOLS).toContain('exec');
    expect(SUBAGENT_BLOCKED_TOOLS).toContain('write_file');
    expect(SUBAGENT_BLOCKED_TOOLS).toContain('edit_file');
    expect(SUBAGENT_BLOCKED_TOOLS).toContain('propose_patch');
    // Özyineleme koruması
    expect(SUBAGENT_BLOCKED_TOOLS).toContain('subagent');
  });

  it('task eksikse hata sonucu üretilir (çökmez)', async () => {
    const events: AgentEvent[] = [];
    const run = createAgentRun([{ role: 'user', content: 'araştır' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        onChunk({
          text: '',
          done: false,
          toolCalls: [{ id: 'sa2', name: 'subagent', args: {} }],
        });
        onChunk({ text: '', done: true });
      },
    });
    await run.step();
    const res = events.find((e) => e.k === 'tool_result');
    expect(res?.k === 'tool_result' && res.ok).toBe(false);
  });
});
