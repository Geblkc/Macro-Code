/**
 * Faz 5 — HTTP/SSE MCP transport (WebView fetch).
 * Yanıt tek JSON ya da SSE akışı olabilir; eşleşen id'li mesaj alınır.
 */
import { McpError, parseResponse, isResponseLike } from '../protocol';
import type { McpTransport } from '../client';
import { fetchFor } from '../../../providers/rustFetch';
export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** O7 — HTTP gövde tavanı: hızlı uygulama sonsuz SSE akışı açamaz. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** O7 — gövdeyi bayt-sayarak sınırlı okur; tavan aşılırsa akış iptal edilir. */
async function readCappedBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // Gövde stream'i yoksa (polyfill/test fake'i) text() üzerinden denetlenir.
    const t = await res.text();
    if (t.length > MAX_BODY_BYTES) throw new McpError('mcp: yanıt gövdesi çok büyük');
    return t;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // iptal hatası yoksayılır
      }
      throw new McpError('mcp: yanıt gövdesi çok büyük');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Gövdeyi tek JSON-RPC yanıt metnine indirger (SSE `data:` satırları dahil). */
export function extractResponseText(body: string, id: number | string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return trimmed;
  // SSE: eşleşen id'li son data satırı.
  let fallback: string | null = null;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const v = JSON.parse(payload) as { id?: unknown; method?: unknown };
      if (isResponseLike(v) && v.id === id) return payload;
      fallback ??= payload;
    } catch {
      // bozuk satır atlanır
    }
  }
  if (fallback) return fallback;
  throw new McpError('mcp: yanıtta eşleşen mesaj yok');
}

/**
 * MCP HTTP transport'ın fetch seçimi.
 * - `injected` (test) her zaman kazanır.
 * - Tauri'de ve hedef CSP `connect-src` dışındaysa Rust `proxy_fetch` kullanılır.
 */
export function mcpFetchFor(url: string, injected?: typeof fetch): typeof fetch {
  return fetchFor(url, injected);
}

export function createHttpTransport(opts: HttpTransportOptions): McpTransport {
  // Faz 7 A5: `fetchFor` — CSP `connect-src` dışındaki uzak MCP origin'leri
  // Rust `proxy_fetch` köprüsüne düşer (diğer tüm ağ yollarıyla aynı davranış).
  const fetchImpl = mcpFetchFor(opts.url, opts.fetchImpl);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastId: number | string | null = null;
  let closed = false;
  // Gönderilen yanıtlar (HTTP istek/yanıt eşleşmesi `send` içinde tamamlanır).
  const pending: string[] = [];

  return {
    async send(messageText: string): Promise<void> {
      if (closed) throw new McpError('mcp: transport kapalı');
      try {
        const v = JSON.parse(messageText) as { id?: unknown };
        if (v && typeof v === 'object' && 'id' in v) {
          lastId = (v as { id: number | string }).id;
        }
      } catch {
        // id çıkarılamazsa ham gönderilir
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(opts.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(opts.headers ?? {}),
          },
          body: messageText,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new McpError(`mcp: http ${res.status}`);
        }
        const body = await readCappedBody(res);
        // Yanıtı sakla; read() teslim eder (SSE gövdesi dahil).
        pending.push(extractResponseText(body, lastId ?? 0));
      } catch (e) {
        if (e instanceof McpError) throw e;
        if (e instanceof DOMException && e.name === 'AbortError') {
          throw new McpError('mcp: http zaman aşımı');
        }
        throw new McpError(`mcp: ağ hatası: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        clearTimeout(timer);
      }
    },
    async read(): Promise<string> {
      const next = pending.shift();
      if (next === undefined) throw new McpError('mcp: okunacak yanıt yok');
      // Zarfsal doğrulama erken yapılır (id eşleşmesi client katmanında).
      parseResponse(next);
      return next;
    },
    async close(): Promise<void> {
      closed = true;
      pending.length = 0;
    },
  };
}
