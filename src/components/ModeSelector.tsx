import { useState, useRef, useEffect } from 'react';
import type { AgentMode } from '../types';
import { useT } from '../lib/i18n';
import { Icon, type IconName } from './icons';

interface Props {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

const MODES: Array<{
  id: AgentMode;
  labelKey: 'mode.build' | 'mode.plan' | 'mode.ask';
  descKey: 'mode.buildDesc' | 'mode.planDesc' | 'mode.askDesc';
  icon: IconName;
}> = [
  { id: 'build', labelKey: 'mode.build', descKey: 'mode.buildDesc', icon: 'wrench' },
  { id: 'plan', labelKey: 'mode.plan', descKey: 'mode.planDesc', icon: 'list-checks' },
  { id: 'ask', labelKey: 'mode.ask', descKey: 'mode.askDesc', icon: 'message' },
];

export default function ModeSelector({ mode, onChange, disabled }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mode-selector-anchor" ref={ref}>
      <button
        type="button"
        className={`mode-badge mode-${active.id}${open ? ' open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={t(active.descKey)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon name={active.icon} size="sm" />
        <span className="mode-badge-label">{t(active.labelKey)}</span>
        <Icon name="chevron-down" size="sm" />
      </button>

      {open && (
        <div className="mode-dropdown" role="listbox">
          <div className="mode-dropdown-header">{t('commands.desc.mode')}</div>
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === mode}
              className={`mode-option${item.id === mode ? ' active' : ''}`}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
            >
              <span className={`mode-option-icon mode-${item.id}`}>
                <Icon name={item.icon} size="sm" />
              </span>
              <div className="mode-option-text">
                <span className="mode-option-title">{t(item.labelKey)}</span>
                <span className="mode-option-desc">{t(item.descKey)}</span>
              </div>
              {item.id === mode && (
                <span className="mode-option-check">
                  <Icon name="check" size="sm" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
