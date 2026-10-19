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

function appendInline(
  doc: Document,
  parent: HTMLElement,
  tokens: MdToken[],
): void {
  for (const t of tokens) {
    if (t.kind === 'text') {
      parent.appendChild(doc.createTextNode(t.text));
    } else if (t.kind === 'code') {
      const el = doc.createElement('code');
      el.className = 'md-code';
      el.textContent = t.text;
      parent.appendChild(el);
    } else if (t.kind === 'bold') {
      const el = doc.createElement('strong');
      el.textContent = t.text;
      parent.appendChild(el);
    } else if (t.kind === 'italic') {
      const el = doc.createElement('em');
      el.textContent = t.text;
      parent.appendChild(el);
    }
  }
}

function copyText(text: string): Promise<boolean> {
  try {
    const nav = globalThis.navigator as Navigator | undefined;
    const clipboard = nav?.clipboard;
    if (clipboard?.writeText) {
      return clipboard.writeText(text).then(
        () => true,
        () => false,
      );
    }
  } catch {
    // Asagidaki fallback'e dus.
  }
  try {
    const doc = globalThis.document;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * AI yanitini guvenli DOM'a cevirir. Sadece createElement/textContent
 * kullanilir — `innerHTML` YOK (XSS).
 */
export function renderMarkdown(src: string, doc?: Document): HTMLElement {
  const documentRef = doc ?? globalThis.document;
  const root = documentRef.createElement('div');
  root.className = 'md';
  let line = documentRef.createElement('div');
  line.className = 'md-line';
  root.appendChild(line);

  const flushLine = () => {
    line = documentRef.createElement('div');
    line.className = 'md-line';
    root.appendChild(line);
  };

  for (const t of tokenizeMarkdown(src)) {
    if (t.kind === 'codeblock') {
      const block = documentRef.createElement('div');
      block.className = 'md-codeblock';
      const head = documentRef.createElement('div');
      head.className = 'md-codeblock-head';
      const lang = documentRef.createElement('span');
      lang.className = 'md-codeblock-lang';
      lang.textContent = t.lang;
      const copy = documentRef.createElement('button');
      copy.type = 'button';
      copy.className = 'md-copy';
      copy.textContent = 'kopyala';
      copy.setAttribute('aria-label', `${t.lang} kodunu kopyala`);
      const codeText = t.code;
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        void copyText(codeText).then((ok) => {
          copy.textContent = ok ? 'kopyalandı ✓' : 'kopyalanamadı';
          copy.classList.toggle('copied', ok);
          globalThis.setTimeout(() => {
            copy.textContent = 'kopyala';
            copy.classList.remove('copied');
          }, 1500);
        });
      });
      head.appendChild(lang);
      head.appendChild(copy);
      const pre = documentRef.createElement('pre');
      const code = documentRef.createElement('code');
      code.textContent = t.code;
      pre.appendChild(code);
      block.appendChild(head);
      block.appendChild(pre);
      root.appendChild(block);
      flushLine();
    } else if (t.kind === 'text' && t.text === '\n') {
      flushLine();
    } else {
      appendInline(documentRef, line, [t]);
    }
  }
  // Bos son satiri temizle.
  const last = root.lastChild as HTMLElement | null;
  if (last && last.className === 'md-line' && !last.hasChildNodes()) {
    root.removeChild(last);
  }
  return root;
}
