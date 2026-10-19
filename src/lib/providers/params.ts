import type { ModelParams } from '../../types';

export interface EffectiveParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  thinkingBudget?: number;
}

function finiteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Kayıtlı ham parametreyi gönderime hazırlar.
 * - thinkingBudget varsa topP düşer (Anthropic thinking + top_p = 400).
 * - temperature'a dokunulmaz (thinking'te 1'e sabitleme anthropic.ts'tedir).
 * - Geçersiz (NaN/negatif maxTokens) alanlar atılır.
 */
export function sanitizeParams(raw: ModelParams | undefined): EffectiveParams {
  if (!raw) return {};
  const out: EffectiveParams = {};
  if (finiteInt(raw.temperature)) out.temperature = raw.temperature as number;
  if (finiteInt(raw.maxTokens) && (raw.maxTokens as number) > 0) {
    out.maxTokens = Math.floor(raw.maxTokens as number);
  }
  if (finiteInt(raw.thinkingBudget) && (raw.thinkingBudget as number) > 0) {
    out.thinkingBudget = Math.floor(raw.thinkingBudget as number);
  } else if (finiteInt(raw.topP)) {
    out.topP = raw.topP as number;
  }
  return out;
}
