/**
 * Unified diff ayrıştırıcı — saf, React bağımsız, testli.
 *
 * `git diff` / `git show --patch` çıktısını dosya → hunk → satır ağacına
 * çevirir. Amaç görselleştirme; satır numaraları hunk başlığından hesaplanır.
 */

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'nonewline' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  /** Satır içeriği (baştaki +/-/boşluk işareti çıkarılmış). */
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  /** `@@ -1,5 +1,7 @@ ...` başlığının tamamı. */
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  /** `diff --git`, `index`, `new file mode` gibi başlık satırları. */
  header: string[];
  hunks: DiffHunk[];
  binary: boolean;
}

export interface ParsedDiff {
  files: DiffFile[];
  binary: boolean;
  additions: number;
  deletions: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function pathFromHeader(line: string, prefix: string): string | null {
  const idx = line.indexOf(prefix);
  if (idx < 0) return null;
  let raw = line.slice(idx + prefix.length).split('\t')[0].trim();
  if (!raw) return null;
  if (raw === '/dev/null') return null;
  // Git, özel karakterli adları C-tarzı tırnaklar; görüntü için tırnağı at.
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) raw = raw.slice(1, -1);
  // `--- a/x` / `+++ b/x` → repo-göreli `x` (prefix yalnızca diff sözdizimi).
  if (raw.startsWith('a/') || raw.startsWith('b/')) return raw.slice(2);
  return raw;
}

function startFile(line: string): DiffFile {
  // `diff --git a/x b/x` → isimleri en iyi çaba ile çıkar (boşluklu yollar
  // için ---/+++ satırları otoriter kaynaktır).
  let oldPath: string | null = null;
  let newPath: string | null = null;
  const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  if (m) {
    oldPath = m[1];
    newPath = m[2];
  }
  return { oldPath, newPath, header: [line], hunks: [], binary: false };
}

/** `git diff` çıktısını ayrıştırır. Boş/ayrıştırılamayan metin → boş liste. */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let additions = 0;
  let deletions = 0;

  const pushLine = (kind: DiffLineKind, body: string) => {
    if (!current || !hunk) return;
    const line: DiffLine = { kind, text: body, oldNo: null, newNo: null };
    if (kind === 'add') {
      line.newNo = newNo++;
      additions += 1;
    } else if (kind === 'del') {
      line.oldNo = oldNo++;
      deletions += 1;
    } else if (kind === 'ctx') {
      line.oldNo = oldNo++;
      line.newNo = newNo++;
    }
    hunk.lines.push(line);
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      current = startFile(line);
      files.push(current);
      hunk = null;
      continue;
    }
    if (!current) {
      // `git show` commit başlığı gibi diff öncesi satırlar yok sayılır.
      continue;
    }
    if (line.startsWith('@@ ')) {
      const m = HUNK_RE.exec(line);
      if (!m) continue;
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.binary = true;
      current.header.push(line);
      continue;
    }
    if (!hunk) {
      // Hunk öncesi başlık satırları.
      if (line.startsWith('--- ')) current.oldPath = pathFromHeader(line, '--- ');
      else if (line.startsWith('+++ ')) current.newPath = pathFromHeader(line, '+++ ');
      current.header.push(line);
      continue;
    }
    if (line.startsWith('\\ No newline')) {
      pushLine('nonewline', line);
      continue;
    }
    if (line.startsWith('+')) {
      pushLine('add', line.slice(1));
      continue;
    }
    if (line.startsWith('-')) {
      pushLine('del', line.slice(1));
      continue;
    }
    if (line.startsWith(' ') || line === '') {
      // Boş satır: diff'te bağlam satırı boşlukla gelir; ham boş satır ise
      // yalnızca ayırıcıdır (yok say).
      if (line.startsWith(' ')) pushLine('ctx', line.slice(1));
      continue;
    }
    // `\` dışındaki bilinmeyen satırlar (ör. `diff --stat` çıktısı) meta.
    pushLine('meta', line);
  }

  return {
    files,
    binary: files.some((f) => f.binary),
    additions,
    deletions,
  };
}

/** Diff dosyası için görünen ad (yeni yol, yoksa eski yol). */
export function displayPath(file: DiffFile): string {
  return file.newPath ?? file.oldPath ?? '(bilinmeyen)';
}
