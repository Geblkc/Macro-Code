import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useSettingsStore } from '../store/settings';
import { getModel } from '../lib/providers';
import { effortValuesForModel, normalizeEffort, reasoningModeForModel } from '../lib/providers/effort';
import type { ReasoningMode } from '../lib/providers/effort';
import { useT } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n/locales/tr';
import { Icon } from './icons';

/** Katalogdan gelen efor değerlerinin görünen adları; bilinmeyenler ham kalır. */
const EFFORT_LABEL_KEYS: Record<string, TranslationKey> = {
  minimal: 'effort.value.minimal',
  low: 'effort.value.low',
  medium: 'effort.value.medium',
  high: 'effort.value.high',
  xhigh: 'effort.value.xhigh',
};

interface Props {
  /** Kontrollü açılış (InputBar `/effort` komutundan açar). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Menü kapandıktan sonra odağı geri vermek için (giriş alanı). */
  onDone?: () => void;
  disabled?: boolean;
}

/**
 * Model eforu rozeti — build/plan/ask mod rozetinin solunda durur.
 * Seçim `settings.modelParams[model].reasoningEffort` içinde model bazında
 * saklanır; model değişince o modelin eforu görünür.
 */
export default function EffortSelector({ open: openProp, onOpenChange, onDone, disabled }: Props) {
  const t = useT();
  // Yalnız aktif oturumun model adına abone ol (her stream tokenında re-render yok).
  const sessionModel = useSessionStore(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.model ?? '',
  );
  const currentModel = useSettingsStore((s) => s.currentModel);
  const customModels = useSettingsStore((s) => s.customModels);
  const modelParams = useSettingsStore((s) => s.modelParams);
  const setModelParams = useSettingsStore((s) => s.setModelParams);

  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;

  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const model = sessionModel || currentModel;
  const meta = useMemo(() => getModel(model, customModels), [model, customModels]);
  const mode: ReasoningMode = useMemo(() => reasoningModeForModel(meta), [meta]);
  const values = useMemo(() => effortValuesForModel(meta), [meta]);
  const combined = useMemo(
    () =>
      !!meta?.reasoningOptions?.some((o) => o.type === 'toggle') &&
      !!meta?.reasoningOptions?.some((o) => o.type === 'effort'),
    [meta],
  );
  const supported = mode !== 'none';
  const selected = normalizeEffort(modelParams[model]?.reasoningEffort) ?? '';
  const enabled = modelParams[model]?.reasoningEnabled;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInnerOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const choose = useCallback(
    (value: string) => {
      const next = { ...(modelParams[model] ?? {}) };
      if (mode === 'toggle') {
        delete next.reasoningEffort;
        if (value === 'on') next.reasoningEnabled = true;
        else if (value === 'off') next.reasoningEnabled = false;
        else delete next.reasoningEnabled;
      } else if (mode === 'effort') {
        if (combined) {
          if (value === 'off') {
            delete next.reasoningEffort;
            next.reasoningEnabled = false;
          } else if (value === '') {
            delete next.reasoningEffort;
            delete next.reasoningEnabled;
          } else {
            delete next.reasoningEnabled;
            next.reasoningEffort = value;
          }
        } else {
          delete next.reasoningEnabled;
          if (value) next.reasoningEffort = value;
          else delete next.reasoningEffort;
        }
      }
      setModelParams(model, next);
      setOpen(false);
      if (onDone) onDone();
      else triggerRef.current?.focus();
    },
    [model, modelParams, setModelParams, setOpen, onDone, mode],
  );

  // Dış tıklama + Esc: menüyü kapat (Esc'te giriş alanına odak döner).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        if (onDone) onDone();
        else triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen, onDone]);

  // Açılınca seçili satıra (yoksa ilk satıra) odaklan.
  useEffect(() => {
    if (!open) return;
    let focusIdx = 0;
    if (mode === 'toggle') {
      focusIdx = enabled === true ? 1 : enabled === false ? 2 : 0;
    } else if (combined && enabled === false) {
      // Birleşik modda "off" satırı 1. sıradadır.
      focusIdx = 1;
    } else if (selected) {
      const i = values.indexOf(selected);
      // Birleşik modda efor satırları auto+off'tan sonra başlar.
      if (i >= 0) focusIdx = i + (combined ? 2 : 1);
    }
    optionRefs.current[focusIdx]?.focus();
    // Yalnız açılışta odaklan; seçim/odak değişiminde yeniden zorlamayız.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onOptionKey = (e: React.KeyboardEvent, index: number, total: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      optionRefs.current[Math.min(index + 1, total - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      optionRefs.current[Math.max(index - 1, 0)]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      optionRefs.current[total - 1]?.focus();
    }
  };

  const effortText = (v: string): string => {
    const key = EFFORT_LABEL_KEYS[v];
    return key ? t(key) : v;
  };

  let label = t('common.dash');
  if (mode === 'fixed') label = t('effort.fixedOn');
  else if (mode === 'toggle') {
    label =
      enabled === true
        ? t('effort.on')
        : enabled === false
          ? t('effort.off')
          : t('effort.auto');
  } else if (mode === 'effort') {
    if (combined && enabled === false) label = t('effort.off');
    else label = selected ? effortText(selected) : t('effort.auto');
  }
  const title = supported ? t('effort.title') : t('effort.unsupported');

  return (
    <div className="effort-selector-anchor" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={`effort-badge${selected ? ' effort-set' : ''}${open ? ' open' : ''}${
          supported ? '' : ' effort-unsupported-badge'
        }`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('effort.title')}: ${label}`}
      >
        <Icon name="spark" size="sm" />
        <span className="effort-badge-label">{label}</span>
        <Icon name="chevron-down" size="sm" />
      </button>

      {open && (
        <div className="effort-dropdown" role="listbox" aria-label={t('effort.title')}>
          <div className="effort-dropdown-header">{t('effort.title')}</div>
          {mode === 'none' ? (
            <div className="effort-unsupported">{t('effort.unsupported')}</div>
          ) : mode === 'fixed' ? (
            <div className="effort-unsupported">{t('effort.fixedOnHint')}</div>
          ) : mode === 'toggle' ? (
            <>
              {(['auto', 'on', 'off'] as const).map((v, i) => {
                const isActive =
                  v === 'auto' ? enabled === undefined : v === 'on' ? enabled === true : enabled === false;
                const chooseValue = v === 'auto' ? '' : v;
                return (
                  <button
                    key={v}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`effort-option${isActive ? ' active' : ''}`}
                    onClick={() => choose(chooseValue)}
                    onKeyDown={(e) => onOptionKey(e, i, 3)}
                  >
                    <span className="effort-option-icon">
                      <Icon name="activity" size="sm" />
                    </span>
                    <span className="effort-option-title">
                      {v === 'auto' ? t('effort.auto') : v === 'on' ? t('effort.on') : t('effort.off')}
                    </span>
                    {isActive && (
                      <span className="effort-option-check">
                        <Icon name="check" size="sm" />
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <button
                ref={(el) => {
                  optionRefs.current[0] = el;
                }}
                type="button"
                role="option"
                aria-selected={!combined ? !selected : (enabled === undefined && !selected)}
                className={`effort-option${(!combined && !selected) || (combined && enabled === undefined && !selected) ? ' active' : ''}`}
                onClick={() => choose('')}
                onKeyDown={(e) => onOptionKey(e, 0, values.length + (combined ? 2 : 1))}
              >
                <span className="effort-option-icon">
                  <Icon name="refresh" size="sm" />
                </span>
                <span className="effort-option-title">{t('effort.auto')}</span>
                {((!combined && !selected) || (combined && enabled === undefined && !selected)) && (
                  <span className="effort-option-check">
                    <Icon name="check" size="sm" />
                  </span>
                )}
              </button>
              {combined && (
                <button
                  ref={(el) => {
                    optionRefs.current[1] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={enabled === false}
                  className={`effort-option${enabled === false ? ' active' : ''}`}
                  onClick={() => choose('off')}
                  onKeyDown={(e) => onOptionKey(e, 1, values.length + 2)}
                >
                  <span className="effort-option-icon">
                    <Icon name="activity" size="sm" />
                  </span>
                  <span className="effort-option-title">{t('effort.off')}</span>
                  {enabled === false && (
                    <span className="effort-option-check">
                      <Icon name="check" size="sm" />
                    </span>
                  )}
                </button>
              )}
              {values.map((value, i) => (
                <button
                  key={value}
                  ref={(el) => {
                    optionRefs.current[i + (combined ? 2 : 1)] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={value === selected}
                  className={`effort-option${value === selected ? ' active' : ''}`}
                  onClick={() => choose(value)}
                  onKeyDown={(e) => onOptionKey(e, i + (combined ? 2 : 1), values.length + (combined ? 2 : 1))}
                >
                  <span className="effort-option-icon">
                    <Icon name="activity" size="sm" />
                  </span>
                  <span className="effort-option-title">{effortText(value)}</span>
                  {value === selected && (
                    <span className="effort-option-check">
                      <Icon name="check" size="sm" />
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
