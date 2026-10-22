import type { Message, TranslateParams } from './types';

/** `{ad}` biçiminde yer tutucu. */
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * `{ad}` yer tutucularını parametrelerle değiştirir.
 * Bilinmeyen yer tutucu olduğu gibi bırakılır (sessiz veri kaybı yok).
 */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Çoğul biçimini seçer (`Intl.PluralRules`).
 * Karşılaştırma/sayı biçimi `locale` ile yapılır (de: 1 → "1 Bestätigung").
 */
export function selectForm(message: Message, count: number, locale: string): string {
  if (typeof message === 'string') return message;
  let category = 'other';
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    category = count === 1 ? 'one' : 'other';
  }
  if (category === 'zero' && message.zero !== undefined) return message.zero;
  if (category === 'one') return message.one;
  return message.other;
}
