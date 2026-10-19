import { describe, expect, it } from 'vitest';
import {
  buildContext,
  isIgnoredPath,
  isSecretFile,
  prioritizeFiles,
  summarizeWorkspace,
} from './context';

describe('Faz B — context', () => {
  it('secret dosyaları yakalar', () => {
    expect(isSecretFile('.env')).toBe(true);
    expect(isSecretFile('.env.local')).toBe(true);
    expect(isSecretFile('keys.json')).toBe(true);
    expect(isSecretFile('data/sessions.db')).toBe(true);
    expect(isSecretFile('src/App.tsx')).toBe(false);
  });

  it('ignore dizinleri eler', () => {
    expect(isIgnoredPath('node_modules/react/index.js')).toBe(true);
    expect(isIgnoredPath('.git/config')).toBe(true);
    expect(isIgnoredPath('dist/index.js')).toBe(true);
    expect(isIgnoredPath('src/App.tsx')).toBe(false);
  });

  it('öncelik: package.json ve README önce', () => {
    const out = prioritizeFiles(['src/z.ts', 'package.json', 'README.md', 'notes.md']);
    expect(out[0]).toBe('package.json');
    expect(out[1]).toBe('README.md');
  });

  it('budget aşımında truncate eder, secret almaz', () => {
    const ctx = buildContext(
      [
        { path: 'package.json', content: '{"name":"x"}' },
        { path: '.env', content: 'SECRET=1' },
        { path: 'big.ts', content: 'a'.repeat(10000) },
      ],
      { maxTotalChars: 5000, maxFileChars: 100 },
    );
    expect(ctx.included).toContain('package.json');
    expect(ctx.included).not.toContain('.env');
    expect(ctx.truncated).toBe(true);
  });

  it('/files özeti üretir', () => {
    const s = summarizeWorkspace(['src/App.tsx', 'node_modules/x.js', 'package.json'], 'demo');
    expect(s).toContain('demo');
    expect(s).not.toContain('node_modules');
  });
});
