/**
 * Sekme/alt-seme klavye navigasyonu (saf fonksiyon).
 *
 * Hem ayarlar modalının sekme rayı hem de iç alt sekmeler (segmented)
 * aynı kuralı kullanır: ↑↓ / ←→ bir sonraki/önceki öğeye, `Home` başa,
 * `End` sona gider. İş yoksa `-1` döner (ör. `Tab`, `Enter`).
 */
export function nextTabIndex(key: string, index: number, count: number): number {
  if (count <= 0 || index < 0) return -1;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}
