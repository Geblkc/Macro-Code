import { createOpenAICompatibleProvider } from './openaiCompatible';

export const deepseekProvider = createOpenAICompatibleProvider({
  name: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: false, vision: false, reasoning: true } },
  ],
});
