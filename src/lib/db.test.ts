import { describe, expect, it } from 'vitest';
import { appendAudit, readAuditLog, type SqlDatabase } from './db';

function fakeDb(): SqlDatabase & { rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    async execute(query: string, bind?: unknown[]) {
      const q = query.trim().toUpperCase();
      if (q.startsWith('CREATE TABLE')) return null;
      if (q.startsWith('INSERT INTO AUDIT_LOG')) {
        const [id, ts, session_id, tool, args_preview, decision, result] = (bind ?? []) as [
          string, number, string, string, string, string, string,
        ];
        rows.push({ id, ts, session_id, tool, args_preview, decision, result });
        return null;
      }
      return null;
    },
    async select<T>(): Promise<T> {
      return [...rows].sort((a, b) => Number(b.ts) - Number(a.ts)) as unknown as T;
    },
  };
}

describe('Faz 6 — audit_log', () => {
  it('yaz → oku roundtrip, decision korunur', async () => {
    const db = fakeDb();
    expect(
      await appendAudit(
        {
          sessionId: 's1',
          tool: 'exec',
          argsPreview: '{"cmd":"ls"}',
          decision: 'approved',
          result: 'ok',
        },
        db,
      ),
    ).toBe(true);
    const rows = await readAuditLog('s1', 20, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 's1', tool: 'exec', decision: 'approved' });
  });

  it('L6/L7: audit argsPreview/result yazılmadan önce redakte edilir', async () => {
    const db = fakeDb();
    await appendAudit(
      {
        sessionId: 's2',
        tool: 'mcp:server:call',
        argsPreview: '{"apiKey":"sk-abcdefghijklmnop","q":"normal"}',
        decision: 'approved',
        result: 'ok Bearer abcdefghijklmnopqrst',
      },
      db,
    );
    const rows = await readAuditLog('s2', 20, db);
    expect(rows[0].argsPreview).not.toContain('sk-abcdefghijklmnop');
    expect(rows[0].argsPreview).toContain('«redakte»');
    expect(rows[0].argsPreview).toContain('normal');
    expect(rows[0].result).not.toContain('abcdefghijklmnopqrst');
    expect(rows[0].result).toContain('«redakte»');
  });

  it('DB yoksa sessizce boş döner', async () => {
    await expect(readAuditLog('s1', 20, undefined)).resolves.toEqual([]);
  });
});
