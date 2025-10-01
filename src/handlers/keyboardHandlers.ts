/**
 * ⌨️ ОБРАБОТЧИКИ ТЕКСТОВЫХ КНОПОК
 * 
 * Обработка нажатий на текстовые кнопки клавиатуры
 */

import type { Context } from 'telegraf';
import { UserService } from '../services/userService.js';
import { getMainMenuKeyboard, getConfirmationButtons } from '../utils/keyboards.js';

export class KeyboardHandlers {
  constructor(
    private userService: UserService,
    private replyWithTracking: (ctx: Context, text: string, extra?: any) => Promise<any>,
    private clearAllChatMessages: (ctx: Context, userId: number, excludeMessageIds?: number[]) => Promise<void>,
    private sendHelpMessage: (ctx: Context) => Promise<void>
  ) {}

  /**
   * Обработчик "💬 Новый чат"
   */
  async handleNewChat(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    
    // Отслеживаем команду пользователя
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    // Сначала отправляем подтверждение
    await this.replyWithTracking(
      ctx,
      '🔄 Очищаю историю и начинаю новый диалог...',
      { reply_markup: getMainMenuKeyboard().reply_markup }
    );
    
    // Отправляем финальное сообщение
    const finalMessage = await this.replyWithTracking(
      ctx,
      '🆕 Готово! История очищена. Отправьте сообщение для начала нового диалога.',
      { reply_markup: getMainMenuKeyboard().reply_markup }
    );
    
    // Потом очищаем все сообщения и историю (исключая последнее сообщение)
    await this.clearAllChatMessages(ctx, userId, [finalMessage.message_id]);
    this.userService.resetHistory(userId);
  }

  /**
   * Обработчик "🔄 Сбросить историю"
   */
  async handleResetHistory(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    
    // Отслеживаем команду пользователя
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    await this.replyWithTracking(
      ctx, 
      '🔄 Вы уверены, что хотите очистить историю диалога?', 
      getConfirmationButtons(userId)
    );
  }

  /**
   * Обработчик "ℹ️ Помощь"
   */
  async handleHelp(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    
    // Отслеживаем команду пользователя
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    await this.sendHelpMessage(ctx);
  }

  /**
   * Обработчик "⚙️ Настройки"
   */
  async handleSettings(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    
    // Отслеживаем команду пользователя
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    const { getSettingsButtons } = await import('../utils/keyboards.js');
    
    await this.replyWithTracking(
      ctx, 
      '⚙️ Настройки бота', 
      getSettingsButtons(userId)
    );
  }

  /**
   * Общий обработчик всех текстовых кнопок
   */
  async handleKeyboardButton(ctx: Context): Promise<void> {
    const text = (ctx.message as any)?.text;
    
    if (!text) return;

    switch (text) {
      case '💬 Новый чат':
        await this.handleNewChat(ctx);
        break;
        
      case '🔄 Сбросить историю':
        await this.handleResetHistory(ctx);
        break;
        
      case 'ℹ️ Помощь':
        await this.handleHelp(ctx);
        break;
        
      case '⚙️ Настройки':
        await this.handleSettings(ctx);
        break;
        
      default:
        // Если кнопка не распознана, передаем в обработчик текстовых сообщений
        return;
    }
  }
}
