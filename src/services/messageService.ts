/**
 * 💬 СЕРВИС УПРАВЛЕНИЯ СООБЩЕНИЯМИ
 * 
 * Форматирование, пагинация и отправка сообщений
 */

import type { Context } from 'telegraf';
import type { Message as TelegramMessage } from 'telegraf/typings/core/types/typegram';
import { buildPaginationKeyboard } from '../utils/keyboards.js';

export interface PaginationState {
  pages: string[];
  currentIndex: number;
}

export class MessageService {
  private paginationStates = new Map<string, PaginationState>();
  private readonly MAX_PAGE_LENGTH = 3500;
  
  // Кэш для оптимизации
  private responseCache = new Map<string, string>();
  private splitCache = new Map<string, string[]>();
  private readonly MAX_CACHE_SIZE = 100;

  /**
   * Форматирование ответа от AI
   */
  formatResponse(text: string): string {
    // Проверяем кэш
    if (this.responseCache.has(text)) {
      return this.responseCache.get(text)!;
    }

    const trimmed = text.trim();
    const cleaned = this.stripDecor(trimmed);
    
    // Кэшируем результат
    if (this.responseCache.size < this.MAX_CACHE_SIZE) {
      this.responseCache.set(text, cleaned);
    }
    
    return cleaned;
  }

  /**
   * Удаление декоративных элементов
   */
  private stripDecor(text: string): string {
    return text
      // Убираем ✨ звёздочки в начале строк
      .replace(/^✨\s*/gm, '')
      // Убираем разделители ━━━━━━
      .replace(/━+/g, '')
      // Убираем лишние пустые строки
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Разбивка длинных сообщений на страницы
   */
  splitMessage(text: string): string[] {
    // Проверяем кэш
    if (this.splitCache.has(text)) {
      return this.splitCache.get(text)!;
    }

    if (text.length <= this.MAX_PAGE_LENGTH) {
      const result = [text];
      if (this.splitCache.size < this.MAX_CACHE_SIZE) {
        this.splitCache.set(text, result);
      }
      return result;
    }

    // Оптимизированная разбивка - сначала по абзацам, затем по словам
    const paragraphs = text.split('\n\n');
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
      if (current.length + paragraph.length + 2 <= this.MAX_PAGE_LENGTH) {
        current += (current ? '\n\n' : '') + paragraph;
      } else {
        if (current) {
          chunks.push(current.trim());
          current = '';
        }
        
        // Если абзац слишком длинный, разбиваем по словам
        if (paragraph.length > this.MAX_PAGE_LENGTH) {
          const words = paragraph.split(' ');
          let wordChunk = '';
          
          for (const word of words) {
            if (wordChunk.length + word.length + 1 <= this.MAX_PAGE_LENGTH) {
              wordChunk += (wordChunk ? ' ' : '') + word;
            } else {
              if (wordChunk) chunks.push(wordChunk.trim());
              wordChunk = word;
            }
          }
          if (wordChunk) chunks.push(wordChunk.trim());
        } else {
          current = paragraph;
        }
      }
    }

    if (current) {
      chunks.push(current.trim());
    }

    // Сохраняем в кэш
    if (this.splitCache.size < this.MAX_CACHE_SIZE) {
      this.splitCache.set(text, chunks);
    }

    return chunks;
  }

  /**
   * Безопасное редактирование сообщения
   */
  async safeEditMessage(
    ctx: Context,
    chatId: number,
    messageId: number,
    text: string,
    extra?: any
  ): Promise<boolean> {
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, text, extra);
      return true;
    } catch (error) {
      // Не логируем эту ошибку - это нормальное поведение Telegram API
      return false;
    }
  }

  /**
   * Отправка ответа с поддержкой пагинации
   */
  async sendAnswer(
    ctx: Context, 
    text: string, 
    statusMessage: TelegramMessage.TextMessage,
    getMainMenuKeyboard: () => any,
    replyWithTracking?: (ctx: Context, text: string, extra?: any) => Promise<any>
  ): Promise<void> {
    const formatted = this.formatResponse(text);
    const pages = this.splitMessage(formatted);
    const chatId = statusMessage.chat.id;
    const messageId = statusMessage.message_id;

    if (pages.length === 1) {
      const edited = await this.safeEditMessage(ctx, chatId, messageId, pages[0]);
      if (!edited) {
        console.log('📝 Редактирование не удалось, удаляю статусное сообщение и отправляю новое');
        // Удаляем статусное сообщение, которое не смогли отредактировать
        try {
          await ctx.telegram.deleteMessage(chatId, messageId);
        } catch (error) {
          console.log('⚠️ Не удалось удалить статусное сообщение');
        }
        
        // Отправляем новое сообщение и отслеживаем его
        if (replyWithTracking) {
          await replyWithTracking(ctx, pages[0], {
            reply_markup: getMainMenuKeyboard().reply_markup
          });
        } else {
          await ctx.reply(pages[0], {
            reply_markup: getMainMenuKeyboard().reply_markup
          });
        }
      } else {
        console.log('✅ Статусное сообщение успешно отредактировано');
      }
      this.paginationStates.delete(`${chatId}:${messageId}`);
      return;
    }

    // Многостраничный ответ
    this.paginationStates.set(`${chatId}:${messageId}`, { pages, currentIndex: 0 });
    const edited = await this.safeEditMessage(ctx, chatId, messageId, pages[0], {
      reply_markup: buildPaginationKeyboard(pages.length, 0, chatId, messageId).reply_markup
    });
    
    if (!edited) {
      console.log('📝 Редактирование многостраничного ответа не удалось, удаляю статусное сообщение');
      // Удаляем статусное сообщение, которое не смогли отредактировать
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
      } catch (error) {
        console.log('⚠️ Не удалось удалить статусное сообщение');
      }
      
      // Отправляем новое многостраничное сообщение
      if (replyWithTracking) {
        await replyWithTracking(ctx, pages[0], buildPaginationKeyboard(pages.length, 0, chatId, messageId));
      } else {
        await ctx.reply(pages[0], buildPaginationKeyboard(pages.length, 0, chatId, messageId));
      }
    } else {
      console.log('✅ Многостраничный ответ успешно отредактирован');
    }
  }

  /**
   * Обработка пагинации
   */
  async handlePagination(
    ctx: any,
    direction: 'prev' | 'next'
  ): Promise<void> {
    const { message } = ctx.callbackQuery;
    if (!message) {
      await ctx.answerCbQuery('Нет данных для переключения.');
      return;
    }

    const chatId = message.chat.id;
    const key = `${chatId}:${message.message_id}`;
    const state = this.paginationStates.get(key);

    if (!state) {
      await ctx.answerCbQuery('Данные не найдены.');
      return;
    }

    const nextIndex = direction === 'next' ? state.currentIndex + 1 : state.currentIndex - 1;

    if (nextIndex < 0 || nextIndex >= state.pages.length) {
      await ctx.answerCbQuery('Дальнейших страниц нет.');
      return;
    }

    state.currentIndex = nextIndex;
    this.paginationStates.set(key, state);

    await ctx.editMessageText(state.pages[nextIndex], {
      reply_markup: buildPaginationKeyboard(state.pages.length, nextIndex, chatId, message.message_id).reply_markup
    });
    await ctx.answerCbQuery();
  }

  /**
   * Получить состояние пагинации
   */
  getPaginationState(chatId: number, messageId: number): PaginationState | undefined {
    const key = `${chatId}:${messageId}`;
    return this.paginationStates.get(key);
  }

  /**
   * Удалить состояние пагинации
   */
  deletePaginationState(chatId: number, messageId: number): void {
    const key = `${chatId}:${messageId}`;
    this.paginationStates.delete(key);
  }

  /**
   * Очистить все состояния пагинации для чата
   */
  clearChatPaginationStates(chatId: number): void {
    const keysToDelete = Array.from(this.paginationStates.keys())
      .filter(key => key.startsWith(`${chatId}:`));
    
    keysToDelete.forEach(key => this.paginationStates.delete(key));
  }

  /**
   * Статистика сервиса сообщений
   */
  getStats() {
    return {
      activePaginationStates: this.paginationStates.size,
      responseCacheSize: this.responseCache.size,
      splitCacheSize: this.splitCache.size,
      maxPageLength: this.MAX_PAGE_LENGTH
    };
  }

  /**
   * Очистка кэшей (для экономии памяти)
   */
  clearCaches(): void {
    this.responseCache.clear();
    this.splitCache.clear();
    console.log('🧹 MessageService: кэши очищены');
  }
}
