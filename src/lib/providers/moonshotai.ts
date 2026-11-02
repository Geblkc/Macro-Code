import { createOpenAICompatibleProvider } from './openaiCompatible';

export const moonshotaiProvider = createOpenAICompatibleProvider({
  name: 'moonshotai',
  baseUrl: 'https://api.moonshot.ai/v1',
  // Kimi K2.6/K2.7 `temperature` kabul etmez.
  supportsTemperature: (model: string) => {
    const m = model.toLowerCase();
    return !m.includes('k2.6') && !m.includes('k2.7');
  },
  models: [
    {
      id: 'kimi-k3.1-pro',
      name: 'Kimi K3.1 Pro',
      provider: 'moonshotai',
      contextWindow: 1048576,
      supportsVision: true,
      maxOutput: 1048576,
      capabilities: { tools: true, vision: true, reasoning: true },
      reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }],
    },
    {
      id: 'kimi-k3',
      name: 'Kimi K3',
      provider: 'moonshotai',
      contextWindow: 1048576,
      supportsVision: true,
      maxOutput: 1048576,
      capabilities: { tools: true, vision: true, reasoning: true },
      reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }],
    },
    {
      id: 'kimi-k2.6',
      name: 'Kimi K2.6',
      provider: 'moonshotai',
      contextWindow: 262144,
      supportsVision: true,
      maxOutput: 262144,
      capabilities: { tools: true, vision: true, reasoning: true },
      reasoningOptions: [{ type: 'toggle' }],
    },
    {
      id: 'kimi-k2.7-code',
      name: 'Kimi K2.7 Code',
      provider: 'moonshotai',
      contextWindow: 262144,
      supportsVision: true,
      maxOutput: 262144,
      capabilities: { tools: true, vision: true, reasoning: true },
      // sabit açık — reasoningOptions yok → fixed mod
    },
  ],
});