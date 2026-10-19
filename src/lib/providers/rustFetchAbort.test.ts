import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === 'proxy_fetch') {
    // Yanıt hiç gelmiyor (asılı istek senaryosu) — yalnızca abort ilgilendiriyor.
    return new Promise<void>(() => {});
  }
  return undefined;
});

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    constructor(public cb: (ev: unknown) => void) {}
  },
  invoke: (...args: unknown[]) => invokeMock(...(args as [string])),
}));

import { rustFetch } from './rustFetch';

describe('Faz 7 A5 — proxy abort (timeout yolu)', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it('abort sinyali proxy_ye iletilir ve istek AbortError ile biter', async () => {
    const ctrl = new AbortController();
    const p = rustFetch('https://mcp.ornek.com/rpc', { signal: ctrl.signal });
    // İstek Rust tarafında asılı kalsın, sonra iptal et.
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(invokeMock).toHaveBeenCalledWith('proxy_abort', expect.anything());
  });

  it('zaten abort edilmiş sinyal hemen iptal eder', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      rustFetch('https://mcp.ornek.com/rpc', { signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
