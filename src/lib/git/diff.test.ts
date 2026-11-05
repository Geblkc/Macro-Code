import { describe, expect, it } from 'vitest';
import { displayPath, parseUnifiedDiff } from './diff';

const MODIFIED = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' export {};',
  '',
].join('\n');

describe('git diff ayrıştırıcı', () => {
  it('tek dosya: hunk ve satır numaraları', () => {
    const parsed = parseUnifiedDiff(MODIFIED);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(1);
    const file = parsed.files[0];
    expect(file.oldPath).toBe('src/app.ts');
    expect(file.newPath).toBe('src/app.ts');
    expect(file.hunks).toHaveLength(1);
    const lines = file.hunks[0].lines;
    expect(lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'add', 'add', 'ctx']);
    expect(lines[0]).toMatchObject({ oldNo: 1, newNo: 1 });
    expect(lines[1]).toMatchObject({ oldNo: 2, newNo: null });
    expect(lines[2]).toMatchObject({ oldNo: null, newNo: 2 });
    expect(lines[3]).toMatchObject({ oldNo: null, newNo: 3 });
    expect(lines[4]).toMatchObject({ oldNo: 3, newNo: 4 });
    expect(displayPath(file)).toBe('src/app.ts');
  });

  it('çok dosyalı diff ve boşluklu yollar', () => {
    const text = [
      'diff --git a/a b.txt b/a b.txt',
      '--- a/a b.txt',
      '+++ b/a b.txt',
      '@@ -0,0 +1 @@',
      '+merhaba',
      'diff --git a/eski.txt b/yeni.txt',
      'similarity index 100%',
      'rename from eski.txt',
      'rename to yeni.txt',
    ].join('\n');
    const parsed = parseUnifiedDiff(text);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0].newPath).toBe('a b.txt');
    expect(parsed.files[1].oldPath).toBe('eski.txt');
    expect(parsed.files[1].newPath).toBe('yeni.txt');
    expect(displayPath(parsed.files[1])).toBe('yeni.txt');
  });

  it('tırnaklı (unicode) yollar ve sekme ayırıcısı', () => {
    const text = [
      'diff --git "a/giz li/s\\304\\261r.txt" "b/giz li/s\\304\\261r.txt"',
      'new file mode 100644',
      '--- "a/giz li/s\\304\\261r.txt"\t',
      '+++ "b/giz li/s\\304\\261r.txt"\t',
      '@@ -0,0 +1 @@',
      '+x',
    ].join('\n');
    const parsed = parseUnifiedDiff(text);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].oldPath).toBe('giz li/s\\304\\261r.txt');
    expect(parsed.files[0].newPath).toBe('giz li/s\\304\\261r.txt');
    expect(displayPath(parsed.files[0])).toBe('giz li/s\\304\\261r.txt');
  });

  it('binary ve newline işareti', () => {
    const text = [
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    const parsed = parseUnifiedDiff(text);
    expect(parsed.binary).toBe(true);
    expect(parsed.files[0].binary).toBe(true);

    const noNewline = parseUnifiedDiff(
      ['diff --git a/x b/x', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b'].join('\n'),
    );
    expect(noNewline.files[0].hunks[0].lines.some((l) => l.kind === 'nonewline')).toBe(true);
  });

  it('boş/anlamsız metin → boş sonuç', () => {
    expect(parseUnifiedDiff('').files).toEqual([]);
    expect(parseUnifiedDiff('  not a diff\n').files).toEqual([]);
    expect(displayPath({ oldPath: null, newPath: null, header: [], hunks: [], binary: false })).toBe(
      '(bilinmeyen)',
    );
  });
});
