import { Channel, invoke } from '@tauri-apps/api/core';
import { isTauri as isTauriRuntime } from '../tauri';

/**
 * İş 2 — CSP `connect-src` bypass.
 *
 * `tauri.conf.json` içindeki `connect-src` yalnızca 6 AI API hostunu + localhost'u
 * listeler. Özel uç (`customEndpoints`), `baseUrlOverride` (Azure/OpenAI proxy) ve
 * uzak Ollama URL'leri bu listeye girmediği için WebView fetch'i **CSP tarafından
 * engellenir**. Bu modül engellenen hedefleri Rust `reqwest`'ine yönlendirir;
 * SSE gövdesi Channel ile WebView'e aktarılır ve gerçek bir `Response`'a
 * yeniden paketlenir — böylece sağlayıcı ayrıştırma kodu hiç değişmez.
 */

/**
 * CSP'deki `connect-src` host listesi. **`src-tauri/tauri.conf.json` ile senkron
 * tutulmalı** — oraya host eklenirse buraya da eklenmelidir.
 */
export const CSP_CONNECT_HOSTS: readonly string[] = [
  'api.anthropic.com',
  'api.openai.com',
  'api.x.ai',
  'api.deepseek.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Bu hedef CSP `connect-src` dışında mı? (Değilse WebView fetch'i yeterlidir.) */
export function needsProxy(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (LOCAL_HOSTS.has(parsed.hostname)) return false;
  return !CSP_CONNECT_HOSTS.includes(parsed.hostname);
}

/**
 * Verilen URL için uygun fetch'i seçer.
 * - `injected` (test enjeksiyonu) her zaman kazanır.
 * - Tauri'de ve hedef CSP dışındaysa Rust proxy kullanılır.
 * - Aksi halde global fetch.
 */
export function fetchFor(url: string, injected?: typeof fetch): typeof fetch {
  if (injected) return injected;
  if (isTauriRuntime() && needsProxy(url)) return rustFetch;
  return globalThis.fetch;
}

type ProxyEvent =
  | { k: 'meta'; status: number; headers: Record<string, string> }
  | { k: 'data'; text: string }
  | { k: 'done' };

let nextRequestId = 1;

/** Basit async kuyruk (Rust Channel → ReadableStream köprüsü). */
class EventQueue<T> {
  private items: T[] = [];
  private ended = false;
  private failure: unknown = null;
  private waiters: Array<() => void> = [];

  push(v: T): void {
    this.items.push(v);
    this.wake();
  }
  close(): void {
    this.ended = true;
    this.wake();
  }
  fail(e: unknown): void {
    this.failure = e;
    this.ended = true;
    this.wake();
  }
  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }
  /** Kuyrukta öğe yoksa ve kapanmadıysa bekler. Bitince `null`. */
  async next(): Promise<T | null> {
    for (;;) {
      if (this.items.length > 0) return this.items.shift() as T;
      if (this.failure) throw this.failure;
      if (this.ended) return null;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
}

/** Rust `proxy_fetch` üzerinden `fetch`-uyumlu istek atar. */
async function rustFetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();

  const headers: Array<[string, string]> = [];
  const raw = init?.headers;
  if (raw) {
    if (Array.isArray(raw)) {
      for (const [k, v] of raw) headers.push([k, String(v)]);
    } else if (raw instanceof Headers) {
      raw.forEach((v, k) => headers.push([k, v]));
    } else {
      for (const [k, v] of Object.entries(raw)) headers.push([k, String(v)]);
    }
  }

  const body =
    init?.body == null
      ? null
      : typeof init.body === 'string'
        ? init.body
        : String(init.body);

  const id = nextRequestId++;
  const queue = new EventQueue<string>();
  // Ref objesi: TS, closure içinde atanan `let`'i `await` sonrası daraltmayı sürdüremez.
  const ref: { meta: { status: number; headers: Record<string, string> } | null } = {
    meta: null,
  };
  let resolveMeta: () => void = () => {};
  const metaReady = new Promise<void>((r) => {
    resolveMeta = r;
  });

  const channel = new Channel<ProxyEvent>((ev) => {
    if (ev.k === 'meta') {
      ref.meta = { status: ev.status, headers: ev.headers };
      resolveMeta();
    } else if (ev.k === 'done') {
      queue.close();
      resolveMeta();
    } else {
      queue.push(ev.text);
    }
  });

  const running = invoke('proxy_fetch', { id, url, method, headers, body, on_data: channel })
    .then(() => {
      queue.close();
      resolveMeta();
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      queue.fail(new TypeError(msg));
      resolveMeta();
    });

  // Faz 7 A5: abort sinyali proxy'ye de yansıtılır. `init.signal` yok sayılırsa
  // çağıranın timeout'u (örn. MCP transport'un 15 sn sınırı) işlemez ve istek
  // Rust tarafında sonsuza kadar asılı kalır.
  const signal = init?.signal;
  if (signal) {
    const onAbort = () => {
      void invoke('proxy_abort', { id }).catch(() => {});
      queue.fail(new DOMException('aborted', 'AbortError'));
      resolveMeta();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    void running.finally(() => signal.removeEventListener('abort', onAbort));
  }

  await metaReady;
  const meta = ref.meta;
  if (!meta) {
    // done/error meta'sız geldi: hatayı yüzeye çıkar.
    const err = await queue.next().catch((e: unknown) => e);
    throw err instanceof Error ? err : new TypeError('proxy: yanıt başlamadı');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await queue.next();
        if (chunk === null) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunk));
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      void invoke('proxy_abort', { id }).catch(() => {});
    },
  });

  // invoke'un bitişi stream'e bağlı; unutulan reddetmeyi engelle.
  void running.catch(() => {});

  return new Response(stream, {
    status: meta.status,
    statusText: '',
    headers: new Headers(meta.headers),
  });
}

/** Tek örnek (kanal/istek kimliği üretimi paylaşılmaz, ama stateless yeterli). */
export const rustFetch: typeof fetch = rustFetchImpl as typeof fetch;
