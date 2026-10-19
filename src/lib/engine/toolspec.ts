/**
 * Kanonik tool tanımları (OpenAI function-calling bazlı).
 * Provider dönüşümleri saf fonksiyondur — test edilebilir.
 */
import type { ToolCall, ToolDefinition, ToolName } from './types';
import { createToolCallId } from './types';

export const CORE_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Proje içindeki bir dosyayı oku. root dışına çıkamaz. Büyük dosyalarda offset+limit kullan.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative dosya yolu' },
        limit: { type: 'number', description: 'Max satır (default 200)' },
        offset: { type: 'number', description: 'Başlangıç satırı, 1-tabanlı (büyük dosyalarda sayfala)' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_dir',
    description: 'Dizini listele. Gizli ve ignore dosyalar elenebilir.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative dizin (boş=root)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'grep',
    description: 'Proje içinde metin ara. regex:true ile düzenli ifade, yoksa literal.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'Alt dizin (boş=root)' },
        regex: { type: 'boolean', description: 'true ise pattern regex sayılır' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'glob',
    description: 'Dosya adı desenine göre dosya bul (örn: src/**/*.test.ts).',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob deseni' },
        path: { type: 'string', description: 'Alt dizin (boş=root)' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_patch',
    description: 'Dosya için yeni içerik öner (önizleme üretir, onaysız uygulanmaz).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'Dosyanın yeni halinin TAMAMI' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description: 'Dosyadaki belirli bir kod bloğunu arayıp yenisiyle değiştirir (tüm dosyayı baştan yazmak yerine bunu tercih et).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative dosya yolu' },
        search: { type: 'string', description: 'Değiştirilecek mevcut kod bloğu (birebir eşleşmeli)' },
        replace: { type: 'string', description: 'Yerine gelecek yeni kod bloğu' },
      },
      required: ['path', 'search', 'replace'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'YENİ dosya oluştur (create-only; mevcut dosya varsa hata verir, edit_file kullan).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative yeni dosya yolu' },
        content: { type: 'string', description: 'Dosya içeriği' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'exec',
    description: 'Terminal komutu çalıştır (allowlist + onaylı).',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Komut (örn: npm)' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string', description: 'Workspace-relative çalışma dizini' },
      },
      required: ['cmd'],
      additionalProperties: false,
    },
  },
  {
    name: 'todo',
    description: 'Görev takibi: add/complete/list. Durum konuşma geçmişinden türetilir.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: "'add' | 'complete' | 'list'" },
        id: { type: 'string', description: 'Görev id (add: opsiyonel, complete: gerekli)' },
        text: { type: 'string', description: 'Görev metni (add için gerekli)' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'subagent',
    description:
      'Salt-okunur alt-agent ile ayrı bir keşif/araştırma görevi çalıştır (dosya yazamaz, komut çalıştıramaz). ' +
      'Karmaşık ve geniş araştırmalarda kullan; sonucu tek özet olarak alırsın.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Alt-görev tanımı (ne bulunacak, hangi dosyalara bakılacak)' },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan',
    description: 'Çok adımlı işi adım listesi olarak duyur (her adım todo ile işaretlenir).',
    parameters: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'string' }, description: 'Sıralı adım listesi' },
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
