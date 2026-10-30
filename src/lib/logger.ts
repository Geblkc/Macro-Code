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

/** Redakte edilecek alan adları — O7: segment-eşleşmeli. Eskiden
 *  tam-adı eşleştiği için `anthropic_api_key`, `newToken` gibi adlar kaçıyordu;
 *  artık snake/kebab/camelCase parçalarına ayrılıp secret-parça içerirse
 *  (örn. `api`, `key`, `token` …) alan redakte edilir ("keynote" gibi
 *  tam-parça olmayan adlar etkilenmez). */
const SECRET_PARTS = new Set([
  'api', 'apikey', 'key', 'token', 'secret', 'password', 'passwd', 'pwd',
  'authorization', 'auth', 'cookie', 'session', 'credential', 'credentials',
]);

/** Alan adı gizli mi? (`APIKey`, `api_key_v2`, `basicAuth …` yakalanır) */
function isSecretField(k: string): boolean {
  const parts = k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return parts.some((p) => SECRET_PARTS.has(p));
}

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
    // L6/L7: URL içindeki kullanıcı:parola ve sorgu parametresi anahtarları
    // da maskelenir (ör. `https://user:pass@host`, `?api_key=…`).
    out = out
      .replace(/(\bhttps?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1«redakte»@')
      .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&\s"'<>]+/gi, '$1«redakte»');
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretField(k) ? REDACTED : redact(v, depth + 1);
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
