import { describe, expect, it } from 'vitest';
import { highlight, isKnownLang } from './highlight';

const classesOf = (code: string, lang: string) =>
  highlight(code, lang)
    .flat()
    .map((t) => t.cls)
    .filter(Boolean);

describe('highlight', () => {
  it('anahtar kelimeleri işaretler', () => {
    const cls = classesOf('const a = 1;', 'ts');
    expect(cls).toContain('hl-key');
  });

  it('dizeleri işaretler', () => {
    const cls = classesOf('const s = "merhaba";', 'ts');
    expect(cls).toContain('hl-str');
  });

  it('sayıları işaretler', () => {
    const cls = classesOf('const n = 42;', 'ts');
    expect(cls).toContain('hl-num');
  });

  it('yorumları işaretler', () => {
    expect(classesOf('// not', 'ts')).toContain('hl-com');
    expect(classesOf('# not', 'python')).toContain('hl-com');
  });

  it('fonksiyon çağrısını işaretler', () => {
    expect(classesOf('doThing()', 'ts')).toContain('hl-fn');
  });

  it('python anahtar kelimelerini tanır', () => {
    expect(classesOf('def f(): pass', 'python')).toContain('hl-key');
  });

  it('bash değişkenlerini tanır', () => {
    expect(classesOf('echo $HOME', 'bash')).toContain('hl-type');
  });

  it('satır satır token üretir', () => {
    const lines = highlight('a\nb\nc', 'ts');
    expect(lines).toHaveLength(3);
  });

  it('bilinmeyen dili düz metin olarak bırakır', () => {
    const lines = highlight('abc def', 'bilinmeyen');
    expect(lines[0][0].cls).toBe('');
  });

  it('çok satırlı blok yorumu kapatır', () => {
    const lines = highlight('/* a\nb */ const x = 1;', 'ts');
    expect(lines[0].some((t) => t.cls === 'hl-com')).toBe(true);
    expect(lines[1].some((t) => t.cls === 'hl-com')).toBe(true);
    expect(lines[1].some((t) => t.cls === 'hl-key')).toBe(true);
  });

  it('dil takma adlarını tanır', () => {
    expect(isKnownLang('tsx')).toBe(true);
    expect(isKnownLang('py')).toBe(true);
    expect(isKnownLang('sh')).toBe(true);
    expect(isKnownLang('xyz')).toBe(false);
  });
});
