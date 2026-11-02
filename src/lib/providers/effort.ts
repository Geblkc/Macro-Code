import type { Model } from '../../types';

/**
 * Model eforu (reasoning effort) yardımcıları.
 *
 * Katalog (`models.dev`) modelin gerçek `reasoning_options.effort` değerlerini
 * verir. Katalog yüklenmemiş/eksikse reasoning destekli modeller için güvenli
 * bir alt küme (`low/medium/high`) kullanılır.
 */

/** Katalog metadata'sı yokken kullanılan güvenli efor değerleri. */
export const FALLBACK_EFFORT_VALUES = ['low', 'medium', 'high'] as const;

export type ReasoningMode = 'effort' | 'toggle' | 'fixed' | 'none';

const NEW_REASONING_PROVIDERS = new Set(['minimax', 'moonshotai', 'zhipuai']);

export function reasoningModeForModel(model: Model | undefined): ReasoningMode {
  if (!model) return 'effort';
  if (!model.capabilities.reasoning || model.provider === 'ollama') return 'none';
  const opts = model.reasoningOptions ?? [];
  const hasEffort = opts.some((o) => o.type === 'effort');
  const hasToggle = opts.some((o) => o.type === 'toggle');
  if (NEW_REASONING_PROVIDERS.has(model.provider)) {
    if (hasEffort) return 'effort';
    if (hasToggle) return 'toggle';
    return 'fixed';
  }
  // Legacy sağlayıcılar: reasoning varsa effort (fallback değerlerle).
  return 'effort';
}

/** `/effort` komutunun kabul ettiği yazımlar (yaygın yazım hataları dahil). */
export const EFFORT_COMMAND_ALIASES = ['effort', 'efforts', 'effors'] as const;

/** Ham değeri normalize eder; boş/geçersizse undefined döner. */
export function normalizeEffort(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 32) return undefined;
  return value;
}

/**
 * Modelin seçilebilir efor değerleri.
 * - Model yoksa (özel uç) güvenli fallback döner.
 * - Reasoning kapalı veya Ollama ise boş liste (UI "desteklemiyor" gösterir).
 */
export function effortValuesForModel(model: Model | undefined): string[] {
  if (!model) return [...FALLBACK_EFFORT_VALUES];
  if (!model.capabilities.reasoning || model.provider === 'ollama') return [];
  if (reasoningModeForModel(model) !== 'effort') return [];

  const option = model.reasoningOptions?.find((o) => o.type === 'effort');
  if (option) {
    const values = [
      ...new Set(
        option.values
          .map((v) => normalizeEffort(v))
          .filter((v): v is string => v !== undefined),
      ),
    ];
    if (values.length > 0) return values;
  }
  return [...FALLBACK_EFFORT_VALUES];
}

/** Slash komutu bu metin mi? (`/effort`, `/efforts`, `/effors`) */
export function isEffortCommand(raw: string): boolean {
  const cmd = raw.trim().toLowerCase();
  if (!cmd.startsWith('/')) return false;
  const name = cmd.slice(1).split(/\s+/, 1)[0];
  return (EFFORT_COMMAND_ALIASES as readonly string[]).includes(name);
}

/** Gemini 3/4 `thinkingLevel` için desteklenen seviyeye indirger. */
export function geminiThinkingLevel(effort: string): 'low' | 'medium' | 'high' {
  const value = normalizeEffort(effort);
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  if (value === 'minimal' || value === 'none') return 'low';
  return 'high';
}

/** Gemini 2.5 `thinkingBudget` eşlemesi. */
export function effortThinkingBudget(effort: string): number {
  switch (normalizeEffort(effort)) {
    case 'minimal':
      return 1024;
    case 'low':
      return 2048;
    case 'medium':
      return 8192;
    case 'xhigh':
    case 'max':
      return 24576;
    case 'high':
    default:
      return 16384;
  }
}
