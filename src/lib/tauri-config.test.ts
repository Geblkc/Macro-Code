import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Faz 7 A1 — çalışma zamanı yapılandırma koruması.
 *
 * `sql:default` plugin izni yalnızca `allow-close/allow-load/allow-select`
 * tanımlar; `allow-execute` yoksa `db.execute()` sessizce başarısız olur ve
 * oturum kalıcılığı, kalıcı onay kuyruğu ve **denetim logu** hiç yazılmaz.
 * Bu bulgu testlerle yakalanamıyordu (testler sahte DB kullanıyor) — bu dosya
 * capability + migration sözleşmesini doğrudan denetler.
 */

const ROOT = process.cwd();
const CAP_PATH = resolve(ROOT, 'src-tauri/capabilities/default.json');
const LIB_RS_PATH = resolve(ROOT, 'src-tauri/src/lib.rs');

interface Capability {
  identifier: string;
  permissions: string[];
}

/**
 * Kodun ihtiyaç duyduğu izinler.
 * `sql:default` paketi `allow-close/allow-load/allow-select` tanımını içerir;
 * `allow-execute` **dahil değildir** — bu yüzden açıkça istenmelidir.
 */
const REQUIRED_EXPLICIT = ['core:default', 'sql:allow-execute'];
const SELECT_PERMS = ['sql:allow-select', 'sql:default'];

describe('Tauri capability (Faz 7 A1)', () => {
  it('capability dosyası okunabilir ve geçerli JSON', () => {
    const cap = JSON.parse(readFileSync(CAP_PATH, 'utf8')) as Capability;
    expect(cap.identifier).toBe('default');
    expect(Array.isArray(cap.permissions)).toBe(true);
  });

  it('sql:allow-execute tanımlı (yoksa audit log + kalıcı onay çalışmaz)', () => {
    const cap = JSON.parse(readFileSync(CAP_PATH, 'utf8')) as Capability;
    expect(cap.permissions).toContain('sql:allow-execute');
  });

  it('gerekli tüm izinler mevcut', () => {
    const cap = JSON.parse(readFileSync(CAP_PATH, 'utf8')) as Capability;
    for (const p of REQUIRED_EXPLICIT) {
      expect(cap.permissions, `eksik izin: ${p}`).toContain(p);
    }
    // Okuma izni: açık `sql:allow-select` ya da `sql:default` paketi.
    expect(
      cap.permissions.some((p) => SELECT_PERMS.includes(p)),
      'okuma izni yok (sql:allow-select / sql:default)',
    ).toBe(true);
  });

  it('shell plugin izni verilmemiş (exec tek yol: exec_cmd allowlist)', () => {
    const cap = JSON.parse(readFileSync(CAP_PATH, 'utf8')) as Capability;
    const shellish = cap.permissions.filter((p) => p.startsWith('shell:'));
    expect(shellish).toEqual([]);
  });
});

describe('Faz 10 D2c — blok listesi tek kaynak', () => {
  it('Rust, TS ile aynı blocks.json dosyasını gömer (kayma imkânsız)', () => {
    const fsRs = readFileSync(resolve(ROOT, 'src-tauri/src/commands/fs.rs'), 'utf8');
    expect(fsRs).toContain('src/lib/engine/blocks.json');
    // Sabit tablo kalmamalı: liste yalnızca JSON'dan okunur.
    expect(fsRs).not.toMatch(/const BLOCKED_DIRS: \[&str/);
    expect(fsRs).not.toMatch(/const BLOCKED_FILES: \[&str/);
  });

  it('TS tarafı da aynı dosyayı import eder', () => {
    const policy = readFileSync(resolve(ROOT, 'src/lib/engine/policy.ts'), 'utf8');
    const context = readFileSync(resolve(ROOT, 'src/lib/engine/context.ts'), 'utf8');
    expect(policy).toContain("from './blocks.json'");
    expect(context).toContain("from './blocks.json'");
  });

  it('blocks.json beklenen girdileri içerir', () => {
    const blocks = JSON.parse(
      readFileSync(resolve(ROOT, 'src/lib/engine/blocks.json'), 'utf8'),
    ) as {
      dirs: string[];
      files: string[];
      secretExts: string[];
      dataExts: string[];
    };
    expect(blocks.dirs).toContain('.git');
    expect(blocks.dirs).toContain('node_modules');
    expect(blocks.files).toContain('.env');
    expect(blocks.files).toContain('keys.json');
    expect(blocks.secretExts).toEqual(expect.arrayContaining(['pem', 'key', 'p12', 'pfx']));
    expect(blocks.dataExts).toEqual(expect.arrayContaining(['db', 'sqlite']));
  });
});

describe('Rust migration sözleşmesi (Faz 7 A1)', () => {
  const libRs = readFileSync(LIB_RS_PATH, 'utf8');

  it('sessions / pending_approvals / audit_log tabloları migration ile oluşturuluyor', () => {
    expect(libRs).toContain('CREATE TABLE IF NOT EXISTS sessions');
    expect(libRs).toContain('CREATE TABLE IF NOT EXISTS pending_approvals');
    expect(libRs).toContain('CREATE TABLE IF NOT EXISTS audit_log');
  });

  it('exec_cmd ve proxy komutları invoke_handler içinde kayıtlı', () => {
    expect(libRs).toContain('exec_cmd');
    expect(libRs).toContain('proxy_fetch');
    expect(libRs).toContain('stream_anthropic');
  });
});
