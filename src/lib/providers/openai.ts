import { createOpenAICompatibleProvider } from './openaiCompatible';

/** o-serisi `system` rolunu kabul etmez; `developer` kullanilir. */
function mapRole(model: string, role: string): string {
  if (role === 'system' && /^o\d/.test(model)) return 'developer';
  return role;
}

export const openaiProvider = createOpenAICompatibleProvider({
  name: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  mapRole,
  models: [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    // Faz 12: kullanıcı listesinden eklenen modeller (models.dev limit/fiyat verisiyle).
    { id: 'gpt-5.6', name: 'GPT-5.6', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'openai', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: false } },
  ],
});
