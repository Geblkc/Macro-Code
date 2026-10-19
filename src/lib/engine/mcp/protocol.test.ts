import { describe, expect, it } from 'vitest';
import {
  McpError,
  createNotification,
  createRequest,
  parseResponse,
  parseToolResult,
  parseToolsList,
  unwrapResponse,
} from './protocol';

describe('Faz 5 — MCP protokolü', () => {
  it('handshake zarfları kurulur', () => {
    expect(createRequest(1, 'initialize', { a: 1 })).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(createNotification('notifications/initialized')).toMatchObject({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  });

  it('geçerli yanıt açılır, hata McpError olur', () => {
    const ok = parseResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    expect(unwrapResponse(ok, 1)).toEqual({ ok: true });
    const bad = parseResponse(
      JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bozuk' } }),
    );
    expect(() => unwrapResponse(bad, 1)).toThrowError(McpError);
    expect(() => unwrapResponse(ok, 2)).toThrow(/id uyuşmazlığı/);
    expect(() => parseResponse('değil json')).toThrowError(McpError);
  });

  it('tools/list doğrulanır', () => {
    const tools = parseToolsList({
      tools: [{ name: 'oku', description: 'd', inputSchema: { type: 'object' } }, { name: 'yaz' }],
    });
    expect(tools).toHaveLength(2);
    expect(tools[1].inputSchema).toEqual({ type: 'object' });
    expect(() => parseToolsList({ tools: [{ ad: 'yok' }] })).toThrowError(McpError);
    expect(() => parseToolsList({})).toThrowError(McpError);
  });

  it('tools/call metne çevrilir (4KB kırpma + isError)', () => {
    const r = parseToolResult({
      content: [{ type: 'text', text: 'a' }, { type: 'image', data: '...' }],
      isError: false,
    });
    expect(r.text).toContain('a');
    expect(r.text).toContain('metin değil');
    expect(r.isError).toBe(false);
    const big = parseToolResult({ content: [{ type: 'text', text: 'x'.repeat(5000) }] });
    expect(big.text.length).toBeLessThan(5000);
    expect(big.text).toContain('kesildi');
    expect(() => parseToolResult({})).toThrowError(McpError);
  });
});
