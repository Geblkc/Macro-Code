import { useId } from 'react';
import type { Model } from '../types';

interface Props {
  value: string;
  /** Seçilebilir modeller (zaten filtrelenmiş). */
  models: Model[];
  onChange: (id: string) => void;
  placeholder?: string;
  /** Boş seçim etiketi (boş bırakılırsa seçim zorunlu). */
  emptyLabel?: string;
  /** Seçili model listede yoksa da gösterilir. */
  extraValue?: string;
  id?: string;
}

/**
 * Arama yapılabilir model seçici.
 *
 * Tarayıcının yerel `datalist` combo'su kullanılır: 500+ modelde native
 * `<select>` kullanılamaz duruma düşer, datalist ise yazarken filtreler.
 */
export default function ModelPicker({
  value,
  models,
  onChange,
  placeholder,
  emptyLabel,
  extraValue,
  id,
}: Props) {
  const listId = useId();
  const extra = extraValue && extraValue !== value ? extraValue : null;

  return (
    <>
      <input
        id={id}
        className="input"
        list={listId}
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {extra ? <option value={extra}>{extra}</option> : null}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
