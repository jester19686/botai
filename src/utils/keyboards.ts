/**
 * ⌨️ КЛАВИАТУРЫ И UI КОМПОНЕНТЫ
 * 
 * Централизованное управление клавиатурами и inline кнопками
 */

import { Markup } from 'telegraf';
import { AVAILABLE_MODELS } from '../types/bot.js';

// Предсоздаём статические клавиатуры для производительности
const MAIN_MENU_KEYBOARD = Markup.keyboard([
  ['💬 Новый чат', '🔄 Сбросить историю'],
  ['ℹ️ Помощь', '⚙️ Настройки']
])
  .resize()
  .persistent();

const WELCOME_BUTTONS = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 Начать', 'welcome:start')],
  [Markup.button.callback('❓ Помощь', 'welcome:help')],
  [Markup.button.callback('🛠️ Настройки', 'welcome:settings')]
]);

/**
 * Получить основную клавиатуру
 */
export const getMainMenuKeyboard = () => MAIN_MENU_KEYBOARD;

/**
 * Получить приветственные кнопки
 */
export const getWelcomeButtons = () => WELCOME_BUTTONS;

/**
 * Кнопки подтверждения
 */
export const getConfirmationButtons = (userId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ Подтвердить', `reset:confirm:${userId}`)],
    [Markup.button.callback('❌ Отмена', `reset:cancel:${userId}`)]
  ]);

/**
 * Кнопки настроек
 */
export const getSettingsButtons = (userId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🧠 Выбрать модель', `settings:model:${userId}`)],
    [Markup.button.callback('📝 Системный промпт', `settings:prompt:${userId}`)],
    [Markup.button.callback('📊 Моя статистика', `settings:stats:${userId}`)],
    [Markup.button.callback('🔙 Закрыть', `settings:close:${userId}`)]
  ]);

/**
 * Кнопки выбора модели
 */
export const getModelSelectionButtons = (userId: number, currentModel: string) => {
  const buttons = AVAILABLE_MODELS.map(model => [
    Markup.button.callback(
      model.id === currentModel ? `✅ ${model.name}` : model.name,
      `settings:selectmodel:${userId}:${model.id}`
    )
  ]);
  buttons.push([Markup.button.callback('🔙 Назад к настройкам', `settings:back:${userId}`)]);
  return Markup.inlineKeyboard(buttons);
};

/**
 * Кнопки настройки промпта
 */
export const getPromptSettingsButtons = (userId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Изменить промпт', `settings:editprompt:${userId}`)],
    [Markup.button.callback('🔄 Сбросить до умолчания', `settings:resetprompt:${userId}`)],
    [Markup.button.callback('🔙 Назад к настройкам', `settings:back:${userId}`)]
  ]);

/**
 * Построить клавиатуру пагинации
 */
export const buildPaginationKeyboard = (total: number, current: number, chatId: number, messageId: number) => {
  const navigation: ReturnType<typeof Markup.button.callback>[] = [];

  if (current > 0) {
    navigation.push(Markup.button.callback('⬅️ Назад', `page:prev:${chatId}:${messageId}`));
  }
  if (current < total - 1) {
    navigation.push(Markup.button.callback('Далее ➡️', `page:next:${chatId}:${messageId}`));
  }

  if (navigation.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('✖️ Закрыть', `noop:${chatId}`)]
    ]);
  }

  return Markup.inlineKeyboard([navigation]);
};

/**
 * Административные кнопки (для админов)
 */
export const getAdminButtons = (userId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика бота', `admin:stats:${userId}`)],
    [Markup.button.callback('👥 Rate Limits', `admin:limits:${userId}`)],
    [Markup.button.callback('🧹 Очистка кэша', `admin:cleanup:${userId}`)],
    [Markup.button.callback('🔙 Закрыть', `admin:close:${userId}`)]
  ]);

/**
 * Кнопки управления rate limits (для админов)
 */
export const getRateLimitButtons = (targetUserId: number, adminId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔓 Сброс лимитов', `admin:reset_limits:${adminId}:${targetUserId}`)],
    [Markup.button.callback('⭐ Добавить в VIP', `admin:add_vip:${adminId}:${targetUserId}`)],
    [Markup.button.callback('❌ Убрать из VIP', `admin:remove_vip:${adminId}:${targetUserId}`)],
    [Markup.button.callback('🔙 Назад', `admin:limits:${adminId}`)]
  ]);
