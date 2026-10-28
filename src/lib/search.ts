/**
 * Konuşma içi arama — saf fonksiyonlar (UI'dan bağımsız, vitest'li).
 *
 * Kapsam satır bazlıdır: eşleşme, sorgunun satır metninde geçtiği satırlardır
 * (markdown kaynağı dahil — render edilmiş DOM aranmaz).
 */

export interface SearchItem {
  /** Satır çapası (mesaj id / extras id) — DOM `data-line-key` karşılığı. */
  key: string;
  text: string;
}

export interface SearchHit {
  key: string;
  /** Eşleşen satırın `items` içindeki sırası. */
  index: number;
}

/** Satır bazlı eşleşmeleri bulur. Boş/whitespace sorgu → []. */
export function findHits(items: SearchItem[], query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  return items.reduce<SearchHit[]>((acc, item, index) => {
    if (item.text.toLowerCase().includes(lower)) acc.push({ key: item.key, index });
    return acc;
  }, []);
}

/**
 * Eşleşmeler arasında tur navigasyonu: mevcut eşleşmeden `dir` kadar ileri,
 * listede döner (wrap-around). `current < 0` ise ilk/son eşleşme.
 */
export function stepHit(hits: SearchHit[], current: number, dir: 1 | -1): number {
  if (hits.length === 0) return -1;
  if (current < 0 || current >= hits.length) return dir === 1 ? 0 : hits.length - 1;
  return (current + dir + hits.length) % hits.length;
}
