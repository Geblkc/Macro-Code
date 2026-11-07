import type { Session } from '../types';
import { migrateProviderModel, PROVIDER_IDS } from './providers';
import { isTauri } from './tauri';
import { logError, redact } from './logger';

export const DB_URL = 'sqlite:sessions.db';
export const SESSIONS_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);';
export const PENDING_APPROVALS_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS pending_approvals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, call_data TEXT NOT NULL, run_state TEXT, created_at INTEGER NOT NULL);';
export const AUDIT_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT NOT NULL, tool TEXT NOT NULL, args_preview TEXT NOT NULL, decision TEXT NOT NULL, result TEXT NOT NULL);'

export const USAGE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS usage_events (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, project TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, ttft_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT \'ok\', cost_usd REAL NOT NULL DEFAULT 0, estimated INTEGER NOT NULL DEFAULT 0, tool_name TEXT, tool_ms INTEGER NOT NULL DEFAULT 0);';

const META_ID = '__meta__';

/** @tauri-apps/plugin-sql Database'in kullandigimiz alt kumesi (testte fake'lenebilir). */
export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

interface SessionRow {
  id: string;
  data: string;
}

/**
 * Son DB acma hatası (diagnostik için; `null` = sorun yok).
 *
 * Faz 7 A1: `sql:default` izni `allow-execute` icermiyordu; `db.execute()`
 * sessizce basarisiz oluyor ve tum kalicilik localStorage'a duserdi. Artik hata
 * yutulmuyor — `sqlError()` ile okunur, boot'ta kullaniciya uyari olarak gosterilir.
 */
let lastDbError: string | null = null;

/** Son SQL acma/erisim hatasının mesajı (yoksa `null`). */
export function sqlError(): string | null {
  return lastDbError;
}

/**
 * Bağlantı önbelleği: `Database.load` + 3 CREATE TABLE her çağrıda tekrarlanmasın
 * (agent döngüsünde her tool kararı `appendAudit` çağırıyor → her seferinde 4 IPC).
 */
let dbPromise: Promise<SqlDatabase | null> | null = null;

async function openDb(provided?: SqlDatabase): Promise<SqlDatabase | null> {
  if (provided) return provided;
  if (!isTauri()) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const { default: Database } = await import('@tauri-apps/plugin-sql');
        const db = (await Database.load(DB_URL)) as unknown as SqlDatabase;
        await db.execute(SESSIONS_TABLE_SQL);
        await db.execute(PENDING_APPROVALS_TABLE_SQL);
        await db.execute(AUDIT_TABLE_SQL);
        await db.execute(USAGE_TABLE_SQL);
        // v0.2.3: usage_events tablosuna `project` kolonu eklendi. Daha önce
        // oluşturulmuş geliştirme veritabanlarında kolon yoksa ekle; hata
        // (kolon zaten var) yok sayılır.
        try {
          await db.execute('ALTER TABLE usage_events ADD COLUMN project TEXT');
        } catch {
          // Kolon zaten mevcut.
        }
        lastDbError = null;
        return db;
      } catch (e) {
        lastDbError = e instanceof Error ? e.message : String(e);
        logError('db.open.failed', { error: lastDbError });
        // Başarısızlıkta önbellek düşürülür → sonraki çağrı yeniden dener.
        dbPromise = null;
        return null;
      }
    })();
  }
  return dbPromise;
}

/**
 * Paylasilan SQL baglantisi (db.ts + engine/approvals.ts ayni baglantiyi kullanir).
 * `provided` verilirse test/fake kullanilir.
 */
export function openSql(provided?: SqlDatabase): Promise<SqlDatabase | null> {
  return openDb(provided);
}

function parseSession(data: string): Session | null {
  try {
    const v = JSON.parse(data) as Partial<Session>;
    if (typeof v.id !== 'string' || !Array.isArray(v.messages)) return null;
    const s = v as Session;
    // P0-3: SQLite'ta kalmış eski model ID'lerini sessizce güncelle.
    if (typeof s.model === 'string' && s.model) {
      const provider = (PROVIDER_IDS as string[]).includes(s.provider as string)
        ? s.provider
        : 'anthropic';
      const migrated = migrateProviderModel(provider, s.model);
      s.provider = migrated.provider;
      s.model = migrated.model;
    }
    return s;
  } catch {
    return null;
  }
}

export interface LoadedSessions {
  sessions: Session[];
  activeSessionId: string | null;
}

/**
 * SQLite'tan session'lari yukler. DB yoksa/erisilemezse `null`
 * doner — cagiran localStorage'a duser (zustand persist zaten yapti).
 */
export async function loadSessionsFromDb(provided?: SqlDatabase): Promise<LoadedSessions | null> {
  const db = await openDb(provided);
  if (!db) return null;
  try {
    const rows = await db.select<SessionRow[]>('SELECT id, data FROM sessions');
    let activeSessionId: string | null = null;
    const sessions: Session[] = [];
    for (const row of rows) {
      if (row.id === META_ID) {
        try {
          const meta = JSON.parse(row.data) as { activeSessionId?: unknown };
          if (typeof meta.activeSessionId === 'string') activeSessionId = meta.activeSessionId;
        } catch {
          // Bozuk meta yok sayilir.
        }
        continue;
      }
      const s = parseSession(row.data);
      if (s) sessions.push(s);
    }
    if (activeSessionId && !sessions.some((s) => s.id === activeSessionId)) {
      activeSessionId = sessions[0]?.id ?? null;
    }
    return { sessions, activeSessionId: activeSessionId ?? sessions[0]?.id ?? null };
  } catch (e) {
    // O7: sessiz hata yolu kapandı — hatayı hem kaydet hem gözlemlenebilir log'a yaz.
    lastDbError = e instanceof Error ? e.message : String(e);
    logError('db.load.failed', { error: lastDbError });
    return null;
  }
}

/** Session'lari SQLite'a yazar. Basarisizsa `false` (localStorage yedegi durur).
 *  Atomik UPSERT: transaction icinde `INSERT OR REPLACE` + stale silme.
 *  `DELETE FROM sessions` full-snapshot kullanilmaz (crash'ta veri kaybi + O(n) IPC). */
export async function saveSessionsToDb(
  sessions: Session[],
  activeSessionId: string | null,
  provided?: SqlDatabase,
): Promise<boolean> {
  const db = await openDb(provided);
  if (!db) return false;
  try {
    await db.execute(SESSIONS_TABLE_SQL);
    await db.execute(PENDING_APPROVALS_TABLE_SQL);
    await db.execute(AUDIT_TABLE_SQL);
    await db.execute('BEGIN IMMEDIATE');
    try {
      for (const s of sessions) {
        await db.execute('INSERT OR REPLACE INTO sessions (id, data) VALUES ($1, $2)', [
          s.id,
          JSON.stringify(s),
        ]);
      }
      await db.execute('INSERT OR REPLACE INTO sessions (id, data) VALUES ($1, $2)', [
        META_ID,
        JSON.stringify({ activeSessionId }),
      ]);
      if (sessions.length > 0) {
        const placeholders = sessions.map((_, i) => `$${i + 2}`).join(', ');
        await db.execute(
          `DELETE FROM sessions WHERE id != $1 AND id NOT IN (${placeholders})`,
          [META_ID, ...sessions.map((s) => s.id)],
        );
      } else {
        await db.execute('DELETE FROM sessions WHERE id != $1', [META_ID]);
      }
      await db.execute('COMMIT');
    } catch (inner) {
      try {
        await db.execute('ROLLBACK');
      } catch {
        // ROLLBACK hatasi yoksayilir; dis catch `false` donecek.
      }
      throw inner;
    }
    return true;
  } catch (e) {
    // O7: sessiz hata yolu kapandı — `sqlError()` ile boot uyarısı okunabilir.
    lastDbError = e instanceof Error ? e.message : String(e);
    logError('db.save.failed', { error: lastDbError });
    return false;
  }
}

/**
 * Streaming sirasinda her token'da DB yazmamak icin gecikmeli yazici.
 * Son cagridan `delayMs` sonra tek yazma yapar.
 */
export function createSessionPersister(
  save: (sessions: Session[], activeId: string | null) => void,
  delayMs = 800,
): { schedule: (sessions: Session[], activeId: string | null) => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { sessions: Session[]; activeId: string | null } | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      const p = pending;
      pending = null;
      save(p.sessions, p.activeId);
    }
  };

  const schedule = (sessions: Session[], activeId: string | null) => {
    pending = { sessions, activeId };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  };

  return { schedule, flush };
}

export type AuditDecision = 'allowed-auto' | 'allowed-approval' | 'denied' | 'approved' | 'rejected';

export interface AuditEntry {
  sessionId: string;
  tool: string;
  argsPreview: string;
  decision: AuditDecision;
  result: string;
}

export interface AuditRow extends AuditEntry {
  id: string;
  ts: number;
}

export type UsageStatus = 'ok' | 'error' | 'rate_limited' | 'timeout' | 'cancelled';

export interface UsageEvent {
  id: string;
  ts: number;
  sessionId: string;
  provider: string;
  model: string;
  project?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  ttftMs: number;
  status: UsageStatus;
  costUsd: number;
  estimated: number;
  toolName?: string;
  toolMs: number;
}

/** Ateşle-bırak yazım (akışı durdurmaz; hata false döner). */
export async function appendAudit(e: AuditEntry, provided?: SqlDatabase): Promise<boolean> {
  const db = await openDb(provided);
  if (!db) return false;
  try {
    await db.execute(AUDIT_TABLE_SQL);
    const id = `audit-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    // L6/L7: denetim kaydı kalıcı bir log'dur — araç argümanları/sonuçları
    // API anahtarı veya token içerebilir (ör. MCP env). Yazmadan önce redakte et.
    const argsPreview = redact(e.argsPreview) as string;
    const result = redact(e.result) as string;
    await db.execute(
      'INSERT INTO audit_log (id, ts, session_id, tool, args_preview, decision, result) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, Date.now(), e.sessionId, e.tool, argsPreview, e.decision, result],
    );
    return true;
  } catch (e) {
    lastDbError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

/** Denetim kayıtlarını en yeniden eskiye okur (Faz 6). */
export async function readAuditLog(
  sessionId: string,
  limit = 20,
  provided?: SqlDatabase,
): Promise<AuditRow[]> {
  const db = await openDb(provided);
  if (!db) return [];
  try {
    await db.execute(AUDIT_TABLE_SQL);
    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT id, ts, session_id, tool, args_preview, decision, result FROM audit_log WHERE session_id = $1 ORDER BY ts DESC LIMIT $2',
      [sessionId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map((r) => ({
      id: String(r.id),
      ts: Number(r.ts),
      sessionId: String(r.session_id),
      tool: String(r.tool),
      argsPreview: String(r.args_preview),
      decision: String(r.decision) as AuditDecision,
      result: String(r.result),
    }));
  } catch (e) {
    lastDbError = e instanceof Error ? e.message : String(e);
    return [];
  }
}

export async function readUsageLog(sessionId: string, limit = 20, provided?: SqlDatabase): Promise<UsageEvent[]> {
  const db = await openDb(provided);
  if (!db) return [];
  try {
    await db.execute(USAGE_TABLE_SQL);
    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT id, ts, session_id, provider, model, project, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, latency_ms, ttft_ms, status, cost_usd, estimated, tool_name, tool_ms FROM usage_events WHERE session_id = $1 ORDER BY ts DESC LIMIT $2',
      [sessionId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map((r) => ({
      id: String(r.id),
      ts: Number(r.ts),
      sessionId: String(r.session_id),
      provider: String(r.provider),
      model: String(r.model),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      reasoningTokens: Number(r.reasoning_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
      latencyMs: Number(r.latency_ms),
      ttftMs: Number(r.ttft_ms),
      status: String(r.status) as UsageStatus,
      ...(r.project !== null && r.project !== undefined ? { project: String(r.project) } : {}),
      costUsd: Number(r.cost_usd),
      estimated: Number(r.estimated),
      toolName: String(r.tool_name),
      toolMs: Number(r.tool_ms),
    }));
  } catch (e) {
    lastDbError = e instanceof Error ? e.message : String(e);
    return [];
  }
}

export async function appendUsageEvent(
  event: UsageEvent,
  provided?: SqlDatabase,
): Promise<boolean> {
  const db = await openDb(provided);
  if (!db) return false;
  try {
    await db.execute(USAGE_TABLE_SQL);
    await db.execute(
      'INSERT INTO usage_events (id, ts, session_id, provider, model, project, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, latency_ms, ttft_ms, status, cost_usd, estimated, tool_name, tool_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)',
      [
        event.id,
        event.ts,
        event.sessionId,
        event.provider,
        event.model,
        event.project ?? null,
        event.inputTokens,
        event.outputTokens,
        event.reasoningTokens,
        event.cacheReadTokens,
        event.cacheWriteTokens,
        event.latencyMs,
        event.ttftMs,
        event.status,
        event.costUsd,
        event.estimated,
        event.toolName ?? null,
        event.toolMs,
      ],
    );
    return true;
  } catch (e) {
    lastDbError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

export async function readAllUsageEvents(
  provided?: SqlDatabase,
): Promise<UsageEvent[]> {
  const db = await openDb(provided);
  if (!db) return [];
  try {
    await db.execute(USAGE_TABLE_SQL);
    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT * FROM usage_events ORDER BY ts DESC LIMIT 1000',
    );
    return rows.map((r) => ({
      id: String(r.id),
      ts: Number(r.ts),
      sessionId: String(r.session_id),
      provider: String(r.provider),
      model: String(r.model),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      reasoningTokens: Number(r.reasoning_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
      latencyMs: Number(r.latency_ms),
      ttftMs: Number(r.ttft_ms),
      status: String(r.status) as UsageStatus,
      ...(r.project !== null && r.project !== undefined ? { project: String(r.project) } : {}),
      costUsd: Number(r.cost_usd),
      estimated: Number(r.estimated),
      toolName: String(r.tool_name),
      toolMs: Number(r.tool_ms),
    }));
  } catch (e) {
    lastDbError = e instanceof Error ? e.message : String(e);
    return [];
  }
}

export async function deleteUsageEvent(
  eventId: string,
  provided?: SqlDatabase,
): Promise<boolean> {
  const db = await openDb(provided);
  if (!db) return false;
  try {
    await db.execute('DELETE FROM usage_events WHERE id = $1', [eventId]);
    return true;
  } catch (e) {
    lastDbError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

export async function readUsageEvents(provided?: SqlDatabase): Promise<UsageEvent[]> {
  const db = await openDb(provided);
  if (!db) return [];
  try {
    await db.execute(USAGE_TABLE_SQL);
    const rows = await db.select<Array<Record<string, unknown>>>(
      'SELECT * FROM usage_events ORDER BY ts DESC LIMIT 10000',
    );
    return rows.map((r) => ({
      id: String(r.id),
      ts: Number(r.ts),
      sessionId: String(r.session_id),
      provider: String(r.provider),
      model: String(r.model),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      reasoningTokens: Number(r.reasoning_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
      latencyMs: Number(r.latency_ms),
      ttftMs: Number(r.ttft_ms),
      status: String(r.status) as UsageStatus,
      ...(r.project !== null && r.project !== undefined ? { project: String(r.project) } : {}),
      costUsd: Number(r.cost_usd),
      estimated: Number(r.estimated),
      toolName: String(r.tool_name),
      toolMs: Number(r.tool_ms),
    }));
  } catch (e) {
    lastDbError = e instanceof Error ? e.message : String(e);
    return [];
  }
}
