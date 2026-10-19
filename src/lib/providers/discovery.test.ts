import { describe, expect, it } from 'vitest';
import { discoverGemini, discoverOllama, discoverOpenAI, discoverOpenRouter } from './discovery';

const jsonFetch = (payload: unknown, ok = true, status = 200) =>
  (async () => ({
    ok,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;

describe('discovery', () => {
  it('openrouter kataloğu çözer', async () => {
    const f = jsonFetch({ data: [{ id: 'a/b', context_length: 100 }, { id: 'c' }, { no: 1 }] });
    const out = await discoverOpenRouter(f);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'a/b', source: 'openrouter', contextWindow: 100 });
    expect(out[1].contextWindow).toBeUndefined();
  });

  it('openrouter hatası fırlatır', async () => {
    await expect(discoverOpenRouter(jsonFetch({}, false, 500))).rejects.toThrow();
  });

  it('ollama isimleri döner', async () => {
    const f = jsonFetch({ models: [{ name: 'llama3.3:latest' }] });
    const out = await discoverOllama('http://h:11434/', f);
    expect(out).toEqual([
      { id: 'llama3.3:latest', source: 'ollama', contextWindow: undefined, fetchedAt: expect.any(Number) },
    ]);
  });

  it('openai data id kullanır', async () => {
    const f = jsonFetch({ data: [{ id: 'm1' }, {}] });
    const out = await discoverOpenAI('k', 'https://x/v1/', f);
    expect(out.map((m) => m.id)).toEqual(['m1']);
    expect(out[0].source).toBe('openai');
  });

  it('gemini models/ önekini kırpar', async () => {
    const f = jsonFetch({ models: [{ name: 'models/gemini-x' }, { name: 5 }] });
    const out = await discoverGemini('AIzaK', f);
    expect(out.map((m) => m.id)).toEqual(['gemini-x']);
    await expect(discoverGemini('  ', f)).rejects.toThrow();
  });
});
