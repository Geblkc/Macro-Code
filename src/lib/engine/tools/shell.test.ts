import { describe, expect, it } from 'vitest';
import { toolExec } from './shell';
import type { ToolCall } from '../types';

const call = (cmd: string, args: string[] = []): ToolCall => ({
  id: 't1',
  name: 'exec',
  args: { cmd, args },
});

describe('Y2 (Faz 3) — exec onay bayrağı', () => {
  it('onaysız exec reddedilir (autoApproved asla true değil)', async () => {
    // invoke'a bile gitmeden guard düşer — "yalnızca Tauri" hatası YOK.
    await expect(toolExec('/tmp', call('npm', ['--version']), 'manual')).rejects.toThrow(
      /onay gerekli/,
    );
  });

  it('approved: true guard\'ı geçer (invoke çağrısına ulaşır)', async () => {
    // Guard aşıldı → hata artık onay değil, Tauri ortamı hakkındadır.
    await expect(
      toolExec('/tmp', call('npm', ['--version']), 'manual', { approved: true }),
    ).rejects.toThrow(/yalnızca Tauri/);
  });

  it('approved olsa bile allowlist dışı komut reddedilir', async () => {
    await expect(
      toolExec('/tmp', call('rm', ['-rf', '/']), 'manual', { approved: true }),
    ).rejects.toThrow(/yasaklı/);
    await expect(
      toolExec('/tmp', call('sudo', []), 'manual', { approved: true }),
    ).rejects.toThrow(/yasaklı/);
  });

  it('extraAllow özel komuta izin verir (Rust invoke\'a kadar)', async () => {
    const extra = { docker: [['ps']] };
    // İzinli: guard'ı geçer → Tauri ortamı hatası.
    await expect(
      toolExec('/tmp', call('docker', ['ps']), 'manual', { approved: true, extraAllow: extra }),
    ).rejects.toThrow(/yalnızca Tauri/);
    // İzin dışı prefix: hâlâ reddedilir.
    await expect(
      toolExec('/tmp', call('docker', ['rm']), 'manual', { approved: true, extraAllow: extra }),
    ).rejects.toThrow(/yasaklı/);
  });
});
