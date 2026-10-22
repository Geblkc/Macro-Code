import { afterEach, describe, expect, it } from 'vitest';
import { tr } from './locales/tr';
import type { TranslationKey } from './locales/tr';
import { en } from './locales/en';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { es } from './locales/es';
import { detectLocale, getLocale, makeT, resolveLocale, setLocale, translate } from './core';
import { interpolate, selectForm } from './format';
import { LOCALES, LOCALE_META } from './types';
import type { Locale, Message } from './types';

const DICTS: Record<Locale, Record<string, unknown>> = { tr, en, de, fr, es };

afterEach(() => {
  setLocale('tr');
});

describe('i18n — anahtar bütünlüğü', () => {
  const trKeys = Object.keys(tr).sort();

  it('kaynak sözlük boş değil', () => {
    expect(trKeys.length).toBeGreaterThan(100);
  });

  for (const locale of LOCALES) {
    it(`${locale}: tr ile aynı anahtar kümesini taşır`, () => {
      const keys = Object.keys(DICTS[locale]).sort();
      const missing = trKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !trKeys.includes(k));
      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] });
    });
  }

  it('tüm diller aynı sayıda anahtar içerir', () => {
    const counts = LOCALES.map((l) => Object.keys(DICTS[l]).length);
    expect(new Set(counts).size).toBe(1);
  });
});

describe('i18n — çeviri', () => {
  it('yer tutucuları değiştirir', () => {
    expect(interpolate('merhaba {name}', { name: 'Dünya' })).toBe('merhaba Dünya');
  });

  it('bilinmeyen yer tutucuyu boşaltmaz', () => {
    expect(interpolate('a {x} b', { y: 1 })).toBe('a {x} b');
  });

  it('parametre yoksa metni değiştirmez', () => {
    expect(interpolate('a {x} b')).toBe('a {x} b');
  });

  it('çoğul biçimini dile göre seçer', () => {
    const one = selectForm({ one: '{count} Tag', other: '{count} Tage' }, 1, 'de');
    const other = selectForm({ one: '{count} Tag', other: '{count} Tage' }, 3, 'de');
    expect(one).toBe('{count} Tag');
    expect(other).toBe('{count} Tage');
  });

  it('İngilizce çoğul sayıyı doğru biçimlendirir', () => {
    const t = makeT('en');
    expect(t('status.pendingCount', { count: 1 })).toBe('1 approval');
    expect(t('status.pendingCount', { count: 4 })).toBe('4 approvals');
  });

  it('Almanca çoğul sayıyı doğru biçimlendirir', () => {
    const t = makeT('de');
    expect(t('status.pendingCount', { count: 1 })).toBe('1 Genehmigung');
    expect(t('status.pendingCount', { count: 4 })).toBe('4 Genehmigungen');
  });

  it('tekil/çoğul farkı her dilde doğru uygulanır', () => {
    expect(makeT('en')('sidebar.time.daysAgo', { count: 1 })).toBe('1 day ago');
    expect(makeT('en')('sidebar.time.daysAgo', { count: 3 })).toBe('3 days ago');
    expect(makeT('de')('sidebar.time.daysAgo', { count: 1 })).toBe('vor 1 Tag');
    expect(makeT('de')('sidebar.time.daysAgo', { count: 3 })).toBe('vor 3 Tagen');
    expect(makeT('fr')('status.mcpActive', { count: 1 })).toBe('1 serveur MCP actif');
    expect(makeT('fr')('status.mcpActive', { count: 3 })).toBe('3 serveurs MCP actifs');
    expect(makeT('es')('status.mcpActive', { count: 1 })).toBe('1 servidor MCP activo');
    expect(makeT('es')('status.mcpActive', { count: 3 })).toBe('3 servidores MCP activos');
  });

  it('sayaç içeren her anahtar İngilizcede çoğul biçimlidir', () => {
    // İngilizce isimleri sayıya göre değiştirir ("1 day" / "3 days") → düz metin
    // ("{count} days") kullanılan anahtar olsaydı "1 days ago" gibi hatalar doğardı.
    //
    // İstisna: sayı bir ETİKET'in sonrasında geliyorsa (ya da parantez içindeyse)
    // isim çoğul biçime bağlı değildir:
    //   input.attachTitle   → "add image (up to 4)"
    //   export.messageCount → "**Total messages:** 1"
    const LABEL_STYLE = new Set(['input.attachTitle', 'export.messageCount']);

    /** Sözlük girdisindeki tüm metin parçaları. */
    const texts = (m: Message): string[] =>
      typeof m === 'string'
        ? [m]
        : m.zero !== undefined
          ? [m.one, m.other, m.zero]
          : [m.one, m.other];

    const counted = (Object.keys(tr) as TranslationKey[]).filter(
      (k) => !LABEL_STYLE.has(k) && texts(tr[k]).some((s) => s.includes('{count}')),
    );
    expect(counted.length).toBeGreaterThan(0);

    // İngilizce sözlükte bu anahtarlar çoğul NESNESİ olmalı (düz metin değil).
    const notPlural = counted.filter((k) => typeof en[k] === 'string');
    expect(notPlural).toEqual([]);

    // Çoğul nesnenin her iki biçimi de sayıyı taşımalı.
    const missing = counted.filter(
      (k) => typeof en[k] !== 'string' && !texts(en[k]).every((s) => s.includes('{count}')),
    );
    expect(missing).toEqual([]);
  });

  it('her dilde tüm anahtarlar boş olmayan metin verir', () => {
    for (const locale of LOCALES) {
      const t = makeT(locale);
      for (const key of Object.keys(tr) as TranslationKey[]) {
        expect(t(key), `${locale}:${key}`).not.toBe('');
      }
    }
  });
});

describe('i18n — locale çözümleme', () => {
  it('varsayılan locale Türkçedir', () => {
    expect(getLocale()).toBe('tr');
  });

  it('setLocale modül geneli locale’i değiştirir', () => {
    setLocale('de');
    expect(getLocale()).toBe('de');
  });

  it('resolveLocale "auto" ayarını sistem diline çevirir', () => {
    expect(resolveLocale('de')).toBe('de');
    expect(['tr', 'en', 'de', 'fr', 'es']).toContain(resolveLocale('auto'));
  });

  it('detectLocale yalnızca desteklenen dilleri döner', () => {
    expect(['tr', 'en', 'de', 'fr', 'es']).toContain(detectLocale());
  });

  it('her locale için meta verisi var', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_META[locale].htmlLang).toBe(locale);
      expect(LOCALE_META[locale].label.length).toBeGreaterThan(0);
    }
  });
});

describe('i18n — fallback', () => {
  it('bilinmeyen anahtar için anahtar adını döner', () => {
    expect(translate('yok.boyle.bir.anahtar' as TranslationKey, 'en')).toBe(
      'yok.boyle.bir.anahtar',
    );
  });

  it('çeviri fonksiyonu locale’e bağlıdır', () => {
    expect(translate('common.save', 'tr')).toBe('Kaydet');
    expect(translate('common.save', 'en')).toBe('Save');
    expect(translate('common.save', 'de')).toBe('Speichern');
    expect(translate('common.save', 'fr')).toBe('Enregistrer');
    expect(translate('common.save', 'es')).toBe('Guardar');
  });
});
