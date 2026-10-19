/**
 * Faz B — Proje anlama / context derleme.
 * Saf fonksiyonlar (dosya sistemi erişimi yok; listeleme Rust fs.rs'ten gelir).
 */
import rawBlocks from './blocks.json';

export interface ContextFile {
  path: string; // workspace-relative, örn: src/App.tsx
  content: string;
}

export interface ContextBudget {
  maxFiles?: number; // default 50
  maxTotalChars?: number; // default 20000
  maxFileChars?: number; // default 4000
}

export interface BuiltContext {
  text: string;
  included: string[];
  skipped: string[];
  truncated: boolean;
}

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_TOTAL = 20000;
const DEFAULT_MAX_FILE = 4000;

/**
 * Faz 10 (D2c) — blok/ignore listeleri `blocks.json`'dan (tek kaynak).
 * Rust `fs.rs` aynı dosyayı gömer → kayma imkânsız.
 */
const SECRET_BASENAMES = new Set<string>(rawBlocks.files);
const SECRET_EXTS = new Set<string>(
  (rawBlocks as unknown as { secretExts: string[] }).secretExts?.map((e) => `.${e}`) ?? [],
);
const DEFAULT_IGNORE_DIRS = new Set<string>(rawBlocks.ignoreDirs);

export function isSecretFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (SECRET_BASENAMES.has(base)) return true;
  const dot = base.lastIndexOf('.');
  if (dot >= 0 && SECRET_EXTS.has(base.slice(dot))) return true;
  if (base.startsWith('.env.')) return true;
  return false;
}

export function isIgnoredPath(path: string): boolean {
  const segs = path.split('/').filter(Boolean);
  for (const s of segs) {
    if (DEFAULT_IGNORE_DIRS.has(s)) return true;
    if (s === '.DS_Store') return true;
  }
  if (isSecretFile(path)) return true;
  return false;
}

/** Dosya önceliği: küçük sayı = önce alınır. */
export function priorityOf(path: string): number {
  if (path === 'package.json') return 0;
  if (/^README\.md$/i.test(path)) return 1;
  if (path === 'src-tauri/tauri.conf.json') return 2;
  if (path.startsWith('src/')) return 3;
  if (path.startsWith('src-tauri/src/')) return 4;
  if (path.endsWith('.md')) return 8;
  return 5;
}

export function prioritizeFiles(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const pa = priorityOf(a);
    const pb = priorityOf(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

export function truncateFile(content: string, maxChars: number): { text: string; cut: boolean } {
  if (content.length <= maxChars) return { text: content, cut: false };
  // Satır sınırında kesmeye çalış.
  const slice = content.slice(0, maxChars);
  const nl = slice.lastIndexOf('\n');
  const text = (nl > maxChars * 0.7 ? slice.slice(0, nl) : slice) + '\n…[truncated]';
  return { text, cut: true };
}

export function buildContext(files: ContextFile[], budget: ContextBudget = {}): BuiltContext {
  const maxFiles = budget.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotal = budget.maxTotalChars ?? DEFAULT_MAX_TOTAL;
  const maxFile = budget.maxFileChars ?? DEFAULT_MAX_FILE;

  const ordered = prioritizeFiles(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  const included: string[] = [];
  const skipped: string[] = [];
  const parts: string[] = [];
  let total = 0;
  let truncated = false;

  for (const p of ordered) {
    if (included.length >= maxFiles) {
      skipped.push(p);
      truncated = true;
      continue;
    }
    if (isIgnoredPath(p) || isSecretFile(p)) {
      skipped.push(p);
      continue;
    }
    const raw = byPath.get(p) ?? '';
    const { text, cut } = truncateFile(raw, maxFile);
    if (cut) truncated = true;
    const block = `--- ${p} ---\n${text}\n`;
    if (total + block.length > maxTotal) {
      truncated = true;
      skipped.push(p);
      continue;
    }
    parts.push(block);
    included.push(p);
    total += block.length;
  }

  return {
    text: parts.join('\n'),
    included,
    skipped,
    truncated,
  };
}

/** /files komutu için kısa özet. */
export function summarizeWorkspace(paths: string[], rootLabel: string): string {
  const visible = paths.filter((p) => !isIgnoredPath(p));
  const ordered = prioritizeFiles(visible).slice(0, 20);
  const more = visible.length > ordered.length ? ` · +${visible.length - ordered.length} dosya` : '';
  return `/// workspace: ${rootLabel} · ${visible.length} dosya${more}\n/// ${ordered.join(', ')}`;
}
