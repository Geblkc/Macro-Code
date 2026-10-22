/**
 * Çoklu dil (i18n) tipleri.
 *
 * Sıfır bağımlılık: her şey elle yazıldı (proje kuralı — bkz. CONTRIBUTING).
 */

/** Desteklenen arayüz dilleri. */
export const LOCALES = ['tr', 'en', 'de', 'fr', 'es'] as const;

export type Locale = (typeof LOCALES)[number];

/** Dil ayarı: `auto` = sistem diline göre çözülür. */
export type LanguageSetting = 'auto' | Locale;

/** Çoğul biçimleri (`Intl.PluralRules` kategorileri). */
export interface PluralForms {
  /** `count = 0` (yalnız bazı dillerde ayrı biçim ister). */
  zero?: string;
  /** `count = 1`. */
  one: string;
  /** Diğer tüm sayılar. */
  other: string;
}

/** Bir sözlük girdisi: düz metin ya da çoğul biçimleri. */
export type Message = string | PluralForms;

/** Çeviri parametreleri: `{ad}` yer tutucuları + çoğul için `count`. */
export interface TranslateParams {
  /** Çoğul biçim seçimi (yoksa `other` kullanılır). */
  count?: number;
  [key: string]: string | number | undefined;
}

/** Dil meta verisi (ad + BCP-47 etiketi). */
export interface LocaleMeta {
  /** Kendi dilinde ad (TR, EN, DE, FR, ES). */
  label: string;
  /** `<html lang>` değeri. */
  htmlLang: string;
  /** `Intl.NumberFormat` / `Intl.DateTimeFormat` için yerel. */
  intl: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  tr: { label: 'Türkçe', htmlLang: 'tr', intl: 'tr-TR' },
  en: { label: 'English', htmlLang: 'en', intl: 'en-US' },
  de: { label: 'Deutsch', htmlLang: 'de', intl: 'de-DE' },
  fr: { label: 'Français', htmlLang: 'fr', intl: 'fr-FR' },
  es: { label: 'Español', htmlLang: 'es', intl: 'es-ES' },
};
