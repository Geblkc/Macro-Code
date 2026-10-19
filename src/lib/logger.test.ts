import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogs, log, logCount, recentLogs, redact } from './logger';

describe('Faz 10 — log kanalı', () => {
  beforeEach(() => {
    clearLogs();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('kayıtlar tutulur ve en yeni önce döner', () => {
    log('info', 'a');
    log('warn', 'b');
    log('error', 'c');
    expect(logCount()).toBe(3);
    const entries = recentLogs(2);
    expect(entries.map((e) => e.event)).toEqual(['c', 'b']);
  });

  it('API anahtarı alanları redakte edilir', () => {
    const out = redact({ apiKey: 'sk-abcdefghijklmnop', token: 'abc', model: 'gpt-6' }) as Record<
      string,
      unknown
    >;
    expect(out.apiKey).toBe('«redakte»');
    expect(out.token).toBe('«redakte»');
    expect(out.model).toBe('gpt-6');
  });

  it('anahtar kalıpları değer içinde de redakte edilir', () => {
    const out = redact('hata: sk-abcdefghijklmnop ile gitti') as string;
    expect(out).not.toContain('sk-abcdefghijklmnop');
    expect(out).toContain('«redakte»');
  });

  it('JWT / Bearer / Gemini / xai kalıpları redakte edilir', () => {
    expect(redact('Bearer abcdefghijklmnopqrst') as string).not.toContain('abcdefghijklmnopqrst');
    expect(redact('AIzaSyABCDEFGHIJKLMNOP') as string).not.toContain('AIzaSyABCDEFGHIJKLMNOP');
    expect(redact('xai-abcdefghijklmnop') as string).not.toContain('xai-abcdefghijklmnop');
    expect(
      redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk') as string,
    ).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('iç içe nesne ve diziler de redakte edilir', () => {
    const out = redact({
      req: { headers: { authorization: 'Bearer xyzabcdefghijkl' }, list: [{ apiKey: 'sk-1234567890ab' }] },
    }) as Record<string, Record<string, Record<string, unknown>>>;
    expect(out.req.headers.authorization).toBe('«redakte»');
    const list = (out.req as unknown as { list: Array<Record<string, unknown>> }).list;
    expect(list[0].apiKey).toBe('«redakte»');
  });

  it('log kaydı veriyi redakte edilmiş halde tutar', () => {
    log('info', 'stream.start', { apiKey: 'sk-abcdefghijkl', model: 'm' });
    const entry = recentLogs(1)[0];
    expect((entry.data as Record<string, unknown>).apiKey).toBe('«redakte»');
    expect((entry.data as Record<string, unknown>).model).toBe('m');
  });

  it('halka arabellek sınırlıdır', () => {
    for (let i = 0; i < 260; i++) log('info', `e${i}`);
    expect(logCount()).toBeLessThanOrEqual(200);
    expect(recentLogs(1)[0].event).toBe('e259');
  });
});
