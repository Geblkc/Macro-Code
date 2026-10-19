/**
 * MacroCode — Sözdizimi renklendirici (bağımlılıksız)
 *
 * Elle yazılmış, küçük bir tarayıcı. Amaç: geliştirici aracında kod
 * bloklarının okunur olması — shiki/prism/hljs YOK (proje kuralı:
 * sıfır runtime bağımlılığı).
 *
 * Desteklenen diller: ts/tsx/js/jsx · python · rust · go · json · bash/sh ·
 * sql · html/xml · css · diff · yaml
 */

export interface HlToken {
  text: string;
  /** CSS sınıfı; boşsa düz metin. */
  cls: string;
}

interface LangSpec {
  keywords: string[];
  /** Satır yorumu önekleri. */
  line: string[];
  /** Blok yorum aç/kapa çiftleri. */
  block?: [string, string][];
  /** Büyük harfle başlayan tanımlayıcılar tip olarak işaretlenir. */
  types?: boolean;
  /** `$`/`{{` gibi değişken önekleri. */
  vars?: boolean;
}

const COMMON_TYPES = [
  'string', 'number', 'boolean', 'object', 'symbol', 'bigint', 'any', 'unknown', 'never', 'void',
];

const SPECS: Record<string, LangSpec> = {
  ts: {
    keywords: [
      'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
      'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for',
      'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'infer', 'instanceof',
      'interface', 'is', 'keyof', 'let', 'namespace', 'new', 'of', 'private', 'protected', 'public',
      'readonly', 'return', 'satisfies', 'set', 'static', 'super', 'switch', 'this', 'throw',
      'try', 'type', 'typeof', 'var', 'while', 'with', 'yield',
    ],
    line: ['//'],
    block: [['/*', '*/']],
    types: true,
  },
  python: {
    keywords: [
      'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
      'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
      'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case',
    ],
    line: ['#'],
    types: true,
  },
  rust: {
    keywords: [
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern',
      'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub',
      'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe',
      'use', 'where', 'while', 'union',
    ],
    line: ['//'],
    block: [['/*', '*/']],
    types: true,
  },
  go: {
    keywords: [
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for',
      'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select',
      'struct', 'switch', 'type', 'var', 'nil', 'true', 'false',
    ],
    line: ['//'],
    block: [['/*', '*/']],
    types: true,
  },
  json: { keywords: ['true', 'false', 'null'], line: [], types: false },
  bash: {
    keywords: [
      'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function',
      'return', 'export', 'local', 'readonly', 'declare', 'source', 'alias', 'set', 'unset', 'echo',
      'exit', 'shift', 'trap', 'in',
    ],
    line: ['#'],
    vars: true,
  },
  sql: {
    keywords: [
      'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create',
      'table', 'drop', 'alter', 'index', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group',
      'order', 'by', 'having', 'limit', 'offset', 'union', 'all', 'distinct', 'as', 'and', 'or',
      'not', 'null', 'primary', 'key', 'foreign', 'references', 'default', 'cascade',
    ],
    line: ['--'],
    types: true,
  },
  css: {
    keywords: ['important', 'from', 'to', 'and', 'not', 'only'],
    line: [],
    block: [['/*', '*/']],
    vars: true,
  },
  yaml: { keywords: ['true', 'false', 'null', 'yes', 'no'], line: ['#'], vars: true },
  diff: { keywords: [], line: [] },
  xml: { keywords: [], line: [], block: [['<!--', '-->']] },
};

SPECS.js = SPECS.ts;
SPECS.jsx = SPECS.ts;
SPECS.tsx = SPECS.ts;
SPECS.mjs = SPECS.ts;
SPECS.cjs = SPECS.ts;
SPECS.python = SPECS.python;
SPECS.py = SPECS.python;
SPECS.rust = SPECS.rust;
SPECS.rs = SPECS.rust;
SPECS.go = SPECS.go;
SPECS.golang = SPECS.go;
SPECS.bash = SPECS.bash;
SPECS.sh = SPECS.bash;
SPECS.shell = SPECS.bash;
SPECS.zsh = SPECS.bash;
SPECS.sql = SPECS.sql;
SPECS.json = SPECS.json;
SPECS.jsonc = SPECS.json;
SPECS.css = SPECS.css;
SPECS.scss = SPECS.css;
SPECS.less = SPECS.css;
SPECS.yaml = SPECS.yaml;
SPECS.yml = SPECS.yaml;
SPECS.xml = SPECS.xml;
SPECS.html = SPECS.xml;
SPECS.svg = SPECS.xml;
SPECS.vue = SPECS.xml;
SPECS.diff = SPECS.diff;
SPECS.patch = SPECS.diff;
SPECS.text = { keywords: [], line: [] };
SPECS.plain = SPECS.text;
SPECS.txt = SPECS.text;

const KEYWORD_SETS = new Map<string, Set<string>>();
for (const [lang, spec] of Object.entries(SPECS)) {
  KEYWORD_SETS.set(lang, new Set([...spec.keywords, ...(spec.types ? COMMON_TYPES : [])]));
}

/** Tanınan dil mi? (bilinmeyen dil düz metin olarak işlenir) */
export function isKnownLang(lang: string): boolean {
  return Object.prototype.hasOwnProperty.call(SPECS, lang.toLowerCase());
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/**
 * Kodu satır satır token'lara ayırır.
 * @returns satır başına token dizisi (her satır ayrı dizi).
 */
export function highlight(code: string, lang: string): HlToken[][] {
  const l = (lang || 'text').toLowerCase();
  const spec = SPECS[l];
  if (!spec) return code.split('\n').map((line) => (line ? [{ text: line, cls: '' }] : []));

  const keywords = KEYWORD_SETS.get(l) ?? new Set<string>();
  const lines = code.split('\n');
  const out: HlToken[][] = [];
  let inBlock = 0; // açık blok yorum sayacı (yorum bloğu türü)
  let blockEnd = '';

  for (const line of lines) {
    const tokens: HlToken[] = [];
    let i = 0;
    const push = (text: string, cls: string) => {
      if (!text) return;
      const last = tokens[tokens.length - 1];
      if (last && last.cls === cls) last.text += text;
      else tokens.push({ text, cls });
    };

    while (i < line.length) {
      // Açık kalan blok yorum
      if (inBlock > 0) {
        const end = line.indexOf(blockEnd, i);
        if (end === -1) {
          push(line.slice(i), 'hl-com');
          i = line.length;
        } else {
          push(line.slice(i, end + blockEnd.length), 'hl-com');
          i = end + blockEnd.length;
          inBlock = 0;
          blockEnd = '';
        }
        continue;
      }

      // Blok yorum başlangıcı
      if (spec.block) {
        let matched = false;
        for (const [open, close] of spec.block) {
          if (line.startsWith(open, i)) {
            const end = line.indexOf(close, i + open.length);
            if (end === -1) {
              push(line.slice(i), 'hl-com');
              i = line.length;
              inBlock = 1;
              blockEnd = close;
            } else {
              push(line.slice(i, end + close.length), 'hl-com');
              i = end + close.length;
            }
            matched = true;
            break;
          }
        }
        if (matched) continue;
      }

      // Satır yorumu
      const lineHit = spec.line.find((p) => line.startsWith(p, i));
      if (lineHit) {
        push(line.slice(i), 'hl-com');
        i = line.length;
        continue;
      }

      // Diff satırı
      if (l === 'diff') {
        const c = line[i];
        if (c === '+' || c === '-' || c === '@') {
          push(c, c === '+' ? 'hl-key' : c === '-' ? 'hl-err' : 'hl-fn');
          i += 1;
          continue;
        }
      }

      // JSON anahtarı: "anahtar" :
      if (l === 'json' || l === 'jsonc') {
        const str = matchString(line, i);
        if (str) {
          let j = i + str.length;
          while (j < line.length && line[j] === ' ') j += 1;
          push(str, line[j] === ':' ? 'hl-fn' : 'hl-str');
          i += str.length;
          continue;
        }
      }

      // Dize
      const str = matchString(line, i);
      if (str) {
        push(str, 'hl-str');
        i += str.length;
        continue;
      }

      // Sayı
      if (/[0-9]/.test(line[i]) || (line[i] === '.' && /[0-9]/.test(line[i + 1] ?? ''))) {
        let j = i;
        while (j < line.length && /[0-9._a-fA-FxXoObBeE+-]/.test(line[j])) {
          // Üs/alt indis işaretlerini sayıya dahil etme
          if ((line[j] === '+' || line[j] === '-') && !/[eE]/.test(line[j - 1] ?? '')) break;
          j += 1;
        }
        push(line.slice(i, j), 'hl-num');
        i = j;
        continue;
      }

      // Tanımlayıcı / anahtar kelime
      if (IDENT_START.test(line[i])) {
        let j = i + 1;
        while (j < line.length && IDENT_PART.test(line[j])) j += 1;
        const word = line.slice(i, j);
        let k = j;
        while (k < line.length && line[k] === ' ') k += 1;
        const isCall = line[k] === '(';

        if (keywords.has(word)) push(word, 'hl-key');
        else if (spec.types && /^[A-Z]/.test(word)) push(word, 'hl-type');
        else if (isCall) push(word, 'hl-fn');
        else if (spec.vars && word.startsWith('$')) push(word, 'hl-type');
        else push(word, '');
        i = j;
        continue;
      }

      // Noktalama
      if (/[{}()[\];:,.<>=+\-*/%&|^!~?:]/.test(line[i])) {
        push(line[i], 'hl-pun');
        i += 1;
        continue;
      }

      // Diğer
      push(line[i], '');
      i += 1;
    }

    out.push(tokens);
  }

  return out;
}

/** Tırnaklı dize (kaçış destekli). Başlangıç değilse null. */
function matchString(line: string, i: number): string | null {
  const q = line[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let j = i + 1;
  while (j < line.length) {
    if (line[j] === '\\') {
      j += 2;
      continue;
    }
    if (line[j] === q) return line.slice(i, j + 1);
    j += 1;
  }
  return line.slice(i);
}
