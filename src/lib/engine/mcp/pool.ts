/**
 * Faz 5 — MCP istemci havuzu + agent bağlantısı.
 * `configureMcp` her agent gönderiminde kurulur; `runMcpTool` tool çalıştırır.
 * Bağlantı hatasında sunucu sessizce atlanır (agent azaltılmış setle sürer).
 */
import { McpClient, type McpTransport } from './client';
import { createHttpTransport } from './transports/http';
import { createStdioTransport } from './transports/stdio';
import { parseMcpName, toToolDefinitions } from './registry';
import type { McpServerConfig } from '../../../types';
import type { ToolCall, ToolDefinition } from '../types';

export interface McpContext {
  servers: McpServerConfig[];
  secrets: Record<string, Record<string, string>>;
  root?: string;
}

interface PooledEntry {
  client: McpClient;
  tools: ToolDefinition[];
  listedAt: number;
  fingerprint: string;
}

const LIST_TTL_MS = 5 * 60 * 1000;

const pool = new Map<string, PooledEntry>();
let context: McpContext = { servers: [], secrets: {} };

export function configureMcp(ctx: McpContext): void {
  context = ctx;
}

export function mcpContext(): McpContext {
  return context;
}

function fingerprint(srv: McpServerConfig): string {
  return JSON.stringify({
    t: srv.transport,
    u: srv.url ?? '',
    c: srv.command ?? '',
    a: srv.args ?? [],
    e: srv.enabled,
  });
}

function shortName(namespaced: string): string {
  const p = parseMcpName(namespaced);
  return p ? p.tool : namespaced;
}

function transportFor(srv: McpServerConfig): McpTransport {
  if (srv.transport === 'stdio') {
    return createStdioTransport({
      serverId: srv.id,
      command: srv.command ?? '',
      args: srv.args ?? [],
      env: context.secrets[srv.id],
      root: context.root,
    });
  }
  return createHttpTransport({ url: srv.url ?? '' });
}

function filterAllowed(srv: McpServerConfig, tools: ToolDefinition[]): ToolDefinition[] {
  if (!srv.allowedTools) return tools;
  return tools.filter((t) => srv.allowedTools!.includes(shortName(t.name as string)));
}

async function ensureListed(srv: McpServerConfig): Promise<PooledEntry> {
  const fp = fingerprint(srv);
  const cached = pool.get(srv.id);
  if (cached && cached.fingerprint === fp && Date.now() - cached.listedAt < LIST_TTL_MS) {
    return cached;
  }
  if (cached) {
    pool.delete(srv.id);
    await cached.client.close().catch(() => {});
  }
  const client = new McpClient(transportFor(srv));
  await client.initialize();
  const tools = filterAllowed(srv, toToolDefinitions(srv.id, await client.listTools()));
  const entry: PooledEntry = { client, tools, listedAt: Date.now(), fingerprint: fp };
  pool.set(srv.id, entry);
  return entry;
}

/** Agent isteğine eklenecek MCP tool tanımları (düşen sunucu atlanır). */
export async function mcpToolsForAgent(): Promise<ToolDefinition[]> {
  const out: ToolDefinition[] = [];
  for (const srv of context.servers) {
    if (!srv.enabled) continue;
    try {
      out.push(...(await ensureListed(srv)).tools);
    } catch {
      // Sunucu düşerse sessiz geç.
    }
  }
  return out;
}

/** `mcp:sunucu:araç` çağrısı. Tool-hatası throw edilir (agent isError işaretler). */
export async function runMcpTool(call: ToolCall): Promise<string> {
  const parsed = parseMcpName(String(call.name));
  if (!parsed) throw new Error(`bozuk mcp adı: ${String(call.name)}`);
  const srv = context.servers.find((s) => s.id === parsed.server && s.enabled);
  if (!srv) throw new Error(`mcp sunucusu yok/kapalı: ${parsed.server}`);
  if (srv.allowedTools && !srv.allowedTools.includes(parsed.tool)) {
    throw new Error(`mcp araç izni yok: ${parsed.tool}`);
  }
  let entry: PooledEntry;
  try {
    entry = await ensureListed(srv);
  } catch (e) {
    throw new Error(`mcp bağlanamadı (${srv.name}): ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const res = await entry.client.callTool(
      parsed.tool,
      (call.args ?? {}) as Record<string, unknown>,
    );
    if (res.isError) throw new Error(res.text || 'araç hatası');
    return res.text || '(boş sonuç)';
  } catch (e) {
    // Bozuk bağlantıyı havuzdan düşür (sonraki çağrı yeniden bağlanır).
    pool.delete(srv.id);
    await entry.client.close().catch(() => {});
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export async function closeMcpPool(): Promise<void> {
  for (const [, e] of pool) {
    await e.client.close().catch(() => {});
  }
  pool.clear();
}
