/**
 * Faz 5 — Transport bağımsız MCP istemcisi (initialize → tools/list → tools/call).
 */
import { APP_VERSION } from '../../appInfo';
import {
  MCP_PROTOCOL_VERSION,
  McpError,
  createNotification,
  createRequest,
  parseResponse,
  parseToolResult,
  parseToolsList,
  unwrapResponse,
  type McpCallResult,
  type McpServerInfo,
  type McpTool,
} from './protocol';

export interface McpTransport {
  /** Tek JSON-RPC mesajı gönderir (satır sonu transporta aittir). */
  send(messageText: string): Promise<void>;
  /** Tek JSON-RPC yanıt mesajını okur. */
  read(): Promise<string>;
  close(): Promise<void>;
}

export interface McpClientOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpError(`mcp: ${what} zaman aşımı`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export class McpClient {
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly transport: McpTransport,
    private readonly opts: McpClientOptions = {},
  ) {}

  private get timeoutMs(): number {
    return this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async roundTrip(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) throw new McpError('mcp: istemci kapalı');
    const id = this.nextId++;
    await withTimeout(
      this.transport.send(JSON.stringify(createRequest(id, method, params))),
      this.timeoutMs,
      `${method} gönderme`,
    );
    const raw = await withTimeout(this.transport.read(), this.timeoutMs, `${method} yanıt`);
    return unwrapResponse(parseResponse(raw), id);
  }

  /** El sıkışma: initialize + initialized bildirimi. */
  async initialize(): Promise<{ protocolVersion: string; serverInfo: McpServerInfo }> {
    const result = (await this.roundTrip('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: { name: 'macrocode', version: APP_VERSION },
      capabilities: {},
    })) as { protocolVersion?: unknown; serverInfo?: unknown };
    // Bildirim için yanıt beklenmez; hata sessizce yoksayılır (bazı sunucular istemez).
    try {
      await this.transport.send(JSON.stringify(createNotification('notifications/initialized')));
    } catch {
      // yoksay
    }
    const serverInfo = result.serverInfo as McpServerInfo | undefined;
    return {
      protocolVersion:
        typeof result.protocolVersion === 'string' ? result.protocolVersion : 'bilinmiyor',
      serverInfo: { name: serverInfo?.name ?? 'bilinmiyor', ...(serverInfo?.version ? { version: serverInfo.version } : {}) },
    };
  }

  async listTools(): Promise<McpTool[]> {
    return parseToolsList(await this.roundTrip('tools/list'));
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    return parseToolResult(
      await this.roundTrip('tools/call', { name, arguments: args }),
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.close();
  }
}
