import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  formatProviderError,
  httpErrorMessage,
  isInsufficientBalanceMessage,
  throwIfHttpError,
} from './common';
import { setLocale } from '../i18n/core';
import { LOCALES } from '../i18n/types';

const DEEPSEEK_402_BODY = JSON.stringify({
  error: {
    message: 'Insufficient Balance (request_id: 75085a85-3bc0-44f0-bd3f-131ae538c086)',
    type: 'insufficient_balance_error',
    param: null,
    code: 'invalid_request_error',
  },
});

describe('httpErrorMessage', () => {
  it('JSON govdeden error.message ayiklar', () => {
    expect(httpErrorMessage(DEEPSEEK_402_BODY, 'http 402')).toBe(
      'Insufficient Balance (request_id: 75085a85-3bc0-44f0-bd3f-131ae538c086)',
    );
  });

  it('message yoksa error.code’a duser', () => {
    const body = JSON.stringify({ error: { code: 'model_not_found' } });
    expect(httpErrorMessage(body, 'http 404')).toBe('model_not_found');
  });

  it('error objesi disinda kok message alanini da okur', () => {
    expect(httpErrorMessage(JSON.stringify({ message: 'quota exceeded' }), 'http 429')).toBe(
      'quota exceeded',
    );
  });

  it('duz metin govde korunur ve 300 karakterle sinirlidir', () => {
    expect(httpErrorMessage('gateway timeout', 'http 504')).toBe('gateway timeout');
    const long = 'x'.repeat(500);
    expect(httpErrorMessage(long, 'http 500')).toHaveLength(300);
  });

  it('bos govde fallback’e duser', () => {
    expect(httpErrorMessage('', 'http 402')).toBe('http 402');
  });
});

describe('throwIfHttpError', () => {
  it('ok yanit hata firlatmaz', async () => {
    await expect(throwIfHttpError(new Response('{}', { status: 200 }))).resolves.toBeUndefined();
  });

  it('402 yaniti temiz mesajla ProviderError’a cevirir', async () => {
    const res = new Response(DEEPSEEK_402_BODY, { status: 402 });
    const err = await throwIfHttpError(res).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    const pe = err as ProviderError;
    expect(pe.status).toBe(402);
    expect(pe.message).toContain('Insufficient Balance');
    expect(pe.message).not.toContain('{"error"');
  });

  it('govde okunamazsa http kodu mesaj olur', async () => {
    const res = new Response(null, { status: 502 });
    const err = await throwIfHttpError(res).catch((e: unknown) => e);
    expect((err as ProviderError).message).toBe('http 502');
  });
});

describe('isInsufficientBalanceMessage', () => {
  it('bilinen bakiye hatalarini tanir', () => {
    expect(isInsufficientBalanceMessage('Insufficient Balance')).toBe(true);
    expect(isInsufficientBalanceMessage('insufficient_credit')).toBe(true);
    expect(isInsufficientBalanceMessage('insufficient_balance_error')).toBe(true);
    expect(isInsufficientBalanceMessage('You exceeded your current quota')).toBe(true);
    expect(isInsufficientBalanceMessage('billing hard limit reached')).toBe(true);
  });

  it('ilgisiz mesajlari tanimaz', () => {
    expect(isInsufficientBalanceMessage('invalid api key')).toBe(false);
    expect(isInsufficientBalanceMessage('rate limit exceeded')).toBe(false);
  });
});

describe('formatProviderError', () => {
  it('402 → her dilde yetersiz bakiye mesaji', () => {
    const err = new ProviderError('Insufficient Balance', 402);
    const seen = new Set<string>();
    for (const l of LOCALES) {
      setLocale(l);
      const msg = formatProviderError(err);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain('{"error"');
      seen.add(msg as string);
    }
    // Mesajlar dile gore farkli olmali (ceviri calisiyor).
    expect(seen.size).toBe(LOCALES.length);
    setLocale('tr');
  });

  it('402 → turkce mesaj yetersiz bakiye ve yonlendirme icerir', () => {
    setLocale('tr');
    const msg = formatProviderError(new ProviderError('Insufficient Balance', 402));
    expect(msg).toContain('yetersiz bakiye');
    expect(msg).toContain('platform.deepseek.com');
    setLocale('tr');
  });

  it('status’suz SSE hatasinda metinden bakiye hatasi taninir', () => {
    setLocale('en');
    const msg = formatProviderError(new ProviderError('Insufficient Balance (request_id: x)'));
    expect(msg).toContain('insufficient balance');
    setLocale('tr');
  });

  it('status’suz alakasiz SSE hatasi bilinmeyen olarak kalir', () => {
    setLocale('en');
    const msg = formatProviderError(new ProviderError('stream disconnected'));
    expect(msg).toContain('stream disconnected');
    setLocale('tr');
  });

  it('regresyon: 401 / 429 / 400-context / 500 siniflandirmasi korunur', () => {
    setLocale('en');
    expect(formatProviderError(new ProviderError('x', 401))).toContain('401');
    expect(formatProviderError(new ProviderError('x', 429))).toContain('rate limit');
    expect(
      formatProviderError(new ProviderError('maximum context length exceeded', 400)),
    ).toContain('context limit');
    expect(formatProviderError(new ProviderError('x', 503))).toContain('503');
    setLocale('tr');
  });

  it('abort hatasi null doner', () => {
    expect(formatProviderError(new DOMException('aborted', 'AbortError'))).toBeNull();
  });
});
