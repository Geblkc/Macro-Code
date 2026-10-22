/**
 * Faz 5 — MCP JSON-RPC 2.0 protokol tipleri (transport bağımsız, saf).
 * Kapsam: initialize, tools/list, tools/call (+ notifications/initialized).
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export class McpError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'McpError';
    this.code = code;
  }
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerInfo {
  name: string;
  version?: string;
}

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export function createRequest(
  id: number | string,
  method: string,
  params?: unknown,
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

export function createNotification(method: string, params?: unknown): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

/** Yanıt-ADAYI mı? (id'li ve sunucu-İSTEĞİ değil — `method`'lu satır
 *  istemcinin kendi isteğinin yanıtı değildir; id karışması kapatılır.) */
export function isResponseLike(v: unknown): v is { id: unknown } {
  return !!v && typeof v === 'object' && 'id' in v && !('method' in v);
}

/** Ham metni JSON-RPC yanıtına çevirir; bozuksa McpError fırlatır. */
export function parseResponse(text: string): JsonRpcResponse {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new McpError('mcp: yanıt JSON değil');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new McpError('mcp: yanıt obje değil');
  }
  const r = v as Record<string, unknown>;
  if (r.jsonrpc !== '2.0' || !('id' in r)) {
    throw new McpError('mcp: geçersiz JSON-RPC zarfı');
  }
  return r as unknown as JsonRpcResponse;
}

/** Yanıtı sonuca çevirir; error varsa McpError fırlatır. */
export function unwrapResponse(res: JsonRpcResponse, id: number | string): unknown {
  if (res.id !== id) {
    throw new McpError(`mcp: yanıt id uyuşmazlığı (beklenen ${String(id)})`);
  }
  if (res.error) {
    throw new McpError(`mcp: ${res.error.message}`, res.error.code);
  }
  return res.result;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** tools/list sonucunu doğrular; bozuksa McpError fırlatır. */
export function parseToolsList(result: unknown): McpTool[] {
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    throw new McpError('mcp: tools/list sonucu bozuk');
  }
  return result.tools.map((t, i) => {
    if (!isRecord(t) || typeof t.name !== 'string' || !t.name) {
      throw new McpError(`mcp: ${i}. araç tanımsız`);
    }
    return {
      name: t.name,
      ...(typeof t.description === 'string' ? { description: t.description } : {}),
      inputSchema: isRecord(t.inputSchema) ? t.inputSchema : { type: 'object' },
    };
  });
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

const MAX_TOOL_TEXT = 4000;

/** tools/call sonucunu metne çevirir (text blokları birleşir, diğerleri yer tutucu). */
export function parseToolResult(result: unknown): McpCallResult {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    throw new McpError('mcp: tools/call sonucu bozuk');
  }
  const parts: string[] = [];
  for (const block of result.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (typeof block.type === 'string') {
      parts.push(`[${block.type} içerik — metin değil]`);
    }
  }
  const text = parts.join('\n');
  const clipped = text.length > MAX_TOOL_TEXT ? `${text.slice(0, MAX_TOOL_TEXT)}\n…[kesildi]` : text;
  return { text: clipped, isError: result.isError === true };
}
