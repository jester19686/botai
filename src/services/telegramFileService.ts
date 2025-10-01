/**
 * 📁 СЕРВИС РАБОТЫ С ФАЙЛАМИ TELEGRAM
 * 
 * Загрузка и обработка файлов из Telegram
 */

import type { Context } from 'telegraf';
import { fetch, Agent, type Response } from 'undici';

// Используем тот же агент что и для OpenRouter
const httpAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
  headersTimeout: 60_000,
  bodyTimeout: 60_000,
  connectTimeout: 30_000
});

export class TelegramFileService {
  private stats = {
    filesProcessed: 0,
    totalSize: 0,
    errors: 0,
    averageProcessingTime: 0
  };

  /**
   * Получить data URL из фото Telegram
   */
  async tgFileToDataUrl(ctx: Context, fileId: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      // Получаем ссылку на файл с таймаутом
      const link = await Promise.race([
        ctx.telegram.getFileLink(fileId),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Telegram getFileLink timeout')), 15000)
        )
      ]);

      // Создаем контроллер для отмены запроса
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        // Загружаем файл с настройками для работы через прокси и retry логикой
        let res: Response | undefined;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
          try {
            res = await fetch(link.href, {
              signal: controller.signal,
              dispatcher: httpAgent,
              headers: {
                'User-Agent': 'TelegramBot/1.0'
              }
            });
            break; // Успешно загружено
          } catch (fetchError) {
            attempts++;
            if (attempts >= maxAttempts) {
              throw fetchError; // Все попытки исчерпаны
            }
            
            console.warn(`⚠️ Попытка ${attempts}/${maxAttempts} загрузки файла неудачна, повтор через 1сек...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        if (!res) {
          throw new Error('Не удалось загрузить файл после всех попыток');
        }

        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`TG file fetch failed: ${res.status} ${res.statusText}`);
        }

        // Определяем MIME тип более точно
        const contentType = res.headers.get('content-type');
        let mime = 'image/jpeg'; // Дефолтный тип
        
        if (contentType) {
          if (contentType.includes('png')) mime = 'image/png';
          else if (contentType.includes('gif')) mime = 'image/gif';
          else if (contentType.includes('webp')) mime = 'image/webp';
          else if (contentType.includes('jpeg') || contentType.includes('jpg')) mime = 'image/jpeg';
        }
        
        const arrayBuffer = await res.arrayBuffer();
        
        // Проверяем размер файла (ограничиваем 5MB для лучшей совместимости)
        if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
          throw new Error('Файл слишком большой (максимум 5MB)');
        }

        // Проверяем минимальный размер (избегаем пустых файлов)
        if (arrayBuffer.byteLength < 100) {
          throw new Error('Файл слишком маленький или поврежден');
        }

        const buf = Buffer.from(arrayBuffer);
        
        // Дополнительная валидация: проверяем что это действительно изображение
        const signature = buf.toString('hex', 0, 8).toLowerCase();
        const isValidImage = 
          signature.startsWith('ffd8ff') || // JPEG
          signature.startsWith('89504e47') || // PNG
          signature.startsWith('47494638') || // GIF
          signature.startsWith('52494646'); // WEBP (RIFF)
          
        if (!isValidImage) {
          throw new Error('Файл не является допустимым изображением');
        }

        // Кодируем в base64 с проверкой корректности
        const b64 = buf.toString('base64');
        
        // Базовая валидация base64
        if (!b64 || b64.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
          throw new Error('Ошибка кодирования изображения в base64');
        }

        const processingTime = Date.now() - startTime;
        
        // Обновляем статистику
        this.updateStats(true, arrayBuffer.byteLength, processingTime);

        console.log(`✅ Изображение успешно обработано: ${mime}, размер: ${(arrayBuffer.byteLength / 1024).toFixed(1)}KB, base64 длина: ${b64.length}, время: ${processingTime}ms`);
        
        return `data:${mime};base64,${b64}`;

      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        // Определяем тип ошибки для более информативного сообщения
        if (fetchError instanceof Error) {
          if (fetchError.name === 'AbortError') {
            throw new Error('Таймаут загрузки изображения (>30 сек)');
          }
          if (fetchError.message.includes('ENOTFOUND') || fetchError.message.includes('Connect Timeout')) {
            throw new Error('Проблемы с сетевым подключением к Telegram');
          }
        }
        throw fetchError;
      }

    } catch (error) {
      this.updateStats(false, 0, Date.now() - startTime);
      console.error('❌ Ошибка загрузки файла Telegram:', error);
      throw error instanceof Error ? error : new Error('Неизвестная ошибка загрузки файла');
    }
  }

  /**
   * Обновление статистики
   */
  private updateStats(success: boolean, fileSize: number, processingTime: number): void {
    this.stats.filesProcessed++;
    
    if (success) {
      this.stats.totalSize += fileSize;
    } else {
      this.stats.errors++;
    }
    
    // Обновляем среднее время обработки
    const totalTime = this.stats.averageProcessingTime * (this.stats.filesProcessed - 1) + processingTime;
    this.stats.averageProcessingTime = totalTime / this.stats.filesProcessed;
  }

  /**
   * Получить статистику сервиса
   */
  getStats() {
    return {
      ...this.stats,
      averageFileSize: this.stats.filesProcessed > 0 
        ? Math.round(this.stats.totalSize / (this.stats.filesProcessed - this.stats.errors)) 
        : 0,
      successRate: this.stats.filesProcessed > 0 
        ? Math.round(((this.stats.filesProcessed - this.stats.errors) / this.stats.filesProcessed) * 100) 
        : 100,
      totalSizeMB: Math.round(this.stats.totalSize / 1024 / 1024 * 100) / 100
    };
  }

  /**
   * Сброс статистики
   */
  resetStats(): void {
    this.stats = {
      filesProcessed: 0,
      totalSize: 0,
      errors: 0,
      averageProcessingTime: 0
    };
  }
}
