import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../store/settings';
import { getLocale, resolveLocale, setLocale, t, translate } from './core';
import { LOCALE_META, LOCALES } from './types';

afterEach(() => {
  setLocale('tr');
  useSettingsStore.setState({ language: 'auto' });
});

describe('i18n — store entegrasyonu', () => {
  it('varsayılan dil ayarı "auto" (sistem diline göre çözülür)', () => {
    expect(useSettingsStore.getState().language).toBe('auto');
  });

  it('setLanguage kalıcı ayarı değiştirir', () => {
    useSettingsStore.getState().setLanguage('de');
    expect(useSettingsStore.getState().language).toBe('de');
    expect(resolveLocale(useSettingsStore.getState().language)).toBe('de');
  });

  it('her desteklenen dil seçilebilir', () => {
    for (const l of LOCALES) {
      useSettingsStore.getState().setLanguage(l);
      expect(resolveLocale(useSettingsStore.getState().language)).toBe(l);
    }
  });

  it('"auto" ayarı yalnızca desteklenen bir dile çözülür', () => {
    const resolved = resolveLocale('auto');
    expect(LOCALES).toContain(resolved);
  });
});

describe('i18n — <html lang> senkronu', () => {
  const original = (globalThis as { document?: unknown }).document;

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = original;
    }
  });

  function stubDocument(): { lang: string } {
    const doc = { documentElement: { lang: 'tr' } };
    (globalThis as { document?: unknown }).document = doc;
    return doc.documentElement;
  }

  it('setLocale <html lang> değerini günceller', () => {
    const el = stubDocument();
    setLocale('fr');
    expect(el.lang).toBe('fr');
    expect(el.lang).toBe(LOCALE_META.fr.htmlLang);
  });

  it('her locale kendi htmlLang değerine karşılık gelir', () => {
    const el = stubDocument();
    for (const l of LOCALES) {
      setLocale(l);
      expect(el.lang).toBe(LOCALE_META[l].htmlLang);
    }
  });
});

describe('i18n — modül geneli locale', () => {
  it('setLocale modül geneli locale’i değiştirir', () => {
    setLocale('es');
    expect(getLocale()).toBe('es');
    expect(t('common.save')).toBe('Guardar');
  });

  it('varsayılan locale Türkçedir (testler Türkçe çıktı bekler)', () => {
    setLocale('tr');
    expect(t('common.save')).toBe('Kaydet');
  });

  it('her locale çeviri yapar (anahtar eksik değil)', () => {
    for (const l of LOCALES) {
      expect(translate('common.save', l)).not.toBe('common.save');
      expect(translate('common.save', l).length).toBeGreaterThan(0);
    }
  });
});
