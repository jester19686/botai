/**
 * 🚀 НЕБЛОКИРУЮЩИЙ ПРОЦЕССОР ИЗОБРАЖЕНИЙ
 * 
 * Обрабатывает изображения в отдельной очереди, не блокируя основной поток бота
 */

import { setTimeout as delay } from 'node:timers/promises';
import pLimit from 'p-limit';

// Типы
export interface ImageProcessingJob {
  userId: number;
  chatId: number;
  fileId: string;
  caption?: string;
  dataUrl: string;
  messageId: number;
  statusMessageId: number;
}

export interface ProcessingResult {
  success: boolean;
  result?: string;
  error?: string;
  processingTime: number;
}

export interface ImageProcessorConfig {
  maxConcurrentProcessing: number;
  requestTimeout: number;
  maxRetries: number;
}

/**
 * Неблокирующий процессор изображений
 */
export class ImageProcessor {
  private readonly concurrencyLimit: ReturnType<typeof pLimit>;
  private readonly config: ImageProcessorConfig;
  private readonly processingJobs = new Map<string, Promise<ProcessingResult>>();
  private readonly processingStartTimes = new Map<string, number>();
  
  // Метрики
  private stats = {
    totalProcessed: 0,
    totalSuccess: 0,
    totalFailed: 0,
    averageProcessingTime: 0,
    activeJobs: 0
  };

  constructor(config: Partial<ImageProcessorConfig> = {}) {
    this.config = {
      maxConcurrentProcessing: config.maxConcurrentProcessing || 3,
      requestTimeout: config.requestTimeout || 180000, // 3 минуты
      maxRetries: config.maxRetries || 2
    };
    
    this.concurrencyLimit = pLimit(this.config.maxConcurrentProcessing);
    
    console.log(`🖼️ ImageProcessor инициализирован с concurrency: ${this.config.maxConcurrentProcessing}`);
  }

  /**
   * Асинхронная обработка изображения (неблокирующая)
   */
  async processImageAsync(
    job: ImageProcessingJob,
    callOpenRouter: (messages: any[], userId: number) => Promise<string>,
    buildHistory: (userId: number) => any[],
    getUserSystemPrompt: (userId: number) => string,
    appendToHistory: (userId: number, message: any) => void
  ): Promise<string> {
    
    const jobId = `${job.userId}_${job.messageId}_${Date.now()}`;
    
    // Проверяем, не обрабатывается ли уже такая задача
    if (this.processingJobs.has(jobId)) {
      throw new Error('Изображение уже обрабатывается');
    }
    
    console.log(`🚀 Запуск асинхронной обработки изображения: ${jobId}`);
    
    // Создаем промис обработки с ограничением concurrency
    const processingPromise = this.concurrencyLimit(async () => {
      return await this.executeImageProcessing(
        job,
        callOpenRouter,
        buildHistory,
        getUserSystemPrompt,
        appendToHistory
      );
    });
    
    // Сохраняем промис для отслеживания
    this.processingJobs.set(jobId, processingPromise);
    this.processingStartTimes.set(jobId, Date.now());
    this.stats.activeJobs++;
    
    try {
      const result = await processingPromise;
      
      // Обновляем статистику
      this.updateStats(true, Date.now() - this.processingStartTimes.get(jobId)!);
      
      console.log(`✅ Асинхронная обработка завершена: ${jobId} за ${result.processingTime}ms`);
      
      if (result.success && result.result) {
        return result.result;
      } else {
        throw new Error(result.error || 'Ошибка обработки изображения');
      }
      
    } catch (error) {
      this.updateStats(false, Date.now() - this.processingStartTimes.get(jobId)!);
      console.error(`❌ Ошибка асинхронной обработки ${jobId}:`, error);
      throw error;
      
    } finally {
      // Очистка
      this.processingJobs.delete(jobId);
      this.processingStartTimes.delete(jobId);
      this.stats.activeJobs--;
    }
  }

  /**
   * Выполнение обработки изображения с retry логикой
   */
  private async executeImageProcessing(
    job: ImageProcessingJob,
    callOpenRouter: (messages: any[], userId: number) => Promise<string>,
    buildHistory: (userId: number) => any[],
    getUserSystemPrompt: (userId: number) => string,
    appendToHistory: (userId: number, message: any) => void
  ): Promise<ProcessingResult> {
    
    const startTime = Date.now();
    let lastError: unknown;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        console.log(`🔄 Попытка ${attempt}/${this.config.maxRetries} обработки изображения для пользователя ${job.userId}`);
        
        // Формируем мультимодальный контент
        const userBlocks = [
          { type: 'text', text: job.caption || 'Опиши изображение кратко. Если есть текст — распознай его.' },
          { type: 'image_url', image_url: { url: job.dataUrl } }
        ];

        // Добавляем в историю (временно)
        appendToHistory(job.userId, { 
          role: 'user', 
          content: '(изображение) ' + (job.caption || 'изображение без подписи') 
        });
        
        const historyArr = buildHistory(job.userId);

        // Готовим сообщения для OpenRouter
        const messages = [
          { role: 'system', content: getUserSystemPrompt(job.userId) },
          ...historyArr,
          { role: 'user', content: userBlocks }
        ];

        // Устанавливаем таймаут для запроса
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Таймаут обработки изображения')), this.config.requestTimeout);
        });

        // Выполняем запрос с таймаутом
        const assistantReply = await Promise.race([
          callOpenRouter(messages, job.userId),
          timeoutPromise
        ]);

        // Сохраняем ответ в историю
        appendToHistory(job.userId, { role: 'assistant', content: assistantReply });

        const processingTime = Date.now() - startTime;
        
        return {
          success: true,
          result: assistantReply,
          processingTime
        };
        
      } catch (error) {
        lastError = error;
        const processingTime = Date.now() - startTime;
        
        console.warn(`⚠️ Попытка ${attempt} неудачна (${processingTime}ms): ${(error as Error).message}`);
        
        // Если это не последняя попытка, делаем паузу
        if (attempt < this.config.maxRetries) {
          const delayMs = 1000 * Math.pow(2, attempt - 1); // Exponential backoff
          console.log(`⏳ Пауза ${delayMs}ms перед следующей попыткой...`);
          await delay(delayMs);
        }
      }
    }
    
    const processingTime = Date.now() - startTime;
    const errorMessage = lastError instanceof Error ? lastError.message : 'Неизвестная ошибка';
    
    return {
      success: false,
      error: `Не удалось обработать изображение после ${this.config.maxRetries} попыток: ${errorMessage}`,
      processingTime
    };
  }

  /**
   * Проверка, обрабатывается ли изображение для пользователя
   */
  isProcessingForUser(userId: number): boolean {
    for (const [jobId] of this.processingJobs) {
      if (jobId.startsWith(`${userId}_`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Получение количества активных задач для пользователя
   */
  getActiveJobsForUser(userId: number): number {
    let count = 0;
    for (const [jobId] of this.processingJobs) {
      if (jobId.startsWith(`${userId}_`)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Обновление статистики
   */
  private updateStats(success: boolean, processingTime: number): void {
    this.stats.totalProcessed++;
    
    if (success) {
      this.stats.totalSuccess++;
    } else {
      this.stats.totalFailed++;
    }
    
    // Обновляем среднее время обработки
    const totalTime = this.stats.averageProcessingTime * (this.stats.totalProcessed - 1) + processingTime;
    this.stats.averageProcessingTime = totalTime / this.stats.totalProcessed;
  }

  /**
   * Получение статистики процессора
   */
  getStats() {
    return {
      ...this.stats,
      config: this.config,
      activeJobs: this.processingJobs.size,
      successRate: this.stats.totalProcessed > 0 
        ? Math.round((this.stats.totalSuccess / this.stats.totalProcessed) * 100) 
        : 0
    };
  }

  /**
   * Принудительная очистка зависших задач
   */
  async clearStaleJobs(maxAge: number = 300000): Promise<number> {
    const now = Date.now();
    let clearedCount = 0;
    
    for (const [jobId, startTime] of this.processingStartTimes) {
      if (now - startTime > maxAge) {
        console.warn(`🗑️ Очистка зависшей задачи: ${jobId} (возраст: ${Math.round((now - startTime) / 1000)}с)`);
        
        this.processingJobs.delete(jobId);
        this.processingStartTimes.delete(jobId);
        this.stats.activeJobs = Math.max(0, this.stats.activeJobs - 1);
        clearedCount++;
      }
    }
    
    if (clearedCount > 0) {
      console.log(`🧹 Очищено ${clearedCount} зависших задач`);
    }
    
    return clearedCount;
  }

  /**
   * Health check процессора
   */
  async healthCheck() {
    const stats = this.getStats();
    
    return {
      status: stats.activeJobs < this.config.maxConcurrentProcessing ? 'healthy' : 'busy',
      activeJobs: stats.activeJobs,
      maxConcurrency: this.config.maxConcurrentProcessing,
      totalProcessed: stats.totalProcessed,
      successRate: stats.successRate,
      averageProcessingTime: Math.round(stats.averageProcessingTime),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Останавливаю ImageProcessor...');
    
    if (this.processingJobs.size > 0) {
      console.log(`⏳ Ожидание завершения ${this.processingJobs.size} активных задач...`);
      
      try {
        // Ждем завершения всех активных задач (максимум 30 секунд)
        await Promise.race([
          Promise.allSettled(Array.from(this.processingJobs.values())),
          delay(30000)
        ]);
      } catch (error) {
        console.warn('⚠️ Не все задачи завершились корректно при shutdown');
      }
    }
    
    // Очищаем все внутренние состояния
    this.processingJobs.clear();
    this.processingStartTimes.clear();
    this.stats.activeJobs = 0;
    
    console.log('✅ ImageProcessor остановлен');
  }
}

// Экспорт singleton экземпляра
export const imageProcessor = new ImageProcessor({
  maxConcurrentProcessing: 3,
  requestTimeout: 180000,
  maxRetries: 2
});
