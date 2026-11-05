import { createOpenAICompatibleProvider } from './openaiCompatible';

export const openrouterProvider = createOpenAICompatibleProvider({
  name: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  extraHeaders: () => ({
    'HTTP-Referer': 'https://macrocode.app',
    'X-Title': 'MacroCode',
  }),
  models: [
    // Auto selection
    { id: 'openrouter/auto', name: 'OpenRouter Auto', provider: 'openrouter', contextWindow: 200000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: false } },

    // Anthropic Claude 3 series
    { id: 'anthropic/claude-3-haiku-20240307', name: 'Claude 3 Haiku (via OR)', provider: 'openrouter', contextWindow: 200000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: false } },
    { id: 'anthropic/claude-3-opus-20240229', name: 'Claude 3 Opus (via OR)', provider: 'openrouter', contextWindow: 200000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'anthropic/claude-3-sonnet-20240229', name: 'Claude 3 Sonnet (via OR)', provider: 'openrouter', contextWindow: 200000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5 (via OR)', provider: 'openrouter', contextWindow: 1000000, supportsVision: true, maxOutput: 128000, capabilities: { tools: true, vision: true, reasoning: true } },

    // OpenAI GPT-4 series
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'openai/gpt-4o', name: 'GPT-4o (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'openai/gpt-4.5-mini', name: 'GPT-4.5 Mini (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: true, maxOutput: 16384, capabilities: { tools: true, vision: true, reasoning: true } },

    // Google Gemini series
    { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro (via OR)', provider: 'openrouter', contextWindow: 200000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'google/gemini-1.5-flash', name: 'Gemini 1.5 Flash (via OR)', provider: 'openrouter', contextWindow: 1000000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'google/gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash 8B (via OR)', provider: 'openrouter', contextWindow: 1000000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },

    // Meta Llama series
    { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B Instruct (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: false, vision: false, reasoning: true } },
    { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: false, vision: false, reasoning: true } },
    { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: false, vision: false, reasoning: true } },

    // Mistral series
    { id: 'mistral/mistral-large-2402', name: 'Mistral Large 2402 (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'mistral/mistral-medium', name: 'Mistral Medium (via OR)', provider: 'openrouter', contextWindow: 32000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'mistral/mistral-small', name: 'Mistral Small (via OR)', provider: 'openrouter', contextWindow: 32000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: false } },

    // Cohere series
    { id: 'cohere/command-r-plus', name: 'Cohere Command R+ (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 4096, capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'cohere/command-r', name: 'Cohere Command R (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 4096, capabilities: { tools: true, vision: false, reasoning: false } },

    // Deepseek series
    { id: 'deepseek/deepseek-coder', name: 'DeepSeek Coder V2 (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: false, vision: false, reasoning: false } },
    { id: 'deepseek/deepseek-v3', name: 'DeepSeek V3 (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },

    // xAI Grok series
    { id: 'x-ai/grok-2', name: 'Grok 2 (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'x-ai/grok-2-vision', name: 'Grok 2 Vision (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },

    // Others
    { id: 'anthropic/claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet Jun2024 (via OR)', provider: 'openrouter', contextWindow: 200000, supportsVision: true, maxOutput: 8192, capabilities: { tools: true, vision: true, reasoning: true } },
    { id: 'openai/o1-mini', name: 'OpenAI o1 Mini (via OR)', provider: 'openrouter', contextWindow: 200000, supportsVision: false, maxOutput: 16384, capabilities: { tools: false, vision: false, reasoning: true } },
    { id: 'openai/o1-preview', name: 'OpenAI o1 Preview (via OR)', provider: 'openrouter', contextWindow: 200000, supportsVision: false, maxOutput: 16384, capabilities: { tools: false, vision: false, reasoning: true } },
    { id: 'nemotron/nemotron', name: 'Nemotron (via OR)', provider: 'openrouter', contextWindow: 128000, supportsVision: false, maxOutput: 8192, capabilities: { tools: false, vision: false, reasoning: true } },
  ],
});
