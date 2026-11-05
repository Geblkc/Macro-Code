import { describe, expect, it } from 'vitest';
import {
  MAX_AI_DIFF_CHARS,
  branchNameError,
  commitMessageError,
  filterDiffForAi,
  isSecretPath,
  repoPathError,
} from './policy';

describe('git policy — gizli yollar', () => {
  it('.env, bloklu dizin ve anahtar uzantıları', () => {
    expect(isSecretPath('.env')).toBe(true);
    expect(isSecretPath('.env.local')).toBe(true);
    expect(isSecretPath('config/.env.production')).toBe(true);
    expect(isSecretPath('node_modules/pkg/index.js')).toBe(true);
    expect(isSecretPath('.git/config')).toBe(true);
    expect(isSecretPath('keys/server.pem')).toBe(true);
    expect(isSecretPath('certs/client.key')).toBe(true);
    expect(isSecretPath('credentials.json')).toBe(true);
  });

  it('normal kaynak dosyalar gizli değildir', () => {
    expect(isSecretPath('src/app.ts')).toBe(false);
    expect(isSecretPath('src/lib/git/policy.ts')).toBe(false);
    expect(isSecretPath('README.md')).toBe(false);
  });
});

describe('git policy — repo-göreli yol', () => {
  it('geçerli yollar', () => {
    expect(repoPathError('src/app.ts')).toBeNull();
    expect(repoPathError('src/foo bar/İstanbul.ts')).toBeNull();
    expect(repoPathError('a.b/c-d_e.txt')).toBeNull();
  });

  it('mutlak yol, ../ ve pathspec magic reddedilir', () => {
    expect(repoPathError('/etc/passwd')).not.toBeNull();
    expect(repoPathError('C:/Windows/system32')).not.toBeNull();
    expect(repoPathError('../disari.txt')).not.toBeNull();
    expect(repoPathError('src/../../x')).not.toBeNull();
    expect(repoPathError('-rf')).not.toBeNull();
    expect(repoPathError(':(top)x')).not.toBeNull();
    expect(repoPathError('a\nb')).not.toBeNull();
    expect(repoPathError('')).not.toBeNull();
  });

  it('gizli dosyalar pathspec olarak reddedilir', () => {
    expect(repoPathError('.env')).not.toBeNull();
    expect(repoPathError('node_modules/a.js')).not.toBeNull();
  });
});

describe('git policy — branch ve mesaj', () => {
  it('branch adı hızlı kontrolü', () => {
    expect(branchNameError('feature/git-panel')).toBeNull();
    expect(branchNameError('fix-1')).toBeNull();
    expect(branchNameError('-x')).not.toBeNull();
    expect(branchNameError('a..b')).not.toBeNull();
    expect(branchNameError('a@{b}')).not.toBeNull();
    expect(branchNameError('a b')).not.toBeNull();
    expect(branchNameError('a.lock')).not.toBeNull();
    expect(branchNameError('a\\b')).not.toBeNull();
    expect(branchNameError('a:b')).not.toBeNull();
    expect(branchNameError('a//b')).not.toBeNull();
    expect(branchNameError('')).not.toBeNull();
  });

  it('commit mesajı sınırları', () => {
    expect(commitMessageError('  fix: bir şey  ')).toBeNull();
    expect(commitMessageError('   ')).not.toBeNull();
    expect(commitMessageError('a'.repeat(5001))).not.toBeNull();
    expect(commitMessageError('a\0b')).not.toBeNull();
  });
});

describe('git policy — AI için diff filtresi', () => {
  it('gizli dosya bloklarını çıkarır', () => {
    const text = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/.env b/.env',
      '--- a/.env',
      '+++ b/.env',
      '@@ -1 +1 @@',
      '-SECRET=1',
      '+SECRET=2',
      'diff --git a/keys/server.pem b/keys/server.pem',
      '--- a/keys/server.pem',
      '+++ b/keys/server.pem',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');
    const out = filterDiffForAi(text);
    expect(out.text).toContain('src/app.ts');
    expect(out.text).not.toContain('.env');
    expect(out.text).not.toContain('server.pem');
    expect(out.excluded).toEqual(['.env', 'keys/server.pem']);
    expect(out.truncated).toBe(false);
  });

  it('boşluklu/tırnaklı yollarda secret bloğu kaçırmaz', () => {
    const text = [
      'diff --git a/src b/.env b/src b/.env',
      '--- a/src b/.env\t',
      '+++ b/src b/.env\t',
      '@@ -1 +1 @@',
      '-SECRET=1',
      '+SECRET=2',
      'diff --git "a/giz li/s\\304\\261r.txt" "b/giz li/s\\304\\261r.txt"',
      '--- "a/giz li/s\\304\\261r.txt"\t',
      '+++ "b/giz li/s\\304\\261r.txt"\t',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    const out = filterDiffForAi(text);
    // `.env` gerçek bir segment; `sır.txt` secret değil ama bozulmamalı.
    expect(out.excluded).toEqual(['src b/.env']);
    expect(out.text).not.toContain('SECRET');
    expect(out.text).toContain('s\\304\\261r.txt');
  });

  it('uzun diff kısaltılır ve işaretlenir', () => {
    const text = `diff --git a/a b/a\n${'+x\n'.repeat(MAX_AI_DIFF_CHARS)}`;
    const out = filterDiffForAi(text);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThan(text.length);
    expect(out.text).toContain('diff kısaltıldı');
  });
});
