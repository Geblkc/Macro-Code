import type { Model, ModelParams, Provider } from '../../types';
import type { ToolCall, ToolDefinition, UsageLike } from '../engine/types';
import { t } from '../i18n/core';

export type { UsageLike };

export interface TokenUsage {
  input: number;
  output: number;
  /** Faz 4: reasoning/thinking tokenleri (output'a dahil değildir, maliyete dahildir). */
  reasoning?: number;
  /** Önbellekten okunan prompt tokenları (input'un içinde sayılır). */
  cacheRead?: number;
  /** Önbelleğe yazılan prompt tokenları (input'un içinde sayılır). */
  cacheWrite?: number;
}

/**
 * İstek başına maksimum çıktı token tavanı (maliyet güvencesi).
 * Provider registry'leri 64k–128k `maxOutput` reklam eder; istekte hepsi bu
 * değere kırpılır. Tek kaynak: anthropic / openai-uyumlu / gemini aynı sabiti
 * kullanır (Gemini'de eskiden tavan yoktu — 65k/131k aynen gidiyordu).
 * Kullanıcının `maxTokens` girdisi de bu tavana tabidir.
 */
export const MAX_OUTPUT_TOKEN_CAP = 16384;

/** Yerel modellerde ek tavan (Ollama `num_predict`). */
export const OLLAMA_MAX_OUTPUT_CAP = 8192;

/** Anthropic extended-thinking bloğu (imzalı; tool_use öncesi aynen geri gönderilir). */
export interface ThinkingBlock {
  thinking: string;
  signature: string;
}

export interface ChatItem {
  role: string;
  content: string;
  /** Mesajın zaman damgası (compaction hafızası: yeni mesajları ayırmak için). */
  ts?: number;
  /** Kaynak mesajın id'si (compaction hafızası: id tabanlı kesim). */
  id?: string;
  /** Ekli görseller (data URL). Sadece user mesajlarında olur. */
  images?: string[];
  /** Modelin yaptığı araç çağrıları (role: 'assistant' iken) */
  toolCalls?: ToolCall[];
  /** Aracın id'si (role: 'tool' iken) */
  toolCallId?: string;
  /** Aracın adı (role: 'tool' iken) */
  toolName?: string;
  /** Araç hatası bayrağı (role: 'tool' iken) */
  isError?: boolean;
  /** Faz 4: imzalı thinking blokları (role: 'assistant' iken, geri gönderim için). */
  thinking?: ThinkingBlock[];
}

export interface StreamChunk {
  text: string;
  done: boolean;
  error?: string;
  usage?: TokenUsage;
  /** Araç çağrıları (birikmiş final liste). Varsa agent loop çalışır. */
  toolCalls?: ToolCall[];
  /** Faz 4: reasoning/thinking metni (dim blokta gösterilir, kalıcı değildir). */
  reasoning?: string;
  /** Faz 4: turun imzalı thinking blokları (final, geçmişe yazılır). */
  thinking?: ThinkingBlock[];
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  messages: ChatItem[];
  onChunk: (chunk: StreamChunk) => void;
  signal?: AbortSignal;
  /** Testler icin enjekte edilebilir fetch. Uretimde global fetch. */
  fetchImpl?: typeof fetch;
  /** Taban URL: Ollama'da zorunlu (apiKey URL taşır); OpenAI-uyumlularda
   *  ayarlardaki özel URL override'ı (boşsa fabrika URL'si kullanılır). */
  baseUrl?: string;
  /** Varsa tool-calling aktif olur (Faz A). Boş/undefined = eski text-only akış. */
  tools?: ToolDefinition[];
  /** Model başına istek parametreleri (saf `sanitizeParams` çıktısı verilir). */
  params?: ModelParams;
  /**
   * Faz 11: prompt cache (önbellek) açık mı?
   * `false` ise sağlayıcı `cache_control` / `prompt_cache_key` göndermez
   * (varsayılan: açık — token maliyetini düşürür).
   */
  cachePrompts?: boolean;
  /**
   * Faz 11: OpenAI-uyumlu sağlayıcılar için önbellek anahtarı (oturuma bağlı).
   */
  promptCacheKey?: string;
  /**
   * İş 3 — arama listesi: registry + kullanıcının eklediği modeller
   * (`resolveModels(customModels)`). Verilmezse sağlayıcının kendi sabit
   * `MODELS` dizisi kullanılır. `maxOutput` / `capabilities` kararları buradan
   * alınır; aksi halde özel model 4096 token + toolsuz + thinking'siz çalışır.
   */
  registry?: Model[];
}

export interface AIProvider {
  name: Provider;
  models: Model[];
  stream: (config: ProviderConfig) => Promise<void>;
  validateKey: (key: string, fetchImpl?: typeof fetch) => Promise<boolean>;
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/** HTTP hatalarini ProviderError'a cevirir (body okumaya calisir, basarisizsa kodu kullanir). */
export async function throwIfHttpError(res: Response): Promise<void> {
  if (res.ok) return;
  const status = res.status;
  let detail = '';
  try {
    const text = await res.text();
    detail = text.slice(0, 300);
  } catch {
    // Govde okunamazsa sadece kodu kullan.
  }
  throw new ProviderError(detail || `http ${status}`, status);
}

/**
 * SSE / satir-bazli JSON akislarini okur.
 * - `data: {...}` satirlari (OpenAI/Gemini/Anthropic)
 * - Ciplak `{...}` satirlari (Ollama)
 * Her payload icin onPayload cagrilir; `true` donerse akis durur.
 */
export async function feedSSELines(
  body: ReadableStream<Uint8Array> | null,
  onPayload: (payload: string) => boolean | void,
  signal?: AbortSignal,
): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);
  let buf = '';
  let stopped = false;

  const pumpLine = (line: string) => {
    if (stopped) return;
    const t = line.trim();
    if (!t || t.startsWith(':') || t.startsWith('event:')) return;
    let payload: string | null = null;
    if (t.startsWith('data:')) payload = t.slice(5).replace(/^ /, '');
    else if (t.startsWith('{')) payload = t;
    if (payload === null) return;
    if (payload === '[DONE]') {
      stopped = true;
      return;
    }
    if (onPayload(payload) === true) stopped = true;
  };

  try {
    for (;;) {
      if (signal?.aborted || stopped) break;
      const { done, value } = await reader.read();
      if (value) {
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          pumpLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (stopped) break;
        }
      }
      if (done) break;
    }
    buf += decoder.decode();
    if (buf.trim() && !stopped) {
      for (const line of buf.split('\n')) pumpLine(line);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function safeJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Sayisal alani guvenli inte cevirir (negatif/NaN -> 0). */
export function toUsageCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.floor(v);
  return n > 0 ? n : 0;
}

/** Gecerli bir usage yoksa `undefined` doner (bos chunk gonderilmez). */
export function toUsage(
  input: unknown,
  output: unknown,
  reasoning?: unknown,
  cacheRead?: unknown,
  cacheWrite?: unknown,
): TokenUsage | undefined {
  const i = toUsageCount(input);
  const o = toUsageCount(output);
  const r = toUsageCount(reasoning);
  const cr = toUsageCount(cacheRead);
  const cw = toUsageCount(cacheWrite);
  if (i === 0 && o === 0 && r === 0) return undefined;
  const out: TokenUsage = { input: i, output: o };
  if (r > 0) out.reasoning = r;
  if (cr > 0) out.cacheRead = cr;
  if (cw > 0) out.cacheWrite = cw;
  return out;
}

/** Usage birleştirme (kümülatif event'ler max ile birleşir; reasoning de korunur). */
export function mergeUsage(
  prev: { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } | null | undefined,
  next: TokenUsage,
): { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } {
  const merged = {
    input: Math.max(prev?.input ?? 0, next.input),
    output: Math.max(prev?.output ?? 0, next.output),
  };
  const r = Math.max(prev?.reasoning ?? 0, next.reasoning ?? 0);
  const cr = Math.max(prev?.cacheRead ?? 0, next.cacheRead ?? 0);
  const cw = Math.max(prev?.cacheWrite ?? 0, next.cacheWrite ?? 0);
  return {
    ...merged,
    ...(r > 0 ? { reasoning: r } : {}),
    ...(cr > 0 ? { cacheRead: cr } : {}),
    ...(cw > 0 ? { cacheWrite: cw } : {}),
  };
}

/**
 * Faz 7 A2: sistem rolü mesajların metnini birleştirir.
 *
 * Compaction özeti (`compact.ts` → `role: 'system'`) ve kalıcı sistem mesajları
 * sağlayıcı API'lerinde "system" alanına taşınmalıdır; Anthropic `messages`
 * içinde `system` rolünü **kabul etmez** ve mesaj sessizce düşerdi.
 */
export function systemTextOf(messages: ChatItem[]): string {
  return messages
    .filter((m) => m.role === 'system' && m.content.trim().length > 0)
    .map((m) => m.content.trim())
    .join('\n\n');
}

/** Sistem rolü mesajları ayıklanmış mesaj listesi (yanıt dizisi). */
export function withoutSystemMessages(messages: ChatItem[]): ChatItem[] {
  return messages.filter((m) => m.role !== 'system');
}

/**
 * Faz 7 A4: iki turun kullanımını **topla**.
 *
 * `mergeUsage` bir *isteğin içindeki* kümülatif usage event'leri için doğrudur
 * (Anthropic `message_delta.output_tokens` kümülatiftir). Ancak agent döngüsünde
 * her tur ayrı bir *istektir* — turlar arasında `max` kullanmak toplamı
 * "en büyük tur"a indiriyor ve maliyet telemetrisini eksik hesaplıyordu.
 */
export function sumUsage(
  prev: UsageLike | null | undefined,
  next: UsageLike | null | undefined,
): UsageLike | undefined {
  if (!prev && !next) return undefined;
  const input = (prev?.input ?? 0) + (next?.input ?? 0);
  const output = (prev?.output ?? 0) + (next?.output ?? 0);
  const reasoning = (prev?.reasoning ?? 0) + (next?.reasoning ?? 0);
  const cacheRead = (prev?.cacheRead ?? 0) + (next?.cacheRead ?? 0);
  const cacheWrite = (prev?.cacheWrite ?? 0) + (next?.cacheWrite ?? 0);
  if (input === 0 && output === 0 && reasoning === 0 && cacheRead === 0 && cacheWrite === 0) {
    return undefined;
  }
  return {
    input,
    output,
    ...(reasoning > 0 ? { reasoning } : {}),
    ...(cacheRead > 0 ? { cacheRead } : {}),
    ...(cacheWrite > 0 ? { cacheWrite } : {}),
  };
}

/**
 * İş 3 — model kaydı arama: `registry` (registry + özel modeller) varsa ondan,
 * yoksa sağlayıcının kendi sabit listesinden. `maxOutput` / `capabilities`
 * kararları bu fonksiyondan geçer; aksi halde kullanıcı eklediği model
 * sağlayıcı listesinde bulunamayıp 4096 token + toolsuz + thinking'siz kalır.
 */
export function lookupModel(
  id: string,
  registry: Model[] | undefined,
  fallback: Model[],
): Model | undefined {
  return (registry ?? fallback).find((m) => m.id === id);
}

export function parseJsonPayload(payload: string): Record<string, unknown> | null {
  const v = safeJson(payload);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/** `data:<mime>;base64,<veri>` → { mime, data }. Bozuksa null. */
export function parseDataUrl(url: string): { mime: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url.trim());
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

/**
 * Yakalanan hatayi terminal `err` satirina cevirir.
 * Abort icin `null` doner (sessiz cikis — err satiri yazilmaz).
 */
export function formatProviderError(err: unknown): string | null {
  if (err && typeof err === 'object') {
    const name = (err as { name?: string }).name;
    if (name === 'AbortError') return null;
  }
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return null;
  }
  if (err instanceof ProviderError) {
    const s = err.status ?? 0;
    if (s === 401 || s === 403) {
      return t('errors.apiKeyInvalid');
    }
    if (s === 429) {
      return t('errors.rateLimit');
    }
    if (s === 400 || s === 413) {
      const d = err.message.toLowerCase();
      if (d.includes('context') || d.includes('token') || d.includes('length') || d.includes('maximum')) {
        return t('errors.contextLimit');
      }
      return t('errors.requestFailed', { status: s, message: err.message });
    }
    if (s >= 500) {
      return t('errors.serverFailed', { status: s });
    }
    if (s > 0) {
      return t('errors.apiFailed', { status: s, message: err.message });
    }
  }
  if (err instanceof TypeError) {
    return t('errors.network');
  }
  const msg = err instanceof Error ? err.message : String(err);
  return t('errors.unknown', { message: msg });
}

/** Faz 1 G6 (K8): retry+backoff. Yalnızca 429/≥500 ProviderError ve TypeError retry eder. */
export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  /** Testte gerçek beklemeyi kapatmak için. */
  sleepImpl?: (ms: number) => Promise<void>;
}

function isAbortErr(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const n = (e as { name?: string }).name;
  return n === 'AbortError';
}

function isRetryable(e: unknown): boolean {
  if (isAbortErr(e)) return false;
  if (e instanceof ProviderError) {
    const s = e.status ?? 0;
    return s === 429 || s >= 500;
  }
  return e instanceof TypeError;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseMs = opts.baseMs ?? 400;
  const maxMs = opts.maxMs ?? 4000;
  const sleep = opts.sleepImpl ?? defaultSleep;
  let last: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      last = e;
      if (attempt >= retries || !isRetryable(e)) throw e;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 250);
      await sleep(Math.min(maxMs, backoff + jitter));
    }
  }
  throw last;
}
