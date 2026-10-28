/**
 * MacroCode — Markdown motoru (sıfırdan, kütüphanesiz)
 *
 * Güvenlik sözleşmesi: `innerHTML` **YOK**. Tüm DOM `createElement` +
 * `textContent` ile kurulur. Bağlantılarda yalnız `http`/`https`/`mailto`
 * şemalarına izin verilir; görseller `img-src` CSP'si dışındaysa bağlantı
 * olarak gösterilir.
 *
 * Desteklenen bloklar: başlık (h1–h6), sırasız/sıralı liste (iç içe),
 * görev listesi, alıntı, yatay çizgi, GFM tablo, kod bloğu, paragraf.
 * Satır içi: `kod`, **kalın**, *italik*, ~~üstü çizili~~, [bağlantı](url),
 * ![görsel](url).
 */

import { copyText } from './clipboard';
import { highlight } from './highlight';
import { t } from './i18n/core';

/* ══════════════════════════════════════════════════════════════════
   Eski (genişletilmemiş) API — geriye uyum için korunur
   ══════════════════════════════════════════════════════════════════ */

export type MdToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'codeblock'; lang: string; code: string };

const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;

/** Tek satir ici inline token'lar: `code`, **bold**, *italic*. */
export function tokenizeInline(line: string): MdToken[] {
  const out: MdToken[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  for (;;) {
    const m = INLINE_RE.exec(line);
    if (!m) break;
    if (m.index > last) {
      out.push({ kind: 'text', text: line.slice(last, m.index) });
    }
    const [full, code, bold, italic] = m;
    if (code) out.push({ kind: 'code', text: full.slice(1, -1) });
    else if (bold) out.push({ kind: 'bold', text: full.slice(2, -2) });
    else if (italic) out.push({ kind: 'italic', text: full.slice(1, -1) });
    last = m.index + full.length;
  }
  if (last < line.length) {
    out.push({ kind: 'text', text: line.slice(last) });
  }
  return out;
}

/**
 * Satir listesi -> token listesi. ```lang bloklari cok-satirli tek token olur.
 * Kapanmamis blok, metnin sonuna kadar kod sayilir.
 */
export function tokenizeMarkdown(src: string): MdToken[] {
  const out: MdToken[] = [];
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1] || 'text';
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // Kapanis citini tuket (yoksa dongu biter).
      out.push({ kind: 'codeblock', lang, code: code.join('\n') });
      continue;
    }
    for (const t of tokenizeInline(line)) out.push(t);
    out.push({ kind: 'text', text: '\n' });
    i += 1;
  }
  // Sondaki yapay newline'i kaldir.
  if (out.length > 0) {
    const last = out[out.length - 1];
    if (last.kind === 'text' && last.text === '\n') out.pop();
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════
   Zengin satır içi tokenizer
   ══════════════════════════════════════════════════════════════════ */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'image'; alt: string; src: string };

/** Bağlantı şeması allowlist'i (XSS). */
const SAFE_SCHEME = /^(https?:|mailto:)/i;

export function isSafeHref(href: string): boolean {
  const v = href.trim();
  if (!v) return false;
  if (v.startsWith('#')) return true;
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  return SAFE_SCHEME.test(v);
}

/** `data:` ve `blob:` görseller CSP tarafından izinli. */
function isEmbeddableImage(src: string): boolean {
  return /^(data:image\/|blob:)/i.test(src.trim());
}

const RICH_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\))/g;

export function tokenizeInlineRich(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  RICH_RE.lastIndex = 0;
  for (;;) {
    const m = RICH_RE.exec(line);
    if (!m) break;
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) });
    const full = m[0];
    if (m[1] !== undefined) {
      out.push({ kind: 'code', text: full.slice(1, -1) });
    } else if (m[2] !== undefined) {
      out.push({ kind: 'bold', text: full.slice(2, -2) });
    } else if (m[3] !== undefined) {
      out.push({ kind: 'bold', text: full.slice(2, -2) });
    } else if (m[4] !== undefined) {
      out.push({ kind: 'italic', text: full.slice(1, -1) });
    } else if (m[5] !== undefined) {
      out.push({ kind: 'strike', text: full.slice(2, -2) });
    } else {
      const bang = full.startsWith('!');
      const text = m[7] ?? '';
      const url = m[8] ?? '';
      if (bang) out.push({ kind: 'image', alt: text, src: url });
      else if (isSafeHref(url)) out.push({ kind: 'link', text, href: url });
      else out.push({ kind: 'text', text: full });
    }
    last = m.index + full.length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

/* ══════════════════════════════════════════════════════════════════
   Blok tokenizer
   ══════════════════════════════════════════════════════════════════ */

export type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'hr' }
  | { kind: 'quote'; text: string }
  | { kind: 'ul'; items: MdListItem[] }
  | { kind: 'ol'; items: MdListItem[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

export interface MdListItem {
  text: string;
  /** Görev listesi: true = işaretli, false = işaretsiz, null = normal madde. */
  checked: boolean | null;
  children: MdBlock[];
}

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_UL = /^(\s*)([-*+])\s+(.*)$/;
const RE_OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RE_QUOTE = /^ {0,3}>\s?(.*)$/;
const RE_FENCE = /^ {0,3}```(\S*)\s*$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 1;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** Bir satırda blok başlangıcı var mı? (paragraf sonlandırıcı) */
function startsBlock(line: string): boolean {
  return (
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_UL.test(line) ||
    RE_OL.test(line) ||
    RE_QUOTE.test(line) ||
    RE_FENCE.test(line)
  );
}

export function tokenizeBlocks(src: string): MdBlock[] {
  const lines = src.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Kod bloğu
    const fence = line.match(RE_FENCE);
    if (fence) {
      const lang = fence[1] || 'text';
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !RE_FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // kapanış çiti (yoksa döngü biter)
      blocks.push({ kind: 'code', lang, code: code.join('\n') });
      continue;
    }

    // Başlık
    const heading = line.match(RE_HEADING);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    // Yatay çizgi
    if (RE_HR.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // Alıntı
    if (RE_QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(RE_QUOTE);
        if (!m) break;
        parts.push(m[1]);
        i += 1;
      }
      blocks.push({ kind: 'quote', text: parts.join('\n') });
      continue;
    }

    // Tablo
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      RE_TABLE_SEP.test(lines[i + 1]) &&
      splitRow(line).length === splitRow(lines[i + 1]).length
    ) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    // Liste
    if (RE_UL.test(line) || RE_OL.test(line)) {
      const ordered = RE_OL.test(line) && !RE_UL.test(line);
      const items = parseList(lines, i, ordered);
      blocks.push(ordered ? { kind: 'ol', items: items.items } : { kind: 'ul', items: items.items });
      i = items.next;
      continue;
    }

    // Paragraf
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      if (isTableRow(lines[i]) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) break;
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length > 0) blocks.push({ kind: 'p', text: para.join('\n') });
  }

  return blocks;
}

interface ParsedList {
  items: MdListItem[];
  next: number;
}

/** Liste öğelerini (iç içe) ayrıştırır. */
function parseList(lines: string[], start: number, ordered: boolean): ParsedList {
  const items: MdListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const m = ordered ? RE_OL.exec(line) : RE_UL.exec(line);
    const other = ordered ? RE_UL.exec(line) : RE_OL.exec(line);
    if (!m && !other) break;
    if (!m) break; // farklı işaret tipi → liste bitti

    const indent = (m[1] ?? '').replace(/\t/g, '  ').length;
    const raw = m[3] ?? '';
    const task = raw.match(/^\[([ xX])\]\s+(.*)$/);
    const item: MdListItem = {
      text: task ? task[2] : raw,
      checked: task ? task[1].toLowerCase() === 'x' : null,
      children: [],
    };
    items.push(item);
    i += 1;

    // Alt öğeler (daha derin girinti)
    const baseIndent = indent;
    const childBlocks: string[] = [];
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        // Boş satır: liste devam ediyorsa devam et, değilse çık
        const peek = lines[i + 1] ?? '';
        const peekIndent = peek.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
        if (peek.trim() && peekIndent > baseIndent) {
          childBlocks.push('');
          i += 1;
          continue;
        }
        break;
      }
      const ind = next.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
      if (ind > baseIndent) {
        childBlocks.push(next.slice(Math.min(next.length, baseIndent + 2)));
        i += 1;
        continue;
      }
      if (RE_UL.test(next) || RE_OL.test(next)) {
        const nm = (RE_UL.exec(next) ?? RE_OL.exec(next)) as RegExpExecArray | null;
        const nIndent = (nm?.[1] ?? '').replace(/\t/g, '  ').length;
        if (nIndent > baseIndent) {
          childBlocks.push(next.slice(Math.min(next.length, baseIndent + 2)));
          i += 1;
          continue;
        }
      }
      break;
    }
    if (childBlocks.length > 0) {
      item.children = tokenizeBlocks(childBlocks.join('\n'));
    }
  }

  return { items, next: i };
}

/* ══════════════════════════════════════════════════════════════════
   Render
   ══════════════════════════════════════════════════════════════════ */

function renderInline(doc: Document, parent: HTMLElement, text: string): void {
  for (const t of tokenizeInlineRich(text)) {
    switch (t.kind) {
      case 'text':
        parent.appendChild(doc.createTextNode(t.text));
        break;
      case 'bold': {
        const el = doc.createElement('strong');
        el.textContent = t.text;
        parent.appendChild(el);
        break;
      }
      case 'italic': {
        const el = doc.createElement('em');
        el.textContent = t.text;
        parent.appendChild(el);
        break;
      }
      case 'strike': {
        const el = doc.createElement('del');
        el.textContent = t.text;
        parent.appendChild(el);
        break;
      }
      case 'code': {
        const el = doc.createElement('code');
        el.className = 'md-code';
        el.textContent = t.text;
        parent.appendChild(el);
        break;
      }
      case 'link': {
        const a = doc.createElement('a');
        a.href = t.href;
        a.textContent = t.text;
        a.rel = 'noreferrer noopener';
        a.target = '_blank';
        parent.appendChild(a);
        break;
      }
      case 'image': {
        // CSP `img-src 'self' data: blob:` — uzak görsel engellenir, bağlantıya düşer.
        if (isEmbeddableImage(t.src)) {
          const img = doc.createElement('img');
          img.src = t.src;
          img.alt = t.alt;
          img.className = 'md-img';
          parent.appendChild(img);
        } else {
          const a = doc.createElement('a');
          a.href = isSafeHref(t.src) ? t.src : '#';
          a.textContent = t.alt || t.src;
          a.rel = 'noreferrer noopener';
          a.target = '_blank';
          a.className = 'md-img-fallback';
          parent.appendChild(a);
        }
        break;
      }
    }
  }
}

function renderBlocks(doc: Document, parent: HTMLElement, blocks: MdBlock[]): void {
  for (const b of blocks) {
    switch (b.kind) {
      case 'p': {
        const p = doc.createElement('p');
        renderInline(doc, p, b.text);
        parent.appendChild(p);
        break;
      }
      case 'h': {
        const h = doc.createElement(`h${Math.min(6, Math.max(1, b.level))}`);
        renderInline(doc, h, b.text);
        parent.appendChild(h);
        break;
      }
      case 'hr': {
        parent.appendChild(doc.createElement('hr'));
        break;
      }
      case 'quote': {
        const q = doc.createElement('blockquote');
        const p = doc.createElement('p');
        renderInline(doc, p, b.text);
        q.appendChild(p);
        parent.appendChild(q);
        break;
      }
      case 'code': {
        parent.appendChild(buildCodeBlock(doc, b.lang, b.code));
        break;
      }
      case 'ul':
      case 'ol': {
        const list = doc.createElement(b.kind === 'ul' ? 'ul' : 'ol');
        for (const item of b.items) {
          const li = doc.createElement('li');
          if (item.checked !== null) {
            li.className = item.checked ? 'task done' : 'task';
            const box = doc.createElement('span');
            box.className = 'task-box';
            box.setAttribute('aria-hidden', 'true');
            li.appendChild(box);
            const span = doc.createElement('span');
            renderInline(doc, span, item.text);
            li.appendChild(span);
          } else {
            renderInline(doc, li, item.text);
          }
          if (item.children.length > 0) {
            const sub = doc.createElement('div');
            sub.className = 'md-sub';
            renderBlocks(doc, sub, item.children);
            li.appendChild(sub);
          }
          list.appendChild(li);
        }
        parent.appendChild(list);
        break;
      }
      case 'table': {
        const table = doc.createElement('table');
        const thead = doc.createElement('thead');
        const tr = doc.createElement('tr');
        for (const cell of b.head) {
          const th = doc.createElement('th');
          renderInline(doc, th, cell);
          tr.appendChild(th);
        }
        thead.appendChild(tr);
        table.appendChild(thead);
        const tbody = doc.createElement('tbody');
        for (const row of b.rows) {
          const r = doc.createElement('tr');
          for (const cell of row) {
            const td = doc.createElement('td');
            renderInline(doc, td, cell);
            r.appendChild(td);
          }
          tbody.appendChild(r);
        }
        table.appendChild(tbody);
        parent.appendChild(table);
        break;
      }
    }
  }
}

/** Kod bloğu: dil etiketi, satır numarası, sözdizimi renklendirme, kopyala. */
function buildCodeBlock(doc: Document, lang: string, code: string): HTMLElement {
  const block = doc.createElement('div');
  block.className = 'md-codeblock';

  const head = doc.createElement('div');
  head.className = 'md-codeblock-head';
  const langEl = doc.createElement('span');
  langEl.className = 'md-codeblock-lang';
  langEl.textContent = lang;
  head.appendChild(langEl);
  const spacer = doc.createElement('span');
  spacer.className = 'spacer';
  head.appendChild(spacer);

  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.className = 'md-copy';
  copy.textContent = t('markdown.copyBtn');
  copy.setAttribute('aria-label', t('markdown.copyCode', { lang }));
  copy.addEventListener('click', (e) => {
    e.stopPropagation();
    void copyText(code).then((ok) => {
      copy.textContent = ok ? t('message.copyOk') : t('message.copyFail');
      copy.classList.toggle('copied', ok);
      globalThis.setTimeout(() => {
        copy.textContent = t('markdown.copyBtn');
        copy.classList.remove('copied');
      }, 1500);
    });
  });
  head.appendChild(copy);
  block.appendChild(head);

  const pre = doc.createElement('pre');
  const codeEl = doc.createElement('code');
  pre.appendChild(codeEl);
  block.appendChild(pre);

  // Sözdizimi renklendirme (best-effort; hata olursa düz metne düşer)
  try {
    const lines = highlight(code, lang);
    lines.forEach((tokens, idx) => {
      const line = doc.createElement('span');
      line.className = 'md-code-line';
      const num = doc.createElement('span');
      num.className = 'md-code-num';
      num.textContent = String(idx + 1);
      line.appendChild(num);
      for (const tk of tokens) {
        if (tk.cls) {
          const span = doc.createElement('span');
          span.className = tk.cls;
          span.textContent = tk.text;
          line.appendChild(span);
        } else {
          line.appendChild(doc.createTextNode(tk.text));
        }
      }
      codeEl.appendChild(line);
    });
  } catch {
    codeEl.textContent = code;
  }

  return block;
}

/**
 * AI yanitini guvenli DOM'a cevirir. Sadece createElement/textContent
 * kullanilir — `innerHTML` YOK (XSS).
 */
export function renderMarkdown(src: string, doc?: Document): HTMLElement {
  const documentRef = doc ?? globalThis.document;
  const root = documentRef.createElement('div');
  root.className = 'md';
  renderBlocks(documentRef, root, tokenizeBlocks(src));
  return root;
}
