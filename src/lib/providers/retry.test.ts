import { describe, expect, it } from 'vitest';
import { ProviderError, withRetry } from './common';

describe('Faz 1 G6 — retry+backoff', () => {
  it('429 → 2 deneme → başarı', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const out = await withRetry(
      async () => {
        n++;
        if (n < 3) throw new ProviderError('rate', 429);
        return 'ok';
      },
      { retries: 2, baseMs: 1, maxMs: 5, sleepImpl: async (ms) => { sleeps.push(ms); } },
    );
    expect(out).toBe('ok');
    expect(n).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it('400 → deneme yok', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new ProviderError('bad', 400);
        },
        { retries: 2, sleepImpl: async () => {} },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(n).toBe(1);
  });

  it('abort → deneme yok', async () => {
    let n = 0;
    const abort = new DOMException('aborted', 'AbortError');
    await expect(
      withRetry(
        async () => {
          n++;
          throw abort;
        },
        { retries: 2, sleepImpl: async () => {} },
      ),
    ).rejects.toBe(abort);
    expect(n).toBe(1);
  });

  it('TypeError (ağ) retry eder', async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        n++;
        if (n === 1) throw new TypeError('fetch failed');
        return 'net-ok';
      },
      { retries: 2, sleepImpl: async () => {} },
    );
    expect(out).toBe('net-ok');
    expect(n).toBe(2);
  });
});
