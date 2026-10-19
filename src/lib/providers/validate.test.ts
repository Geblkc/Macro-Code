import { describe, expect, it } from 'vitest';
import { validateDetailed } from './validate';

const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
const badFetch = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
const errFetch = (async () => {
  throw new TypeError('ağ');
}) as unknown as typeof fetch;

describe('validateDetailed', () => {
  it('openai: ok/invalid/network ayrımı', async () => {
    expect(await validateDetailed('openai', 'k', { fetchImpl: okFetch })).toBe('ok');
    expect(await validateDetailed('openai', 'k', { fetchImpl: badFetch })).toBe('invalid');
    expect(await validateDetailed('openai', 'k', { fetchImpl: errFetch })).toBe('network');
    expect(await validateDetailed('openai', '  ', { fetchImpl: okFetch })).toBe('invalid');
  });

  it('özel base URL kullanılır', async () => {
    let seen = '';
    const cap = (async (url: unknown) => {
      seen = String(url);
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    await validateDetailed('openai', 'k', { fetchImpl: cap, baseUrl: 'http://l:1/v1/' });
    expect(seen).toBe('http://l:1/v1/models');
  });

  it('anthropic biçim denetimi (ağ çağrısı yok)', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    expect(await validateDetailed('anthropic', 'sk-ant-abcdefghij123456', { fetchImpl: spy })).toBe('ok');
    expect(called).toBe(false);
    expect(await validateDetailed('anthropic', 'kisa', { fetchImpl: spy })).toBe('invalid');
  });

  it('ollama: tags ok/network', async () => {
    expect(await validateDetailed('ollama', 'http://x:11434', { fetchImpl: okFetch })).toBe('ok');
    expect(await validateDetailed('ollama', 'http://x:11434', { fetchImpl: errFetch })).toBe('network');
  });

  it('gemini: key + ok', async () => {
    expect(await validateDetailed('gemini', 'AIzaX', { fetchImpl: okFetch })).toBe('ok');
    expect(await validateDetailed('gemini', '', { fetchImpl: okFetch })).toBe('invalid');
    expect(await validateDetailed('gemini', 'AIzaX', { fetchImpl: errFetch })).toBe('network');
  });
});
