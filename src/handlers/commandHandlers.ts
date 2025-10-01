/**
 * 🎯 ОБРАБОТЧИКИ КОМАНД
 * 
 * Обработка всех текстовых команд бота
 */

import type { Context } from 'telegraf';
import { UserService } from '../services/userService.js';
import { rateLimitService } from '../services/rateLimitService.js';
import { 
  getMainMenuKeyboard, 
  getWelcomeButtons, 
  getConfirmationButtons,
  getSettingsButtons,
  getAdminButtons 
} from '../utils/keyboards.js';

// Список админов (можно вынести в конфиг)
const ADMIN_USER_IDS = new Set<number>([
  // Добавьте сюда ID админов
  // 123456789
]);

export class CommandHandlers {
  constructor(
    private userService: UserService,
    private replyWithTracking: (ctx: Context, text: string, extra?: any) => Promise<any>
  ) {}

  /**
   * Команда /start
   */
  async handleStart(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    const userFirstName = ctx.from?.first_name ?? 'друг';
    
    await this.replyWithTracking(
      ctx,
      `👋 Привет, ${userFirstName}!

Добро пожаловать в интеллектуального ассистента. Выбирай действие на клавиатуре ниже, и мы начнём!`,
      { reply_markup: getMainMenuKeyboard().reply_markup }
    );

    await this.replyWithTracking(
      ctx,
      '🚀 Готовы стартовать? Я могу помочь с ответами, идеями и подсказками. Выберите одну из кнопок ниже.',
      getWelcomeButtons()
    );

    // Показываем клавиатуру отдельно для постоянного доступа
    await this.replyWithTracking(
      ctx,
      'Используйте кнопки ниже для быстрого доступа к функциям:',
      { reply_markup: getMainMenuKeyboard().reply_markup }
    );
  }

  /**
   * Команда /reset
   */
  async handleReset(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    await this.replyWithTracking(
      ctx, 
      '🔄 Вы уверены, что хотите очистить историю диалога?', 
      getConfirmationButtons(userId)
    );
  }

  /**
   * Команда /settings
   */
  async handleSettings(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    await this.replyWithTracking(
      ctx, 
      '⚙️ Настройки бота', 
      getSettingsButtons(userId)
    );
  }

  /**
   * Команда /help
   */
  async handleHelp(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    const helpText = [
      'ℹ️ *Справка*',
      '',
      '• Нажмите «💬 Новый чат», чтобы начать свежий диалог.',
      '• Используйте «🔄 Сбросить историю», чтобы очистить контекст.',
      '• В «⚙️ Настройки» можно:',
      '  - 🧠 Выбрать модель AI (Grok 4 Fast, DeepSeek Chat)',
      '  - 📝 Изменить системный промпт для персонализации',
      '',
      '📸 *Работа с изображениями:*',
      '• Grok 4 Fast поддерживает анализ изображений',
      '• DeepSeek Chat работает только с текстом',
      '• Отправьте фото с подписью для лучших результатов',
      '',
      'Отправьте сообщение или фото — и я отвечу максимально быстро!'
    ].join('\n');

    await this.replyWithTracking(ctx, helpText, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard().reply_markup
    });
  }

  /**
   * Команда /debug
   */
  async handleDebug(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    const userStats = this.userService.getUserStats(userId);
    const limitInfo = rateLimitService.getUserLimitInfo(userId);
    
    const debugInfo = [
      '🔍 *Диагностическая информация:*',
      '',
      `• Пользователь: ${userId}`,
      `• Модель: ${userStats.model}`,
      `• Всего сообщений: ${userStats.totalMessages}`,
      `• История: ${userStats.historyLength} сообщений`,
      `• VIP статус: ${rateLimitService.isVipUser(userId) ? '✅' : '❌'}`,
      '',
      '⏱️ *Rate Limits:*',
      `• Текст: ${limitInfo.text_message?.current || 0}/${limitInfo.text_message?.max || 0}`,
      `• Изображения: ${limitInfo.image_processing?.current || 0}/${limitInfo.image_processing?.max || 0}`,
      `• Команды: ${limitInfo.command?.current || 0}/${limitInfo.command?.max || 0}`,
      '',
      '💡 *При проблемах:*',
      '• Дождитесь окончания предыдущего запроса',
      '• Проверьте размер изображения (<5MB)',
      '• Используйте JPEG, PNG форматы'
    ].join('\n');
    
    await this.replyWithTracking(ctx, debugInfo, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard().reply_markup
    });
  }

  /**
   * Команда /stats - статистика пользователя
   */
  async handleStats(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    const userStats = this.userService.getUserStats(userId);
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
    
    await this.replyWithTracking(ctx, statsText, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard().reply_markup
    });
  }

  /**
   * Административные команды
   */
  async handleAdmin(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    
    // Проверяем права админа
    if (!ADMIN_USER_IDS.has(userId)) {
      await this.replyWithTracking(ctx, '❌ У вас нет прав администратора.');
      return;
    }
    
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    await this.replyWithTracking(
      ctx,
      '👑 Панель администратора',
      getAdminButtons(userId)
    );
  }

  /**
   * Добавить пользователя в VIP
   */
  async handleAddVip(ctx: Context, targetUserId: string): Promise<void> {
    const userId = ctx.from!.id;
    
    if (!ADMIN_USER_IDS.has(userId)) {
      await this.replyWithTracking(ctx, '❌ У вас нет прав администратора.');
      return;
    }
    
    const targetId = parseInt(targetUserId);
    rateLimitService.addVipUser(targetId);
    
    await this.replyWithTracking(
      ctx,
      `✅ Пользователь ${targetId} добавлен в VIP`
    );
  }

  /**
   * Убрать пользователя из VIP
   */
  async handleRemoveVip(ctx: Context, targetUserId: string): Promise<void> {
    const userId = ctx.from!.id;
    
    if (!ADMIN_USER_IDS.has(userId)) {
      await this.replyWithTracking(ctx, '❌ У вас нет прав администратора.');
      return;
    }
    
    const targetId = parseInt(targetUserId);
    rateLimitService.removeVipUser(targetId);
    
    await this.replyWithTracking(
      ctx,
      `❌ Пользователь ${targetId} удален из VIP`
    );
  }

  /**
   * Сброс лимитов пользователя
   */
  async handleResetLimits(ctx: Context, targetUserId: string): Promise<void> {
    const userId = ctx.from!.id;
    
    if (!ADMIN_USER_IDS.has(userId)) {
      await this.replyWithTracking(ctx, '❌ У вас нет прав администратора.');
      return;
    }
    
    const targetId = parseInt(targetUserId);
    rateLimitService.resetUserLimits(targetId);
    
    await this.replyWithTracking(
      ctx,
      `🔓 Лимиты пользователя ${targetId} сброшены`
    );
  }

  /**
   * Статистика бота для админа
   */
  async handleBotStats(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    
    if (!ADMIN_USER_IDS.has(userId)) {
      await this.replyWithTracking(ctx, '❌ У вас нет прав администратора.');
      return;
    }
    
    const globalStats = this.userService.getGlobalStats();
    const rateLimitStats = rateLimitService.getStats();
    
    const statsText = [
      '📊 *Статистика бота:*',
      '',
      '👥 *Пользователи:*',
      `• Всего: ${globalStats.totalUsers}`,
      `• Активные: ${globalStats.activeUsers}`,
      `• Заблокированные: ${rateLimitStats.blockedUsers}`,
      `• VIP: ${rateLimitStats.activeVipUsers}`,
      '',
      '💬 *Сообщения:*',
      `• Всего: ${globalStats.totalMessages}`,
      `• Нарушения лимитов: ${rateLimitStats.totalViolations}`,
      '',
      '💾 *Система:*',
      `• Память: ${globalStats.memoryUsage}`,
      `• Время работы: ${Math.round(process.uptime() / 60)} мин`
    ].join('\n');
    
    await this.replyWithTracking(ctx, statsText, {
      parse_mode: 'Markdown'
    });
  }

  /**
   * Проверяем права админа
   */
  isAdmin(userId: number): boolean {
    return ADMIN_USER_IDS.has(userId);
  }

  /**
   * Добавить админа
   */
  addAdmin(userId: number): void {
    ADMIN_USER_IDS.add(userId);
  }

  /**
   * Убрать админа
   */
  removeAdmin(userId: number): void {
    ADMIN_USER_IDS.delete(userId);
  }
}
