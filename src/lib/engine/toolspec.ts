/**
 * Kanonik tool tanımları (OpenAI function-calling bazlı).
 * Provider dönüşümleri saf fonksiyondur — test edilebilir.
 *
 * DİL NOTU: Bu açıklamalar **modele gönderilir** (kullanıcıya gösterilmez).
 * Bu yüzden İngilizce sabittir ve arayüz dilinden BAĞIMSIZDIR — locale
 * değişse bile değişmez. Model performansı ve araç çağrı tutarlılığı için.
 */
import type { ToolCall, ToolDefinition, ToolName } from './types';
import { createToolCallId } from './types';

export const CORE_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read a file inside the project. Cannot leave the workspace root. Use offset+limit for large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        limit: { type: 'number', description: 'Max lines (default 200)' },
        offset: { type: 'number', description: 'Start line, 1-based (paginate for large files)' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_dir',
    description: 'List a directory. Hidden and ignored files may be filtered out.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory (empty = root)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'grep',
    description: 'Search for text in the project. Use regex:true for a regular expression, otherwise literal.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'Subdirectory (empty = root)' },
        regex: { type: 'boolean', description: 'true means the pattern is a regex' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'glob',
    description: 'Find files by a file name pattern (e.g. src/**/*.test.ts).',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
        path: { type: 'string', description: 'Subdirectory (empty = root)' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_patch',
    description: 'Propose new content for a file (produces a preview; it is not applied without approval).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'The COMPLETE new content of the file' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description:
      'Find a specific code block in a file and replace it with a new one (prefer this over rewriting the whole file).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        search: { type: 'string', description: 'The existing code block to replace (must match exactly)' },
        replace: { type: 'string', description: 'The new code block that takes its place' },
      },
      required: ['path', 'search', 'replace'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description:
      'Create a NEW file (create-only; it fails if the file exists — use edit_file instead).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path of the new file' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'exec',
    description: 'Run a terminal command (allowlist + approval required).',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Command (e.g. npm)' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string', description: 'Workspace-relative working directory' },
      },
      required: ['cmd'],
      additionalProperties: false,
    },
  },
  {
    name: 'todo',
    description:
      'Task tracking: add/complete/list. The state is derived from the conversation history.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: "'add' | 'complete' | 'list'" },
        id: { type: 'string', description: 'Task id (optional for add, required for complete)' },
        text: { type: 'string', description: 'Task text (required for add)' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'subagent',
    description:
      'Run a separate exploration/research task with a read-only subagent (it cannot write files or run commands). ' +
      'Use it for complex, broad research; you get the result as a single summary.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Sub-task definition (what to look for, which files to inspect)',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan',
    description:
      'Announce a multi-step task as a list of steps (each step is tracked with todo).',
    parameters: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'string' }, description: 'Ordered list of steps' },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
];

export function getTool(name: string): ToolDefinition | undefined {
  return CORE_TOOLS.find((t) => t.name === name);
}

export function isKnownToolName(name: string): name is ToolName {
  return CORE_TOOLS.some((t) => t.name === name);
}

// ---------------------------------------------------------------- OpenAI ---

export interface OpenAIToolPayload {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAIToolPayload[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** OpenAI delta.tool_calls parçalarını biriktirip final ToolCall[] üretir. */
export function accumulateOpenAIToolCalls(
  deltas: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
): ToolCall[] {
  const byIndex = new Map<number, { id: string; name: string; argsText: string }>();
  for (const d of deltas) {
    const key = typeof d.index === 'number' ? d.index : 0;
    // Tek çağrılık eski test formu: index yoksa her eleman ayrı çağrı sayılırdı.
    // Gerçek OpenAI akışında index her zaman vardır; yoksa sırayı koru:
    // aynı index'e yığ, farklı çağrılar farklı index ile gelir.
    const slot = byIndex.get(key) ?? { id: '', name: '', argsText: '' };
    if (d.id) slot.id = d.id;
    if (d.function?.name) slot.name += d.function.name;
    if (d.function?.arguments) slot.argsText += d.function.arguments;
    byIndex.set(key, slot);
  }
  const out: ToolCall[] = [];
  for (const slot of byIndex.values()) {
    if (!slot.name) continue;
    out.push({
      id: slot.id || createToolCallId(),
      name: slot.name,
      args: safeParseArgs(slot.argsText),
    });
  }
  return out;
}

// -------------------------------------------------------------- Anthropic ---

export interface AnthropicToolPayload {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toAnthropicTools(tools: ToolDefinition[]): AnthropicToolPayload[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export type AnthropicBlockAcc = {
  id: string;
  name: string;
  jsonText: string;
};

/** Anthropic: content_block_start(tool_use) + input_json_delta birikimi. */
export function accumulateAnthropicToolUse(
  starts: Array<{ id: string; name: string }>,
  jsonDeltas: string[],
): ToolCall[] {
  return starts.map((s, i) => ({
    id: s.id || createToolCallId(),
    name: s.name,
    args: safeParseArgs(jsonDeltas[i] ?? ''),
  }));
}

// ----------------------------------------------------------------- Gemini ---

export interface GeminiToolPayload {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export function toGeminiTools(tools: ToolDefinition[]): GeminiToolPayload {
  return {
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
}

export function geminiFunctionCallToToolCall(
  fc: { name?: string; args?: Record<string, unknown> },
  fallbackId?: string,
): ToolCall | null {
  if (!fc.name) return null;
  return {
    id: fallbackId || createToolCallId(),
    name: fc.name,
    args: (fc.args ?? {}) as Record<string, unknown>,
  };
}

// ------------------------------------------------------------------ ortak ---

export function safeParseArgs(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return { _value: v };
  } catch {
    return { _raw: text };
  }
}

/** ToolCall arg'larından string alanı güvenli oku. */
export function strArg(args: Record<string, unknown>, key: string, fallback = ''): string {
  const v = args[key];
  return typeof v === 'string' ? v : fallback;
}
