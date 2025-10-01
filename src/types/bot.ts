// Общие типы для бота
export type Role = 'system' | 'user' | 'assistant';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = {
  role: Role;
  content: string | ContentBlock[];
};

export type History = ChatMessage[];

export type PaginationState = {
  pages: string[];
  currentIndex: number;
};

export type UserSettings = {
  model: string;
  systemPrompt: string;
};

// Доступные модели
export const AVAILABLE_MODELS = [
  { id: 'x-ai/grok-4-fast:free', name: '🚀 Grok 4 Fast (📸 с изображениями)', supportsImages: true },
  { id: 'deepseek/deepseek-chat-v3.1:free', name: '🧠 DeepSeek Chat v3.1 (только текст)', supportsImages: false }
] as const;

// Константы
export const MAX_HISTORY_MESSAGES = 10;
export const MAX_PAGE_LENGTH = 3500;
export const REQUEST_TIMEOUT_MS = 120_000;
export const USER_RATE_LIMIT_MS = 2000;
export const MAX_CONCURRENT_REQUESTS = 5;
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
