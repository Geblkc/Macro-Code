import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_NAME, APP_VERSION, LICENSE, REPO_URL } from './appInfo';

/**
 * Sürüm **tek kaynak** sözleşmesi.
 *
 * `package.json` → `vite.config.ts` (define) → uygulama.
 * `tauri.conf.json` sürümü elle tutulur — bu test senkron olduğunu doğrular.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string;
  version: string;
  productName: string;
  description?: string;
  license?: string;
  repository?: { url?: string };
  homepage?: string;
};

const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
  version: string;
  productName: string;
  identifier: string;
  bundle?: { copyright?: string };
};

const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoVersion = /^\s*version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];

describe('sürüm tek kaynak', () => {
  it('package.json sürümü geçerli semver', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('tauri.conf.json sürümü package.json ile aynı', () => {
    expect(tauriConf.version).toBe(pkg.version);
  });

  it('Cargo.toml sürümü package.json ile aynı', () => {
    expect(cargoVersion).toBe(pkg.version);
  });

  it('tauri.conf.json ürün adı package.json ile aynı', () => {
    expect(tauriConf.productName).toBe(pkg.productName);
  });

  it('bundle telif hakkı lisansla uyumlu', () => {
    expect(tauriConf.bundle?.copyright).toContain(LICENSE);
  });

  it('gömülen sürüm package.json ile aynı', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('gömülen sürüm boş değil', () => {
    expect(APP_VERSION.length).toBeGreaterThan(0);
    expect(APP_VERSION).not.toBe('0.0.0');
  });

  it('uygulama adı package.json ile uyumlu', () => {
    expect(APP_NAME).toBe(pkg.productName);
  });

  it('kaynak bağlantısı ya boş ya geçerli bir URL', () => {
    if (REPO_URL === '') {
      // repository tanımlı değilse bağlantı gösterilmez (About sekmesi).
      expect(pkg.repository?.url ?? pkg.homepage ?? '').toBe('');
      return;
    }
    expect(REPO_URL).toMatch(/^https?:\/\//);
  });
});
