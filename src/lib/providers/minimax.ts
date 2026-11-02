import { createOpenAICompatibleProvider } from './openaiCompatible';

export const minimaxProvider = createOpenAICompatibleProvider({
  name: 'minimax',
  baseUrl: 'https://api.minimax.io/v1',
  models: [
    {
      id: 'MiniMax-M3.1-Flash',
      name: 'MiniMax M3.1 Flash',
      provider: 'minimax',
      contextWindow: 1000000,
      supportsVision: true,
      maxOutput: 524288,
      capabilities: { tools: true, vision: true, reasoning: true },
      reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
    },
    {
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      provider: 'minimax',
      contextWindow: 1000000,
      supportsVision: true,
      maxOutput: 524288,
      capabilities: { tools: true, vision: true, reasoning: true },
      reasoningOptions: [{ type: 'toggle' }],
    },
  ],
});