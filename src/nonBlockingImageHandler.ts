/**
 * 🚀 НЕБЛОКИРУЮЩИЙ ОБРАБОТЧИК ИЗОБРАЖЕНИЙ
 * 
 * Замена для блокирующего обработчика в основном файле
 */

import type { Context } from 'telegraf';
import type { Message as TelegramMessage } from 'telegraf/typings/core/types/typegram';
import { imageProcessor, type ImageProcessingJob } from './imageProcessor.js';

/**
 * Создает неблокирующий обработчик изображений
 */
export function createNonBlockingImageHandler(dependencies: {
  doesUserModelSupportImages: (userId: number) => boolean;
  AVAILABLE_MODELS: readonly any[];
  getUserModel: (userId: number) => string;
  replyWithTracking: (ctx: Context, text: string, extra?: any) => Promise<TelegramMessage>;
  trackUserMessage: (userId: number, messageId: number) => void;
  isUserRequestActive: (userId: number) => boolean;
  checkUserRateLimit: (userId: number) => boolean;
  USER_RATE_LIMIT_MS: number;
  userLastRequest: Map<number, number>;
  tgFileToDataUrl: (ctx: Context, fileId: string) => Promise<string>;
  callOpenRouter: (messages: any[], userId: number) => Promise<string>;
  buildHistory: (userId: number) => any[];
  getUserSystemPrompt: (userId: number) => string;
  appendToHistory: (userId: number, message: any) => void;
  sendAnswer: (ctx: Context, answer: string, statusMessage: TelegramMessage.TextMessage) => Promise<void>;
  getMainMenuKeyboard: () => any;
  userActiveRequests: Map<number, boolean>;
}) {

  return async (ctx: Context) => {
    const userId = ctx.from!.id;
    let statusMessage: TelegramMessage.TextMessage | undefined;

    // Отслеживаем сообщение с изображением
    dependencies.trackUserMessage(userId, ctx.message!.message_id);

    try {
      // 1. НЕМЕДЛЕННЫЕ ПРОВЕРКИ (без блокировки)
      
      // Проверяем поддержку изображений
      if (!dependencies.doesUserModelSupportImages(userId)) {
        const currentModel = dependencies.AVAILABLE_MODELS.find(m => m.id === dependencies.getUserModel(userId));
        
        try {
          await ctx.deleteMessage();
        } catch (error) {
          console.warn('⚠️ Не удалось удалить сообщение с изображением:', (error as Error).message);
        }
        
        await dependencies.replyWithTracking(ctx, 
          `❌ Модель ${currentModel?.name || 'текущая'} не поддерживает обработку изображений.\n\n💡 Переключитесь на Grok 4 Fast в настройках для работы с изображениями.`, 
          { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
        );
        return;
      }

      // Проверяем rate limit
      if (!dependencies.checkUserRateLimit(userId)) {
        const waitTime = Math.ceil((dependencies.USER_RATE_LIMIT_MS - (Date.now() - (dependencies.userLastRequest.get(userId) || 0))) / 1000);
        
        await dependencies.replyWithTracking(ctx, 
          `⏳ Слишком быстро! Подождите ${waitTime} секунд между сообщениями.`, 
          { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
        );
        return;
      }

      // Проверяем, не обрабатывается ли уже запрос для этого пользователя (ТЕКСТ ИЛИ ИЗОБРАЖЕНИЕ)
      if (dependencies.isUserRequestActive(userId) || imageProcessor.isProcessingForUser(userId)) {
        console.log(`🚫 Заблокировано изображение от пользователя ${userId} - активен другой запрос`);
        
        try {
          await ctx.deleteMessage();
        } catch (error) {
          console.warn(`⚠️ Не удалось удалить изображение пользователя: ${(error as Error).message}`);
        }
        
        const warningMessage = await dependencies.replyWithTracking(ctx, 
          `⏳ Дождитесь окончания обработки предыдущего запроса. Одновременно можно обрабатывать только один запрос.`, 
          { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
        );
        
        // Автоудаление предупреждения через 10 секунд
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(ctx.chat!.id, warningMessage.message_id);
          } catch (error) {
            // Игнорируем ошибку
          }
        }, 10000);
        
        return;
      }

      // 2. МГНОВЕННЫЙ ОТВЕТ ПОЛЬЗОВАТЕЛЮ
      console.log(`🖼️ Получено изображение от пользователя ${userId}, начинаю НЕБЛОКИРУЮЩУЮ обработку...`);
      
      statusMessage = await dependencies.replyWithTracking(
        ctx,
        '🖼️ Получил изображение! Обрабатываю в фоне...\n⚡ Бот остается активным для других команд',
        { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
      ) as TelegramMessage.TextMessage;

      // 3. ПОДГОТОВКА ДАННЫХ (быстро, неблокирующе)
      const photos = (ctx.message as any).photo || [];
      const largest = photos[photos.length - 1];
      const caption = ((ctx.message as any).caption || '').trim();

      // Получаем data URL (может занять время, но не блокирует других пользователей)
      const dataUrl = await dependencies.tgFileToDataUrl(ctx, largest.file_id);

      // 4. АСИНХРОННАЯ ОБРАБОТКА (в отдельной очереди)
      const job: ImageProcessingJob = {
        userId,
        chatId: ctx.chat!.id,
        fileId: largest.file_id,
        caption,
        dataUrl,
        messageId: ctx.message!.message_id,
        statusMessageId: statusMessage.message_id
      };

      // Запускаем неблокирующую обработку
      imageProcessor.processImageAsync(
        job,
        dependencies.callOpenRouter,
        dependencies.buildHistory,
        dependencies.getUserSystemPrompt,
        dependencies.appendToHistory
      ).then(async (assistantReply) => {
        // Обработка завершена успешно
        console.log(`✅ Неблокирующая обработка изображения завершена для пользователя ${userId}`);
        
        try {
          if (statusMessage) {
            await dependencies.sendAnswer(ctx, assistantReply, statusMessage);
          } else {
            // Fallback если statusMessage не определен
            await dependencies.replyWithTracking(ctx, assistantReply, {
              reply_markup: dependencies.getMainMenuKeyboard().reply_markup
            });
          }
        } catch (error) {
          console.error('❌ Ошибка отправки результата:', error);
          
          try {
            if (statusMessage) {
              await ctx.telegram.editMessageText(
                ctx.chat!.id,
                statusMessage.message_id,
                undefined,
                '❌ Изображение обработано, но произошла ошибка при отправке результата. Попробуйте еще раз.',
                { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
              );
            } else {
              await dependencies.replyWithTracking(ctx, 
                '❌ Изображение обработано, но произошла ошибка при отправке результата. Попробуйте еще раз.',
                { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
              );
            }
          } catch (editError) {
            console.error('❌ Не удалось обновить статусное сообщение:', editError);
          }
        }
        
      }).catch(async (error) => {
        // Обработка завершена с ошибкой
        console.error(`❌ Ошибка неблокирующей обработки изображения для пользователя ${userId}:`, error);
        
        // Определяем тип ошибки для пользовательского сообщения
        let userMessage = '⚠️ Не удалось обработать изображение.';
        
        if (error instanceof Error) {
          if (error.message.includes('таймаут') || error.message.includes('timeout')) {
            userMessage = '⏰ Обработка изображения заняла слишком много времени. Попробуйте изображение меньшего размера.';
          } else if (error.message.includes('сетевым подключением') || error.message.includes('Connect Timeout')) {
            userMessage = '🌐 Проблемы с интернет-соединением. Проверьте подключение и попробуйте еще раз.';
          } else if (error.message.includes('слишком большой')) {
            userMessage = '📦 Изображение слишком большое. Попробуйте сжать изображение.';
          } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            userMessage = '🔑 Проблемы с авторизацией API. Попробуйте позже.';
          } else if (error.message.includes('429') || error.message.includes('rate limit')) {
            userMessage = '🚫 Превышен лимит запросов к API. Подождите немного.';
          } else if (error.message.includes('base64') || error.message.includes('кодирования')) {
            userMessage = '🔧 Ошибка обработки изображения. Попробуйте другой формат (PNG, JPEG).';
          }
        }
        
        // Обновляем статусное сообщение с ошибкой
        try {
          if (statusMessage) {
            // Пытаемся отредактировать сообщение
            try {
              await ctx.telegram.editMessageText(
                ctx.chat!.id,
                statusMessage.message_id,
                undefined,
                `${userMessage}\n\n💡 Попробуйте еще раз или обратитесь к администратору.`,
                { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
              );
            } catch (editError) {
              console.log('⚠️ Не удалось отредактировать статусное сообщение, удаляю и отправляю новое');
              
              // Удаляем статусное сообщение
              try {
                await ctx.telegram.deleteMessage(ctx.chat!.id, statusMessage.message_id);
              } catch (deleteError) {
                // Игнорируем ошибку удаления
              }
              
              // Отправляем новое сообщение
              await dependencies.replyWithTracking(ctx, 
                `${userMessage}\n\n💡 Попробуйте еще раз или обратитесь к администратору.`,
                { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
              );
            }
          } else {
            await dependencies.replyWithTracking(ctx, 
              `${userMessage}\n\n💡 Попробуйте еще раз или обратитесь к администратору.`,
              { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
            );
          }
        } catch (generalError) {
          console.error('❌ Критическая ошибка отправки сообщения об ошибке:', generalError);
        }
      });

      // 5. НЕМЕДЛЕННОЕ ВОЗВРАЩЕНИЕ УПРАВЛЕНИЯ
      // Функция завершается здесь, не дожидаясь обработки изображения!
      // Бот может обрабатывать другие сообщения пока изображение обрабатывается в фоне
      
      console.log(`🚀 Обработчик изображения для пользователя ${userId} завершен, обработка продолжается в фоне`);
      
    } catch (error) {
      console.error('❌ Критическая ошибка в обработчике изображений:', error);
      
      // Отправляем сообщение об ошибке
      const errorMessage = error instanceof Error 
        ? `❌ Произошла критическая ошибка: ${error.message}` 
        : '❌ Произошла неизвестная ошибка при обработке изображения.';
      
      try {
        if (statusMessage) {
          await ctx.telegram.editMessageText(
            ctx.chat!.id,
            statusMessage.message_id,
            undefined,
            errorMessage,
            { reply_markup: dependencies.getMainMenuKeyboard().reply_markup }
          );
        } else {
          await dependencies.replyWithTracking(ctx, errorMessage, {
            reply_markup: dependencies.getMainMenuKeyboard().reply_markup
          });
        }
      } catch (replyError) {
        console.error('❌ Не удалось отправить сообщение об ошибке:', replyError);
      }
    }
  };
}

/**
 * Получение статистики процессора изображений
 */
export function getImageProcessorStats() {
  return imageProcessor.getStats();
}

/**
 * Health check процессора изображений
 */
export async function getImageProcessorHealth() {
  return await imageProcessor.healthCheck();
}

/**
 * Очистка зависших задач
 */
export async function clearStaleImageJobs() {
  return await imageProcessor.clearStaleJobs();
}

/**
 * Shutdown процессора изображений
 */
export async function shutdownImageProcessor() {
  return await imageProcessor.shutdown();
}
