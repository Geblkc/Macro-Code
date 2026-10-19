import { describe, expect, it } from 'vitest';
import {
  allowedCommands,
  decideTool,
  execApprovalWarning,
  isExecAllowed,
  isPathSafe,
  isRmSafe,
  parseCustomAllowList,
  parseCustomLine,
} from './policy';
import rawAllowlist from './allowlist.json';

describe('Faz C — policy', () => {
  it('../ ve mutlak yol reddedilir', () => {
    expect(isPathSafe('../etc/passwd')).toBe(false);
    expect(isPathSafe('/etc/passwd')).toBe(false);
    expect(isPathSafe('src/App.tsx')).toBe(true);
    expect(isPathSafe('')).toBe(true);
  });

  it('secret dosyalar reddedilir', () => {
    expect(isPathSafe('.env')).toBe(false);
    expect(isPathSafe('keys.json')).toBe(false);
  });

  it('Y1 (Faz 2): bloklu dizinler her bileşende reddedilir', () => {
    // isPathSafe — okuma ve yazma aynı kapıdan geçer.
    expect(isPathSafe('.git/config')).toBe(false);
    expect(isPathSafe('.git')).toBe(false);
    expect(isPathSafe('alt/.git/hooks/pre-commit')).toBe(false);
    expect(isPathSafe('node_modules/x.js')).toBe(false);
    expect(isPathSafe('.macrocode/backups/manifest.json')).toBe(false);
    expect(isPathSafe('target/debug/binary')).toBe(false);
    expect(isPathSafe('src/app.ts')).toBe(true);

    // decideTool: read/grep/glob autoApproved YOLU bu kez kapanır.
    expect(decideTool('read_file', { path: '.git/config' }, 'manual').allowed).toBe(false);
    expect(decideTool('grep', { pattern: 'token', path: '.git' }, 'manual').allowed).toBe(false);
    expect(decideTool('glob', { pattern: '**/*', path: '.git' }, 'manual').allowed).toBe(false);

    // Yazma araçları da reddedilir (auto-edit modunda bile).
    expect(decideTool('write_file', { path: '.git/hooks/pre-commit' }, 'auto-edit').allowed).toBe(false);
    expect(decideTool('edit_file', { path: '.git/config' }, 'auto-edit').allowed).toBe(false);
    expect(decideTool('propose_patch', { path: '.git/config' }, 'auto-edit').allowed).toBe(false);
  });

  it('read/list/grep auto-approved', () => {
    expect(decideTool('read_file', { path: 'src/a.ts' }, 'manual').autoApproved).toBe(true);
    expect(decideTool('read_file', { path: '../x' }, 'manual').allowed).toBe(false);
  });

  it('exec allowlist dışı yasak', () => {
    expect(isExecAllowed('rm', ['-rf'])).toBe(false);
    expect(isExecAllowed('sudo', [])).toBe(false);
    expect(isExecAllowed('npm', ['--version'])).toBe(true);
    expect(isExecAllowed('git', ['status'])).toBe(true);
    expect(decideTool('exec', { cmd: 'rm', args: [] }, 'manual').allowed).toBe(false);
  });

  it('Faz 3: geniş allowlist satırları', () => {
    expect(isExecAllowed('git', ['push'])).toBe(true);
    expect(isExecAllowed('git', ['add', '.'])).toBe(true);
    expect(isExecAllowed('cargo', ['clippy'])).toBe(true);
    expect(isExecAllowed('pytest', ['-k', 'x'])).toBe(true);
    expect(isExecAllowed('tsc', ['--noEmit'])).toBe(true);
    expect(isExecAllowed('go', ['test', './...'])).toBe(true);
    expect(isExecAllowed('rg', ['desen'])).toBe(true);
    expect(isExecAllowed('pip', ['install', 'p'])).toBe(true);
    expect(isExecAllowed('pip', ['uninstall', 'p'])).toBe(false);
    expect(isExecAllowed('cargo', ['run'])).toBe(false);
  });

  it('Faz 3: rm -i kabul, rm -rf/-r/--force ret', () => {
    expect(isRmSafe(['-i', 'dosya'])).toBe(true);
    expect(isExecAllowed('rm', ['-i', 'dosya'])).toBe(true);
    expect(isRmSafe(['-rf', '/'])).toBe(false);
    expect(isRmSafe(['-i', '-rf', 'dosya'])).toBe(false);
    expect(isRmSafe(['dosya'])).toBe(false);
    expect(isRmSafe(['-i', '--force'])).toBe(false);
    expect(decideTool('exec', { cmd: 'rm', args: ['-rf'] }, 'manual').allowed).toBe(false);
    expect(decideTool('exec', { cmd: 'rm', args: ['-i', 'a'] }, 'manual').allowed).toBe(true);
  });

  it('Faz 3 drift: TS tablosu allowlist.json ile birebir aynı', () => {
    const { _note: _n, ...json } = rawAllowlist as unknown as Record<string, string[][]>;
    void _n;
    expect(allowedCommands()).toEqual(json);
    // JSON'daki her komut TS'de tanınır: ilk prefix geçerli sayılır.
    for (const [cmd, prefixes] of Object.entries(json)) {
      if (cmd === 'rm') {
        expect(isExecAllowed(cmd, ['-i', 'x'])).toBe(true);
        continue;
      }
      const sample = prefixes.length === 0 ? ['ornek-arg'] : [...prefixes[0], 'ekstra'];
      expect(isExecAllowed(cmd, sample)).toBe(true);
    }
  });

  it('Faz 3: glob auto, write_file auto-edit dışında onaylı, todo auto', () => {
    expect(decideTool('glob', { pattern: '*.ts' }, 'manual').autoApproved).toBe(true);
    expect(decideTool('glob', { pattern: '../x' }, 'manual').allowed).toBe(false);
    expect(decideTool('write_file', { path: 'yeni.ts' }, 'manual').autoApproved).toBe(false);
    expect(decideTool('write_file', { path: 'yeni.ts' }, 'auto-edit').autoApproved).toBe(true);
    expect(decideTool('todo', { action: 'list' }, 'manual')).toMatchObject({
      allowed: true,
      autoApproved: true,
    });
    expect(decideTool('plan', { steps: ['a'] }, 'manual')).toMatchObject({
      allowed: true,
      autoApproved: true,
    });
  });

  it('exec hiçbir modda otomatik onaylanmaz (O6)', () => {
    const dManual = decideTool('exec', { cmd: 'npm', args: ['--version'] }, 'manual');
    expect(dManual.allowed).toBe(true);
    expect(dManual.autoApproved).toBe(false);

    const dAutoEdit = decideTool('exec', { cmd: 'npm', args: ['--version'] }, 'auto-edit');
    expect(dAutoEdit.allowed).toBe(true);
    expect(dAutoEdit.autoApproved).toBe(false);

    // Faz 12 B.7: `auto-read` artık gerçek bir salt-okunur mod → exec **reddedilir**
    // (onay istenmez; hiç çalışmaz). O6 kuralı (otomatik onay yok) korunur.
    const dAutoRead = decideTool('exec', { cmd: 'npm', args: ['--version'] }, 'auto-read');
    expect(dAutoRead.allowed).toBe(false);
    expect(dAutoRead.autoApproved).toBeFalsy();
  });

  it('O1 (Faz 4): dosya argümanı jaili decideTool\'da', () => {
    const jail = (cmd: string, a: string[]) =>
      decideTool('exec', { cmd, args: a }, 'manual').allowed;
    // Mutlak yol / ../ / bloklu — onay da aşılamaz (policy kararı allowed:false).
    expect(jail('cat', ['/etc/passwd'])).toBe(false);
    expect(jail('cat', ['../../.ssh/id_rsa'])).toBe(false);
    expect(jail('cat', ['.env'])).toBe(false);
    expect(jail('cat', ['.git/config'])).toBe(false);
    expect(jail('find', ['/'])).toBe(false);
    expect(jail('rg', ['token', '.git'])).toBe(false);
    expect(jail('head', ['-n', '5', '/var/log/syslog'])).toBe(false);
    expect(jail('cat', ['sertifika.pem'])).toBe(false);
    // rm jail'i
    expect(jail('rm', ['-i', '/etc/hosts'])).toBe(false);
    expect(jail('rm', ['-i', '../disari.txt'])).toBe(false);
    // Normal kullanım
    expect(jail('cat', ['src/app.ts'])).toBe(true);
    expect(jail('find', ['.', '-name', '*.ts'])).toBe(true);
    expect(jail('rg', ['desen', 'src'])).toBe(true);
    expect(jail('ls', ['-la'])).toBe(true);
    // Dosya argümanı olmayan komut etkilenmez
    expect(jail('echo', ['/bir/yol'])).toBe(true);
    expect(jail('npm', ['test'])).toBe(true);
  });

  it('O1 (Faz 4): onay uyarısı — yapı gereği kod çalıştıran komutlar', () => {
    expect(execApprovalWarning('npm', ['run', 'build'])).toMatch(/package\.json/);
    expect(execApprovalWarning('npm', ['test'])).toMatch(/package\.json/);
    expect(execApprovalWarning('pip', ['install', 'p'])).toBeTruthy();
    expect(execApprovalWarning('cargo', ['run'])).toBeTruthy();
    expect(execApprovalWarning('git', ['push'])).toBeTruthy();
    expect(execApprovalWarning('git', ['status'])).toBeNull();
    expect(execApprovalWarning('cat', ['src/a.ts'])).toBeNull();
    expect(execApprovalWarning('ls', [])).toBeNull();
  });

  it('Faz 6: custom allowlist satırları', () => {
    expect(parseCustomLine('docker ps')).toEqual(['docker', ['ps']]);
    expect(parseCustomLine('htop')).toEqual(['htop', []]);
    expect(parseCustomLine('rm -rf')).toBeNull();
    expect(parseCustomLine('# yorum')).toBeNull();
    const extra = parseCustomAllowList(['docker ps', 'rm -rf', '']);
    expect(isExecAllowed('docker', ['ps'], extra)).toBe(true);
    expect(isExecAllowed('docker', ['rm'], extra)).toBe(false);
    expect(isExecAllowed('rm', ['-rf'], extra)).toBe(false);
    expect(decideTool('exec', { cmd: 'docker', args: ['ps'] }, 'manual', extra).allowed).toBe(true);
  });

  it('Faz 8 L3: yerleşik tablo ile kullanıcı tablosu birleşik (OR) uygulanır', () => {
    // `cargo run` yerleşik tabloda yok (yalnız check/test/build/clippy) → ek tablo şart.
    const extra = parseCustomAllowList(['cargo run']);
    expect(isExecAllowed('cargo', ['run'], extra)).toBe(true);
    // Ek tablo olmadan aynı komut reddedilir.
    expect(isExecAllowed('cargo', ['run'])).toBe(false);
    // Yerleşik izinler korunur.
    expect(isExecAllowed('cargo', ['check'], extra)).toBe(true);
    // Hiçbir tabloda olmayan kombinasyon reddedilir.
    expect(isExecAllowed('cargo', ['bench'], extra)).toBe(false);
    // `git fetch` benzeri: yerleşik tablo prefix listesinde olmayan alt komut.
    const ex2 = parseCustomAllowList(['git fetch']);
    expect(isExecAllowed('git', ['fetch'], ex2)).toBe(true);
    expect(isExecAllowed('git', ['fetch'])).toBe(false);
  });

  it('Faz 12 B.7: auto-read = salt-okunur mod (yazma ve exec kapalı)', () => {
    // Yazma araçları reddedilir (onay istenmez — hiç çalışmazlar).
    for (const name of ['propose_patch', 'edit_file', 'write_file']) {
      const d = decideTool(name, { path: 'a.ts', content: 'x' }, 'auto-read');
      expect(d.allowed, name).toBe(false);
      expect(d.reason).toMatch(/salt-okunur/);
    }
    // Komut çalıştırma kapalı.
    const ex = decideTool('exec', { cmd: 'ls', args: [] }, 'auto-read');
    expect(ex.allowed).toBe(false);
    expect(ex.reason).toMatch(/salt-okunur/);
    // Okuma araçları serbest (keşif modunun amacı).
    const readArgs: Record<string, Record<string, unknown>> = {
      read_file: { path: 'a.ts' },
      list_dir: { path: '' },
      grep: { pattern: 'x' },
      glob: { pattern: '**/*.ts' },
    };
    for (const [name, args] of Object.entries(readArgs)) {
      const d = decideTool(name, args, 'auto-read');
      expect(d.allowed, name).toBe(true);
      expect(d.autoApproved, name).toBe(true);
    }
    // Diğer modlar etkilenmez.
    expect(decideTool('write_file', { path: 'a.ts', content: 'x' }, 'manual').autoApproved).toBe(false);
    expect(decideTool('write_file', { path: 'a.ts', content: 'x' }, 'auto-edit').autoApproved).toBe(true);
    expect(decideTool('exec', { cmd: 'ls' }, 'auto-edit').autoApproved).toBe(false);
  });

  it('Faz 8 L3: ek tablo tehlikeli kuralları gevşetmez (rm)', () => {
    const extra = parseCustomAllowList(['rm -rf']);
    // parseCustomLine 'rm' satırlarını eler → tabloya hiç girmez.
    expect(Object.keys(extra)).toHaveLength(0);
    expect(isExecAllowed('rm', ['-rf', 'x'], extra)).toBe(false);
  });
});
