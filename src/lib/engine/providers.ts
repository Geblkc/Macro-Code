/**
 * Faz A — Provider birleştirme katmanı + Capability lookup.
 * Agent kararları model capability'sine göre verilir:
 * Provider → Model → Capabilities → Agent.
 */
import { getProvider, supportsToolsForModel, getProviderDef } from '../providers';
import type { ProviderConfig } from '../providers/common';
import type { CustomModel, Provider } from '../../types';
import type { ToolDefinition } from './types';

/** Model bazlı tool desteği; modelId yoksa provider default modeline bakılır. */
export function supportsTools(provider: Provider, modelId?: string, customs: CustomModel[] = []): boolean {
  if (modelId) return supportsToolsForModel(modelId, customs);
  const def = getProviderDef(provider);
  if (!def) return false;
  return supportsToolsForModel(def.defaultModel);
}

export async function streamWithTools(
  provider: Provider,
  config: ProviderConfig & { tools?: ToolDefinition[] },
): Promise<void> {
  const tools = config.tools && config.tools.length > 0 ? config.tools : undefined;
  // Desteklemeyen modelde tools sessizce düşer (text-only davranış korunur).
  const ok = supportsTools(provider, config.model);
  await getProvider(provider).stream({
    ...config,
    ...(ok ? { tools } : { tools: undefined }),
  });
}

export { getProvider };
