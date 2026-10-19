import { createOpenAICompatibleProvider } from './openaiCompatible';

export const deepseekProvider = createOpenAICompatibleProvider({
  name: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: true, vision: false, reasoning: false } },
    // Faz 12: kullanıcı listesinden eklenen V4 ailesi (models.dev verisiyle).
    { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', provider: 'deepseek', contextWindow: 1000000, supportsVision: true, maxOutput: 393216, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', contextWindow: 1000000, supportsVision: true, maxOutput: 393216, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', contextWindow: 1000000, supportsVision: false, maxOutput: 393216, capabilities: { tools: true, vision: false, reasoning: true } },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: false, vision: false, reasoning: true } },
  ],
});
