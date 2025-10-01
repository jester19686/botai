/**
 * 🚀 НОВЫЙ ГЛАВНЫЙ ФАЙЛ БОТА
 * 
 * Использует рефакторинговую версию с модульной архитектурой
 */

import { TelegramBot } from './bot.js';

// Создаем и запускаем бота
const bot = new TelegramBot();

bot.launch().catch((error) => {
  console.error('❌ Критическая ошибка при запуске:', error);
  process.exit(1);
});

// Обработка сигналов завершения
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
