/**
 * MacroCode çekirdek motor — ortak tipler.
 * UI'dan bağımsız (React/Zustand import yasak).
 */

export type Workspace = {
  /** Mutlak kök dizin (ör: /home/user/proj). Rust tarafında jail için kullanılır. */
  root: string;
  /** İnsan görünen ad (klasör adı). */
  label: string;
};

export type JsonSchema = Record<string, unknown>;

export type ToolName =
  | 'read_file'
  | 'list_dir'
  | 'grep'
  | 'glob'
  | 'propose_patch'
  | 'edit_file'
  | 'write_file'
  | 'exec'
  | 'todo'
  | 'plan'
  | 'subagent';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  /** JSON-Schema (OpenAI function-calling bazlı). */
  parameters: JsonSchema;
}

export interface ToolCall {
  /** Provider'ın verdiği id; yoksa üretilir. */
  id: string;
  name: ToolName | string;
  args: Record<string, unknown>;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant tool çağrısı yaptıysa. */
  toolCalls?: ToolCall[];
  /** tool sonucuysa hangi çağrıya ait. */
  toolCallId?: string;
}

/**
 * Kullanım sayacı (token maliyeti). `cacheRead`/`cacheWrite` input'un içindedir
 * (Faz 7: prompt cache token takibi).
 */
export interface UsageLike {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type AgentEvent =
  | { k: 'text'; delta: string }
  | { k: 'reasoning'; delta: string }
  | { k: 'thinking'; blocks: Array<{ thinking: string; signature: string }> }
  | { k: 'tool_call'; call: ToolCall }
  | { k: 'tool_result'; id: string; ok: boolean; output: string }
  | { k: 'tool_preview'; id: string; output: string }
  | { k: 'done'; usage?: UsageLike };
export type ApprovalMode = 'manual' | 'auto-read' | 'auto-edit';

export interface PolicyDecision {
  allowed: boolean;
  /** false ise kullanıcıya gösterilecek gerekçe. */
  reason?: string;
  /** true ise onay sorulmadan geçilebilir (read gibi). */
  autoApproved?: boolean;
}

export interface PendingPatch {
  id: string;
  path: string;
  /** Yeni dosya içeriğinin tamamı. */
  content: string;
  /** Önizleme için üretilmiş basit diff. */
  preview: string;
  createdAt: number;
  /**
   * Faz 10 (D2a): yamanın üretildiği workspace kökü.
   * `/root` değişirse yama eski köke aittir; yeni köke uygulanmamalı
   * (eskiden aynı göreli yol yeni workspace'te yanlış dosyayı ezdiyordu).
   */
  root?: string;
}

export function createToolCallId(): string {
  try {
    const c = globalThis.crypto as unknown as { randomUUID?: () => string } | undefined;
    if (c?.randomUUID) return `call-${c.randomUUID()}`;
  } catch {
    // düşer
  }
  return `call-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
