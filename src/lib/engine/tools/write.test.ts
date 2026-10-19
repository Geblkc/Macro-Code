import { describe, expect, it, vi } from 'vitest';
import { toolWriteFile } from './write';

describe('Faz 3 — write_file', () => {
  it('başarıda önizleme satırı döner', async () => {
    const impl = vi.fn(async () => {});
    const out = await toolWriteFile(
      '/tmp',
      { id: 'w1', name: 'write_file', args: { path: 'yeni.ts', content: 'x' } },
      impl,
    );
    expect(impl).toHaveBeenCalledWith('/tmp', 'yeni.ts', 'x');
    expect(out).toContain('/// oluşturuldu: yeni.ts');
  });

  it('eksik alan ve yasaklı yol hata verir', async () => {
    await expect(
      toolWriteFile('/tmp', { id: 'w2', name: 'write_file', args: { path: '' } }),
    ).rejects.toThrow();
    await expect(
      toolWriteFile('/tmp', { id: 'w3', name: 'write_file', args: { path: '../kacis' } }),
    ).rejects.toThrow();
  });

  it('O_EXCL: Rust hatası Türkçe iletilir', async () => {
    const impl = vi.fn(async () => {
      throw new Error('dosya zaten var: a.ts · edit_file kullan');
    });
    await expect(
      toolWriteFile('/tmp', { id: 'w4', name: 'write_file', args: { path: 'a.ts', content: 'x' } }, impl),
    ).rejects.toThrow(/dosya zaten var/);
  });
});
