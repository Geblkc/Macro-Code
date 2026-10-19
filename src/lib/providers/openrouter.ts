import { createOpenAICompatibleProvider } from './openaiCompatible';

export const openrouterProvider = createOpenAICompatibleProvider({
  name: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  extraHeaders: () => ({
    'HTTP-Referer': 'https://macrocode.app',
    'X-Title': 'MacroCode',
  }),
  models: [
    { id: 'openrouter/auto', name: 'OpenRouter Auto', provider: 'openrouter', contextWindow: 200000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: false } },
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5 (via OR)', provider: 'openrouter', contextWindow: 1000000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol (via OR)', provider: 'openrouter', contextWindow: 1050000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'x-ai/grok-4.7', name: 'Grok 4.7 (via OR)', provider: 'openrouter', contextWindow: 256000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },
  ],
});
