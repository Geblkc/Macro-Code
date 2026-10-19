import { createOpenAICompatibleProvider } from './openaiCompatible';

export const xaiProvider = createOpenAICompatibleProvider({
  name: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  models: [
    { id: 'grok-4.20', name: 'Grok 4.20', provider: 'xai', contextWindow: 256000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'grok-4.7', name: 'Grok 4.7', provider: 'xai', contextWindow: 256000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'grok-latest', name: 'Grok Latest', provider: 'xai', contextWindow: 256000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },
  ],
});
