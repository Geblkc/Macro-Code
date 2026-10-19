import { describe, expect, it, vi } from 'vitest';
import { createHttpTransport, extractResponseText, mcpFetchFor } from './http';
import { needsProxy } from '../../../providers/rustFetch';

const res = (body: string, type = 'application/json') =>
  new Response(body, { status: 200, headers: { 'content-type': type } });

describe('Faz 5 — HTTP transport', () => {
  it('tek JSON gövde aynen alınır', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    expect(extractResponseText(body, 1)).toBe(body);
  });

  it('SSE gövdeden eşleşen id seçilir', () => {
    const body = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"a":1}}',
      'data: {"jsonrpc":"2.0","id":2,"result":{"b":2}}',
    ].join('\n');
    expect(JSON.parse(extractResponseText(body, 2))).toMatchObject({ id: 2 });
  });

  it('send→read turu mock fetch ile çalışır', async () => {
    const fetchImpl = vi.fn(async () =>
      res(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })),
    );
    const t = createHttpTransport({ url: 'https://ornek/mcp', fetchImpl: fetchImpl as unknown as typeof fetch });
    await t.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await t.read()).toContain('"ok":true');
    await t.close();
    await expect(t.send('{}')).rejects.toThrow(/kapalı/);
  });

  it('http hatası McpError olur', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 500 }));
    const t = createHttpTransport({ url: 'https://ornek/mcp', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(t.send('{"jsonrpc":"2.0","id":1}')).rejects.toThrow(/http 500/);
  });
});

describe('Faz 7 A5 — MCP transport fetch seçimi (CSP bypass)', () => {
  it('enjekte edilen fetch her zaman kullanılır (test/MDI yolu bozulmaz)', () => {
    const injected = vi.fn() as unknown as typeof fetch;
    expect(mcpFetchFor('https://mcp.ornek.com/rpc', injected)).toBe(injected);
  });

  it('Tauri dışında global fetch kullanılır', () => {
    expect(mcpFetchFor('https://mcp.ornek.com/rpc')).toBe(globalThis.fetch);
  });

  it('uzak MCP origin CSP connect-src dışındadır → proxy gerekir', () => {
    // Tauri'de bu origin `connect-src` listesinde olmadığı için Rust proxy'ye düşer.
    expect(needsProxy('https://mcp.ornek.com/rpc')).toBe(true);
    expect(needsProxy('http://localhost:3000/mcp')).toBe(false);
  });
});
