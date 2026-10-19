interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

/** Özel anahtar (native checkbox yerine). */
export default function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    />
  );
}
