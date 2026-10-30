import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../appInfo';
import { McpClient, type McpTransport } from './client';

function scripted(handlers: Record<string, (id: number | string) => string>): McpTransport {
  const outbox: string[] = [];
  return {
    async send(text: string): Promise<void> {
      outbox.push(text);
    },
    async read(): Promise<string> {
      const last = outbox[outbox.length - 1];
      const req = JSON.parse(last) as { id: number | string; method: string };
      const fn = handlers[req.method];
      if (!fn) throw new Error(`beklenmeyen method: ${req.method}`);
      return fn(req.id);
    },
    async close(): Promise<void> {},
  };
}

const res = (id: number | string, result: unknown) =>
  JSON.stringify({ jsonrpc: '2.0', id, result });

describe('Faz 5 — MCP istemcisi', () => {
  it('initialize + listTools + callTool (mock transport)', async () => {
    const seen: string[] = [];
    const t: McpTransport = {
      async send(text: string): Promise<void> {
        seen.push(text);
      },
      async read(): Promise<string> {
        const req = JSON.parse(seen[seen.length - 1]) as { id: number; method: string };
        if (req.method === 'initialize') {
          return res(req.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'demo' } });
        }
        if (req.method === 'tools/list') {
          return res(req.id, { tools: [{ name: 'topla', inputSchema: { type: 'object' } }] });
        }
        return res(req.id, { content: [{ type: 'text', text: '42' }] });
      },
      async close(): Promise<void> {},
    };
    const c = new McpClient(t, { timeoutMs: 1000 });
    const hello = await c.initialize();
    expect(hello.serverInfo.name).toBe('demo');
    // initialized bildirimi de gönderildi
    expect(seen.some((s) => s.includes('notifications/initialized'))).toBe(true);
    const init = JSON.parse(seen[0]) as { params: { clientInfo: { version: string } } };
    expect(init.params.clientInfo.version).toBe(APP_VERSION);
    expect(await c.listTools()).toHaveLength(1);
    const out = await c.callTool('topla', { a: 1 });
    expect(out.text).toBe('42');
    await c.close();
  });

  it('scripted yardımcı handshake kurar', async () => {
    const t = scripted({
      initialize: (id) => res(id, { protocolVersion: 'x', serverInfo: { name: 's' } }),
    });
    const c = new McpClient(t);
    expect((await c.initialize()).serverInfo.name).toBe('s');
    await c.close();
  });

  it('sunucu hatası McpError olur', async () => {
    const t: McpTransport = {
      async send(): Promise<void> {},
      async read(): Promise<string> {
        return JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'yok' } });
      },
      async close(): Promise<void> {},
    };
    const c = new McpClient(t);
    await expect(c.listTools()).rejects.toThrow('yok');
  });

  it('zaman aşımı ve kapalı istemci korunur', async () => {
    const hanging: McpTransport = {
      async send(): Promise<void> {},
      read(): Promise<string> {
        return new Promise((resolve) => setTimeout(() => resolve('{}'), 500));
      },
      async close(): Promise<void> {},
    };
    const c = new McpClient(hanging, { timeoutMs: 20 });
    await expect(c.listTools()).rejects.toThrow(/zaman aşımı/);
    await c.close();
    await expect(c.listTools()).rejects.toThrow(/kapalı/);
  });
});
