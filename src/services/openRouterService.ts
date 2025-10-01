/**
 * 🚀 СЕРВИС РАБОТЫ С OPENROUTER API
 * 
 * Централизованная работа с OpenRouter API
 */

import { fetch, Agent } from 'undici';
import { z } from 'zod';
import type { ChatMessage } from '../types/bot.js';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 120_000;

// Пул соединений для ускорения HTTP-запросов (Keep-Alive)
const httpAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
  headersTimeout: 60_000,
  bodyTimeout: 60_000,
  connectTimeout: 30_000
});

// Валидация ответа OpenRouter
const OpenRouterResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.string(),
          content: z.union([
            z.string(),
            z.array(
              z.object({
                type: z.string(),
                text: z.string().optional()
              })
            )
          ])
        })
      })
    )
    .min(1, 'Сервис OpenRouter вернул пустой ответ')
});

export class OpenRouterService {
  private totalRequests = 0;
  private totalErrors = 0;
  
  // Управление конкурентностью
  private readonly MAX_CONCURRENT_REQUESTS = 5;
  private currentRequests = 0;
  private requestQueue: Array<() => Promise<void>> = [];

  constructor(
    private apiKey: string
  ) {}

  /**
   * Основной метод для вызова OpenRouter API
   */
  async callOpenRouter(messages: ChatMessage[], userId: number, userModel: string): Promise<string> {
    return this.executeWithConcurrencyLimit(async () => {
      let attempt = 0;
      let lastError: unknown;

      while (attempt < 3) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
          this.totalRequests++;
          console.log(`📡 OpenRouter попытка ${attempt + 1} (сообщений: ${messages.length}) [Активных запросов: ${this.currentRequests}]`);
          
          const response = await fetch(OPENROUTER_ENDPOINT, {
            method: 'POST',
            signal: controller.signal,
            dispatcher: httpAgent,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://your-bot-domain.com',
              'X-Title': 'AI Telegram Bot'
            },
            body: JSON.stringify({
              model: userModel,
              messages,
              temperature: 0.7,
              max_tokens: 800
            })
          });

          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) {
              console.warn(`⚠️ OpenRouter вернул статус ${response.status}, повтор запроса.`);
              throw new Error(`Сервис вернул статус ${response.status}`);
            }
            const errorText = await response.text();
            console.error(`❌ OpenRouter ошибка ${response.status}: ${errorText}`);
            throw new Error(`Ошибка OpenRouter: ${response.status} ${errorText}`);
          }

          const data = await response.json();
          console.log('✅ OpenRouter ответ получен');
          const parsed = OpenRouterResponseSchema.safeParse(data);

          if (!parsed.success) {
            console.error('❌ Ошибка парсинга:', parsed.error.message);
            throw new Error(`Не удалось распарсить ответ OpenRouter: ${parsed.error.message}`);
          }

          const content = this.extractContentText(parsed.data.choices[0]?.message.content).trim();
          if (!content) {
            throw new Error('OpenRouter не вернул содержимое ответа.');
          }

          return content;
        } catch (error) {
          this.totalErrors++;
          lastError = error;
          attempt += 1;
          console.warn(`⚠️ Попытка ${attempt} завершилась ошибкой: ${(error as Error).message}`);
          if (attempt < 3) {
            const delayMs = 400 * 2 ** (attempt - 1);
            await this.delay(delayMs);
          }
        } finally {
          clearTimeout(timeout);
        }
      }

      const message = lastError instanceof Error ? lastError.message : 'Неизвестная ошибка';
      throw new Error(`Не удалось получить ответ от OpenRouter: ${message}`);
    });
  }

  /**
   * Извлечение текста из контента
   */
  private extractContentText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const textParts = content
        .filter((item): item is { type: string; text?: string } => typeof item === 'object' && item !== null)
        .map((item) => item.text ?? '')
        .filter(Boolean);
      return textParts.join('\n').trim();
    }
    return '';
  }

  /**
   * Система управления конкурентностью запросов
   */
  private async executeWithConcurrencyLimit<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.currentRequests++;
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.currentRequests--;
          this.processQueue();
        }
      };

      if (this.currentRequests < this.MAX_CONCURRENT_REQUESTS) {
        execute();
      } else {
        this.requestQueue.push(execute);
      }
    });
  }

  /**
   * Обработка очереди запросов
   */
  private processQueue(): void {
    if (this.requestQueue.length > 0 && this.currentRequests < this.MAX_CONCURRENT_REQUESTS) {
      const nextRequest = this.requestQueue.shift();
      if (nextRequest) {
        nextRequest();
      }
    }
  }

  /**
   * Задержка (утилита)
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Статистика сервиса
   */
  getStats() {
    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      currentRequests: this.currentRequests,
      queueLength: this.requestQueue.length,
      successRate: this.totalRequests > 0 
        ? Math.round(((this.totalRequests - this.totalErrors) / this.totalRequests) * 100) 
        : 100
    };
  }
}
