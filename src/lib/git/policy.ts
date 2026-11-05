/**
 * Git istemci-tarafı doğrulama — saf, testli.
 *
 * Asıl güvenlik Rust `commands/git.rs` içindedir; buradaki kontroller UX için
 * erken geri bildirim verir ve aynı kuralları yansıtır (çift savunma).
 */
import rawBlocks from '../engine/blocks.json';

const BLOCKED_FILES = new Set<string>(
  (rawBlocks.files ?? []).map((f) => f.toLowerCase()),
);
const BLOCKED_DIRS = new Set<string>(
  (rawBlocks.dirs ?? []).map((d) => d.toLowerCase()),
);
const SECRET_EXTS = new Set<string>(
  ((rawBlocks as unknown as { secretExts?: string[] }).secretExts ?? []).map((e) =>
    e.toLowerCase(),
  ),
);
const DATA_EXTS = new Set<string>(
  ((rawBlocks as unknown as { dataExts?: string[] }).dataExts ?? []).map((e) =>
    e.toLowerCase(),
  ),
);

export const MAX_COMMIT_MESSAGE = 5000;
export const MAX_AI_DIFF_CHARS = 12_000;

/** `.env`, `*.pem`, `credentials.json` gibi AI'a gönderilmemesi gereken yol. */
export function isSecretPath(path: string): boolean {
  const v = path.replace(/\\/g, '/');
  return v.split('/').some((seg) => {
    const s = seg.toLowerCase();
    if (!s || s === '.') return false;
    if (s === '..') return true;
    if (BLOCKED_DIRS.has(s)) return true;
    if (BLOCKED_FILES.has(s)) return true;
    if (s.startsWith('.env.')) return true;
    const dot = s.lastIndexOf('.');
    if (dot >= 0 && dot < s.length - 1) {
      const ext = s.slice(dot + 1);
      if (SECRET_EXTS.has(ext) || DATA_EXTS.has(ext)) return true;
    }
    return false;
  });
}

/** Repo-göreli yol hatası (anahtar) veya null. Rust `validate_repo_path` eşi. */
export function repoPathError(raw: string): string | null {
  const p = raw.replace(/\\/g, '/');
  if (!p) return 'git.error.invalidPath';
  if (p.length > 4096) return 'git.error.invalidPath';
  if (/[\0\n\r]/.test(p)) return 'git.error.invalidPath';
  if (p.startsWith('-')) return 'git.error.invalidPath';
  if (p.includes(':')) return 'git.error.invalidPath';
  if (p.startsWith('/') || /^[a-zA-Z]:\//.test(p)) return 'git.error.invalidPath';
  const parts = p.split('/').filter((s) => s && s !== '.');
  if (parts.length === 0) return 'git.error.invalidPath';
  if (parts.some((seg) => seg === '..')) return 'git.error.invalidPath';
  if (isSecretPath(p)) return 'git.error.invalidPath';
  return null;
}

/** Branch adı hızlı kontrolü. Otoriter kontrol Rust `check-ref-format`. */
export function branchNameError(name: string): string | null {
  if (!name || name.length > 255) return 'git.error.invalidBranch';
  if (/[\x00-\x1f\x7f]/.test(name)) return 'git.error.invalidBranch';
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) {
    return 'git.error.invalidBranch';
  }
  if (name.endsWith('.') || name.endsWith('.lock') || name.includes('..')) {
    return 'git.error.invalidBranch';
  }
  if (name.includes('@{') || name.includes('//')) return 'git.error.invalidBranch';
  if (/[ ~^:?*[\\]/.test(name)) return 'git.error.invalidBranch';
  return null;
}

/** Commit mesajı hatası veya null. */
export function commitMessageError(msg: string): string | null {
  const v = msg.trim();
  if (!v) return 'git.error.invalidMessage';
  if (v.length > MAX_COMMIT_MESSAGE) return 'git.error.invalidMessage';
  if (v.includes('\0')) return 'git.error.invalidMessage';
  return null;
}

/**
 * `--- a/yol` / `+++ b/yol` başlığından repo-göreli yolu çıkarır.
 *
 * Git, boşluk içeren adlardan sonra `\t` ekler; unicode/özel karakterli
 * adları C-tarzı tırnaklar. Tırnak içeriği güvenlik kontrolü için yeterlidir
 * (`.env`, `.pem` gibi ASCII parçalar kaçışlanmaz).
 */
function headerPath(line: string): string | null {
  let raw = line.slice(4);
  const tab = raw.indexOf('\t');
  if (tab >= 0) raw = raw.slice(0, tab);
  raw = raw.trim();
  if (!raw || raw === '/dev/null') return null;
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    raw = raw.slice(1, -1);
  }
  if (raw.startsWith('a/') || raw.startsWith('b/')) raw = raw.slice(2);
  return raw;
}

/** Bir diff bloğundaki tüm dosya yolları (silinen/yeniden adlandırılan dahil). */
function blockPaths(block: string): string[] {
  const paths: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const p = headerPath(line);
      if (p) paths.push(p);
    } else if (/^(rename|copy) (from|to) /.test(line)) {
      let p = line.replace(/^(rename|copy) (from|to) /, '').trim();
      if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
      if (p) paths.push(p);
    }
  }
  if (paths.length === 0) {
    // Yalnızca mod/binary değişimi: `---`/`+++` yok, başlıktan dene.
    const m = /^diff --git (.+) (.+)$/m.exec(block);
    if (m) {
      for (const raw of [m[1], m[2]]) {
        let p = raw.trim();
        if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
        if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
        if (p) paths.push(p);
      }
    }
  }
  return paths;
}

/**
 * AI'a gönderilecek diff'i güvenli biçimde kısaltır.
 *
 * - Secret/bloklu dosyaların diff blokları tamamen çıkarılır.
 * - Toplam metin `maxChars` ile sınırlanır; kesildiği bildirilir.
 */
export function filterDiffForAi(
  diffText: string,
  maxChars: number = MAX_AI_DIFF_CHARS,
): { text: string; excluded: string[]; truncated: boolean } {
  const excluded = new Set<string>();
  const blocks = diffText.split(/(?=^diff --git )/m);
  const kept: string[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const paths = blockPaths(block);
    const secret = paths.find((p) => isSecretPath(p));
    if (secret) {
      excluded.add(secret);
      continue;
    }
    kept.push(block);
  }
  let text = kept.join('');
  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… (diff kısaltıldı)`;
    truncated = true;
  }
  return { text, excluded: [...excluded], truncated };
}
