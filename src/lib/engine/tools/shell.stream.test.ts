import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../types';

const { invokeMock, channels } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  channels: [] as Array<{ cb: (ev: unknown) => void }>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    constructor(public cb: (ev: unknown) => void) {
      channels.push(this);
    }
  },
  invoke: (...args: unknown[]) => invokeMock(...(args as [string])),
}));

import { cancelExec, resolveExecTimeout, toolExec } from './shell';

const call = (args: Record<string, unknown> = {}): ToolCall => ({
  id: 't1',
  name: 'exec',
  args: { cmd: 'echo', args: ['ok'], ...args },
});

const out = (p: Partial<Record<string, unknown>> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  truncated: false,
  cancelled: false,
  timed_out: false,
  ...p,
});

describe('P0.2 — exec canlı akış / timeout / iptal', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    channels.length = 0;
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stdout/stderr parçalarını onStream ile iletir ve ExecOut döndürür', async () => {
    invokeMock.mockImplementation(async (cmd: string, payload: Record<string, unknown>) => {
      expect(cmd).toBe('exec_cmd_stream');
      const ch = payload.onEvent as { cb: (ev: unknown) => void };
      ch.cb({ k: 'stdout', data: 'merhaba\n' });
      ch.cb({ k: 'stderr', data: 'uyarı\n' });
      return out({ stdout: 'merhaba\n', stderr: 'uyarı\n' });
    });

    const seen: Array<[string, string]> = [];
    const res = await toolExec('/tmp', call(), 'manual', {
      approved: true,
      extraAllow: {},
      onStream: (s, d) => seen.push([s, d]),
    });

    expect(seen).toEqual([
      ['stdout', 'merhaba\n'],
      ['stderr', 'uyarı\n'],
    ]);
    expect(res).toContain('[exit 0]');
    expect(res).toContain('merhaba');
    expect(res).toContain('[stderr]');
    expect(invokeMock).toHaveBeenCalledWith(
      'exec_cmd_stream',
      expect.objectContaining({ runId: 't1', cmd: 'echo', timeoutMs: 30_000 }),
    );
  });

  it('sıfırdan farklı çıkış kodunu başarısız tool sonucu yapar', async () => {
    invokeMock.mockResolvedValue(out({ code: 2, stdout: 'test patladı', stderr: 'hata' }));
    await expect(
      toolExec('/tmp', call({ cmd: 'npm', args: ['test'] }), 'manual', { approved: true }),
    ).rejects.toThrow('[exit 2]');
  });

  it('iptal ve timeout ayrı hata mesajı üretir', async () => {
    invokeMock.mockResolvedValueOnce(out({ code: -1, cancelled: true, stdout: 'kısmi' }));
    await expect(
      toolExec('/tmp', call(), 'manual', { approved: true }),
    ).rejects.toThrow(/iptal edildi/);

    invokeMock.mockResolvedValueOnce(out({ code: -1, timed_out: true }));
    await expect(
      toolExec('/tmp', call(), 'manual', { approved: true }),
    ).rejects.toThrow(/zaman aşımına/);
  });

  it('komut türüne göre varsayılan timeout ve ayar üst sınırı', () => {
    expect(resolveExecTimeout(call({ cmd: 'ls', args: [] }), 'ls', [])).toBe(30_000);
    expect(resolveExecTimeout(call({ cmd: 'cargo', args: ['build'] }), 'cargo', ['build'])).toBe(
      300_000,
    );
    expect(resolveExecTimeout(call({ cmd: 'npm', args: ['test'] }), 'npm', ['test'])).toBe(
      120_000,
    );
    // Açık değer ayar üst sınırına kırpılır.
    expect(
      resolveExecTimeout(call({ cmd: 'cargo', args: ['build'], timeoutMs: 500_000 }), 'cargo', [
        'build',
      ], 60_000),
    ).toBe(60_000);
    // Rust tavanı aşılamaz.
    expect(
      resolveExecTimeout(call({ cmd: 'cargo', args: ['build'], timeoutMs: 9_000_000 }), 'cargo', [
        'build',
      ]),
    ).toBe(600_000);
  });

  it('cancelExec doğru run id ile exec_cancel çağırır', async () => {
    invokeMock.mockResolvedValue(true);
    await expect(cancelExec('t1')).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('exec_cancel', { runId: 't1' });
  });
});
