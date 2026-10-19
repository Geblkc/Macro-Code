import { describe, expect, it } from 'vitest';
import { buildMapText, composeProjectBlock, type TreeEntry } from './repoContext';

describe('Faz 9 — repo bağlamı (harita + anahtar dosyalar + hafıza)', () => {
  it('harita dosyaları öncelik sırasına göre listeler', () => {
    const { text, fileCount } = buildMapText(
      ['src/app.ts', 'README.md', 'package.json', 'src-tauri/src/main.rs', 'docs/x.md'],
      4000,
    );
    expect(fileCount).toBe(5);
    const lines = text.split('\n');
    expect(lines[0]).toBe('- package.json');
    expect(lines[1]).toBe('- README.md');
    // src/ src-tauri/src/ önce gelir, .md en sonda
    expect(text.indexOf('- src/app.ts')).toBeLessThan(text.indexOf('- docs/x.md'));
  });

  it('harita karakter sınırında kırpılır ve "+N dosya daha" yazar', () => {
    const paths = Array.from({ length: 50 }, (_, i) => `src/dosya-${i}.ts`);
    const { text, truncated, fileCount } = buildMapText(paths, 120);
    expect(truncated).toBe(true);
    expect(fileCount).toBe(50);
    expect(text).toContain('+');
    expect(text.length).toBeLessThan(200);
  });

  it('ignore edilen dosyalar haritaya girmez', () => {
    const { text } = buildMapText(['src/a.ts', 'node_modules/x.js', 'dist/out.js', '.env'], 4000);
    expect(text).toContain('- src/a.ts');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('dist/out.js');
    expect(text).not.toContain('.env');
  });

  it('proje bloğu harita + anahtar dosya + notları birleştirir', () => {
    const block = composeProjectBlock({
      map: '- package.json\n- src/a.ts',
      mapTruncated: false,
      fileCount: 2,
      keyFiles: [{ path: 'AGENTS.md', content: 'Kurallar: önce test yaz.' }],
      memory: '- [1] api anahtarı ana depoda',
    });
    expect(block).toContain('[proje]');
    expect(block).toContain('- package.json');
    expect(block).toContain('[proje:AGENTS.md]');
    expect(block).toContain('Kurallar: önce test yaz.');
    expect(block).toContain('[notlar]');
    expect(block).toContain('api anahtarı ana depoda');
  });

  it('boş parçalarda blok üretilmez', () => {
    const block = composeProjectBlock({
      map: '',
      mapTruncated: false,
      fileCount: 0,
      keyFiles: [],
      memory: '   ',
    });
    expect(block).toBe('');
  });

  it('TreeEntry tipi beklenen alanları taşır', () => {
    const e: TreeEntry = { path: 'src/a.ts', size: 12 };
    expect(e.path).toBe('src/a.ts');
  });
});
