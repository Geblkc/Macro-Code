/**
 * Faz 10 — gözlemlenebilirlik (log kanalı).
 *
 * Kod tabanında `console.*` çağrısı yoktu; bir sorun olduğunda terminalde
 * yalnızca "✗ ..." satırı görülüyordu, bağlam (hangi istek, hangi model,
 * kaç tur, hangi hata) kayboluyordu.
 *
 * Bu modül:
 * - son N kaydı **hafızada** tutar (`/log` komutuyla görüntülenir),
 * - WebView konsoluna da yazar (devtools),
 * - **gizli değerleri redakte eder** (API anahtarı/token gibi alanlar asla
 *   loglanmaz — denetim raporundaki "console.* ile secret log'u yok" maddesi
 *   bozulmamalı).
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  event: string;
  data?: unknown;
}

const MAX_ENTRIES = 200;
const buffer: LogEntry[] = [];

/** Redakte edilecek alan adları. */
const SECRET_FIELD = /^(api[-_ ]?key|apikey|authorization|auth|token|secret|password|passwd|pwd|key|cookie|session)$/i;

/** Değer kalıbıyla redakte edilecek gizli diziler. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /xai-[A-Za-z0-9_-]{8,}/g,
  /gsk_[A-Za-z0-9_-]{8,}/g,
  /AIza[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
];

const REDACTED = '«redakte»';

/** Bir değeri redakte eder (özyinelemeli, derinlik sınırlı). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (typeof value === 'string') {
    let out = value;
    for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, REDACTED);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_FIELD.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Kayıt ekler (redakte edilmiş). */
export function log(level: LogLevel, event: string, data?: unknown): void {
  const entry: LogEntry = {
    ts: Date.now(),
    level,
    event,
    ...(data !== undefined ? { data: redact(data) } : {}),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  const line = `[${new Date(entry.ts).toISOString().slice(11, 23)}] ${level.toUpperCase()} ${event}`;
  try {
    if (level === 'error') console.error(line, entry.data ?? '');
    else if (level === 'warn') console.warn(line, entry.data ?? '');
    else console.info(line, entry.data ?? '');
  } catch {
    // Konsol yoksa yoksay (gizli hata üretmemek için).
  }
}

export const logInfo = (event: string, data?: unknown) => log('info', event, data);
export const logWarn = (event: string, data?: unknown) => log('warn', event, data);
export const logError = (event: string, data?: unknown) => log('error', event, data);

/** Son N kayıt (en yeni önce). */
export function recentLogs(n = 50): LogEntry[] {
  const count = Math.min(Math.max(n, 1), MAX_ENTRIES);
  return buffer.slice(-count).reverse();
}

/** Kayıt sayısı. */
export function logCount(): number {
  return buffer.length;
}

/** Testler için temizle. */
export function clearLogs(): void {
  buffer.length = 0;
}
