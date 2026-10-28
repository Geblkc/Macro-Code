import { useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDER_DEFS, getCapabilitiesForModel } from '../lib/providers';
import type { Model, Provider } from '../types';
import { useT } from '../lib/i18n';
import { Icon, type IconName } from './icons';

interface Props {
  /** Panel açık mı (kontrollü — tetikleyici tüketiciye ait). */
  open: boolean;
  /** Panel kapanma isteği (backdrop / Esc / seçim sonrası). */
  onClose: () => void;
  /** Gösterilecek modeller — tüketici görünürluğu önceden süzer (disabled, anahtar vb.). */
  models: Model[];
  /** Anahtarı olmayan sağlıclar ("anahtar ekle" satırları). */
  locked?: Provider[];
  /** Aktif seçili model (vurgu + aria-selected). */
  activeModel?: string;
  /** Model seçildi (panel hemen kapanır). */
  onSelect: (m: Model) => void;
  /** Boş seçim satırı (ör. "aktif modeli kullan"). */
  clear?: { label: string; onSelect: () => void };
  /** Listede olmayan seçili değer satırı (bilinmeyen/özel model). */
  extra?: { id: string; label: string; onSelect: () => void };
  /** "anahtar ekle" satırı → ayarları aç (yoksa satır gösterilmez). */
  onOpenSettings?: () => void;
  /** Konum: `viewport` titlebar sabiti (varsayılan), `field` alan içi mutlak. */
  anchor?: 'viewport' | 'field';
}

const CAP_ICONS: {
  key: 'tools' | 'vision' | 'reasoning';
  icon: IconName;
  labelKey: 'titlebar.capTools' | 'titlebar.capVision' | 'titlebar.capReasoning';
}[] = [
  { key: 'tools', icon: 'wrench', labelKey: 'titlebar.capTools' },
  { key: 'vision', icon: 'eye', labelKey: 'titlebar.capVision' },
  { key: 'reasoning', icon: 'spark', labelKey: 'titlebar.capReasoning' },
];

/**
 * Faz 7: model açılır listesinin ORTAK paneli (eski Titlebar dropdown'ı).
 *
 * Arama + sağlayıcı gruplama + yetenek rozetleri + "anahtar ekle" satırı +
 * klavye gezinimi (oklar / Home / End / Enter / Esc) tek yerde yaşar.
 * Tetikleyici tüketicinin (Titlebar pill'i veya form alanı); panel her yerde
 * aynı davranışı verir. `models` listesini tüketici süzer (ör. anahtarı
 * olmayan sağlayıcı, devre dışı model).
 */
export default function ModelDropdown({
  open,
  onClose,
  models,
  locked,
  activeModel,
  onSelect,
  clear,
  extra,
  onOpenSettings,
  anchor = 'viewport',
}: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            (m.family ?? '').toLowerCase().includes(q),
        )
      : models;
    const map = new Map<string, Model[]>();
    for (const m of filtered) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return [...map.entries()];
  }, [models, query]);

  // Düz liste (klavye gezinmesi için).
  const flat = useMemo(() => groups.flatMap(([, ms]) => ms), [groups]);

  // Bilinmeyen değer satırı: listede yoksa görünür (tekrar satırı önlenir).
  const extraVisible = extra && !models.some((m) => m.id === extra.id) ? extra : null;

  // Panel açılınca arama kutusuna odaklan; kapanınca sıfırla.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  // İmleç görünür olduğunda listeye kaydır.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  if (!open) return null;

  // Klavye gezinimi panelin KENDİSİNDE (React baloncuğu): ayarlar modalındaki
  // Esc yalnız paneli kapatır (stopPropagation modalı kapatmaz) ve panel
  // dışındaki alanların ok tuşları ele geçirilmez.
  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(Math.max(0, flat.length - 1));
    } else if (e.key === 'Enter') {
      // Paneldeki butonlarda Enter'in native tıklaması devrede kalsın.
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const m = flat[cursor];
      if (m) {
        onSelect(m);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
  };

  return (
    <>
      <div className="dropdown-backdrop" onClick={onClose} />
      <div
        className={`model-dropdown${anchor === 'field' ? ' anchor-field' : ''}`}
        role="listbox"
        aria-label={t('titlebar.modelSelect')}
        onKeyDown={onPanelKeyDown}
      >
        <div className="model-search-row">
          <Icon name="search" size="sm" />
          <input
            ref={searchRef}
            className="model-search"
            type="text"
            placeholder={t('titlebar.searchPlaceholder')}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />
        </div>
        <div className="model-dropdown-list" ref={listRef}>
          {clear ? (
            <button
              className="model-item model-item-clear"
              onClick={() => {
                clear.onSelect();
                onClose();
              }}
            >
              <Icon name="x" size="sm" />
              {clear.label}
            </button>
          ) : null}
          {extraVisible ? (
            <button
              className="model-item model-item-extra"
              onClick={() => {
                extraVisible.onSelect();
                onClose();
              }}
            >
              <span className="mid">{extraVisible.label}</span>
            </button>
          ) : null}
          {groups.length === 0 ? (
            <div className="model-group-title">
              {query ? t('titlebar.noMatch') : t('titlebar.noVisible')}
            </div>
          ) : (
            groups.map(([p, ms]) => (
              <div key={p} className="model-group">
                <div className="model-group-title">
                  {PROVIDER_DEFS[p as Provider]?.label ?? p}
                </div>
                {ms.map((m) => {
                  const caps = getCapabilitiesForModel(m.id);
                  const idx = flat.indexOf(m);
                  return (
                    <button
                      key={m.id}
                      role="option"
                      aria-selected={m.id === activeModel}
                      data-idx={idx}
                      className={`model-item${m.id === activeModel ? ' active' : ''}${
                        idx === cursor ? ' cursor' : ''
                      }`}
                      title={m.description || m.name}
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => {
                        onSelect(m);
                        onClose();
                      }}
                    >
                      <span className="mid">{m.id}</span>
                      {caps ? (
                        <span className="cap">
                          {CAP_ICONS.map((c) => (
                            <span
                              key={c.key}
                              className={caps[c.key] ? 'on' : 'off'}
                              title={t(c.labelKey)}
                            >
                              <Icon name={c.icon} size="sm" />
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {locked && locked.length > 0 && onOpenSettings ? (
            <div className="model-group">
              <div className="model-group-title">{t('titlebar.lockedProviders')}</div>
              {locked.map((p) => (
                <button
                  key={p}
                  className="model-item model-item-lock"
                  title={t('titlebar.needKey', { provider: PROVIDER_DEFS[p as Provider]?.label ?? p })}
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  <Icon name="key" size="sm" />
                  {PROVIDER_DEFS[p as Provider]?.label ?? p} — {t('titlebar.addKey')}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
