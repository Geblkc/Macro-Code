import { describe, expect, it } from 'vitest';
import {
  allowedCommands,
  decideTool,
  execApprovalWarning,
  execFileArgViolation,
  gitPathArgs,
  isBlockedFile,
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

  it('H2: blok listeleri büyük/küçük harf duyarlı değil (macOS/Windows bypass)', () => {
    // isPathSafe / isBlockedDir
    expect(isPathSafe('.GIT/config')).toBe(false);
    expect(isPathSafe('Node_Modules/x.js')).toBe(false);
    expect(isPathSafe('alt/.Git/hooks/pre-commit')).toBe(false);
    // isBlockedFile (dosya adı + .env. öneki)
    expect(isBlockedFile('KEYS.JSON')).toBe(true);
    expect(isBlockedFile('.ENV.local')).toBe(true);
    // decideTool yolu da aynı duyarlılıkta.
    expect(decideTool('read_file', { path: '.GIT/config' }, 'manual').allowed).toBe(false);
    expect(decideTool('write_file', { path: '.GIT/hooks/pre-commit' }, 'auto-edit').allowed).toBe(false);
    // exec dosya argümanı jail'i (Rust `check_file_arg` ile senkron).
    expect(execFileArgViolation('cat', ['.GIT/config'])).not.toBeNull();
    expect(execFileArgViolation('cat', ['KEYS.JSON'])).not.toBeNull();
    expect(execFileArgViolation('cat', ['.ENV.local'])).not.toBeNull();
    expect(execFileArgViolation('cat', ['src/app.ts'])).toBeNull();
    // Doğru davranış korunur: gerçekçi olmayan adlar hâlâ geçer.
    expect(isPathSafe('src/app.ts')).toBe(true);
  });

  it('M4: genişletilmiş blok listeleri (dosya, dizin, uzantı)', () => {
    // Dizinler.
    expect(isPathSafe('.ssh/id_rsa')).toBe(false);
    expect(isPathSafe('.aws/credentials')).toBe(false);
    expect(isPathSafe('.gnupg/secring.gpg')).toBe(false);
    expect(isPathSafe('.kube/config')).toBe(false);
    expect(isPathSafe('.docker/config.json')).toBe(false);
    // Dosya adları.
    expect(isBlockedFile('.netrc')).toBe(true);
    expect(isBlockedFile('.git-credentials')).toBe(true);
    expect(isBlockedFile('.pypirc')).toBe(true);
    expect(isBlockedFile('.htpasswd')).toBe(true);
    expect(isBlockedFile('.pgpass')).toBe(true);
    expect(isBlockedFile('service-account.json')).toBe(true);
    expect(isBlockedFile('.vault-token')).toBe(true);
    // Uzantılar.
    expect(isPathSafe('certs/vault.kdbx')).toBe(false);
    expect(isPathSafe('certs/client.p8')).toBe(false);
    expect(isPathSafe('certs/keystore.jks')).toBe(false);
    expect(isPathSafe('certs/server.ppk')).toBe(false);
    expect(isPathSafe('vpn/profile.ovpn')).toBe(false);
    // Meşru yollar etkilenmez.
    expect(isPathSafe('src/app.ts')).toBe(true);
    expect(isPathSafe('docs/aws-setup.md')).toBe(true);
  });

  it('read/list/grep auto-approved', () => {
    expect(decideTool('read_file', { path: 'src/a.ts' }, 'manual').autoApproved).toBe(true);
    expect(decideTool('read_file', { path: '../x' }, 'manual').allowed).toBe(false);
  });

  it('M6: git dosya argümanı jail\'i (--, rev:path, -F/--output)', () => {
    expect(gitPathArgs(['show', 'HEAD:src/app.ts'])).toContain('src/app.ts');
    expect(gitPathArgs(['log', '--', '.env'])).toContain('.env');
    expect(gitPathArgs(['commit', '-F', 'mesaj.txt'])).toContain('mesaj.txt');
    expect(gitPathArgs(['diff', '--output=/tmp/x', 'HEAD'])).toContain('/tmp/x');
    expect(gitPathArgs(['add', 'src/app.ts'])).toContain('src/app.ts');
    // Tehlikeli okuma/yazma yolları.
    expect(execFileArgViolation('git', ['diff', '--no-index', '/etc/passwd', 'x'])).not.toBeNull();
    expect(execFileArgViolation('git', ['commit', '-F', '/etc/passwd'])).not.toBeNull();
    expect(execFileArgViolation('git', ['commit', '--file=/etc/passwd'])).not.toBeNull();
    expect(execFileArgViolation('git', ['show', 'HEAD:.env'])).not.toBeNull();
    expect(execFileArgViolation('git', ['log', '--', '.env'])).not.toBeNull();
    expect(execFileArgViolation('git', ['diff', '--output=/tmp/x', 'HEAD'])).not.toBeNull();
    expect(execFileArgViolation('git', ['add', '.ssh/id_rsa'])).not.toBeNull();
    expect(execFileArgViolation('git', ['add', '../x'])).not.toBeNull();
    expect(execFileArgViolation('git', ['-C', '../x', 'status'])).not.toBeNull();
    expect(execFileArgViolation('git', ['--git-dir=/etc', 'status'])).not.toBeNull();
    expect(execFileArgViolation('git', ['--exec-path=/tmp', 'status'])).not.toBeNull();
    // Meşru kullanım etkilenmez.
    expect(execFileArgViolation('git', ['status'])).toBeNull();
    expect(execFileArgViolation('git', ['show', 'HEAD:src/app.ts'])).toBeNull();
    expect(execFileArgViolation('git', ['diff', 'src/a.ts', 'src/b.ts'])).toBeNull();
    expect(execFileArgViolation('git', ['log', '--', 'src'])).toBeNull();
    // `-m` değeri mesajdır, yol değil.
    expect(execFileArgViolation('git', ['commit', '-m', 'fix: ../tmp'])).toBeNull();
    expect(execFileArgViolation('git', ['add', 'src/app.ts'])).toBeNull();
    // decideTool üzerinden de kapalı.
    expect(
      decideTool('exec', { cmd: 'git', args: ['diff', '--no-index', '/etc/passwd', 'x'] }, 'manual')
        .allowed,
    ).toBe(false);
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
    const { _note: _n, _predicates: _p, ...json } = rawAllowlist as unknown as Record<
      string,
      string[][]
    > & { _predicates: Record<string, string[]> };
    void _n;
    void _p;
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

  it('O7: komut-çalıştıran flagler reddedilir (find -exec, rg --pre)', () => {
    // decideTool seviyesinde: onay kartına hiç düşmez.
    const jail = (cmd: string, a: string[]) =>
      decideTool('exec', { cmd, args: a }, 'manual').allowed;
    expect(jail('find', ['.', '-exec', 'sh', '-c', 'id'])).toBe(false);
    expect(jail('find', ['.', '-execdir', 'id'])).toBe(false);
    expect(jail('find', ['.', '-ok', 'sh', '{}', ';'])).toBe(false);
    expect(jail('find', ['.', '-okdir', 'id'])).toBe(false);
    expect(jail('rg', ['--pre', 'kotu.sh', 'desen'])).toBe(false);
    expect(jail('rg', ['--pre=sh', 'desen'])).toBe(false);
    expect(jail('rg', ['--pre-glob', '*.txt', 'desen'])).toBe(false);
    const predReason = decideTool('exec', { cmd: 'find', args: ['.', '-exec', 'id'] }, 'manual');
    expect(predReason.reason).toMatch(/komut çalıştırabilir/);
    // Normal kullanım etkilenmez.
    expect(jail('find', ['.', '-name', '*.ts'])).toBe(true);
    expect(jail('rg', ['desen', '-g', '*.ts'])).toBe(true);
    expect(jail('rg', ['--pretty'])).toBe(true);
  });

  it('O7: ek-allowlist komut-çalıştıran flagleri açamaz', () => {
    const extra = parseCustomAllowList(['find -name', 'rg']);
    expect(isExecAllowed('find', ['-name', 'x', '-exec', 'id'], extra)).toBe(true); // isExecAllowed serbest
    // ama decideTool kalıcı olarak reddeder (rm kuralıyla aynı sertlik).
    expect(
      decideTool('exec', { cmd: 'find', args: ['-name', 'x', '-exec', 'id'] }, 'manual', extra)
        .allowed,
    ).toBe(false);
    expect(
      decideTool('exec', { cmd: 'rg', args: ['--pre', 'x.sh', 'd'] }, 'manual', extra).allowed,
    ).toBe(false);
    expect(
      decideTool('exec', { cmd: 'find', args: ['-name', 'x'] }, 'manual', extra).allowed,
    ).toBe(true);
  });

  it('O7: rm bayrak kümesi char-üyeliği ("-1f" tarzı da reddedilir)', () => {
    expect(isRmSafe(['-i', '-1f', 'x'])).toBe(false);
    expect(isRmSafe(['-i', '-1r', 'x'])).toBe(false);
    expect(isRmSafe(['-i', '-1', 'x'])).toBe(true);
    expect(isRmSafe(['-i', '-fi', 'x'])).toBe(false);
  });

  it('O7: git diff --no-index / --output onay uyarısı üretir', () => {
    expect(execApprovalWarning('git', ['diff', '--no-index', 'a', 'b'])).toMatch(/no-index/);
    expect(execApprovalWarning('git', ['log', '--output=x'])).toMatch(/workspace dışına/);
    expect(execApprovalWarning('git', ['diff'])).toBeNull();
    expect(execApprovalWarning('git', ['status'])).toBeNull();
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
