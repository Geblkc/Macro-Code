import { describe, expect, it } from 'vitest';
import { createAgentRun, type AgentRunState } from './agent';
import type { AgentEvent } from './types';

describe('Faz 12 B.8 — agent durumu kalıcılığı (run_state)', () => {
  it('serialize: geçmiş + adım + bekleyen çağrı kaydedilir', async () => {
    const events: AgentEvent[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'yaz' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [{ id: 'c1', name: 'exec', args: { cmd: 'ls' } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'bitti', done: false });
          onChunk({ text: '', done: true });
        }
      },
    });
    const r = await run.step();
    expect(r.kind).toBe('needs-approval');

    const state = JSON.parse(run.serialize()) as AgentRunState;
    expect(state.steps).toBe(1);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].call.id).toBe('c1');
    // Geçmiş: kullanıcı + assistant(toolCalls) + tool sonucu yok (onay bekliyor)
    expect(state.msgs.length).toBeGreaterThanOrEqual(2);
  });

  it('restore: kayıtlı durumdan run kaldığı yerden sürer', async () => {
    // 1. tur: exec çağrısı → onay bekliyor.
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'yaz' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: () => {},
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [{ id: 'c1', name: 'exec', args: { cmd: 'ls' } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'devam etti', done: false });
          onChunk({ text: '', done: true });
        }
      },
    });
    await run.step();
    const saved = run.serialize();

    // 2. tur: YENİ run, kayıtlı durumdan (restart simülasyonu).
    const state = JSON.parse(saved) as AgentRunState;
    const events: AgentEvent[] = [];
    let m = 0;
    const restored = createAgentRun(
      [],
      {
        provider: 'openai',
        apiKey: 'k',
        model: 'm',
        workspaceRoot: '/tmp',
        onEvent: (e) => events.push(e),
        streamImpl: async ({ onChunk }) => {
          m++;
          onChunk({ text: 'devam etti', done: false });
          onChunk({ text: '', done: true });
        },
      },
      state,
    );
    // Onaylanan iş: resolve → run devam eder.
    const r = await restored.resolve([{ id: 'c1', approved: true }]);
    expect(r.kind).toBe('done');
    const texts = events
      .filter((e) => e.k === 'text')
      .map((e) => (e.k === 'text' ? e.delta : ''))
      .join('');
    expect(texts).toContain('devam etti');
  });

  it('restore: adım sayısı korunur (maxSteps aşılmaz)', async () => {
    const state: AgentRunState = {
      msgs: [{ role: 'user', content: 'x' }],
      steps: 7,
      finalText: 'önceki',
      usage: null,
      pending: [],
    };
    const run = createAgentRun(
      [],
      {
        provider: 'openai',
        apiKey: 'k',
        model: 'm',
        workspaceRoot: '/tmp',
        maxSteps: 8,
        onEvent: () => {},
        streamImpl: async ({ onChunk }) => {
          onChunk({ text: 'tur', done: false });
          onChunk({ text: '', done: true });
        },
      },
      state,
    );
    const r = await run.step();
    // 7'den başladı → maxSteps 8 → tek tur daha, sonra biter.
    expect(r.kind).toBe('done');
    const s = JSON.parse(run.serialize()) as AgentRunState;
    expect(s.steps).toBe(8);
  });

  it('restore: pending çağrılar step() ile yeniden bildirilir', async () => {
    const state: AgentRunState = {
      msgs: [{ role: 'user', content: 'x' }],
      steps: 1,
      finalText: '',
      usage: null,
      pending: [{ call: { id: 'c9', name: 'exec', args: { cmd: 'ls' } } }],
    };
    const run = createAgentRun(
      [],
      {
        provider: 'openai',
        apiKey: 'k',
        model: 'm',
        workspaceRoot: '/tmp',
        onEvent: () => {},
        streamImpl: async ({ onChunk }) => {
          onChunk({ text: '', done: true });
        },
      },
      state,
    );
    const r = await run.step();
    expect(r.kind).toBe('needs-approval');
    if (r.kind === 'needs-approval') {
      expect(r.pending[0].id).toBe('c9');
    }
  });
});
