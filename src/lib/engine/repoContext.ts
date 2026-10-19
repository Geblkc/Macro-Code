/**
 * Faz 9 (P9.1–P9.3) — Repo bağlamı.
 *
 * Agent bir workspace'e ilk girdiğinde projenin ne olduğunu bilmiyor; her şeyi
 * `list_dir`/`read_file` tool çağrılarıyla keşfetmek zorunda kalıyordu.
 * Bu modül bağlamı **bir kez** hazırlayıp system prompt'a `[proje]` bloğu olarak
 * ekler:
 *
 * - **Harita**: dosya listesi (öncelik sırasına göre: package.json → README →
 *   src/ → src-tauri/src/ → diğerleri), modelin context penceresine göre kırpılır.
 * - **Anahtar dosyalar**: `AGENTS.md` / `CLAUDE.md` / `README.md` (yoksa atlanır).
 * - **Kalıcı hafıza**: `.macrocode/context.md` (kullanıcının `/note` ile bıraktığı
 *   notlar) — sonraki oturumlarda da hatırlanır.
 *
 * Önbellek: aynı root + aynı dosya imzası için tekrar hazırlanmaz.
 */
import { prioritizeFiles, isIgnoredPath } from './context';
import { windowFor } from './tokens';

export interface TreeEntry {
  path: string;
  size: number;
}

export interface RepoContext {
  root: string;
  /** `[proje]` bloğu (system prompt'a eklenir). */
  text: string;
  /** Haritadaki dosya sayısı (özet için). */
  fileCount: number;
  /** Okunan anahtar dosyalar. */
  keyFiles: string[];
  /** Kalıcı hafıza içeriği (yoksa boş). */
  memory: string;
  /** Harita/okuma sırasında oluşan hata (yoksa null). */
  error: string | null;
}

/** Anahtar dosyalar (öncelik sırasıyla). */
export const KEY_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md'] as const;

/** Anahtar dosya başına karakter sınırı (system prompt maliyeti). */
export const KEY_FILE_MAX_CHARS = 2000;
/** Kalıcı notların system prompt'a giren karakter sınırı (son N karakter). */
export const MEMORY_MAX_CHARS = 4000;

const MEMORY_FILE = '.macrocode/context.md';

async function invokeRust<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  throw new Error(`${cmd} yalnızca Tauri'de çalışır`);
}

/** Workspace dosya listesi (bloklu dizinler/secret dosyalar Rust tarafında elenir). */
export async function listTree(root: string, max = 400): Promise<TreeEntry[]> {
  return invokeRust<TreeEntry[]>('list_tree', { root, maxEntries: max });
}

/** Bir dosyanın içeriği (Rust `read_file`; hata → null). */
export async function readFileSafe(
  root: string,
  path: string,
  limit = 400,
): Promise<string | null> {
  try {
    const out = await invokeRust<{ content: string; truncated: boolean }>('read_file', {
      root,
      path,
      limit,
    });
    return out.content;
  } catch {
    return null;
  }
}

/** Kalıcı hafıza (`.macrocode/context.md`) — Rust `memory_read`. */
export async function readMemory(root: string): Promise<string> {
  try {
    return await invokeRust<string>('memory_read', { root });
  } catch {
    return '';
  }
}

/**
 * Harita metnini üretir (saf — test edilebilir).
 * `maxChars` sınırı aşılırsa dosya listesi kırpılır ve sayı belirtilir.
 */
export function buildMapText(
  paths: string[],
  maxChars: number,
): { text: string; fileCount: number; truncated: boolean } {
  const visible = paths.filter((p) => !isIgnoredPath(p));
  const ordered = prioritizeFiles(visible);
  const lines: string[] = [];
  let used = 0;
  let truncated = false;
  for (const p of ordered) {
    const line = `- ${p}`;
    if (used + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const rest = ordered.length - lines.length;
  if (rest > 0) {
    lines.push(`- … +${rest} dosya daha`);
  }
  return { text: lines.join('\n'), fileCount: ordered.length, truncated };
}

/** `[proje]` bloğunu birleştirir (harita + anahtar dosyalar + hafıza). */
export function composeProjectBlock(ctx: {
  map: string;
  mapTruncated: boolean;
  fileCount: number;
  keyFiles: Array<{ path: string; content: string }>;
  memory: string;
}): string {
  const parts: string[] = [];
  if (ctx.map) {
    parts.push(
      `[proje] bu workspace'teki dosyalar (${ctx.fileCount} dosya${ctx.mapTruncated ? ', liste kırpıldı' : ''}):\n${ctx.map}`,
    );
  }
  for (const f of ctx.keyFiles) {
    parts.push(`[proje:${f.path}]\n${f.content}`);
  }
  if (ctx.memory.trim()) {
    parts.push(`[notlar]\n${ctx.memory.trim()}`);
  }
  return parts.join('\n');
}

// ── Önbellek ──────────────────────────────────────────────────────────
interface CacheEntry {
  sig: string;
  value: RepoContext;
}
const cache = new Map<string, CacheEntry>();

function signature(paths: string[]): string {
  // Dosya listesi imzası: sayı + ilk/son yollar (değişiklik yakalanır).
  const first = paths[0] ?? '';
  const last = paths[paths.length - 1] ?? '';
  return `${paths.length}:${first}:${last}`;
}

/**
 * Repo bağlamını hazırlar (önbellekli).
 * `maxChars` verilmezse modelin context penceresine göre ölçeklenir
 * (pencere × %2, tavan 8k karakter).
 */
export async function buildRepoContext(
  root: string,
  opts: { model?: string; customModels?: import('../../types').CustomModel[]; maxChars?: number } = {},
): Promise<RepoContext> {
  const empty: RepoContext = {
    root,
    text: '',
    fileCount: 0,
    keyFiles: [],
    memory: '',
    error: null,
  };
  if (!root) return empty;
  // Tauri dışında (tarayıcı-dev) Rust komutları yok → bağlam hazırlanamaz;
  // bu bir hata değil, sessizce boş geçilir (agent zaten Tauri gerektirir).
  const isTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!isTauri) return empty;
  let paths: string[] = [];
  try {
    const tree = await listTree(root, 400);
    paths = tree.map((e) => e.path);
  } catch (e) {
    empty.error = e instanceof Error ? e.message : String(e);
    return empty;
  }
  const sig = signature(paths);
  const cached = cache.get(root);
  if (cached && cached.sig === sig) {
    return cached.value;
  }

  // Harita boyutu: modelin context penceresine göre ölçekli.
  // (Not: `window` global'ı gölgelenmesin diye `ctxWindow` adı kullanıldı.)
  const ctxWindow = opts.model ? windowFor(opts.model, opts.customModels ?? []) : 200_000;
  const maxChars = opts.maxChars ?? Math.min(8000, Math.floor(ctxWindow * 0.02));
  const map = buildMapText(paths, maxChars);

  // Anahtar dosyalar (bounded — system prompt maliyeti sınırlı).
  const keyFiles: Array<{ path: string; content: string }> = [];
  for (const name of KEY_FILES) {
    if (!paths.includes(name)) continue;
    const content = await readFileSafe(root, name, name === 'README.md' ? 80 : 150);
    if (content && content.trim()) {
      keyFiles.push({ path: name, content: content.slice(0, KEY_FILE_MAX_CHARS) });
    }
  }

  // Kalıcı notlar: yalnızca **son** kayıtlar (eski notlar bağlamdan düşer).
  const memoryRaw = await readMemory(root);
  const memory =
    memoryRaw.length > MEMORY_MAX_CHARS ? memoryRaw.slice(-MEMORY_MAX_CHARS) : memoryRaw;
  const text = composeProjectBlock({
    map: map.text,
    mapTruncated: map.truncated,
    fileCount: map.fileCount,
    keyFiles,
    memory,
  });

  const value: RepoContext = {
    root,
    text,
    fileCount: map.fileCount,
    keyFiles: keyFiles.map((f) => f.path),
    memory,
    error: null,
  };
  cache.set(root, { sig, value });
  return value;
}

/** Önbelleği temizle (workspace değişti / test). */
export function clearRepoContextCache(): void {
  cache.clear();
}

/** Kalıcı hafızaya not ekle (Rust `memory_append`). */
export async function appendMemory(root: string, text: string): Promise<string> {
  return invokeRust<string>('memory_append', { root, text });
}

export { MEMORY_FILE };
