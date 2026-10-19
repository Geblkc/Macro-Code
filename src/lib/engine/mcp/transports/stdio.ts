/**
 * Faz 5 — stdio MCP transport (Rust subprocess köprüsü).
 * WebView'da subprocess yok; satır-tabanlı JSON-RPC Rust üzerinden akar.
 * App çıkışında tüm child'lar öldürülür (RunEvent::Exit kancası lib.rs'te).
 */
import { invoke } from '@tauri-apps/api/core';
import { McpError, parseResponse } from '../protocol';
import type { McpTransport } from '../client';

export interface StdioTransportOptions {
  serverId: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Workspace kökü (cwd jail için). */
  root?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Yanıt-benzeri satıra kadar okur (bildirim satırları atlanır). */
async function readResponse(
  procId: string,
  timeoutMs: number,
  startedAt: number,
): Promise<string> {
  for (;;) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) throw new McpError('mcp: stdio yanıt zaman aşımı');
    const line = await invoke<string>('mcp_read', { id: procId, timeout_ms: timeoutMs - elapsed });
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t) as { id?: unknown };
      if (v && typeof v === 'object' && 'id' in v) {
        parseResponse(t);
        return t;
      }
      // Bildirim satırı → atla, okumaya devam.
    } catch {
      // Bozuk satır → atla.
    }
  }
}

export function createStdioTransport(opts: StdioTransportOptions): McpTransport {
  let procId: string | null = null;
  let closed = false;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function ensureSpawn(): Promise<string> {
    if (procId) return procId;
    if (closed) throw new McpError('mcp: transport kapalı');
    if (!opts.command.trim()) throw new McpError('mcp: sunucu komutu boş');
    procId = await invoke<string>('mcp_spawn', {
      command: opts.command,
      args: opts.args ?? [],
      env: opts.env ?? null,
      root: opts.root ?? null,
    });
    return procId;
  }

  return {
    async send(messageText: string): Promise<void> {
      const id = await ensureSpawn();
      try {
        await invoke('mcp_write', { id, data: messageText });
      } catch (e) {
        procId = null;
        throw new McpError(`mcp: yazma hatası: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async read(): Promise<string> {
      const id = await ensureSpawn();
      const startedAt = Date.now();
      try {
        return await readResponse(id, timeoutMs, startedAt);
      } catch (e) {
        if (e instanceof McpError) throw e;
        throw new McpError(`mcp: okuma hatası: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async close(): Promise<void> {
      closed = true;
      if (procId) {
        const id = procId;
        procId = null;
        try {
          await invoke('mcp_kill', { id });
        } catch {
          // kapanışta sessiz
        }
      }
    },
  };
}
