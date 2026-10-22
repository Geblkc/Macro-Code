import { useMemo } from 'react';
import { useSettingsStore } from '../../store/settings';
import { resolveLocale, translate } from './core';
import type { TFn } from './core';
import type { TranslateParams } from './types';
import type { TranslationKey } from './locales/tr';

/**
 * Store'daki dil ayarına bağlı çeviri fonksiyonu.
 * Dil değişince yeniden render olur (locale `useMemo` bağımlılığı).
 */
export function useT(): TFn {
  const setting = useSettingsStore((s) => s.language);
  const locale = resolveLocale(setting);
  return useMemo(
    () => (key: TranslationKey, params?: TranslateParams) => translate(key, locale, params),
    [locale],
  );
}
