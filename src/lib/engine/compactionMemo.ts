/**
 * Faz 7 A2/A4 — compaction hafızası.
 *
 * Otomatik compaction özeti **kalıcı katmana yazılmaz** (kullanıcı transcript'ini
 * sessizce değiştirmiş olmamak için). Bu, uzun oturumlarda her turda aynı
 * özetleme çağrısının tekrarlanması anlamına geliyordu (her tur +1 LLM çağrısı,
 * tüm transcript maliyetiyle).
 *
 * Çözüm: compaction sonucu **oturum başına bellekte** saklanır. Sonraki
 * gönderimlerde geçmiş, "özet + o özetten sonra eklenen mesajlar" olarak
 * kurulur — tekrar özetleme yapılmaz, transcript görünümü bozulmaz.
 *
 * `at` = özetleme anının zaman damgası; bundan sonraki mesajlar (timestamp >
 * at) memo'ya eklenir.
 */
export interface CompactionMemo<T> {
  /** Özetlemenin yapıldığı an (epoch ms) — yalnızca bilgi amaçlı. */
  at: number;
  /** Özetlenmiş geçmiş (özet mesajı + korunan mesajlar). */
  items: T[];
  /**
   * Özete dahil edilen mesajların id'leri (Faz 9 P9.5 — B3).
   * Zaman damgası kesimi "aynı milisaniyede oluşan mesaj" riski taşıyordu;
   * id kesimi kesin sonuç verir.
   */
  coveredIds?: string[];
}

const memos = new Map<string, CompactionMemo<unknown>>();

/** Oturumun son compaction hafızası (yoksa `undefined`). */
export function getMemo<T>(sessionId: string): CompactionMemo<T> | undefined {
  return memos.get(sessionId) as CompactionMemo<T> | undefined;
}

/** Oturum için compaction hafızası yaz. */
export function setMemo<T>(
  sessionId: string,
  at: number,
  items: T[],
  extra: { coveredIds?: string[] } = {},
): void {
  memos.set(sessionId, { at, items, ...extra });
}

/** Oturumun compaction hafızasını temizle (session silindi/yeni geçmiş). */
export function clearMemo(sessionId: string): void {
  memos.delete(sessionId);
}

/** Tüm hafızayı temizle (testler için). */
export function clearAllMemos(): void {
  memos.clear();
}

/**
 * Faz 12 B.6 — kalıcılık.
 *
 * Bellek içi hafıza restart'ta kaybolur → uzun oturum tam bağlamı yeniden kurar
 * ve **tekrar özetleme** yapar. Bu yüzden hafıza, oturumun JSON'unda
 * (`Session.compaction`) saklanan bir kopya ile birlikte tutulur.
 */
export type PersistedCompaction = {
  at: number;
  items: Array<{
    role: string;
    content: string;
    id?: string;
    ts?: number;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  }>;
  coveredIds?: string[];
};

/** Bellek içi hafızayı kalıcı (session) biçimine çevirir. */
export function memoToPersisted<T extends { role: string; content: string }>(
  memo: CompactionMemo<T>,
): PersistedCompaction {
  return {
    at: memo.at,
    coveredIds: memo.coveredIds ? [...memo.coveredIds] : undefined,
    items: memo.items.map((i) => {
      const it = i as unknown as {
        role: string;
        content: string;
        id?: string;
        ts?: number;
        toolCallId?: string;
        toolName?: string;
        isError?: boolean;
      };
      return {
        role: it.role,
        content: it.content,
        ...(it.id !== undefined ? { id: it.id } : {}),
        ...(it.ts !== undefined ? { ts: it.ts } : {}),
        ...(it.toolCallId !== undefined ? { toolCallId: it.toolCallId } : {}),
        ...(it.toolName !== undefined ? { toolName: it.toolName } : {}),
        ...(it.isError !== undefined ? { isError: it.isError } : {}),
      };
    }),
  };
}

/** Kalıcı (session) biçimini bellek içi hafızaya çevirir. */
export function memoFromPersisted<T>(form: PersistedCompaction): CompactionMemo<T> {
  return {
    at: form.at,
    items: form.items as unknown as T[],
    ...(form.coveredIds ? { coveredIds: [...form.coveredIds] } : {}),
  };
}

/**
 * Etkin hafıza: bellek içi kayıt varsa o, yoksa oturumdaki kalıcı kopya.
 * (Restart sonrası bellek boştur → kalıcı kopya kullanılır.)
 */
export function resolveMemo<T>(
  sessionId: string,
  persisted?: PersistedCompaction | null,
): CompactionMemo<T> | undefined {
  const mem = getMemo<T>(sessionId);
  if (mem) return mem;
  if (persisted) return memoFromPersisted<T>(persisted);
  return undefined;
}

/**
 * Hafızayı geçmişe uygula: "özet + özetten sonra eklenen öğeler".
 * Hafıza yoksa geçmiş olduğu gibi döner.
 *
 * **Faz 9 P9.5 (B3):** kesim artık **id** tabanlıdır. `coveredIds` doluysa o
 * mesajlar hariç tutulur (zaman damgası kesimindeki "aynı ms" riski yok).
 * `coveredIds` yoksa (eski hafıza) zaman damgası kesimine düşülür.
 */
export function applyMemo<T extends { ts?: number; id?: string }>(
  memo: CompactionMemo<T> | undefined,
  items: T[],
): T[] {
  if (!memo) return items;
  if (memo.coveredIds && memo.coveredIds.length >= 0 && memo.coveredIds.length > 0) {
    const covered = new Set(memo.coveredIds);
    return [...memo.items, ...items.filter((i) => !i.id || !covered.has(i.id))];
  }
  return [...memo.items, ...items.filter((i) => (i.ts ?? 0) > memo.at)];
}
