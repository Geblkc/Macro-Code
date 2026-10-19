import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSafeHref, tokenizeBlocks, tokenizeInlineRich } from './markdown';

describe('tokenizeBlocks', () => {
  it('başlıkları tanır (h1-h6)', () => {
    const b = tokenizeBlocks('## Başlık\n\nMetin');
    expect(b[0]).toEqual({ kind: 'h', level: 2, text: 'Başlık' });
    expect(b[1]).toEqual({ kind: 'p', text: 'Metin' });
  });

  it('sırasız ve sıralı listeyi ayırır', () => {
    const ul = tokenizeBlocks('- bir\n- iki');
    expect(ul[0].kind).toBe('ul');
    const ol = tokenizeBlocks('1. bir\n2. iki');
    expect(ol[0].kind).toBe('ol');
  });

  it('iç içe listeyi alt öğe olarak tutar', () => {
    const b = tokenizeBlocks('- bir\n  - alt\n- iki');
    expect(b[0].kind).toBe('ul');
    if (b[0].kind === 'ul') {
      expect(b[0].items).toHaveLength(2);
      expect(b[0].items[0].children.length).toBeGreaterThan(0);
    }
  });

  it('görev listesi işaretini tanır', () => {
    const b = tokenizeBlocks('- [x] bitti\n- [ ] kalmadı');
    if (b[0].kind === 'ul') {
      expect(b[0].items[0].checked).toBe(true);
      expect(b[0].items[1].checked).toBe(false);
    }
  });

  it('kod bloğunu tek blok olarak alır (kapanmamışsa sona kadar)', () => {
    const b = tokenizeBlocks('```ts\nconst a = 1;\n```');
    expect(b[0]).toEqual({ kind: 'code', lang: 'ts', code: 'const a = 1;' });
    const unclosed = tokenizeBlocks('```\nsatır');
    expect(unclosed[0].kind).toBe('code');
  });

  it('alıntı ve yatay çizgiyi tanır', () => {
    expect(tokenizeBlocks('> alıntı')[0].kind).toBe('quote');
    expect(tokenizeBlocks('---')[0].kind).toBe('hr');
  });

  it('GFM tablosunu başlık + satırlara ayırır', () => {
    const b = tokenizeBlocks('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(b[0].kind).toBe('table');
    if (b[0].kind === 'table') {
      expect(b[0].head).toEqual(['a', 'b']);
      expect(b[0].rows).toEqual([['1', '2']]);
    }
  });

  it('paragrafı blok başlangıcında keser', () => {
    const b = tokenizeBlocks('metin\n## başlık');
    expect(b[0].kind).toBe('p');
    expect(b[1].kind).toBe('h');
  });
});

describe('tokenizeInlineRich', () => {
  it('kod, kalın, italik, üstü çizili ve bağlantıyı tanır', () => {
    const t = tokenizeInlineRich('`kod` **kalın** *italik* ~~çizili~~ [bağlantı](https://x.com)');
    const kinds = t.map((x) => x.kind);
    expect(kinds).toContain('code');
    expect(kinds).toContain('bold');
    expect(kinds).toContain('italic');
    expect(kinds).toContain('strike');
    expect(kinds).toContain('link');
  });

  it('görseli ayrı işaretler', () => {
    const t = tokenizeInlineRich('![alt](data:image/png;base64,AAA)');
    expect(t.some((x) => x.kind === 'image')).toBe(true);
  });

  it('tehlikeli şemalı bağlantıyı düz metne çevirir', () => {
    const t = tokenizeInlineRich('[x](javascript:alert(1))');
    expect(t.every((x) => x.kind === 'text')).toBe(true);
  });
});

describe('isSafeHref', () => {
  it('http/https/mailto ve göreli yolları kabul eder', () => {
    expect(isSafeHref('https://x.com')).toBe(true);
    expect(isSafeHref('http://x.com')).toBe(true);
    expect(isSafeHref('mailto:a@b.com')).toBe(true);
    expect(isSafeHref('/yerel')).toBe(true);
    expect(isSafeHref('#bolum')).toBe(true);
  });

  it('javascript:, data: ve vbscript: reddeder', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox')).toBe(false);
  });
});

describe('XSS koruması (kaynak düzeyinde regresyon)', () => {
  // DOM ortamı bağımlılığı eklemeden, renderer'ın güvenli API kullandığını
  // doğruluyoruz: `innerHTML`/`outerHTML`/`insertAdjacentHTML` yasak.
  const src = readFileSync(new URL('./markdown.ts', import.meta.url), 'utf8');

  it('innerHTML / outerHTML / insertAdjacentHTML kullanmaz', () => {
    expect(src).not.toMatch(/\.innerHTML\s*=/);
    expect(src).not.toMatch(/\.outerHTML\s*=/);
    expect(src).not.toMatch(/insertAdjacentHTML/);
    expect(src).not.toMatch(/document\.write/);
  });

  it('yalnızca createElement / createTextNode ile DOM kurar', () => {
    expect(src).toContain('createElement');
    expect(src).toContain('createTextNode');
  });

  it('bağlantılarda şema allowlist uygular', () => {
    expect(src).toContain('isSafeHref');
    expect(src).toContain('SAFE_SCHEME');
  });

  it('görsellerde CSP uyumlu gömme kuralı uygular', () => {
    expect(src).toContain('isEmbeddableImage');
  });
});
