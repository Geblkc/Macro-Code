import { describe, expect, it } from 'vitest';
import { buildCustomProvider, makeEndpointId, parseEndpointModels } from './custom';
import { listOllamaModels } from './ollama';

describe('özel uç yardımcıları', () => {
  it('makeEndpointId slug üretir', () => {
    expect(makeEndpointId('Şirket Proxy!')).toBe('custom_sirket-proxy');
    expect(makeEndpointId('  ')).toBe('custom_uc');
    expect(makeEndpointId('ABC 123')).toBe('custom_abc-123');
  });

  it('parseEndpointModels satır/virgül ayırır, tekilleştirir', () => {
    expect(parseEndpointModels('a,\n b\na\n\n')).toEqual(['a', 'b']);
    expect(parseEndpointModels('')).toEqual([]);
  });

  it('buildCustomProvider taban URL ile konuşur', async () => {
    let seen = '';
    const cap = (async (url: unknown) => {
      seen = String(url);
      return {
        ok: true,
        status: 200,
        body: null,
        headers: new Headers(),
      };
    }) as unknown as typeof fetch;
    // body null → feedSSELines erken çıkar; istek URL'si doğrulanır.
    const prov = buildCustomProvider({
      id: 'custom_x',
      name: 'X',
      baseUrl: 'http://l:1/v1/',
      models: ['m1'],
    });
    expect(prov.models.map((m) => m.id)).toEqual(['m1']);
    await prov.stream({ apiKey: 'k', model: 'm1', messages: [], onChunk: () => {}, fetchImpl: cap });
    expect(seen).toBe('http://l:1/v1/chat/completions');
  });

  it('listOllamaModels tags yanıtını çözer', async () => {
    const tags = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'llama3.3:latest' }, { name: 'x' }, {}] }),
    })) as unknown as typeof fetch;
    expect(await listOllamaModels('http://h:11434/', tags)).toEqual(['llama3.3:latest', 'x']);
    const bad = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(listOllamaModels('http://h:11434', bad)).rejects.toThrow();
  });
});
