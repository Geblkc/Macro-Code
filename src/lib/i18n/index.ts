/**
 * Çoklu dil (i18n) genel API.
 *
 * - React bileşenlerinde: `useT()`
 * - React dışı (lib/hooks): `t()`
 * - Sözlükler: `./locales/{tr,en,de,fr,es}.ts` — `tr.ts` kaynak gerçektir.
 */
export { t, makeT, translate, setLocale, getLocale, detectLocale, resolveLocale } from './core';
export type { TFn, Dictionary, TranslationKey } from './core';
export { useT } from './hook';
export { LOCALES, LOCALE_META } from './types';
export type { Locale, LanguageSetting, Message, PluralForms, TranslateParams } from './types';
