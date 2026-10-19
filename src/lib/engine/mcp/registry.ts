/**
 * Faz 5 — MCP → ToolDefinition adaptörü (`mcp:<sunucu>:<tool>` namespace).
 * Çağrı politikası: her zaman manuel onay (K2 akışı, O6 ile tutarlı).
 */
import type { ToolCall, ToolDefinition, ToolName } from '../types';
import type { McpTool } from './protocol';

const TR_MAP: Record<string, string> = {
  Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u',
  Ö: 'o', ö: 'o', Ç: 'c', ç: 'c', I: 'i', ı: 'i', İ: 'i',
};

/** Görünen addan kayıt-uyumlu id üretir (`mcp_<slug>`, küçük harf). */
export function makeMcpServerId(name: string): string {
  const ascii = name
    .trim()
    .split('')
    .map((ch) => TR_MAP[ch] ?? ch)
    .join('');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `mcp_${slug || 'sunucu'}`;
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp:${server}:${tool}`;
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp:') && name.split(':').length === 3;
}

/** `mcp:sunucu:araç` → { server, tool } (bozuksa null). */
export function parseMcpName(name: string): { server: string; tool: string } | null {
  if (!isMcpToolName(name)) return null;
  const [, server, tool] = name.split(':');
  if (!server || !tool) return null;
  return { server, tool };
}

export function toToolDefinitions(server: string, tools: McpTool[]): ToolDefinition[] {
  return tools.map((t) => ({
    name: mcpToolName(server, t.name) as ToolName,
    description: t.description?.trim() ? `[mcp:${server}] ${t.description}` : `[mcp:${server}] ${t.name}`,
    parameters:
      t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' },
  }));
}

export function mcpCallFromToolCall(call: ToolCall): { server: string; tool: string } | null {
  return parseMcpName(String(call.name));
}
