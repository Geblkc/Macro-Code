import { interpolate, selectForm } from './format';
import type { Message, TranslateParams } from './types';
import { LOCALES, LOCALE_META } from './types';
import type { Locale, LanguageSetting } from './types';
import { tr } from './locales/tr';
import type { TranslationKey } from './locales/tr';
import { en } from './locales/en';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { es } from './locales/es';

export type { TranslationKey };

/** Sözlük tipi — her dil `tr` ile birebir aynı anahtar kümesini taşır. */
export type Dictionary = Record<TranslationKey, Message>;

const DICTIONARIES: Record<Locale, Dictionary> = { tr, en, de, fr, es };

/** Çeviri fonksiyonu imzası. */
export type TFn = (key: TranslationKey, params?: TranslateParams) => string;

/**
 * React dışı çağıranlar için modül geneli locale.
 * `App.tsx` store değerini buraya yansıtır; `useT()` doğrudan store'dan okur.
 */
let currentLocale: Locale = 'tr';

export function getLocale(): Locale {
  return currentLocale;
}

/** Locale'i değiştirir ve `<html lang>` niteliğini senkronlar. */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = LOCALE_META[locale].htmlLang;
  }
}

/**
 * Sistemin diline göre en yakın desteklenen dili bulur.
 * `navigator.languages` → `navigator.language` → `tr` sırasıyla denenir.
 */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'tr';
  const candidates: string[] = [];
  try {
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  } catch {
    // navigator.languages erişilemez → yalnız navigator.language denenir.
  }
  if (navigator.language) candidates.push(navigator.language);
  for (const raw of candidates) {
    const base = raw.toLowerCase().split('-')[0];
    const hit = LOCALES.find((l) => l === base);
    if (hit) return hit;
  }
  return 'tr';
}

/** Dil ayarını gerçek locale'e çözer (`auto` → sistem dili). */
export function resolveLocale(setting: LanguageSetting): Locale {
  return setting === 'auto' ? detectLocale() : setting;
}

/**
 * Anahtarı çevirir.
 * Fallback zinciri: aktif dil → İngilizce → Türkçe → anahtarın kendisi.
 */
export function translate(
  key: TranslationKey,
  locale: Locale,
  params?: TranslateParams,
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES.tr;
  let message = dict[key] as Message | undefined;
  if (message === undefined) message = DICTIONARIES.en[key] as Message | undefined;
  if (message === undefined) message = DICTIONARIES.tr[key] as Message | undefined;
  if (message === undefined) return key;
  if (typeof message === 'string') return interpolate(message, params);
  const count = params?.count ?? 0;
  return interpolate(selectForm(message, count, locale), params);
}

/** Verilen locale'e bağlı çeviri fonksiyonu üretir. */
export function makeT(locale: Locale): TFn {
  return (key, params) => translate(key, locale, params);
}

/** Modül geneli locale'e bağlı çeviri (React dışı çağıranlar). */
export function t(key: TranslationKey, params?: TranslateParams): string {
  return translate(key, currentLocale, params);
}
