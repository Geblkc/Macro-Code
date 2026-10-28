import { useState } from 'react';
import type { Model, Provider } from '../types';
import { Icon } from './icons';
import ModelDropdown from './ModelDropdown';

interface Props {
  value: string;
  /** Seçilebilir modeller (zaten filtrelenmiş). */
  models: Model[];
  /** Anahtarı olmayan sağlıclar ("anahtar ekle" satırları). */
  locked?: Provider[];
  onChange: (id: string) => void;
  placeholder?: string;
  /** Boş seçim etiketi (boş bırakılırsa seçim zorunlu). */
  emptyLabel?: string;
  /** Seçili model listede yoksa da gösterilir. */
  extraValue?: string;
  /** Bilinmeyen değer satırının etiketi (varsayılan: değer kendisi). */
  extraLabel?: string;
  /** "anahtar ekle" satırı → ayarları/sekmeleri aç. */
  onOpenSettings?: () => void;
  id?: string;
}

/**
 * Arama yapılabilir model seçici (Faz 7).
 *
 * Native `datalist` yerine Titlebar ile **aynı** `ModelDropdown` panelini
 * kullanır: sağlayıcı gruplama, arama, yetenek rozetleri ve "anahtar ekle"
 * satırı her ortamda aynı davranışır. Tetikleyici form alanı görünümündedir.
 */
export default function ModelPicker({
  value,
  models,
  locked,
  onChange,
  placeholder,
  emptyLabel,
  extraValue,
  extraLabel,
  onOpenSettings,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const known = models.some((m) => m.id === value);
  // Bilinmeyen değer: çağrı verdiyse o, yoksa listede olmayan değer kendisi.
  const extra = extraValue || (value && !known ? value : null);

  return (
    <div className="model-field">
      <button
        type="button"
        id={id}
        className={`input model-field-btn${value ? '' : ' empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mval">{value || placeholder || emptyLabel || ''}</span>
        <Icon name="chevron-down" size="sm" />
      </button>
      <ModelDropdown
        open={open}
        onClose={() => setOpen(false)}
        anchor="field"
        models={models}
        locked={locked}
        activeModel={value}
        onSelect={(m) => onChange(m.id)}
        clear={
          emptyLabel !== undefined
            ? { label: emptyLabel, onSelect: () => onChange('') }
            : undefined
        }
        extra={
          extra
            ? { id: extra, label: extraLabel ?? extra, onSelect: () => onChange(extra) }
            : undefined
        }
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
