/**
 * 👤 СЕРВИС УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯМИ
 * 
 * Централизованное управление пользовательскими данными и настройками
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UserSettings } from '../types/bot.js';

export class UserService {
  private userSettings = new Map<number, UserSettings>();
  private userHistories = new Map<number, any[]>();
  private userBotMessages = new Map<number, Set<number>>();
  private userAllMessages = new Map<number, Set<number>>();
  
  private readonly SETTINGS_FILE = join(process.cwd(), 'user_settings.json');
  private readonly MESSAGES_FILE = join(process.cwd(), 'user_messages.json');
  
  // LRU кэш для ограничения памяти
  private readonly MAX_USERS_IN_MEMORY = 1000;
  private userAccessTime = new Map<number, number>();

  constructor(
    private defaultModel: string,
    private defaultSystemPrompt: string
  ) {
    this.loadSavedSettings();
    this.loadSavedMessages();
  }

  /**
   * Получить настройки пользователя
   */
  getUserSettings(userId: number): UserSettings {
    this.updateUserAccess(userId);
    
    return this.userSettings.get(userId) || {
      model: this.defaultModel,
      systemPrompt: this.defaultSystemPrompt
    };
  }

  /**
   * Установить модель пользователя
   */
  setUserModel(userId: number, model: string): void {
    const settings = this.getUserSettings(userId);
    settings.model = model;
    this.userSettings.set(userId, settings);
    this.saveUserSettings();
  }

  /**
   * Получить модель пользователя
   */
  getUserModel(userId: number): string {
    return this.getUserSettings(userId).model;
  }

  /**
   * Установить системный промпт пользователя
   */
  setUserSystemPrompt(userId: number, systemPrompt: string): void {
    const settings = this.getUserSettings(userId);
    settings.systemPrompt = systemPrompt;
    this.userSettings.set(userId, settings);
    this.saveUserSettings();
  }

  /**
   * Получить системный промпт пользователя
   */
  getUserSystemPrompt(userId: number): string {
    return this.getUserSettings(userId).systemPrompt;
  }

  /**
   * Получить историю пользователя
   */
  buildHistory(userId: number): any[] {
    this.updateUserAccess(userId);
    
    if (!this.userHistories.has(userId)) {
      this.userHistories.set(userId, []);
    }
    return this.userHistories.get(userId)!;
  }

  /**
   * Добавить сообщение в историю
   */
  appendToHistory(userId: number, message: any): void {
    const history = this.buildHistory(userId);
    history.push(message);
    
    // Ограничиваем историю
    const MAX_HISTORY = 10;
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
  }

  /**
   * Сбросить историю пользователя
   */
  resetHistory(userId: number): void {
    this.updateUserAccess(userId);
    this.userHistories.set(userId, []);
  }

  /**
   * Отследить сообщение бота
   */
  trackBotMessage(userId: number, messageId: number): void {
    const messages = this.userBotMessages.get(userId) ?? new Set<number>();
    messages.add(messageId);
    this.userBotMessages.set(userId, messages);
    
    // Также отслеживаем в общем списке
    const allMessages = this.userAllMessages.get(userId) ?? new Set<number>();
    allMessages.add(messageId);
    this.userAllMessages.set(userId, allMessages);
    
    this.saveCurrentMessages();
  }

  /**
   * Отследить сообщение пользователя
   */
  trackUserMessage(userId: number, messageId: number): void {
    const allMessages = this.userAllMessages.get(userId) ?? new Set<number>();
    allMessages.add(messageId);
    this.userAllMessages.set(userId, allMessages);
    this.saveCurrentMessages();
  }

  /**
   * Получить сообщения бота для пользователя
   */
  getUserBotMessages(userId: number): Set<number> {
    return this.userBotMessages.get(userId) ?? new Set<number>();
  }

  /**
   * Получить все сообщения пользователя
   */
  getUserAllMessages(userId: number): Set<number> {
    return this.userAllMessages.get(userId) ?? new Set<number>();
  }

  /**
   * Очистить сообщения пользователя
   */
  clearUserMessages(userId: number): void {
    this.userBotMessages.set(userId, new Set());
    this.userAllMessages.set(userId, new Set());
    this.saveCurrentMessages();
  }

  /**
   * Получить статистику пользователя
   */
  getUserStats(userId: number): {
    totalMessages: number;
    botMessages: number;
    historyLength: number;
    model: string;
    joinedAt: Date | null;
  } {
    return {
      totalMessages: this.userAllMessages.get(userId)?.size || 0,
      botMessages: this.userBotMessages.get(userId)?.size || 0,
      historyLength: this.userHistories.get(userId)?.length || 0,
      model: this.getUserModel(userId),
      joinedAt: null // TODO: добавить в будущем
    };
  }

  /**
   * Получить общую статистику
   */
  getGlobalStats(): {
    totalUsers: number;
    activeUsers: number;
    totalMessages: number;
    memoryUsage: string;
  } {
    let totalMessages = 0;
    for (const messages of this.userAllMessages.values()) {
      totalMessages += messages.size;
    }

    const memoryUsage = `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`;

    return {
      totalUsers: this.userSettings.size,
      activeUsers: this.userAccessTime.size,
      totalMessages,
      memoryUsage
    };
  }

  /**
   * Обновить время последнего доступа пользователя
   */
  private updateUserAccess(userId: number): void {
    this.userAccessTime.set(userId, Date.now());
    
    // Периодически очищаем память
    if (Math.random() < 0.01) { // 1% шанс на проверку
      this.cleanupOldUsers();
    }
  }

  /**
   * Очистка старых пользователей из памяти
   */
  private cleanupOldUsers(): void {
    if (this.userHistories.size <= this.MAX_USERS_IN_MEMORY) return;
    
    // Сортируем по времени последнего доступа
    const sortedUsers = Array.from(this.userAccessTime.entries())
      .sort(([, a], [, b]) => a - b)
      .slice(0, this.userHistories.size - this.MAX_USERS_IN_MEMORY);
      
    for (const [userId] of sortedUsers) {
      this.userHistories.delete(userId);
      this.userBotMessages.delete(userId);
      this.userAllMessages.delete(userId);
      this.userAccessTime.delete(userId);
    }
    
    console.log(`🧹 Очищено ${sortedUsers.length} неактивных пользователей из памяти`);
  }

  /**
   * Загрузка сохранённых настроек
   */
  private loadSavedSettings(): void {
    try {
      if (existsSync(this.SETTINGS_FILE)) {
        const data = readFileSync(this.SETTINGS_FILE, 'utf-8');
        const savedSettings = JSON.parse(data);
        
        for (const [userIdStr, settings] of Object.entries(savedSettings)) {
          const userId = parseInt(userIdStr);
          this.userSettings.set(userId, settings as UserSettings);
        }
        
        console.log(`⚙️ Загружено настроек для ${Object.keys(savedSettings).length} пользователей`);
      }
    } catch (error) {
      console.warn('⚠️ Не удалось загрузить настройки пользователей:', (error as Error).message);
    }
  }

  /**
   * Сохранение настроек пользователей
   */
  private async saveUserSettings(): Promise<void> {
    try {
      const settingsObject: Record<string, UserSettings> = {};
      this.userSettings.forEach((settings, userId) => {
        settingsObject[userId.toString()] = settings;
      });
      
      await writeFile(this.SETTINGS_FILE, JSON.stringify(settingsObject, null, 2), 'utf-8');
    } catch (error) {
      console.warn('⚠️ Не удалось сохранить настройки пользователей:', (error as Error).message);
    }
  }

  /**
   * Загрузка сохранённых сообщений
   */
  private loadSavedMessages(): void {
    try {
      if (existsSync(this.MESSAGES_FILE)) {
        const data = readFileSync(this.MESSAGES_FILE, 'utf-8');
        const savedMessages = JSON.parse(data);
        
        for (const [userIdStr, messages] of Object.entries(savedMessages)) {
          const userId = parseInt(userIdStr);
          const messageData = messages as { botMessages: number[]; allMessages: number[] };
          
          this.userBotMessages.set(userId, new Set(messageData.botMessages));
          this.userAllMessages.set(userId, new Set(messageData.allMessages));
        }
        
        console.log(`📂 Загружено сообщений для ${Object.keys(savedMessages).length} пользователей`);
      }
    } catch (error) {
      console.warn('⚠️ Не удалось загрузить сохранённые ID сообщений:', (error as Error).message);
    }
  }

  /**
   * Сохранение сообщений (с батчингом)
   */
  private saveTimeout: NodeJS.Timeout | null = null;
  private pendingSave = false;

  private saveCurrentMessages(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    this.saveTimeout = setTimeout(async () => {
      if (this.pendingSave) return;
      this.pendingSave = true;
      
      try {
        const userMessages: Record<string, any> = {};
        for (const [userId, messages] of this.userAllMessages.entries()) {
          const botMessages = this.userBotMessages.get(userId) || new Set();
          userMessages[userId.toString()] = {
            botMessages: Array.from(botMessages),
            allMessages: Array.from(messages)
          };
        }
        
        writeFileSync(this.MESSAGES_FILE, JSON.stringify(userMessages));
      } catch (error) {
        console.warn('⚠️ Ошибка сохранения сообщений:', (error as Error).message);
      } finally {
        this.pendingSave = false;
        this.saveTimeout = null;
      }
    }, 1000); // Группируем сохранения в батчи по 1 секунде
  }
}
