import { describe, expect, it } from 'vitest';
import { createAgentRun } from './agent';
import { listPending, proposePatch } from './tools/patch';
import type { AgentEvent } from './types';

/**
 * Faz 9 P9.0 (B2) — `auto-edit` modunda yazma gerçekten yapılmalı.
 *
 * `propose_patch`/`edit_file` yalnızca pending patch üretir; asıl yazma
 * `applyPendingPatch` ile olur. Onay akışında bu `resolve()` içinde çağrılır;
 * **onaysız** (auto-edit) yolda çağrılmıyordu → dosya hiç değişmiyordu,
 * agent "yazdım" diyordu.
 *
 * Test ayırt edicidir: mock, gerçek `toolProposePatch` gibi pending patch
 * üretir. Tarayıcı ortamında `apply_patch` Rust çağrısı "yalnızca Tauri"
 * hatası verir → düzeltme varsa sonuç **hata** olur (uygulama denenmiş olur),
 * düzeltme yoksa sonuç **başarılı** olur ve patch havuzda kalır.
 */
describe('Faz 9 B2 — auto-edit modunda yazma uygulanır', () => {
  it('onaysız propose_patch: pending patch üretilir ve UYGULANMAYA çalışılır', async () => {
    const events: AgentEvent[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'yaz' }], {
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      workspaceRoot: '/tmp',
      approvalMode: 'auto-edit',
      onEvent: (e) => events.push(e),
      streamImpl: async ({ onChunk }) => {
        n++;
        if (n === 1) {
          onChunk({
            text: '',
            done: false,
            toolCalls: [
              { id: 'p1', name: 'propose_patch', args: { path: 'a.ts', content: 'yeni' } },
            ],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: '', done: true });
        }
      },
      // Gerçek `toolProposePatch` gibi pending patch üretir.
      runToolImpl: async () => {
        const p = proposePatch('a.ts', 'yeni', 'eski');
        return `preview ${p.id}`;
      },
    });
    await run.step();

    const results = events.filter((e) => e.k === 'tool_result');
    expect(results).toHaveLength(1);
    const res = results[0];
    // Uygulama denendi → Rust çağrısı tarayıcıda hata verdi → sonuç hatadır.
    expect(res.k === 'tool_result' && res.ok).toBe(false);
    expect(res.k === 'tool_result' && res.output).toMatch(/yalnızca Tauri/);
    // Patch havuzda kalmadı (applyPendingPatch onu tüketti).
    expect(listPending()).toHaveLength(0);
  });

  it('onay modunda (manual) patch havuzda kalır — onay bekler', async () => {
    const events: AgentEvent[] = [];
    let n = 0;
    const run = createAgentRun([{ role: 'user', content: 'yaz' }], {
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
              { id: 'p2', name: 'propose_patch', args: { path: 'b.ts', content: 'yeni' } },
            ],
          });
          onChunk({ text: '', done: true });
        } else {
          onChunk({ text: '', done: true });
        }
      },
      runToolImpl: async () => {
        const p = proposePatch('b.ts', 'yeni', 'eski');
        return `preview ${p.id}`;
      },
    });
    const r = await run.step();
    // Manuel modda tur onayda durur, dosya uygulanmaz.
    expect(r.kind).toBe('needs-approval');
    expect(listPending().length).toBeGreaterThan(0);
  });
});
