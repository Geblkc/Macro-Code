import { describe, expect, it } from 'vitest';
import tauriConf from '../../../src-tauri/tauri.conf.json';
import { CSP_CONNECT_HOSTS, fetchFor, needsProxy } from './rustFetch';

describe('needsProxy — CSP connect-src ayna kuralı (İş 2)', () => {
  it('CSP listesindeki 6 host proxy’den muaf', () => {
    expect(needsProxy('https://api.anthropic.com/v1/messages')).toBe(false);
    expect(needsProxy('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(needsProxy('https://openrouter.ai/api/v1/chat/completions')).toBe(false);
    expect(needsProxy('https://api.deepseek.com/v1/chat/completions')).toBe(false);
    expect(needsProxy('https://api.x.ai/v1/chat/completions')).toBe(false);
    expect(
      needsProxy('https://generativelanguage.googleapis.com/v1beta/models/x'),
    ).toBe(false);
  });

  it('localhost / 127.0.0.1 proxy’den muaf (varsayılan Ollama)', () => {
    expect(needsProxy('http://localhost:11434/api/chat')).toBe(false);
    expect(needsProxy('http://127.0.0.1:11434/api/tags')).toBe(false);
    expect(needsProxy('http://[::1]:11434/api/chat')).toBe(false);
  });

  it('özel uç / baseUrlOverride hostu proxy’ye gider', () => {
    expect(needsProxy('https://proxy.ornek.com/v1/chat/completions')).toBe(true);
    expect(needsProxy('https://my-res.openai.azure.com/v1/chat/completions')).toBe(true);
    expect(needsProxy('http://192.168.1.5:1234/v1/chat/completions')).toBe(true);
    expect(needsProxy('http://lmstudio.ev.local:1234/v1/models')).toBe(true);
  });

  it('geçersiz / http-dışı URL proxy’ye girmez (fetchFor global’e düşer)', () => {
    expect(needsProxy('')).toBe(false);
    expect(needsProxy('not a url')).toBe(false);
    expect(needsProxy('file:///etc/passwd')).toBe(false);
    expect(needsProxy('data:text/plain,x')).toBe(false);
  });

  it('alt-alan adı listede değilse proxy’ye gider (tam eşleşme)', () => {
    // CSP host listesi alt alan adı kabul etmez → ayna kural da etmemeli.
    expect(needsProxy('https://eu.api.openai.com/v1')).toBe(true);
  });
});

describe('CSP_CONNECT_HOSTS — tauri.conf.json ile senkron', () => {
  it('connect-src içindeki host listesi birebir aynı', () => {
    const csp = (
      tauriConf as unknown as { app: { security: { csp: string } } }
    ).app.security.csp;
    const match = /connect-src([^;]*)/.exec(csp);
    expect(match, 'CSP içinde connect-src bulunamadı').toBeTruthy();
    const directive = (match as RegExpExecArray)[1];

    const hostsInCsp = [...directive.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map(
      (m) => m[1],
    );
    // localhost/127.0.0.1 joker olarak `:*` ile verilir; listeden çıkar.
    const remoteHosts = hostsInCsp.filter(
      (h) => h !== 'localhost' && h !== '127.0.0.1' && h !== 'self',
    );
    expect([...remoteHosts].sort()).toEqual([...CSP_CONNECT_HOSTS].sort());
  });
});

describe('fetchFor — enjeksiyon > rust proxy > global fetch', () => {
  it('enjeksiyon verilmişse o kazanır (CSP dışı host bile olsa)', () => {
    const injected = (() => {}) as unknown as typeof fetch;
    expect(fetchFor('https://proxy.ornek.com/v1', injected)).toBe(injected);
  });

  it('CSP içi host → global fetch (Tauri olsa bile)', () => {
    expect(fetchFor('https://api.openai.com/v1')).toBe(globalThis.fetch);
  });

  it('CSP dışı host → rustFetch (isTauri false ise global fetch kalır)', () => {
    // Test ortamında isTauri() false → global fetch. Tauri dalı rustFetch olur.
    expect(needsProxy('https://proxy.ornek.com/v1')).toBe(true);
    expect(fetchFor('https://proxy.ornek.com/v1')).toBe(globalThis.fetch);
  });
});
