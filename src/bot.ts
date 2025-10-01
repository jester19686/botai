/**
 * 🤖 ГЛАВНЫЙ ФАЙЛ БОТА (РЕФАКТОРИНГ)
 * 
 * Основная логика бота с подключенными модулями
 */

import { config as loadEnv } from 'dotenv';
import { Telegraf, type Context, type MiddlewareFn } from 'telegraf';
import { z } from 'zod';

// Сервисы
import { UserService } from './services/userService.js';
import { rateLimitService } from './services/rateLimitService.js';
import { OpenRouterService } from './services/openRouterService.js';
import { MessageService } from './services/messageService.js';
import { TelegramFileService } from './services/telegramFileService.js';

// Обработчики
import { CommandHandlers } from './handlers/commandHandlers.js';
import { KeyboardHandlers } from './handlers/keyboardHandlers.js';
import { CallbackHandlers } from './handlers/callbackHandlers.js';

// Утилиты
import { getMainMenuKeyboard } from './utils/keyboards.js';

// Типы и константы
import { AVAILABLE_MODELS } from './types/bot.js';

// Существующие модули (пока оставляем как есть)
import { createNonBlockingImageHandler } from './nonBlockingImageHandler.js';
import './health.js';

// Загрузка конфигурации
loadEnv();

// Валидация конфигурации
const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Необходимо указать TELEGRAM_BOT_TOKEN в файле .env'),
  OPENROUTER_API_KEY: z.string().min(1, 'Необходимо указать OPENROUTER_API_KEY в файле .env'),
  OPENROUTER_MODEL: z.string().min(1).default('x-ai/grok-4-fast:free'),
  SYSTEM_PROMPT: z.string().min(1).default('Отвечай простым текстом на русском. Запрещено: эмодзи, ASCII-рамки/разделители, markdown-заголовки и списки. Не добавляй лишних разделителей. Давай только суть.')
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const flattened = parsedEnv.error.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors).flatMap(([field, errors]) =>
    (errors ?? []).map((error) => `${field}: ${error}`)
  );
  const messages = [...flattened.formErrors, ...fieldErrors];
  console.error('⚠️ Ошибка конфигурации:\n', messages.join('\n'));
  process.exit(1);
}

const ENV = parsedEnv.data;

/**
 * Основной класс бота
 */
export class TelegramBot {
  private bot: Telegraf;
  
  // Сервисы
  private userService: UserService;
  private openRouterService: OpenRouterService;
  private messageService: MessageService;
  private telegramFileService: TelegramFileService;
  
  // Обработчики
  private commandHandlers: CommandHandlers;
  private keyboardHandlers: KeyboardHandlers;
  private callbackHandlers: CallbackHandlers;

  // Состояния
  private userStates = new Map<number, string>();
  private userActiveRequests = new Map<number, boolean>();

  constructor() {
    // Инициализация сервисов
    this.userService = new UserService(ENV.OPENROUTER_MODEL, ENV.SYSTEM_PROMPT);
    this.openRouterService = new OpenRouterService(ENV.OPENROUTER_API_KEY);
    this.messageService = new MessageService();
    this.telegramFileService = new TelegramFileService();
    
    // Создание бота
    this.bot = new Telegraf(ENV.TELEGRAM_BOT_TOKEN, {
      telegram: {
        agent: undefined,
        attachmentAgent: undefined,
        testEnv: false
      },
      handlerTimeout: 180_000
    });

    // Инициализация обработчиков
    this.commandHandlers = new CommandHandlers(
      this.userService,
      this.replyWithTracking.bind(this)
    );

    this.keyboardHandlers = new KeyboardHandlers(
      this.userService,
      this.replyWithTracking.bind(this),
      this.clearAllChatMessages.bind(this),
      this.sendHelpMessage.bind(this)
    );

    this.callbackHandlers = new CallbackHandlers(
      this.userService,
      this.messageService,
      this.replyWithTracking.bind(this),
      this.clearAllChatMessages.bind(this),
      ENV.SYSTEM_PROMPT,
      this.setUserState.bind(this),
      this.clearUserState.bind(this)
    );

    // Настройка бота
    this.setupMiddleware();
    this.setupHandlers();
  }

  /**
   * Настройка middleware
   */
  private setupMiddleware(): void {
    // Middleware для приватных чатов
    const ensurePrivateChat: MiddlewareFn<Context> = async (ctx, next) => {
      if (ctx.chat?.type !== 'private') {
        await this.replyWithTracking(ctx, '⚠️ Бот поддерживает работу только в приватных чатах.');
        return;
      }
      return next();
    };

    this.bot.use(ensurePrivateChat);

    // Rate limiting middleware для команд
    this.bot.command(/(start|help|settings|reset|debug|stats|admin)/, 
      rateLimitService.createMiddleware('command')
    );

    // Rate limiting middleware для текстовых сообщений
    this.bot.on('text', rateLimitService.createMiddleware('text_message'));

    // Rate limiting middleware для изображений  
    this.bot.on('photo', rateLimitService.createMiddleware('image_processing'));
  }

  /**
   * Настройка обработчиков
   */
  private setupHandlers(): void {
    // Команды
    this.bot.start(this.commandHandlers.handleStart.bind(this.commandHandlers));
    this.bot.command('reset', this.commandHandlers.handleReset.bind(this.commandHandlers));
    this.bot.command('settings', this.commandHandlers.handleSettings.bind(this.commandHandlers));
    this.bot.command('help', this.commandHandlers.handleHelp.bind(this.commandHandlers));
    this.bot.command('debug', this.commandHandlers.handleDebug.bind(this.commandHandlers));
    this.bot.command('stats', this.commandHandlers.handleStats.bind(this.commandHandlers));
    this.bot.command('admin', this.commandHandlers.handleAdmin.bind(this.commandHandlers));

    // Текстовые кнопки
    this.bot.hears(['💬 Новый чат', '🔄 Сбросить историю', 'ℹ️ Помощь', '⚙️ Настройки'], 
      this.keyboardHandlers.handleKeyboardButton.bind(this.keyboardHandlers)
    );

    // Callback кнопки (пока оставляем как есть)
    this.setupCallbackHandlers();

    // Обработка сообщений
    this.bot.on('text', this.handleTextMessage.bind(this));
    this.bot.on('photo', this.setupImageHandler());
    this.bot.on(['document', 'video', 'audio', 'voice', 'sticker'], this.handleUnsupportedMedia.bind(this));

    // Глобальная обработка ошибок
    this.bot.catch(this.handleError.bind(this));
  }

  /**
   * Настройка callback обработчиков
   */
  private setupCallbackHandlers(): void {
    // Welcome callbacks
    this.bot.action('welcome:start', async (ctx) => {
      await ctx.answerCbQuery('Давайте начнём!');
      await ctx.editMessageText('🚀 Отлично! Просто напишите сообщение, и я отвечу.');
    });

    this.bot.action('welcome:help', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '❓ *Как работает бот*\n\n' +
          '1. Вы отправляете вопрос или просьбу.\n' +
          '2. Я обращаюсь к модели OpenRouter.\n' +
          '3. Возвращаю подробный и красиво оформленный ответ.\n\n' +
          'Используйте кнопки меню для дополнительных действий.',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.action('welcome:settings', async (ctx) => {
      await ctx.answerCbQuery();
      if (!ctx.from) return;
      
      const { getSettingsButtons } = await import('./utils/keyboards.js');
      await ctx.editMessageText('⚙️ Открываю настройки...', getSettingsButtons(ctx.from.id));
    });

    // Settings callbacks
    this.bot.action(/settings:model:(\d+)/, this.callbackHandlers.handleSettingsModel.bind(this.callbackHandlers));
    this.bot.action(/settings:selectmodel:(\d+):(.+)/, this.callbackHandlers.handleSelectModel.bind(this.callbackHandlers));
    this.bot.action(/settings:prompt:(\d+)/, this.callbackHandlers.handleSettingsPrompt.bind(this.callbackHandlers));
    this.bot.action(/settings:editprompt:(\d+)/, this.callbackHandlers.handleEditPrompt.bind(this.callbackHandlers));
    this.bot.action(/settings:resetprompt:(\d+)/, this.callbackHandlers.handleResetPrompt.bind(this.callbackHandlers));
    this.bot.action(/settings:canceledit:(\d+)/, this.callbackHandlers.handleCancelEdit.bind(this.callbackHandlers));
    this.bot.action(/settings:back:(\d+)/, this.callbackHandlers.handleSettingsBack.bind(this.callbackHandlers));
    this.bot.action(/settings:close:(\d+)/, this.callbackHandlers.handleSettingsClose.bind(this.callbackHandlers));
    this.bot.action(/settings:stats:(\d+)/, this.callbackHandlers.handleUserStatsFromSettings.bind(this.callbackHandlers));

    // Reset callbacks
    this.bot.action(/reset:confirm:(\d+)/, this.callbackHandlers.handleResetConfirm.bind(this.callbackHandlers));
    this.bot.action(/reset:cancel:(\d+)/, this.callbackHandlers.handleResetCancel.bind(this.callbackHandlers));

    // Admin callbacks
    this.bot.action(/admin:stats:(\d+)/, async (ctx) => {
      if (this.commandHandlers.isAdmin(ctx.from!.id)) {
        await this.commandHandlers.handleBotStats(ctx as any);
      }
    });

    // Pagination callbacks
    this.bot.action(/page:(prev|next):(\-?\d+):(\d+)/, async (ctx) => {
      const direction = ctx.match[1] as 'prev' | 'next';
      await this.callbackHandlers.handlePagination(ctx, direction);
    });

    // Noop callback
    this.bot.action(/noop:(\d+)/, this.callbackHandlers.handleNoop.bind(this.callbackHandlers));
  }

  /**
   * Настройка обработчика изображений
   */
  private setupImageHandler() {
    return createNonBlockingImageHandler({
      doesUserModelSupportImages: (userId) => this.doesUserModelSupportImages(userId),
      AVAILABLE_MODELS,
      getUserModel: (userId) => this.userService.getUserModel(userId),
      replyWithTracking: this.replyWithTracking.bind(this),
      trackUserMessage: (userId, messageId) => this.userService.trackUserMessage(userId, messageId),
      isUserRequestActive: (userId) => this.userActiveRequests.has(userId),
      checkUserRateLimit: (userId) => rateLimitService.checkLimit(userId, 'image_processing').allowed,
      USER_RATE_LIMIT_MS: 2000,
      userLastRequest: new Map(),
      tgFileToDataUrl: (ctx, fileId) => this.telegramFileService.tgFileToDataUrl(ctx, fileId),
      callOpenRouter: (messages, userId) => {
        const userModel = this.userService.getUserModel(userId);
        return this.openRouterService.callOpenRouter(messages, userId, userModel);
      },
      buildHistory: (userId) => this.userService.buildHistory(userId),
      getUserSystemPrompt: (userId) => this.userService.getUserSystemPrompt(userId),
      appendToHistory: (userId, message) => this.userService.appendToHistory(userId, message),
      sendAnswer: (ctx, answer, statusMessage) => this.messageService.sendAnswer(ctx, answer, statusMessage, getMainMenuKeyboard, this.replyWithTracking.bind(this)),
      getMainMenuKeyboard,
      userActiveRequests: this.userActiveRequests
    });
  }

  /**
   * Вспомогательный метод для отправки с отслеживанием
   */
  private async replyWithTracking(ctx: Context, text: string, extra?: any): Promise<any> {
    const message = await ctx.reply(text, extra);
    if (ctx.from) {
      this.userService.trackBotMessage(ctx.from.id, message.message_id);
    }
    return message;
  }

  /**
   * Проверка поддержки изображений моделью
   */
  private doesUserModelSupportImages(userId: number): boolean {
    const userModel = this.userService.getUserModel(userId);
    const model = AVAILABLE_MODELS.find(m => m.id === userModel);
    return model?.supportsImages ?? false;
  }

  /**
   * Обработка текстовых сообщений
   */
  private async handleTextMessage(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const text = (ctx.message as any)?.text?.trim();
    
    if (!text) return;

    // Проверяем, не является ли это редактированием промпта
    const userState = this.userStates.get(userId);
    
    if (userState === 'awaiting_prompt') {
      const success = await this.callbackHandlers.handlePromptInput(ctx, userId, text);
      if (success) {
        this.userStates.delete(userId);
      }
      return;
    }

    // Основная обработка текстового сообщения
    await this.processTextMessage(ctx, userId, text);
  }

  /**
   * Основная обработка текстового сообщения
   */
  private async processTextMessage(ctx: Context, userId: number, text: string): Promise<void> {
    let emergencyUnlock: NodeJS.Timeout | undefined;

    // КРИТИЧЕСКАЯ СЕКЦИЯ: Атомарная проверка и установка блокировки
    const isActive = this.userActiveRequests.has(userId);
    const isProcessingImage = this.isProcessingImageForUser(userId);
    
    if (isActive || isProcessingImage) {
      console.log(`🚫 Заблокирован текстовый запрос от пользователя ${userId} - активен другой запрос`);
      
      // Удаляем новое сообщение пользователя
      try {
        await ctx.telegram.deleteMessage(ctx.chat!.id, ctx.message!.message_id);
      } catch (error) {
        console.warn(`⚠️ Не удалось удалить сообщение пользователя: ${(error as Error).message}`);
      }
      
      // Отправляем предупреждение с автоудалением
      const warningMessage = await this.replyWithTracking(ctx, 
        `⏳ Дождитесь окончания обработки предыдущего запроса. Одновременно можно обрабатывать только один запрос.`,
        { reply_markup: getMainMenuKeyboard().reply_markup }
      );
      
      // Автоматически удаляем предупреждение через 12 секунд
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(ctx.chat!.id, warningMessage.message_id);
        } catch (error) {
          // Игнорируем ошибки удаления
        }
      }, 12000);
      
      return;
    }

    // МГНОВЕННАЯ БЛОКИРОВКА: Устанавливаем блокировку ДО любых других операций  
    this.userActiveRequests.set(userId, true);

    // Добавляем автоматическую очистку блокировки через 3 минуты на случай зависания
    emergencyUnlock = setTimeout(() => {
      console.warn(`⚠️ Экстренная разблокировка пользователя ${userId} (таймаут 3 мин)`);
      this.userActiveRequests.delete(userId);
    }, 180_000);

    // Отслеживаем сообщение пользователя для возможности удаления
    this.userService.trackUserMessage(userId, ctx.message!.message_id);

    const statusMessage = await this.replyWithTracking(ctx, '⏳ Генерирую ответ...', {
      reply_markup: getMainMenuKeyboard().reply_markup
    }) as any;

    let requestCompleted = false;
    
    const longWaitTimer = setTimeout(() => {
      if (!requestCompleted) {
        void this.messageService.safeEditMessage(
          ctx,
          statusMessage.chat.id,
          statusMessage.message_id,
          '⏳ Запрос занимает больше времени обычного. Пожалуйста, подождите ещё немного...'
        );
      }
    }, 15_000);

    try {
      // Добавляем сообщение пользователя в историю
      this.userService.appendToHistory(userId, { role: 'user', content: text });
      
      // Формируем историю для отправки в AI
      const history = this.userService.buildHistory(userId);
      const messages = [
        { role: 'system', content: this.userService.getUserSystemPrompt(userId) },
        ...history
      ];
      
      // Вызываем OpenRouter
      const userModel = this.userService.getUserModel(userId);
      const assistantReply = await this.openRouterService.callOpenRouter(messages, userId, userModel);
      
      requestCompleted = true;
      
      // Сохраняем ответ в историю
      this.userService.appendToHistory(userId, { role: 'assistant', content: assistantReply });
      
      // Отправляем ответ
      await this.messageService.sendAnswer(ctx, assistantReply, statusMessage, getMainMenuKeyboard, this.replyWithTracking.bind(this));
      
    } catch (error) {
      requestCompleted = true;
      const message = error instanceof Error ? error.message : 'Произошла непредвиденная ошибка';
      const friendlyMessage = this.getFriendlyErrorMessage(message);
      
      const edited = await this.messageService.safeEditMessage(
        ctx, 
        statusMessage.chat.id, 
        statusMessage.message_id, 
        friendlyMessage
      );
      
      if (!edited) {
        await this.replyWithTracking(ctx, friendlyMessage, {
          reply_markup: getMainMenuKeyboard().reply_markup
        });
      }
    } finally {
      // В любом случае снимаем пометку об активном запросе
      this.userActiveRequests.delete(userId);
      clearTimeout(longWaitTimer);
      if (emergencyUnlock) clearTimeout(emergencyUnlock);
    }
  }

  /**
   * Получить дружественное сообщение об ошибке
   */
  private getFriendlyErrorMessage(message: string): string {
    if (/401/.test(message)) {
      return '❌ Ошибка авторизации в OpenRouter. Проверьте API-ключ и доступы.';
    }
    if (/403/.test(message) || message.includes('not available in your region')) {
      return '🔧 Сервер не работает в данный момент. Попробуйте зайти позже.';
    }
    return `❌ Ошибка: ${message}`;
  }

  /**
   * Проверить, обрабатывается ли изображение для пользователя
   */
  private isProcessingImageForUser(userId: number): boolean {
    // Интегрируем с imageProcessor когда он будет доступен
    try {
      const { imageProcessor } = require('./imageProcessor.js');
      return imageProcessor.isProcessingForUser(userId);
    } catch {
      return false;
    }
  }

  /**
   * Обработка неподдерживаемых медиафайлов
   */
  private async handleUnsupportedMedia(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    
    this.userService.trackUserMessage(userId, ctx.message!.message_id);
    
    try {
      await ctx.deleteMessage();
    } catch (error) {
      console.warn('⚠️ Не удалось удалить сообщение с файлом:', (error as Error).message);
    }
    
    await this.replyWithTracking(ctx, 
      '❌ Поддерживаются только изображения.\n\n💡 Отправьте фото для анализа (если используете Grok 4 Fast) или текстовое сообщение.',
      { reply_markup: getMainMenuKeyboard().reply_markup }
    );
  }

  /**
   * Обработка ошибок бота
   */
  private handleError(error: any, ctx?: Context): void {
    console.error('❌ Ошибка в боте:', error);
    if (ctx && ctx.chat) {
      ctx.reply('🚨 Произошла внутренняя ошибка. Попробуйте еще раз позже.')
        .catch(() => console.error('❌ Не удалось отправить сообщение об ошибке пользователю'));
    }
  }

  /**
   * Очистка всех сообщений в чате
   */
  private async clearAllChatMessages(ctx: Context, userId: number, excludeMessageIds: number[] = []): Promise<void> {
    const chatId = ctx.chat?.id ?? (ctx as any).callbackQuery?.message?.chat.id ?? userId;
    
    console.log(`🗑️ Начинаю очистку всех сообщений для пользователя ${userId}`);
    
    // Удаляем все отслеживаемые сообщения (бота и пользователя), кроме исключений
    const allMessages = this.userService.getUserAllMessages(userId);
    const messagesToDelete = Array.from(allMessages).filter(id => !excludeMessageIds.includes(id));
    
    if (messagesToDelete.length > 0) {
      console.log(`📝 Найдено ${messagesToDelete.length} сообщений для удаления (исключено: ${excludeMessageIds.length})`);
      
      // ОПТИМИЗАЦИЯ: Параллельное удаление сообщений вместо последовательного
      const deletePromises = messagesToDelete.map(async (messageId) => {
        try {
          await ctx.telegram.deleteMessage(chatId, messageId);
          return { success: true, messageId };
        } catch (error) {
          const errorMsg = (error as Error).message;
          // Не показываем ошибки для старых сообщений (48+ часов)
          if (!errorMsg.includes('message to delete not found') && !errorMsg.includes('message can\'t be deleted')) {
            console.warn(`⚠️ Не удалось удалить сообщение ${messageId}: ${errorMsg}`);
          }
          return { success: false, messageId };
        }
      });

      // Ждём завершения всех операций параллельно
      const results = await Promise.allSettled(deletePromises);
      const deletedCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const errorCount = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
      
      console.log(`✅ Удалено ${deletedCount} сообщений, ошибок: ${errorCount}`);
    } else {
      console.log(`📝 Сообщений для удаления не найдено (всего отслеживается: ${allMessages.size})`);
    }
    
    // Небольшая задержка для стабилизации
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Временно скрываем системную клавиатуру для очистки
    try {
      const removeKeyboardMsg = await ctx.telegram.sendMessage(chatId, '🧹', {
        reply_markup: { remove_keyboard: true }
      });
      // Сразу удаляем это служебное сообщение
      await ctx.telegram.deleteMessage(chatId, removeKeyboardMsg.message_id);
    } catch (error) {
      // Игнорируем ошибки очистки клавиатуры
    }
    
    // Очищаем все tracking карты
    this.userService.clearUserMessages(userId);
    
    // Очищаем состояния пагинации
    this.messageService.clearChatPaginationStates(chatId);
    
    console.log(`🗑️ Очистка завершена для пользователя ${userId}`);
  }

  /**
   * Отправка справочного сообщения
   */
  private async sendHelpMessage(ctx: Context): Promise<void> {
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
   * Установить состояние ожидания промпта
   */
  setUserState(userId: number, state: string): void {
    this.userStates.set(userId, state);
  }

  /**
   * Убрать состояние пользователя
   */
  clearUserState(userId: number): void {
    this.userStates.delete(userId);
  }

  /**
   * Запуск бота
   */
  public async launch(): Promise<void> {
    try {
      await this.bot.launch();
      console.log('🤖 Бот успешно запущен (рефакторинг версия)');
      console.log(`🌐 Режим: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📡 Railway: ${process.env.RAILWAY_ENVIRONMENT ? 'YES' : 'NO'}`);
    } catch (error) {
      console.error('❌ Ошибка запуска бота:', error);
      process.exit(1);
    }
  }

  /**
   * Остановка бота
   */
  public async stop(signal?: string): Promise<void> {
    console.log(`🛑 Получен ${signal || 'STOP'}, завершаю работу...`);
    await this.bot.stop(signal);
    console.log('✅ Бот остановлен');
  }
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`🛑 Получен ${signal}, завершаю работу...`);
  process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
