import { describe, expect, it } from 'vitest';
import { applyPendingPatch, clearPending, makePreview, proposePatch, toolEditFile } from './patch';

describe('Faz D — patch', () => {
  it('diff önizleme üretir', () => {
    const p = makePreview('a.ts', 'line1\nline2\nline3', 'line1\nLINE2\nline3');
    expect(p).toContain('- line2');
    expect(p).toContain('+ LINE2');
  });

  it('onaysız uygulama yok: id tek kullanımlık', async () => {
    clearPending();
    const p = proposePatch('a.ts', 'new', 'old');
    // Tarayıcıda Rust yok -> hata vermeli, ama pending durmalı mı?
    // applyPendingPatch önce takePending yapar; Rust hatası olsa da id tükenir.
    await expect(applyPendingPatch('/tmp', p.id)).rejects.toThrow();
    await expect(applyPendingPatch('/tmp', p.id)).rejects.toThrow(/bekleyen yama bulunamadı/);
  });

  it('toolEditFile aranılan bloğu benzersiz bulup değiştirir', async () => {
    clearPending();
    const oldCode = 'function hello() {\n  return 1;\n}\n';
    const preview = await toolEditFile(
      '/tmp',
      { id: 'e1', name: 'edit_file', args: { path: 'test.ts', search: 'return 1;', replace: 'return 2;' } },
      async () => oldCode,
    );
    expect(preview).toContain('-   return 1;');
    expect(preview).toContain('+   return 2;');
  });

  it('toolEditFile bulunamayan veya çoklu eşleşen blokta hata verir', async () => {
    clearPending();
    const code = 'const a = 1;\nconst a = 1;\n';
    // Bulunamayan
    await expect(
      toolEditFile(
        '/tmp',
        { id: 'e2', name: 'edit_file', args: { path: 'test.ts', search: 'yok', replace: 'var' } },
        async () => code,
      ),
    ).rejects.toThrow(/bulunamadı/);

    // Birden fazla eşleşen
    await expect(
      toolEditFile(
        '/tmp',
        { id: 'e3', name: 'edit_file', args: { path: 'test.ts', search: 'const a = 1;', replace: 'const b = 2;' } },
        async () => code,
      ),
    ).rejects.toThrow(/birden fazla kez/);
  });
});
