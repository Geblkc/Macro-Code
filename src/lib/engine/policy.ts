/**
 * Faz C/F — İzin modeli (client-side savunma; asıl jail Rust'tadır).
 * Faz 3: allowlist tek kaynağı `allowlist.json` (Rust `exec.rs` aynı dosyayı gömer).
 */
import rawAllowlist from './allowlist.json';
import rawBlocks from './blocks.json';
import { parseMcpName } from './mcp/registry';
import { t } from '../i18n/core';
import type { ApprovalMode, PolicyDecision, ToolName } from './types';

const {
  _note: _allowNote,
  // O7 — komut-çalıştıran flag tablosu komut DEĞİLDİR; ayrı ayrıştırılır,
  // aksi halde `ALLOWED_CMDS["_predicates"]` obje kalırdı ve prefix
  // eşleşmesi obje üzerinde `.some()` ile çökerdi.
  _predicates: _predRaw,
  ...ALLOWED_CMDS
} = rawAllowlist as unknown as Record<string, string[][]> & {
  _note: string;
  _predicates: Record<string, string[]>;
};
void _allowNote;
void _predRaw;

/**
 * O7 — serbest-argüman komutlarda "bu flag komut çalıştırır" tablosu.
 * Tek kaynak: `allowlist.json` `_predicates` bölümü; Rust `exec.rs`
 * `check_predicates` aynı tabloyu include_str! ile okur. Bu flagler
 * kullanıcı ek-allowlist'iyle bile GEÇEMEZ (rm kuralıyla aynı sertlik).
 */
const EXEC_PREDICATES: Readonly<Record<string, readonly string[]>> = (_predRaw ?? {}) as Record<
  string,
  string[]
>;

/** O7 — ihlal varsa okunur sebep, yoksa null (Rust `check_predicates` ile senkron). */
export function execPredicateViolation(cmd: string, args: string[]): string | null {
  const bad = EXEC_PREDICATES[cmd.trim()];
  if (!bad || bad.length === 0) return null;
  for (const a of args) {
    for (const f of bad) {
      if (a === f || a.startsWith(`${f}=`)) {
        return t('policy.predicateViolation', { cmd: cmd.trim(), arg: a });
      }
    }
  }
  return null;
}

/**
 * Faz 10 (D2c) — blok listelerinin **tek kaynağı**: `blocks.json`.
 * Rust `fs.rs` aynı dosyayı `include_str!` ile gömer → TS/Rust kayması imkânsız.
 */
const BLOCKED_FILES = new Set<string>(rawBlocks.files);
const BLOCKED_DIRS = new Set<string>(rawBlocks.dirs);
const BLOCKED_SECRET_EXTS = new Set<string>(
  (rawBlocks as unknown as { secretExts: string[] }).secretExts ?? [],
);
const BLOCKED_DATA_EXTS = new Set<string>(
  (rawBlocks as unknown as { dataExts: string[] }).dataExts ?? [],
);

/** Dosya uzantısı bloklu mu? (gizli/veri uzantıları — tek kaynak).
 *  O7: Rust `is_blocked_name_ext` ile senkron — son `.` sonrası uzantı;
 *  `.pem` tarzı dotfile'lar da yakalanır, uzantısız ad ("key") yakalanmaz. */
export function isBlockedExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return BLOCKED_SECRET_EXTS.has(ext) || BLOCKED_DATA_EXTS.has(ext);
}

/** Yolun HERHANGİ bir bileşeni bloklu dizindeyse true (jail dışı + içi aynı).
 *  H2: büyük/küçük harf duyarsız — macOS/Windows dosya sistemleri `.GIT`'i
 *  `.git` diye çözer, blok listesi küçük harf. */
export function isBlockedDir(path: string): boolean {
  return path
    .split('/')
    .some((seg) => seg && BLOCKED_DIRS.has(seg.toLowerCase()));
}

/**
 * O1 (Faz 4): dosya operandsı alan serbest-argüman komutları — Rust `exec.rs`
 * `FILE_ARG_CMDS` ile senkron. Bayraklar (`-la`) ve desenler (`*.ts`) etkilenmez.
 */
export const FILE_ARG_CMDS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'wc', 'find', 'rg', 'ls', 'touch', 'mkdir', 'prettier',
]);

/** Tek dosya argümanı jail'i (Rust `check_file_arg` ile senkron).
 *  H2: `.GIT` / `KEYS.JSON` / `.ENV.local` gibi büyük harf varyantları da düşer. */
export function isFileArgSafe(a: string): boolean {
  const v = a.trim().replace(/\\/g, '/');
  if (!v || v.startsWith('-')) return true; // bayrak
  if (v.startsWith('/')) return false;      // mutlak yol
  return !v.split('/').some((seg) => {
    const s = seg.toLowerCase();
    return seg === '..' || BLOCKED_DIRS.has(s) || BLOCKED_FILES.has(s)
      || s.startsWith('.env.')
      || isBlockedExt(seg);
  });
}

/** `--opt=değer` biçiminden değeri çıkarır (`--filefoo` yanlış eşleşmez). */
function optValue(arg: string, flag: string): string | null {
  if (!arg.startsWith(`${flag}=`)) return null;
  return arg.slice(flag.length + 1);
}

/**
 * M6 — git argümanlarından **dosya/dizin yolu** taşıyanları çıkarır.
 * Rust `exec.rs::git_path_args` ile senkron (çift savunma).
 *
 * Kapsam: `--` sonrası operandlar, `rev:path` path kısmı, `-F/--file`,
 * `--output`, `--pathspec-from-file`, `add` pathspec'leri ve global
 * `-C/--git-dir/--work-tree` değerleri.
 */
export function gitPathArgs(args: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  let sub: string | null = null;

  while (i < args.length) {
    const a = args[i];
    if (a === '--') {
      out.push(...args.slice(i + 1));
      return out;
    }
    if (!a.startsWith('-')) {
      sub = a;
      i += 1;
      break;
    }
    if (a === '-C') {
      if (args[i + 1] !== undefined) out.push(args[i + 1]);
      i += 2;
      continue;
    }
    if (a.startsWith('-C') && a.length > 2) {
      out.push(a.slice(2));
      i += 1;
      continue;
    }
    if (a.startsWith('--git-dir=') || a.startsWith('--work-tree=')) {
      out.push(a.slice(a.indexOf('=') + 1));
      i += 1;
      continue;
    }
    if (a === '--git-dir' || a === '--work-tree') {
      if (args[i + 1] !== undefined) out.push(args[i + 1]);
      i += 2;
      continue;
    }
    if (['-c', '--config-env', '--namespace', '--super-prefix', '--attr-source'].includes(a)) {
      i += 2;
      continue;
    }
    i += 1;
  }

  if (!sub) return out;
  const rest = args.slice(i);
  const takeNext = (j: number): number => {
    if (rest[j + 1] !== undefined) out.push(rest[j + 1]);
    return j + 1;
  };

  if (sub === 'add') {
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (a === '--') {
        out.push(...rest.slice(j + 1));
        break;
      }
      const v = optValue(a, '--pathspec-from-file');
      if (v !== null) out.push(v);
      else if (a === '--pathspec-from-file') j = takeNext(j);
      else if (!a.startsWith('-')) out.push(a);
    }
  } else if (sub === 'diff' || sub === 'log' || sub === 'show') {
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (a === '--') {
        out.push(...rest.slice(j + 1));
        break;
      }
      const v = optValue(a, '--output');
      if (v !== null) out.push(v);
      else if (a === '--output') j = takeNext(j);
      else if (!a.startsWith('-')) {
        // URL dosya yolu değildir; `rev:path` ise yalnız path kısmı denetlenir.
        if (a.includes('://')) continue;
        const c = a.indexOf(':');
        if (c >= 0) {
          const p = a.slice(c + 1);
          if (p) out.push(p);
        } else {
          out.push(a);
        }
      }
    }
  } else if (sub === 'commit') {
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (a === '--') {
        out.push(...rest.slice(j + 1));
        break;
      }
      const v = optValue(a, '--file') ?? optValue(a, '--pathspec-from-file');
      if (v !== null) out.push(v);
      else if (a === '--file' || a === '--pathspec-from-file' || a === '-F') j = takeNext(j);
      else if (a.startsWith('-F') && a.length > 2) out.push(a.slice(2));
    }
  } else if (sub === 'stash') {
    const pos = rest.indexOf('--');
    if (pos >= 0) out.push(...rest.slice(pos + 1));
  }
  return out;
}

/** `exec` çağrısında dosya argümanı ihlali varsa sebebi, yoksa null. */
export function execFileArgViolation(cmd: string, args: string[]): string | null {
  if (cmd === 'rm') {
    const files = args.filter((a) => !a.startsWith('-'));
    const bad = files.find((a) => !isFileArgSafe(a));
    return bad ? t('policy.fileArgViolation', { arg: bad }) : null;
  }
  if (cmd === 'git') {
    // M6: `--exec-path` keyfi `git-<altkomut>` programı çalıştırır.
    if (args.some((a) => a === '--exec-path' || a.startsWith('--exec-path='))) {
      return t('policy.fileArgViolation', { arg: '--exec-path' });
    }
    const bad = gitPathArgs(args).find((a) => !isFileArgSafe(a));
    return bad ? t('policy.fileArgViolation', { arg: bad }) : null;
  }
  if (!FILE_ARG_CMDS.has(cmd)) return null;
  const bad = args.filter((a) => !a.startsWith('-')).find((a) => !isFileArgSafe(a));
  return bad ? t('policy.fileArgViolation', { arg: bad }) : null;
}

/**
 * O1 (c): onay ekranında gösterilecek açık uyarı — "yapı gereği kod çalıştıran"
 * komutlar (package.json script, vcs, paket kurulumu, test koşucusu).
 */
export function execApprovalWarning(cmd: string, args: string[]): string | null {
  if (cmd === 'npm') {
    if (args[0] === 'run' || args[0] === 'test') {
      return t('policy.warnNpmScript');
    }
  }
  if (cmd === 'npx') return t('policy.warnNpx');
  if (cmd === 'pip' && args[0] === 'install') return t('policy.warnPip');
  if (cmd === 'go' && args[0] === 'test') return t('policy.warnGoTest');
  if (cmd === 'cargo' && ['run', 'build', 'test', 'check', 'clippy'].includes(args[0] ?? '')) {
    if (args[0] === 'build' || args[0] === 'run') {
      return t('policy.warnCargoBuild');
    }
    return t('policy.warnCargoTest');
  }
  if (cmd === 'pytest' || cmd === 'tsc') return t('policy.warnTestRunner');
  if (cmd === 'git') {
    if (['commit', 'push', 'add', 'stash'].includes(args[0] ?? '')) {
      return t('policy.warnGitChange');
    }
    // O7: --no-index workspace DIŞINDAN da okur; --output çıktıyı jail
    // dışına yazabilir — onay ekranında açıkça işaretlenir (flag reddedilmez:
    // workspace içindeki meşru klasör diff'i çalışmaya devam eder).
    if (args[0] === 'diff' && args.includes('--no-index')) {
      return t('policy.warnGitNoIndex');
    }
    if (
      ['diff', 'log', 'show'].includes(args[0] ?? '') &&
      args.some((a) => a === '--output' || a.startsWith('--output='))
    ) {
      return t('policy.warnGitOutput');
    }
    return null;
  }
  if (cmd === 'prettier' || cmd === 'eslint') return t('policy.warnLinter');
  return null;
}

export function allowedCommands(): Record<string, string[][]> {
  return ALLOWED_CMDS;
}

export function isBlockedFile(path: string): boolean {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  if (BLOCKED_FILES.has(base)) return true;
  if (base.startsWith('.env.')) return true;
  // Uzantılar da tek kaynaktan (Rust `is_blocked_ext` ile aynı — O7 senkronu).
  return isBlockedExt(path.split('/').pop() ?? path);
}

/** Client-side jail: mutlak yol ve ../ reddedilir. H2: bileşenler duyarlı değil. */
export function isPathSafe(rel: string): boolean {
  const p = rel.trim().replace(/\\/g, '/');
  if (!p || p === '.' || p === '/') return true;
  if (p.startsWith('/')) return false;
  const segs = p.split('/').filter(Boolean);
  for (const s of segs) {
    if (s === '..') return false;
    if (BLOCKED_DIRS.has(s.toLowerCase())) return false;
  }
  if (isBlockedFile(p)) return false;
  return true;
}

/**
 * `rm` yalnızca `-i` ile (interaktif); `-f`/`-r`/`-R`/`--force`/`--recursive`
 * her konumda reddedilir (`rm -i -rf` dahil).
 */
export function isRmSafe(args: string[]): boolean {
  if (args[0] !== '-i') return false;
  for (const a of args.slice(1)) {
    if (a === '--force' || a === '--recursive' || a === '--no-preserve-root') return false;
    // O7: Rust `is_rm_safe` char-üyeliğiyle senkron — kısa bayrak kümesinde
    // f/r/R VARLIĞI reddeder (regex değil: "-1f" gibi biçimlerde de yakalanır).
    if (a.startsWith('-') && !a.startsWith('--')) {
      for (const ch of a.slice(1)) {
        if (ch === 'f' || ch === 'r' || ch === 'R') return false;
      }
    }
  }
  return true;
}

/**
 * Faz 6: kullanıcı satırı → [komut, prefix]. "docker ps" → ["docker", ["ps"]],
 * "htop" → ["htop", []] (serbest argüman). `rm`/boş/yorum/geçersiz → null.
 */
export function parseCustomLine(line: string): [string, string[]] | null {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  const parts = t.split(/\s+/);
  const cmd = parts[0];
  if (!cmd || cmd === 'rm' || cmd === '_note') return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(cmd)) return null;
  const args = parts.slice(1);
  if (args.some((a) => a.includes('\n') || a.includes('\0'))) return null;
  return [cmd, args];
}

/** Ayar listesinden ek tablo üretir (geçersiz satırlar atlanır). */
export function parseCustomAllowList(lines: string[]): Record<string, string[][]> {
  const table: Record<string, string[][]> = {};
  for (const line of lines) {
    const parsed = parseCustomLine(line);
    if (!parsed) continue;
    const [cmd, prefix] = parsed;
    (table[cmd] ??= []).push(prefix);
  }
  return table;
}

export function isExecAllowed(cmd: string, args: string[], extraAllow: Record<string, string[][]> = {}): boolean {
  const c = cmd.trim();
  // Tehlikeli karakterler hiçbir komutta geçmez.
  if (args.some((a) => a.includes('\n') || a.includes('\0'))) return false;
  if (c === 'rm') return isRmSafe(args);
  // Faz 8 L3: yerleşik tablo + kullanıcı tablosu **birleşik** (OR) uygulanır.
  // (Eskiden `??` ile yalnızca ilk bulunan tablo geçerliydi → kullanıcının eklediği
  //  "npm run build:ozel" gibi bir satır yerleşik "npm" satırının gölgesinde kalıyordu.)
  const tables: string[][][] = [];
  const base = ALLOWED_CMDS[c];
  if (base) tables.push(base);
  const extra = extraAllow[c];
  if (extra) tables.push(extra);
  if (tables.length === 0) return false;
  // Boş prefix listesi: args serbest (ls/pwd/echo/eslint/pytest/…).
  if (tables.some((t) => t.length === 0)) return true;
  // Diğerleri: prefix eşleşmesi.
  return tables.some((t) => t.some((prefix) => prefix.every((p, i) => args[i] === p)));
}

export function decideTool(
  name: ToolName | string,
  args: Record<string, unknown>,
  mode: ApprovalMode,
  extraAllow: Record<string, string[][]> = {},
): PolicyDecision
{
  if (name === 'glob') {
    const p = typeof args.path === 'string' ? args.path : '';
    if (p && isBlockedFile(p)) {
      return { allowed: false, reason: t('policy.forbiddenFile', { path: p }) };
    }
    if (p && !isPathSafe(p)) {
      return { allowed: false, reason: t('policy.outsideRoot') };
    }
    const pat = typeof args.pattern === 'string' ? args.pattern.trim().replace(/\\/g, '/') : '';
    if (!pat) {
      return { allowed: false, reason: t('policy.patternRequired') };
    }
    if (pat.startsWith('/') || pat.split('/').some((s) => s === '..')) {
      return { allowed: false, reason: t('policy.outsideRootPattern') };
    }
    return { allowed: true, autoApproved: true };
  }
  if (name === 'read_file' || name === 'list_dir' || name === 'grep') {
    const p = typeof args.path === 'string' ? args.path : '';
    if (p && isBlockedFile(p)) {
      return { allowed: false, reason: t('policy.forbiddenFile', { path: p }) };
    }
    if (p && !isPathSafe(p)) {
      return { allowed: false, reason: t('policy.outsideRoot') };
    }
    return { allowed: true, autoApproved: true };
  }
  if (name === 'propose_patch' || name === 'edit_file' || name === 'write_file') {
    // Faz 12 B.7: `auto-read` = **salt-okunur keşif modu** — yazma araçları
    // hiç çalışmaz (onay da istenmez). Önceden bu mod `manual` ile aynıydı
    // (okuma araçları zaten hep serbest olduğu için) → anlamsızdı.
    if (mode === 'auto-read') {
      return { allowed: false, reason: t('policy.readOnlyWrite') };
    }
    const p = typeof args.path === 'string' ? args.path : '';
    if (!p || !isPathSafe(p)) {
      return { allowed: false, reason: t('policy.invalidPath') };
    }
    // Önizleme her zaman serbest; uygulama onayı agent.ts'te sorulur.
    return { allowed: true, autoApproved: mode === 'auto-edit' };
  }
  if (name === 'todo' || name === 'plan') {
    // Yerel sunum araçları: dosya sistemine dokunmaz, her zaman serbest.
    return { allowed: true, autoApproved: true };
  }
  if (name === 'subagent') {
    // Faz 8 L1: alt-agent salt-okunurdur (yazma araçları `disallowTools` ile kapalı)
    // → onay gerektirmez; yalnızca token harcar.
    return { allowed: true, autoApproved: true };
  }
  if (typeof name === 'string' && name.startsWith('mcp:')) {
    // Faz 5: MCP araçları her zaman manuel onaylıdır (K2 akışı).
    return parseMcpName(name)
      ? { allowed: true, autoApproved: false }
      : { allowed: false, reason: t('policy.badMcpName', { name }) };
  }
  if (name === 'exec') {
    // Faz 12 B.7: salt-okunur modda komut çalıştırılmaz.
    if (mode === 'auto-read') {
      return { allowed: false, reason: t('policy.readOnlyExec') };
    }
    const cmd = typeof args.cmd === 'string' ? args.cmd : '';
    const rawArgs = Array.isArray(args.args)
      ? args.args.filter((a): a is string => typeof a === 'string')
      : [];
    if (cmd.trim() === 'rm' && !isRmSafe(rawArgs)) {
      return { allowed: false, reason: t('policy.rmBlocked') };
    }
    // O7: komut-çalıştıran flagler (find -exec, rg --pre …) — ek allowlist
    // dâhil hiçbir yoldan geçemez (Rust `check_predicates` çift savunma).
    const pred = execPredicateViolation(cmd, rawArgs);
    if (pred) {
      return { allowed: false, reason: pred };
    }
    // O1 (Faz 4): dosya argümanı jail'i (Rust ile senkron — çift savunma).
    const jailBreak = execFileArgViolation(cmd.trim(), rawArgs);
    if (jailBreak) {
      return { allowed: false, reason: jailBreak };
    }
    if (!isExecAllowed(cmd, rawArgs, extraAllow)) {
      return { allowed: false, reason: t('policy.forbiddenCommand', { cmd }) };
    }
    // Güvenlik (O6 düzeltmesi): exec hiçbir standart modda (manual/auto-read/auto-edit)
    // otomatik onaylanamaz; kabuk komutları her zaman kullanıcı onayı gerektirir.
    return { allowed: true, autoApproved: false };
  }
  return { allowed: false, reason: t('policy.unknownTool', { name }) };
}
