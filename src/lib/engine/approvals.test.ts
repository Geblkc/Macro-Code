import { describe, expect, it } from 'vitest';
import {
  clearApprovalsMemory,
  listApprovals,
  queueApproval,
  restoreApprovals,
  takeApproval,
  type ApprovalsDb,
} from './approvals';

function fakeDb(): ApprovalsDb & { rows: Map<string, { id: string; session_id: string; call_data: string; run_state: string | null; created_at: number }> } {
  const rows = new Map<string, { id: string; session_id: string; call_data: string; run_state: string | null; created_at: number }>();
  return {
    rows,
    async execute(query: string, bind?: unknown[]) {
      const q = query.trim().toUpperCase();
      if (q.startsWith('CREATE TABLE')) return null;
      if (q.startsWith('INSERT OR REPLACE')) {
        const [id, session_id, call_data, run_state, created_at] = (bind ?? []) as [string, string, string, string | null, number];
        rows.set(id, { id, session_id, call_data, run_state, created_at });
        return null;
      }
      if (q.startsWith('DELETE FROM')) {
        if (bind && bind.length === 1) {
          const id = String(bind[0]);
          rows.delete(id);
        }
        return null;
      }
      return null;
    },
    async select<T>(query: string, bind?: unknown[]): Promise<T> {
      const q = query.trim().toUpperCase();
      if (q.includes('WHERE ID =')) {
        const id = String((bind ?? [])[0]);
        const r = rows.get(id);
        return (r ? [r] : []) as unknown as T;
      }
      if (q.includes('WHERE SESSION_ID =')) {
        const sid = String((bind ?? [])[0]);
        return [...rows.values()].filter((r) => r.session_id === sid) as unknown as T;
      }
      return [...rows.values()] as unknown as T;
    },
  };
}

describe('Faz 1 G3 — approvals kuyruk + kalıcılık', () => {
  it('kuyruk → list → take tek kullanımlık', async () => {
    clearApprovalsMemory();
    const db = fakeDb();
    await queueApproval(
      { id: 'c1', sessionId: 's1', call: { id: 'c1', name: 'exec', args: { cmd: 'ls' } }, createdAt: 1 },
      db,
    );
    const listed = await listApprovals('s1', db);
    expect(listed.map((p) => p.id)).toContain('c1');
    const taken = await takeApproval('c1', db);
    expect(taken?.call.name).toBe('exec');
    expect(await takeApproval('c1', db)).toBeUndefined();
    expect(await listApprovals('s1', db)).toHaveLength(0);
  });

  it('restoreApprovals belleğe geri yükler', async () => {
    clearApprovalsMemory();
    const db = fakeDb();
    await queueApproval(
      { id: 'c2', sessionId: 's9', call: { id: 'c2', name: 'exec', args: {} }, createdAt: 2 },
      db,
    );
    clearApprovalsMemory();
    const restored = await restoreApprovals(db);
    expect(restored.map((p) => p.id)).toContain('c2');
  });
});
