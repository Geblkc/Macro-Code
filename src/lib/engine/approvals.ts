/**
 * Faz 1 G3 (K9): kalıcı onay kuyruğu — SQLite + bellek.
 * UI (App) boot'ta restoreApprovals çağırır, step() pending'i queueApproval ile yazar,
 * resolve öncesi takeApproval ile düşer.
 */
import { openSql, PENDING_APPROVALS_TABLE_SQL as PENDING_SQL } from '../db';
import type { ToolCall } from './types';

export interface PendingApproval {
  id: string;
  sessionId: string;
  call: ToolCall;
  createdAt: number;
  /**
   * Faz 12 B.8 — kalıcı agent durumu (JSON).
   * Uygulama yeniden başlatıldığında bekleyen iş kaldığı yerden sürülsün.
   */
  runState?: string | null;
}

/** Tek kaynak: `db.ts` (şema `src-tauri/src/lib.rs` migration ile aynı). */
export const PENDING_APPROVALS_TABLE_SQL = PENDING_SQL;

export interface ApprovalsDb {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

const memory = new Map<string, PendingApproval>();

async function openApprovalsDb(provided?: ApprovalsDb): Promise<ApprovalsDb | null> {
  if (provided) return provided;
  // Faz 7 A1: tek paylaşılan bağlantı (db.ts) — hata `sqlError()` ile görünür.
  const db = await openSql();
  if (!db) return null;
  try {
    await db.execute(PENDING_APPROVALS_TABLE_SQL);
    return db;
  } catch {
    return null;
  }
}

interface ApprovalRow {
  id: string;
  session_id: string;
  call_data: string;
  run_state: string | null;
  created_at: number;
}

function rowToApproval(row: ApprovalRow): PendingApproval | null {
  try {
    const call = JSON.parse(row.call_data) as ToolCall;
    if (!call || typeof call.id !== 'string') return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      call,
      createdAt: typeof row.created_at === 'number' ? row.created_at : Date.now(),
      ...(row.run_state ? { runState: row.run_state } : {}),
    };
  } catch {
    return null;
  }
}

export async function queueApproval(p: PendingApproval, db?: ApprovalsDb): Promise<void> {
  memory.set(p.id, p);
  const odb = await openApprovalsDb(db);
  if (!odb) {
    try {
      const raw = localStorage.getItem('macrocode-approvals');
      const arr = raw ? (JSON.parse(raw) as PendingApproval[]) : [];
      const next = [...arr.filter((a) => a.id !== p.id), p];
      localStorage.setItem('macrocode-approvals', JSON.stringify(next));
    } catch {
      // localStorage yoksa bellek yeterli.
    }
    return;
  }
  await odb.execute(PENDING_APPROVALS_TABLE_SQL);
  await odb.execute(
    'INSERT OR REPLACE INTO pending_approvals (id, session_id, call_data, run_state, created_at) VALUES ($1, $2, $3, $4, $5)',
    [p.id, p.sessionId, JSON.stringify(p.call), p.runState ?? null, p.createdAt],
  );
}

export async function takeApproval(
  id: string,
  db?: ApprovalsDb,
): Promise<PendingApproval | undefined> {
  const mem = memory.get(id);
  if (mem) memory.delete(id);
  const odb = await openApprovalsDb(db);
  if (!odb) {
    try {
      const raw = localStorage.getItem('macrocode-approvals');
      if (raw) {
        const arr = JSON.parse(raw) as PendingApproval[];
        const found = arr.find((a) => a.id === id);
        localStorage.setItem(
          'macrocode-approvals',
          JSON.stringify(arr.filter((a) => a.id !== id)),
        );
        return found ?? mem;
      }
    } catch {
      // yoksay
    }
    return mem;
  }
  try {
    const rows = await odb.select<ApprovalRow[]>(
      'SELECT id, session_id, call_data, run_state, created_at FROM pending_approvals WHERE id = $1',
      [id],
    );
    await odb.execute('DELETE FROM pending_approvals WHERE id = $1', [id]);
    const fromDb = rows.length > 0 ? rowToApproval(rows[0]) : null;
    return fromDb ?? mem;
  } catch {
    return mem;
  }
}

export async function listApprovals(
  sessionId?: string,
  db?: ApprovalsDb,
): Promise<PendingApproval[]> {
  const odb = await openApprovalsDb(db);
  if (!odb) {
    const memList = [...memory.values()].filter((p) => !sessionId || p.sessionId === sessionId);
    try {
      const raw = localStorage.getItem('macrocode-approvals');
      if (raw) {
        const arr = JSON.parse(raw) as PendingApproval[];
        for (const a of arr) {
          if (!memory.has(a.id) && (!sessionId || a.sessionId === sessionId)) {
            memList.push(a);
          }
        }
      }
    } catch {
      // yoksay
    }
    return memList;
  }
  try {
    await odb.execute(PENDING_APPROVALS_TABLE_SQL);
    const rows = sessionId
      ? await odb.select<ApprovalRow[]>(
          'SELECT id, session_id, call_data, run_state, created_at FROM pending_approvals WHERE session_id = $1 ORDER BY created_at ASC',
          [sessionId],
        )
      : await odb.select<ApprovalRow[]>(
          'SELECT id, session_id, call_data, run_state, created_at FROM pending_approvals ORDER BY created_at ASC',
        );
    const fromDb = rows
      .map(rowToApproval)
      .filter((p): p is PendingApproval => p !== null);
    // Bellekte olup DB'de olmayan (henüz yazılmamış) kayıtları birleştir.
    for (const m of memory.values()) {
      if (!fromDb.some((p) => p.id === m.id) && (!sessionId || m.sessionId === sessionId)) {
        fromDb.push(m);
      }
    }
    return fromDb;
  } catch {
    return [...memory.values()].filter((p) => !sessionId || p.sessionId === sessionId);
  }
}

export async function restoreApprovals(db?: ApprovalsDb): Promise<PendingApproval[]> {
  const all = await listApprovals(undefined, db);
  for (const a of all) memory.set(a.id, a);
  return all;
}

export function clearApprovalsMemory(): void {
  memory.clear();
}
