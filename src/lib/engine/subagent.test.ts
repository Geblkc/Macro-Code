import { describe, expect, it } from 'vitest';
import { runSubagent, SUBAGENT_BLOCKED_TOOLS } from './subagent';
import type { AgentEvent } from './types';

describe('Faz 5b — alt-agent', () => {
  it('yazma denemesi reddedilir, okuma sürer', async () => {
    const events: AgentEvent[] = [];
    let n = 0;
    const r = await runSubagent('araştır', [], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      summarize: async () => 'özet',
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [
              { id: 'w1', name: 'exec', args: { cmd: 'ls', args: [] } },
              { id: 'r1', name: 'read_file', args: { path: 'a' } },
            ],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'bulgular', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async () => 'içerik',
    });
    expect(r.text).toContain('bulgular');
    const results = events.filter((e) => e.k === 'tool_result');
    expect(results).toHaveLength(2);
    expect(results[0].k === 'tool_result' && results[0].ok).toBe(false);
    expect(results[1].k === 'tool_result' && results[1].ok).toBe(true);
  });

  it('bütçe aşımında compaction ile küçülür', async () => {
    const big = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `eski-${i} ` + 'z'.repeat(4000),
    }));
    let summarized = false;
    const r = await runSubagent('devam', big, {
      provider: 'openai',
      apiKey: 'k',
      model: 'mini',
      customModels: [
        {
          id: 'mini',
          provider: 'openai',
          name: 'mini',
          capabilities: { tools: true, vision: false, reasoning: false },
          contextWindow: 10000,
        },
      ],
      workspaceRoot: '/tmp',
      onEvent: () => {},
      summarize: async () => {
        summarized = true;
        return 'eski özet';
      },
      streamImpl: async ({ messages, onChunk }) => {
        // 60 mesaj değil, özet + kuyruk gitmeli
        expect(messages.length).toBeLessThan(60);
        onChunk({ text: 'tamam', done: false });
        onChunk({ text: '', done: true });
      },
    });
    expect(summarized).toBe(true);
    expect(r.compacted).toBe(true);
    expect(r.text).toBe('tamam');
  });

  it('bloklu liste yazma araçlarını kapsar', () => {
    expect(SUBAGENT_BLOCKED_TOOLS).toEqual(
      expect.arrayContaining(['exec', 'write_file', 'edit_file', 'propose_patch']),
    );
  });
});
