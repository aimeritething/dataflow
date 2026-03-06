/**
 * AI Configuration Module
 * 
 * Manages AI provider settings from environment variables.
 * Supports OpenAI, Anthropic, and Ollama providers.
 */

export type AIProvider = 'openai' | 'anthropic' | 'ollama';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  authToken?: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
}

export interface AIConfigStatus {
  provider: AIProvider;
  model: string;
  isConfigured: boolean;
}

/**
 * Get AI configuration from environment variables
 */
export function getAIConfig(): AIConfig {
  const provider = (process.env.AI_PROVIDER || 'anthropic') as AIProvider;

  switch (provider) {
    case 'anthropic':
      return {
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        authToken: process.env.ANTHROPIC_AUTH_TOKEN,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2048', 10),
      };

    case 'ollama':
      return {
        provider: 'ollama',
        model: process.env.OLLAMA_MODEL || 'llama3',
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2048', 10),
      };

    case 'openai':
    default:
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2048', 10),
      };
  }
}

/**
 * Get AI configuration status (without sensitive data)
 */
export function getAIConfigStatus(): AIConfigStatus {
  const config = getAIConfig();

  let isConfigured = false;

  switch (config.provider) {
    case 'openai':
      isConfigured = !!config.apiKey && config.apiKey !== 'sk-your-api-key-here';
      break;
    case 'anthropic':
      isConfigured = !!(config.apiKey || config.authToken);
      break;
    case 'ollama':
      isConfigured = !!config.baseUrl;
      break;
  }

  return {
    provider: config.provider,
    model: config.model,
    isConfigured,
  };
}

/**
 * Validate AI configuration
 */
export function validateAIConfig(config: AIConfig): { valid: boolean; error?: string } {
  if (config.provider === 'openai' && !config.apiKey) {
    return { valid: false, error: 'OpenAI API Key is not configured. Please set OPENAI_API_KEY in .env.local' };
  }

  if (config.provider === 'anthropic' && !config.apiKey && !config.authToken) {
    return { valid: false, error: 'Anthropic credentials not configured. Please set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in .env.local' };
  }

  if (config.provider === 'ollama' && !config.baseUrl) {
    return { valid: false, error: 'Ollama base URL is not configured. Please set OLLAMA_BASE_URL in .env.local' };
  }

  return { valid: true };
}
