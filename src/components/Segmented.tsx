import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { nextTabIndex } from '../lib/tabNav';
import { Icon, type IconName } from './icons';

export interface SegmentedItem {
  id: string;
  label: string;
  icon?: IconName;
}

interface Props {
  items: SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  /** Erişilebilirlik etiketi (ekran okuyucu). */
  ariaLabel: string;
}

/**
 * Yatay alt sekme kontrolü (segmented control).
 *
 * Aynı klavye kuralını kullanır: ↑↓ / ←→ bir sonraki/önceki öğeye,
 * `Home`/`End` başa/sona gider. Odak seçili öğeden başlar (roving tabindex).
 */
export default function Segmented({ items, value, onChange, ariaLabel }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleKeyDown = (e: ReactKeyboardEvent, id: string) => {
    const idx = items.findIndex((i) => i.id === id);
    const next = nextTabIndex(e.key, idx, items.length);
    if (next < 0) return;
    e.preventDefault();
    const target = items[next];
    onChange(target.id);
    refs.current[target.id]?.focus();
  };

  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          className={`seg-btn${value === item.id ? ' active' : ''}`}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => handleKeyDown(e, item.id)}
          ref={(el) => {
            refs.current[item.id] = el;
          }}
        >
          {item.icon ? <Icon name={item.icon} size="sm" /> : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}
