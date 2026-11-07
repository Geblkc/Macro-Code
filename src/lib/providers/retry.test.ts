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

  it('onRetry: deneme numarası ve bekleme süresini bildirir', async () => {
    let n = 0;
    const infos: Array<{ nextAttempt: number; maxAttempts: number; delayMs: number }> = [];
    const out = await withRetry(
      async () => {
        n++;
        if (n < 3) throw new ProviderError('rate', 429);
        return 'ok';
      },
      {
        retries: 2,
        baseMs: 1,
        maxMs: 5,
        sleepImpl: async () => {},
        onRetry: (info) => infos.push(info),
      },
    );
    expect(out).toBe('ok');
    expect(infos.map((i) => i.nextAttempt)).toEqual([2, 3]);
    expect(infos.every((i) => i.maxAttempts === 3)).toBe(true);
    expect(infos.every((i) => i.delayMs > 0)).toBe(true);
  });

  it('Retry-After başlığı backoff yerine kullanılır', async () => {
    let n = 0;
    const sleeps: number[] = [];
    await withRetry(
      async () => {
        n++;
        if (n === 1) throw new ProviderError('rate', 429, 4000);
        return 'ok';
      },
      {
        retries: 2,
        baseMs: 1,
        maxMs: 5,
        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(sleeps).toEqual([4000]);
  });

  it('shouldRetry false → o hata için retry yok', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new ProviderError('rate', 429);
        },
        { retries: 2, sleepImpl: async () => {}, shouldRetry: () => false },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(n).toBe(1);
  });

  it('onRetry hata fırlatsa bile retry akışı sürer', async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        n++;
        if (n === 1) throw new ProviderError('rate', 429);
        return 'ok';
      },
      {
        retries: 2,
        sleepImpl: async () => {},
        onRetry: () => {
          throw new Error('ui-boom');
        },
      },
    );
    expect(out).toBe('ok');
    expect(n).toBe(2);
  });
});
