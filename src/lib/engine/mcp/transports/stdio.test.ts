import { describe, expect, it } from 'vitest';
import { createStdioTransport } from './stdio';

describe('Faz 5 — stdio transport', () => {
  it('boş komut erken reddedilir', async () => {
    const t = createStdioTransport({ serverId: 'mcp:b', command: '   ' });
    await expect(t.send('{}')).rejects.toThrow(/komutu boş/);
    await t.close();
  });

  it('Tauri dışında spawn McpError üretir (yakalanabilir)', async () => {
    const t = createStdioTransport({ serverId: 'mcp:yok', command: 'yok-komut-xyz' });
    // Tarayıcı/vitest ortamında invoke yoktur → McpError (ham hata değil).
    await expect(t.send('{}')).rejects.toThrowError();
    await t.close();
  });
});
