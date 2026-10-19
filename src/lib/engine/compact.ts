/**
 * Faz 2 — Compaction: bütçe aşıldığında eski mesajları özetle, yenileri koru.
 * Saf fonksiyonlar (LLM çağrısı `summarize` enjeksiyonuyla gelir).
 */
import type { Message } from '../../types';
import type { AgentHistoryItem } from './agent';
import { approxHistoryTokens, approxMessageTokens, type TokenCountable } from './tokens';

/** Bütçenin %75'i aşılınca compaction tetiklenir. */
export const COMPACTION_THRESHOLD = 0.75;

/** Özet mesajı içeriği en fazla bu kadar (döngüsel compaction önlemi). */
export const SUMMARY_MAX_CHARS = 2000;

/** Özetleyiciye verilen transcript en fazla bu kadar (kırpılmış). */
export const TRANSCRIPT_MAX_CHARS = 12_000;

export interface CompactInput<T extends AgentHistoryItem = AgentHistoryItem> {
  history: T[];
  budget: number;
  summarize: (transcript: string) => Promise<string>;
  /** Testte sabit tarih için. */
  nowTs?: number;
}

export function shouldCompact(history: TokenCountable[], budget: number): boolean {
  if (history.length === 0 || budget <= 0) return false;
  return approxHistoryTokens(history) > budget * COMPACTION_THRESHOLD;
}

/**
 * Compaction noktası: sondan `keepTokens` kadar tut, tool çiftini koparma.
 * Son mesaj her zaman korunur. Drop boşsa compaction anlamsızdır.
 */
export function splitAtCompactionPoint<T extends TokenCountable & { role: string; toolCallId?: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> }>(
  h: T[],
  keepTokens: number,
): { keep: T[]; drop: T[] } {
  if (h.length === 0) return { keep: [], drop: [] };
  let total = 0;
  let start = h.length - 1;
  // Son mesaj daima keep'te.
  for (let i = h.length - 1; i >= 0; i--) {
    total += approxMessageTokens(h[i]);
    start = i;
    if (total >= keepTokens && i > 0) {
      start = i;
      break;
    }
    if (i === 0) {
      start = 0;
      break;
    }
  }
  let keep = h.slice(start);
  let drop = h.slice(0, start);
  // Tool çifti kopmasın: keep'in başı tool sonucuysa, eşleşen assistant'ı da al.
  if (keep.length > 0 && drop.length > 0) {
    const first = keep[0];
    if ((first.role === 'tool' || first.role === 'system') && first.toolCallId) {
      const prev = drop[drop.length - 1];
      if (
        prev.role === 'assistant' &&
        prev.toolCalls?.some((c) => c.id === first.toolCallId)
      ) {
        keep = [prev, ...keep];
        drop = drop.slice(0, -1);
      }
    }
  }
  // Drop boşsa compaction anlamsız (tek dev mesaj) — olduğu gibi bırak.
  if (drop.length === 0) return { keep: [...h], drop: [] };
  return { keep, drop };
}

function formatDropped(m: AgentHistoryItem): string {
  const head = `[${m.role}] ${(m.content ?? '').slice(0, 200)}`;
  if (!m.toolCalls?.length) return head;
  const calls = m.toolCalls
    .map((c) => `tool ▸ ${c.name} ${JSON.stringify(c.args ?? {}).slice(0, 200)}`)
    .join('\n');
  return `${head}\n${calls}`;
}

export function buildTranscript(history: AgentHistoryItem[]): string {
  const full = history.map(formatDropped).join('\n');
  if (full.length <= TRANSCRIPT_MAX_CHARS) return full;
  return `${full.slice(0, TRANSCRIPT_MAX_CHARS)}\n…[transcript kesildi]`;
}

export function buildSummaryContent(summary: string, nowTs: number): string {
  const d = new Date(nowTs);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `[özet · ${stamp}] ${summary.slice(0, SUMMARY_MAX_CHARS)}`;
}

/**
 * Geçmişi özetle: eski mesajlar özet + son mesajlar korunur.
 * Eşik altındaysa (veya drop boşsa) geçmiş aynen döner.
 */
export async function compactHistory<T extends AgentHistoryItem>(
  input: CompactInput<T>,
): Promise<T[]> {
  const { history, budget, summarize, nowTs = Date.now() } = input;
  if (!shouldCompact(history, budget)) return history;
  // keep: bütçenin ~%50'si (özet + yanıt payı korunur).
  const { keep, drop } = splitAtCompactionPoint(history, Math.floor(budget * 0.5));
  if (drop.length === 0) return history;
  const summary = (await summarize(buildTranscript(drop))).trim();
  if (!summary) return history;
  const summaryMsg = {
    role: 'system',
    content: buildSummaryContent(summary, nowTs),
  } as T;
  return [summaryMsg, ...keep];
}

/** Kalıcı `/compact`: Message dizisini özetle (özet başa eklenir, yeniler korunur). */
export async function compactSessionMessages(
  messages: Message[],
  budget: number,
  summarize: (transcript: string) => Promise<string>,
  nowTs: number = Date.now(),
): Promise<{ messages: Message[]; dropped: number; kept: number }> {
  const history: AgentHistoryItem[] = messages.map((m) => ({
    role: m.role === 'system' && m.toolCallId ? 'tool' : m.role,
    content: m.content,
    ...(m.images?.length ? { images: [...m.images] } : {}),
    ...(m.toolCalls?.length ? { toolCalls: m.toolCalls.map((c) => ({ ...c })) } : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId, toolName: m.toolName } : {}),
    ...(m.isError !== undefined ? { isError: m.isError } : {}),
  }));
  if (!shouldCompact(history, budget)) {
    return { messages, dropped: 0, kept: messages.length };
  }
  const { keep, drop } = splitAtCompactionPoint(history, Math.floor(budget * 0.5));
  if (drop.length === 0) return { messages, dropped: 0, kept: messages.length };
  const summary = (await summarize(buildTranscript(drop))).trim();
  if (!summary) return { messages, dropped: 0, kept: messages.length };
  const keptCount = keep.length;
  // Orijinal id/timestamp'leri koru: sondan keptCount mesaj aynen alınır.
  // (keep ile tail aynı uzunluktadır; tool çifti düzeltmesi ±1 oynayabilir,
  //  tail yine de kronolojik son mesajlardır.)
  const tail = messages.slice(messages.length - keptCount);
  const summaryMsg: Message = {
    id: `summary-${nowTs}`,
    role: 'system',
    content: buildSummaryContent(summary, nowTs),
    timestamp: nowTs,
  };
  return { messages: [summaryMsg, ...tail], dropped: messages.length - tail.length, kept: tail.length };
}
