import { describe, expect, it } from 'vitest';
import { closeMcpPool, configureMcp, mcpToolsForAgent, runMcpTool } from './pool';

describe('Faz 5 — MCP havuzu', () => {
  it('sunucu yoksa boş liste, bilinmeyen çağrı hata verir', async () => {
    configureMcp({ servers: [], secrets: {} });
    await expect(mcpToolsForAgent()).resolves.toEqual([]);
    await expect(
      runMcpTool({ id: 'c', name: 'mcp:yok:oku', args: {} }),
    ).rejects.toThrow(/yok\/kapalı/);
    await expect(runMcpTool({ id: 'c', name: 'bozuk-ad', args: {} })).rejects.toThrow(
      /bozuk mcp adı/,
    );
    await closeMcpPool();
  });

  it('kapalı sunucu atlanır, izin filtresi korunur', async () => {
    configureMcp({
      servers: [
        {
          id: 'mcp_kapali',
          name: 'kapalı',
          transport: 'http',
          url: 'http://127.0.0.1:9/mcp',
          enabled: false,
          allowedTools: null,
        },
      ],
      secrets: {},
    });
    await expect(mcpToolsForAgent()).resolves.toEqual([]);
    await expect(
      runMcpTool({ id: 'c', name: 'mcp:mcp_kapali:oku', args: {} }),
    ).rejects.toThrow(/yok\/kapalı/);
    await closeMcpPool();
  });

  it('ulaşılamaz sunucu listeyi kırmaz (boş döner)', async () => {
    configureMcp({
      servers: [
        {
          id: 'mcp_olu',
          name: 'ölü',
          transport: 'http',
          url: 'http://127.0.0.1:9/mcp',
          enabled: true,
          allowedTools: null,
        },
      ],
      secrets: {},
    });
    await expect(mcpToolsForAgent()).resolves.toEqual([]);
    await expect(runMcpTool({ id: 'c', name: 'mcp:mcp_olu:oku', args: {} })).rejects.toThrow(
      /bağlanamadı/,
    );
    await closeMcpPool();
  });
});
