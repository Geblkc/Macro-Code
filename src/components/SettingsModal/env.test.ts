import { describe, expect, it } from 'vitest';
import { allowListIssues, maskEnvText, parseEnvText, serializeEnv } from './types';

describe('maskEnvText — env değerlerini gizleme', () => {
  it('değerleri maskeler, anahtar adlarını korur', () => {
    expect(maskEnvText('API_KEY=supersecret')).toBe('API_KEY=••••••••');
  });

  it('yorum ve boş satırlara dokunmaz', () => {
    expect(maskEnvText('# not\n\nTOKEN=abc')).toBe('# not\n\nTOKEN=•••');
  });

  it('değeri olmayan satırı değiştirmez', () => {
    expect(maskEnvText('EMPTY=')).toBe('EMPTY=');
  });

  it('eşittir içeren değerleri korur (ilk = ayırıcı alınır)', () => {
    expect(maskEnvText('URL=https://x?a=b')).toBe('URL=••••••••');
  });

  it('maske uzunluğu 8 karakterle sınırlıdır', () => {
    expect(maskEnvText('K=0123456789012345')).toBe('K=••••••••');
  });

  it('maskelenmiş metin tekrar çözülemez (idempotent değil, kasıtlı)', () => {
    // Maskeli metin tekrar maskelendiğinde "••" kalır — kayıt metni bozulmaz.
    const once = maskEnvText('K=v');
    expect(once).toBe('K=•');
    expect(maskEnvText(once)).toBe('K=•');
  });
});

describe('allowListIssues — shell allowlist doğrulama', () => {
  it('geçerli satırlar sorun üretmez', () => {
    expect(allowListIssues(['docker ps', 'htop', 'npm run build'])).toEqual([]);
  });

  it('boş satır ve yorum sorun değildir', () => {
    expect(allowListIssues(['', '   ', '# yorum'])).toEqual([]);
  });

  it('rm satırı geçersiz sayılır (kurallar gevşemez)', () => {
    expect(allowListIssues(['rm -rf /'])).toEqual(['rm -rf /']);
  });

  it('geçersiz komut adı yakalanır', () => {
    expect(allowListIssues(['bad;cmd'])).toEqual(['bad;cmd']);
  });

  it('birden çok geçersiz satırı listeler', () => {
    expect(allowListIssues(['docker ps', 'rm x', 'a|b', 'ok'])).toEqual(['rm x', 'a|b']);
  });
});

describe('parseEnvText / serializeEnv — env metni dönüşümü', () => {
  it('geçerli satırları ayrıştırır', () => {
    const { keys, values } = parseEnvText('A=1\nB=2');
    expect(keys).toEqual(['A', 'B']);
    expect(values).toEqual({ A: '1', B: '2' });
  });

  it('geçersiz anahtar adlarını atlar', () => {
    expect(parseEnvText('1BAD=x\nOK=y').keys).toEqual(['OK']);
  });

  it('yorum satırlarını atlar', () => {
    expect(parseEnvText('# note\nOK=y').keys).toEqual(['OK']);
  });

  it('serialize → parse gidiş-dönüşü korur', () => {
    const { keys, values } = parseEnvText('A=1\nB=2');
    const text = serializeEnv(keys, values);
    expect(parseEnvText(text).values).toEqual({ A: '1', B: '2' });
  });
});
