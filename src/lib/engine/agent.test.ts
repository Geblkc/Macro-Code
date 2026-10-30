import { describe, expect, it, vi } from 'vitest';

// L5 — audit asimetrisi: mod yasağının da `appendAudit('denied')` ürettiğini
// doğrulamak için DB katmanı mock'lanır (gerçek SQLite Tauri'de çalışır).
const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn(async (..._args: unknown[]) => true) }));
vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  return { ...actual, appendAudit: (...args: unknown[]) => auditMock(...args) };
});

import { createAgentRun, toProviderMessages } from './agent';
import type { AgentDeps, AgentHistoryItem } from './agent';
import type { AgentEvent } from './types';

/** Eski `runAgent` yerine: kullanıcı mesajı geçmişe eklenip tek tur çalıştırılır. */
async function runAgentCompat(
  userText: string,
  history: AgentHistoryItem[],
  deps: AgentDeps,
): Promise<{ text: string; steps: number }> {
  const run = createAgentRun([...history, { role: 'user', content: userText }], deps);
  const r = await run.step();
  if (r.kind === 'needs-approval') return { text: '', steps: 0 };
  return { text: r.text, steps: r.steps };
}

describe('Faz F — agent loop', () => {
  it('text-only akışta tek turda biter', async () => {
    const events: AgentEvent[] = [];
    const r = await runAgentCompat('merhaba', [], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        onChunk({ text: 'selam', done: false });
        onChunk({ text: '', done: true });
      },
    });
    expect(r.text).toBe('selam');
    expect(r.steps).toBe(1);
    expect(events.some((e) => e.k === 'done')).toBe(true);
  });

  it('read_file çağrısını koşup ikinci turda bitirir', async () => {
    const events: AgentEvent[] = [];
    let n = 0;
    const r = await runAgentCompat('listele', [], {
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
            toolCalls: [{ id: 'c1', name: 'list_dir', args: { path: '' } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'dosyalar: a.ts', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async () => 'file  a.ts',
    });
    expect(r.text).toContain('dosyalar');
    expect(events.filter((e) => e.k === 'tool_call')).toHaveLength(1);
    expect(events.filter((e) => e.k === 'tool_result')).toHaveLength(1);
  });

  it('yasaklı exec çalıştırılmaz', async () => {
    const events: AgentEvent[] = [];
    await runAgentCompat('sil', [], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        onChunk({
          text: '',
          done: false,
          toolCalls: [{ id: 'c9', name: 'exec', args: { cmd: 'rm', args: ['-rf'] } }],
        });
        onChunk({ text: '', done: true });
      },
      runToolImpl: async () => {
        throw new Error('çalışmamalıydı');
      },
    });
    const res = events.find((e) => e.k === 'tool_result');
    expect(res?.k === 'tool_result' && res.ok).toBe(false);
  });

  it('ikinci turda sağlayıcıya yerel tool_calls ve tool sonuçları iletilir', async () => {
    const receivedMessages: unknown[][] = [];
    await runAgentCompat('test et', [], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      onEvent: () => {},
      streamImpl: async ({ messages, onChunk }) => {
        receivedMessages.push([...messages]);
        if (receivedMessages.length === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [{ id: 'tc_101', name: 'read_file', args: { path: 'package.json' } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'tamamlandı', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async () => '{"name": "test"}',
    });

    expect(receivedMessages).toHaveLength(2);
    // 1. tur: sadece kullanıcı mesajı
    expect(receivedMessages[0]).toHaveLength(1);
    expect(receivedMessages[0][0]).toMatchObject({ role: 'user', content: 'test et' });

    // 2. tur: user -> assistant (toolCalls ile) -> tool (toolCallId ve output ile)
    expect(receivedMessages[1]).toHaveLength(3);
    expect(receivedMessages[1][0]).toMatchObject({ role: 'user', content: 'test et' });
    expect(receivedMessages[1][1]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'tc_101', name: 'read_file', args: { path: 'package.json' } }],
    });
    expect(receivedMessages[1][2]).toMatchObject({
      role: 'tool',
      toolCallId: 'tc_101',
      toolName: 'read_file',
      content: '{"name": "test"}',
    });
  });

  it('Faz 1: 3 turlu run — tool → resolve(approved) → tool → metin, geçmiş korunur', async () => {
    const events: AgentEvent[] = [];
    const seen: unknown[][] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'başla' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'manual',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ messages, onChunk }) => {
        seen.push([...messages]);
        n++;
        if (n === 1) {
          onChunk({ text: '', done: false, toolCalls: [{ id: 'a1', name: 'exec', args: { cmd: 'ls', args: [] } }] });
          onChunk({ text: '', done: true });
        } else if (n === 2) {
          onChunk({ text: '', done: false, toolCalls: [{ id: 'a2', name: 'read_file', args: { path: 'x' } }] });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'bitti', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async (call) => `out:${call.name}`,
    });
    const r1 = await run.step();
    expect(r1.kind).toBe('needs-approval');
    if (r1.kind !== 'needs-approval') throw new Error('pending bekleniyordu');
    expect(r1.pending.map((c) => c.id)).toEqual(['a1']);
    const r2 = await run.resolve([{ id: 'a1', approved: true }]);
    // İkinci tur auto (read_file) koşup üçüncü tura geçmiş olmalı → done
    expect(r2.kind).toBe('done');
    if (r2.kind !== 'done') throw new Error('done bekleniyordu');
    expect(r2.text).toContain('bitti');
    // Üçüncü tur mesajlarında ilk tool geçmişi korunuyor
    const third = seen[2] as Array<{ role: string; toolCalls?: Array<{ id: string }>; toolCallId?: string }>;
    const ids = third.flatMap((m) => [
      ...(m.toolCalls ?? []).map((c) => c.id),
      ...(m.toolCallId ? [m.toolCallId] : []),
    ]);
    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
  });

  it('M1: tek kart onayı diğer bekleyenleri ÇALIŞTIRMAZ (partial resolve)', async () => {
    // Aynı turda iki onay çağrısı: `exec` ve `write_file` (manual modda ikisi de bekler).
    const events: AgentEvent[] = [];
    const ran: string[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'başla' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'manual',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [
              { id: 'p1', name: 'exec', args: { cmd: 'ls', args: [] } },
              { id: 'p2', name: 'write_file', args: { path: 'a.txt', content: 'x' } },
            ],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'bitti', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async (call) => {
        ran.push(call.id);
        return `out:${call.id}`;
      },
    });

    const p = await run.step();
    expect(p.kind).toBe('needs-approval');
    if (p.kind !== 'needs-approval') throw new Error('pending bekleniyordu');
    expect(p.pending.map((c) => c.id)).toEqual(['p1', 'p2']);

    // Yalnız p1 onaylanır → p2 hâlâ bekler, tur ilerlemez.
    const r2 = await run.resolve([{ id: 'p1', approved: true }]);
    expect(r2.kind).toBe('needs-approval');
    if (r2.kind !== 'needs-approval') throw new Error('pending bekleniyordu');
    expect(r2.pending.map((c) => c.id)).toEqual(['p2']);
    expect(ran).toEqual(['p1']);
    expect(events.some((e) => e.k === 'tool_result' && e.id === 'p2')).toBe(false);

    // Kalan p2 reddedilir → döngü devam eder, done.
    const done = await run.resolve([{ id: 'p2', approved: false }]);
    expect(done.kind).toBe('done');
    if (done.kind !== 'done') throw new Error('done bekleniyordu');
    expect(done.text).toContain('bitti');
    expect(ran).toEqual(['p1']);
    const p2res = events.find((e) => e.k === 'tool_result' && e.id === 'p2');
    expect(p2res?.k === 'tool_result' && p2res.output).toContain('reddetti');
  });

  it('M1: eşzamanlı kart onayları çakışmaz (resolve sıraya alınır)', async () => {
    const events: AgentEvent[] = [];
    const ran: string[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'başla' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'manual',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [
              { id: 'q1', name: 'exec', args: { cmd: 'ls', args: [] } },
              { id: 'q2', name: 'write_file', args: { path: 'b.txt', content: 'y' } },
            ],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'tamam', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async (call) => {
        ran.push(call.id);
        return `out:${call.id}`;
      },
    });

    const p = await run.step();
    expect(p.kind).toBe('needs-approval');
    // İki kart neredeyse aynı anda onaylanır (gerçek kullanıcı davranışı).
    const [r1, r2] = await Promise.all([
      run.resolve([{ id: 'q1', approved: true }]),
      run.resolve([{ id: 'q2', approved: true }]),
    ]);
    expect(r1.kind).toBe('needs-approval');
    expect(r2.kind).toBe('done');
    // Her araç TAM BİR kez çalıştı (çift çalıştırma yok).
    expect(ran).toEqual(['q1', 'q2']);
    expect(events.filter((e) => e.k === 'tool_result' && e.id === 'q1')).toHaveLength(1);
    expect(events.filter((e) => e.k === 'tool_result' && e.id === 'q2')).toHaveLength(1);
  });

  it('M2: plan modunda MCP aracı çalışmaz (mcp:* joker, onay kartı yok)', async () => {
    const events: AgentEvent[] = [];
    let ran = false;
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'başla' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      agentMode: 'plan',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [{ id: 'm1', name: 'mcp:filesystem:write_file', args: { path: 'x' } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'plan hazır', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async () => {
        ran = true;
        return 'çalışmamalıydı';
      },
    });

    const r = await run.step();
    // Onay kartı üretilmedi: tur doğrudan devam etti ve bitti.
    expect(r.kind).toBe('done');
    expect(ran).toBe(false);
    const res = events.find((e) => e.k === 'tool_result' && e.id === 'm1');
    expect(res?.k === 'tool_result' && res.ok).toBe(false);
    expect(res?.k === 'tool_result' && res.output).toContain('kullanamaz');
  });

  it('L5: mod yasağı audit kaydına denied olarak düşer', async () => {
    auditMock.mockClear();
    const run = createAgentRun([{ role: 'user', content: 'x' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      agentMode: 'plan',
      auditSessionId: 's-audit',
      onEvent: () => {},
      streamImpl: async ({ onChunk }) => {
        onChunk({
          text: '',
          done: false,
          toolCalls: [
            {
              id: 'z1',
              name: 'exec',
              args: { cmd: 'ls', args: [], apiKey: 'sk-abcdefghijkl' },
            },
          ],
        });
        onChunk({ text: '', done: true });
      },
    });
    await run.step();
    const entry = auditMock.mock.calls
      .map(
        (c) =>
          c[0] as {
            tool?: string;
            decision?: string;
            result?: string;
            argsPreview?: string;
          },
      )
      .find((e) => e.tool === 'exec');
    expect(entry).toBeDefined();
    expect(entry?.decision).toBe('denied');
    expect(entry?.result).toContain('kullanamaz');
    // L6/L7: audit argsPreview alan-adı redaksiyonundan geçer.
    expect(entry?.argsPreview).not.toContain('sk-abcdefghijkl');
    expect(entry?.argsPreview).toContain('«redakte»');
  });

  it('Faz 1: reddet + devam — isError sonucu ile agent durmaz', async () => {
    const events: AgentEvent[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'koş' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'manual',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({ text: '', done: false, toolCalls: [{ id: 'r1', name: 'exec', args: { cmd: 'ls', args: [] } }] });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'alternatif denedim', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async () => {
        throw new Error('onaysız çalışmamalı');
      },
    });
    const p = await run.step();
    expect(p.kind).toBe('needs-approval');
    const done = await run.resolve([{ id: 'r1', approved: false }]);
    expect(done.kind).toBe('done');
    if (done.kind !== 'done') throw new Error('done bekleniyordu');
    expect(done.text).toContain('alternatif');
  });

  it('Y2 (Faz 3): resolve(approved) exec\'i çalıştırır — onay gerekli hatası YOK', async () => {
    // runToolImpl YOK → gerçek defaultRunTool → toolExec akışı test edilir.
    // approve edilmeden guard düşer; approve sonrası invoke noktasına ulaşır.
    const events: AgentEvent[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'koş' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'manual',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [{ id: 'y2', name: 'exec', args: { cmd: 'npm', args: ['--version'] } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'devam', done: false });
          onChunk({ text: '', done: true });
        }
      },
    });
    const p = await run.step();
    expect(p.kind).toBe('needs-approval');
    await run.resolve([{ id: 'y2', approved: true }]);
    // Exec çalıştı (Tauri olmadığı için invoke hatası döndü ama zincir koptu MU — hayır;
    // önemli olan hata "onay gerekli" DEĞİL ve akış devam etti).
    const res = events.find((e) => e.k === 'tool_result' && e.id === 'y2');
    expect(res?.k === 'tool_result' && res.ok).toBe(false);
    expect(res?.k === 'tool_result' && res.output).not.toContain('onay gerekli');
    expect(res?.k === 'tool_result' && res.output).toContain('Tauri');
  });

  it('Y2 (Faz 3): resolve(approved=false) exec\'i çalıştırmaz', async () => {
    const events: AgentEvent[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'koş' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'manual',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [{ id: 'y2r', name: 'exec', args: { cmd: 'npm', args: ['--version'] } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'tamam', done: false });
          onChunk({ text: '', done: true });
        }
      },
    });
    await run.step();
    const r = await run.resolve([{ id: 'y2r', approved: false }]);
    expect(r.kind).toBe('done');
    const res = events.find((e) => e.k === 'tool_result');
    expect(res?.k === 'tool_result' && res.output).toContain('reddetti');
  });

  it('Faz 1 C.6: eşleşmeyen tool çifti provider 400 üretmez', () => {
    const msgs = toProviderMessages([
      { role: 'assistant', content: 'eski', toolCalls: [{ id: 'orphan', name: 'read_file', args: {} }] },
      { role: 'user', content: 'devam' },
    ]);
    // Orphan çağrı metinle birlikte korunur ama boş tool listesi gönderilmez
    expect(msgs.some((m) => (m.toolCalls ?? []).some((c) => c.id === 'orphan'))).toBe(false);
    const converted = toProviderMessages([
      { role: 'assistant', content: 'a', toolCalls: [{ id: 'k1', name: 'read_file', args: {} }] },
      { role: 'tool', content: 'sonuç', toolCallId: 'k1', toolName: 'read_file' },
      { role: 'tool', content: 'sahipsiz', toolCallId: 'yok', toolName: 'exec' },
    ]);
    expect(converted.some((m) => m.role === 'user' && m.content.includes('sahipsiz'))).toBe(true);
  });

  it('Faz 4: reasoning olayı akar, thinking geçmişe yazılır ve korunur', async () => {
    const events: AgentEvent[] = [];
    const seen: unknown[][] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'düşünerek listele' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'manual',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ messages, onChunk }) => {
        seen.push([...messages]);
        n++;
        if (n === 1) {
          onChunk({ text: '', done: false, reasoning: 'plan kuruyorum' });
          onChunk({
            text: '',
            done: false,
            thinking: [{ thinking: 'plan', signature: 'sig-1' }],
            toolCalls: [{ id: 't1', name: 'list_dir', args: { path: '' } }],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: 'bitti', done: false });
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async () => 'a.ts',
    });
    const done = await run.step();
    expect(done.kind).toBe('done');
    // reasoning olayı tüketiciye ulaştı
    expect(events.some((e) => e.k === 'reasoning')).toBe(true);
    // thinking blokları ikinci tur isteğinde taşındı
    const second = seen[1] as Array<{ role: string; thinking?: Array<{ signature: string }> }>;
    const asst = second.find((m) => m.role === 'assistant');
    expect(asst?.thinking).toEqual([{ thinking: 'plan', signature: 'sig-1' }]);
    // usage reasoning birleşir
    expect(events.some((e) => e.k === 'done')).toBe(true);
  });
});
