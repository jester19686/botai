/**
 * 🎯 ОБРАБОТЧИКИ CALLBACK КНОПОК
 * 
 * Обработка нажатий на inline кнопки
 */

import type { Context } from 'telegraf';
import type { CallbackQuery } from 'telegraf/typings/core/types/typegram';
import { UserService } from '../services/userService.js';
import { MessageService } from '../services/messageService.js';
import { 
  getSettingsButtons, 
  getModelSelectionButtons, 
  getPromptSettingsButtons 
} from '../utils/keyboards.js';
import { AVAILABLE_MODELS } from '../types/bot.js';

export class CallbackHandlers {
  constructor(
    private userService: UserService,
    private messageService: MessageService,
    private replyWithTracking: (ctx: Context, text: string, extra?: any) => Promise<any>,
    private clearAllChatMessages: (ctx: Context, userId: number, excludeMessageIds?: number[]) => Promise<void>,
    private defaultSystemPrompt: string,
    private setUserState?: (userId: number, state: string) => void,
    private clearUserState?: (userId: number) => void
  ) {}

  /**
   * Welcome callbacks
   */
  async handleWelcomeStart(ctx: any): Promise<void> {
    await ctx.answerCbQuery('Давайте начнём!');
    await ctx.editMessageText('🚀 Отлично! Просто напишите сообщение, и я отвечу.');
  }

  async handleWelcomeHelp(ctx: any): Promise<void> {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '❓ *Как работает бот*\n\n' +
        '1. Вы отправляете вопрос или просьбу.\n' +
        '2. Я обращаюсь к модели OpenRouter.\n' +
        '3. Возвращаю подробный и красиво оформленный ответ.\n\n' +
        'Используйте кнопки меню для дополнительных действий.',
      { parse_mode: 'Markdown' }
    );
  }

  async handleWelcomeSettings(ctx: any): Promise<void> {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    
    await ctx.editMessageText('⚙️ Открываю настройки...', getSettingsButtons(ctx.from.id));
  }

  /**
   * Settings callbacks
   */
  async handleSettingsModel(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.answerCbQuery();
    const currentModel = this.userService.getUserModel(userId);
    const modelName = AVAILABLE_MODELS.find(m => m.id === currentModel)?.name || currentModel;
    
    await ctx.editMessageText(
      `🧠 Текущая модель: ${modelName}\n\nВыберите модель:`, 
      getModelSelectionButtons(userId, currentModel)
    );
  }

  async handleSelectModel(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    const modelId = ctx.match[2];
    
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    // Валидация выбранной модели
    const validModel = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (!validModel) {
      await ctx.answerCbQuery('❌ Недопустимая модель');
      return;
    }
    
    this.userService.setUserModel(userId, modelId);
    const imageSupport = validModel.supportsImages ? '\n📸 Поддерживает изображения!' : '\n📝 Только текстовые сообщения';
    
    await ctx.answerCbQuery(`✅ Модель изменена на ${validModel.name}`);
    await ctx.editMessageText(
      `🧠 Текущая модель: ${validModel.name}${imageSupport}\n\nВыберите модель:`, 
      getModelSelectionButtons(userId, modelId)
    );
  }

  async handleSettingsPrompt(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.answerCbQuery();
    const userPrompt = this.userService.getUserSystemPrompt(userId);
    
    await ctx.editMessageText(
      `📝 Системный промпт:\n\n${userPrompt}\n\n💡 Нажмите кнопку ниже, чтобы изменить промпт.`, 
      getPromptSettingsButtons(userId)
    );
  }

  async handleEditPrompt(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.answerCbQuery();
    
    // Устанавливаем состояние ожидания промпта
    if (this.setUserState) {
      this.setUserState(userId, 'awaiting_prompt');
    }
    
    const { Markup } = await import('telegraf');
    await ctx.editMessageText(
      '✏️ Введите новый системный промпт:\n\n' +
      'Системный промпт определяет, как будет вести себя AI ассистент. ' +
      'Например: "Ты дружелюбный помощник", "Отвечай кратко и по делу" и т.д.\n\n' +
      '💡 Отправьте текстовое сообщение с новым промптом.',
      Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `settings:canceledit:${userId}`)]])
    );
  }

  async handleResetPrompt(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    this.userService.setUserSystemPrompt(userId, this.defaultSystemPrompt);
    await ctx.answerCbQuery('✅ Промпт сброшен до значения по умолчанию');
    
    await ctx.editMessageText(
      `📝 Системный промпт:\n\n${this.defaultSystemPrompt}\n\n💡 Нажмите кнопку ниже, чтобы изменить промпт.`, 
      getPromptSettingsButtons(userId)
    );
  }

  async handleCancelEdit(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    // Очищаем состояние ожидания промпта
    if (this.clearUserState) {
      this.clearUserState(userId);
    }
    
    await ctx.answerCbQuery('❌ Редактирование отменено');
    const userPrompt = this.userService.getUserSystemPrompt(userId);
    
    await ctx.editMessageText(
      `📝 Системный промпт:\n\n${userPrompt}\n\n💡 Нажмите кнопку ниже, чтобы изменить промпт.`, 
      getPromptSettingsButtons(userId)
    );
  }

  async handleSettingsBack(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.answerCbQuery();
    await ctx.editMessageText('⚙️ Настройки бота', getSettingsButtons(userId));
  }

  async handleSettingsClose(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.answerCbQuery();
    await ctx.editMessageText('Настройки закрыты. Возвращайтесь, когда понадобится!');
  }

  async handleUserStatsFromSettings(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.answerCbQuery();
    
    const userStats = this.userService.getUserStats(userId);
    const { rateLimitService } = await import('../services/rateLimitService.js');
    const limitInfo = rateLimitService.getUserLimitInfo(userId);
    
    const statsText = [
      '📊 *Ваша статистика:*',
      '',
      `📝 Всего сообщений: ${userStats.totalMessages}`,
      `🤖 Ответов бота: ${userStats.botMessages}`,
      `💭 В истории: ${userStats.historyLength} сообщений`,
      `🧠 Текущая модель: ${userStats.model}`,
      `⭐ VIP статус: ${rateLimitService.isVipUser(userId) ? 'Активен' : 'Неактивен'}`,
      '',
      '⏱️ *Лимиты (текущий/максимум):*',
      `• Сообщения: ${limitInfo.text_message?.current || 0}/${limitInfo.text_message?.max || 0}`,
      `• Изображения: ${limitInfo.image_processing?.current || 0}/${limitInfo.image_processing?.max || 0}`,
      `• Команды: ${limitInfo.command?.current || 0}/${limitInfo.command?.max || 0}`
    ].join('\n');
    
    await ctx.editMessageText(statsText, {
      parse_mode: 'Markdown',
      reply_markup: getSettingsButtons(userId).reply_markup
    });
  }

  /**
   * Reset callbacks
   */
  async handleResetConfirm(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.answerCbQuery('История успешно сброшена.');
    
    // СНАЧАЛА отправляем подтверждение, затем очищаем сообщения
    const { getMainMenuKeyboard } = await import('../utils/keyboards.js');
    
    try {
      // Пытаемся отредактировать сообщение
      await ctx.editMessageText('✅ История диалога очищена. Начнём с чистого листа!');
    } catch (error) {
      // Если не получилось отредактировать, отправляем новое сообщение
      console.log('⚠️ Не удалось отредактировать сообщение подтверждения, отправляю новое');
      await this.replyWithTracking(ctx, '✅ История диалога очищена. Начнём с чистого листа!', {
        reply_markup: getMainMenuKeyboard().reply_markup
      });
    }
    
    // Отправляем итоговое сообщение с клавиатурой
    const finalMessage = await this.replyWithTracking(ctx, '🆕 Готов к новому диалогу! Отправьте сообщение для начала.', {
      reply_markup: getMainMenuKeyboard().reply_markup
    });
    
    // Теперь очищаем все сообщения (исключая только что отправленное)
    await this.clearAllChatMessages(ctx, userId, [finalMessage.message_id]);
    this.userService.resetHistory(userId);
  }

  async handleResetCancel(ctx: any): Promise<void> {
    const userId = Number(ctx.match[1]);
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('Эта кнопка недоступна.');
      return;
    }
    
    await ctx.editMessageText('Отменено. История сохранена.');
    await ctx.answerCbQuery('Действие отменено.');
  }

  /**
   * Pagination callbacks
   */
  async handlePagination(ctx: any, direction: 'prev' | 'next'): Promise<void> {
    await this.messageService.handlePagination(ctx, direction);
  }

  /**
   * Noop callback
   */
  async handleNoop(ctx: any): Promise<void> {
    await ctx.answerCbQuery('Действие не требуется.');
  }

  /**
   * Валидация промпта
   */
  validatePrompt(text: string): { valid: boolean; error?: string } {
    if (text.length < 5) {
      return { valid: false, error: 'Промпт слишком короткий. Минимум 5 символов.' };
    }
    
    if (text.length > 1000) {
      return { valid: false, error: 'Промпт слишком длинный. Максимум 1000 символов.' };
    }

    // Защита от потенциально опасных команд в промпте
    const dangerousPatterns = [
      /ignore\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|prompts?)/i,
      /forget\s+(?:everything|all)/i,
      /you\s+are\s+(?:no\s+longer|not)/i,
      /disregard\s+(?:the\s+)?(?:above|previous)/i
    ];
    
    if (dangerousPatterns.some(pattern => pattern.test(text))) {
      return { 
        valid: false, 
        error: 'Промпт содержит недопустимые команды. Пожалуйста, используйте только описание желаемого поведения ассистента.' 
      };
    }

    return { valid: true };
  }

  /**
   * Обработка ввода нового промпта
   */
  async handlePromptInput(ctx: Context, userId: number, text: string): Promise<boolean> {
    const validation = this.validatePrompt(text);
    
    if (!validation.valid) {
      const { getMainMenuKeyboard } = await import('../utils/keyboards.js');
      await this.replyWithTracking(ctx, `❌ ${validation.error}\n\n💡 Попробуйте еще раз через настройки.`, {
        reply_markup: getMainMenuKeyboard().reply_markup
      });
      return false;
    }
    
    // Сохраняем новый промпт
    this.userService.setUserSystemPrompt(userId, text);
    
    // Показываем сокращенную версию для длинных промптов
    const displayText = text.length > 150 ? text.slice(0, 147) + '...' : text;
    
    const { getMainMenuKeyboard } = await import('../utils/keyboards.js');
    await this.replyWithTracking(ctx, `✅ Системный промпт успешно обновлен!\n\n📝 Новый промпт:\n${displayText}`, {
      reply_markup: getMainMenuKeyboard().reply_markup
    });
    
    return true;
  }
}
