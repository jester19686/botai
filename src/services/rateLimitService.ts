/**
 * 🚫 ПРОДВИНУТЫЙ RATE LIMITING СЕРВИС
 * 
 * Управляет ограничениями для пользователей с гибкими настройками
 */

interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
  blockDurationMs?: number; // Время блокировки при превышении
}

interface UserLimitInfo {
  count: number;
  resetTime: number;
  blockedUntil?: number;
  violations: number; // Количество нарушений
}

export class RateLimitService {
  private limits = new Map<string, UserLimitInfo>();
  private globalLimits = new Map<number, UserLimitInfo>();
  
  // Правила для разных типов действий
  private rules: Record<string, RateLimitRule> = {
    'text_message': { 
      maxRequests: 30, 
      windowMs: 60000, // 1 минута
      blockDurationMs: 300000 // 5 минут блокировки
    },
    'image_processing': { 
      maxRequests: 10, 
      windowMs: 300000, // 5 минут
      blockDurationMs: 600000 // 10 минут блокировки
    },
    'settings_change': { 
      maxRequests: 5, 
      windowMs: 60000, // 1 минута
      blockDurationMs: 60000 // 1 минута блокировки
    },
    'command': { 
      maxRequests: 20, 
      windowMs: 60000 // 1 минута
    },
    'global': { 
      maxRequests: 50, 
      windowMs: 3600000, // 1 час
      blockDurationMs: 1800000 // 30 минут блокировки
    }
  };

  /**
   * Проверить лимит для конкретного действия
   */
  checkLimit(userId: number, action: string = 'global'): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    blockedUntil?: number;
    reason?: string;
  } {
    const rule = this.rules[action] || this.rules.global;
    const key = `${userId}:${action}`;
    const now = Date.now();
    
    let userLimit = this.limits.get(key);
    
    // Проверяем блокировку
    if (userLimit?.blockedUntil && now < userLimit.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: userLimit.resetTime,
        blockedUntil: userLimit.blockedUntil,
        reason: `Заблокирован до ${new Date(userLimit.blockedUntil).toLocaleTimeString('ru-RU')}`
      };
    }

    // Сброс лимита если окно прошло
    if (!userLimit || now > userLimit.resetTime) {
      userLimit = {
        count: 0,
        resetTime: now + rule.windowMs,
        violations: userLimit?.violations || 0
      };
      this.limits.set(key, userLimit);
    }

    // Проверяем лимит
    if (userLimit.count >= rule.maxRequests) {
      // Увеличиваем нарушения и блокируем если нужно
      userLimit.violations++;
      
      if (rule.blockDurationMs) {
        userLimit.blockedUntil = now + rule.blockDurationMs;
      }
      
      this.limits.set(key, userLimit);
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: userLimit.resetTime,
        blockedUntil: userLimit.blockedUntil,
        reason: `Превышен лимит: ${rule.maxRequests} запросов за ${Math.round(rule.windowMs / 1000)} сек`
      };
    }

    // Увеличиваем счетчик
    userLimit.count++;
    this.limits.set(key, userLimit);

    return {
      allowed: true,
      remaining: rule.maxRequests - userLimit.count,
      resetTime: userLimit.resetTime
    };
  }

  /**
   * Получить информацию о лимитах пользователя
   */
  getUserLimitInfo(userId: number): Record<string, {
    current: number;
    max: number;
    resetTime: number;
    blocked: boolean;
    violations: number;
  }> {
    const info: Record<string, any> = {};
    
    for (const [action, rule] of Object.entries(this.rules)) {
      const key = `${userId}:${action}`;
      const userLimit = this.limits.get(key);
      const now = Date.now();
      
      info[action] = {
        current: userLimit?.count || 0,
        max: rule.maxRequests,
        resetTime: userLimit?.resetTime || now + rule.windowMs,
        blocked: userLimit?.blockedUntil ? now < userLimit.blockedUntil : false,
        violations: userLimit?.violations || 0
      };
    }
    
    return info;
  }

  /**
   * Сброс лимитов для пользователя (для админа)
   */
  resetUserLimits(userId: number, action?: string): void {
    if (action) {
      const key = `${userId}:${action}`;
      this.limits.delete(key);
    } else {
      // Сбрасываем все лимиты пользователя
      const keysToDelete = Array.from(this.limits.keys())
        .filter(key => key.startsWith(`${userId}:`));
      
      keysToDelete.forEach(key => this.limits.delete(key));
    }
  }

  /**
   * Добавить пользователя в VIP (без лимитов)
   */
  private vipUsers = new Set<number>();
  
  addVipUser(userId: number): void {
    this.vipUsers.add(userId);
  }
  
  removeVipUser(userId: number): void {
    this.vipUsers.delete(userId);
  }
  
  isVipUser(userId: number): boolean {
    return this.vipUsers.has(userId);
  }

  /**
   * Обновить правила rate limiting
   */
  updateRule(action: string, rule: RateLimitRule): void {
    this.rules[action] = rule;
  }

  /**
   * Получить статистику rate limiting
   */
  getStats(): {
    totalUsers: number;
    blockedUsers: number;
    totalViolations: number;
    activeVipUsers: number;
  } {
    const now = Date.now();
    let blockedUsers = 0;
    let totalViolations = 0;
    const uniqueUsers = new Set<string>();
    
    for (const [key, limit] of this.limits) {
      const userId = key.split(':')[0];
      uniqueUsers.add(userId);
      
      if (limit.blockedUntil && now < limit.blockedUntil) {
        blockedUsers++;
      }
      
      totalViolations += limit.violations || 0;
    }
    
    return {
      totalUsers: uniqueUsers.size,
      blockedUsers,
      totalViolations,
      activeVipUsers: this.vipUsers.size
    };
  }

  /**
   * Очистка старых записей (вызывать периодически)
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [key, limit] of this.limits) {
      // Удаляем записи, которые истекли и не заблокированы
      if (now > limit.resetTime && (!limit.blockedUntil || now > limit.blockedUntil)) {
        toDelete.push(key);
      }
    }
    
    toDelete.forEach(key => this.limits.delete(key));
    
    if (toDelete.length > 0) {
      console.log(`🧹 Rate limit: очищено ${toDelete.length} старых записей`);
    }
  }

  /**
   * Middleware для проверки rate limit
   */
  createMiddleware(action: string = 'global') {
    return async (ctx: any, next: any) => {
      const userId = ctx.from?.id;
      if (!userId) return next();

      // VIP пользователи проходят без ограничений
      if (this.isVipUser(userId)) {
        return next();
      }

      const limitResult = this.checkLimit(userId, action);
      
      if (!limitResult.allowed) {
        const waitTime = Math.ceil((limitResult.resetTime - Date.now()) / 1000);
        
        let message = `⏳ ${limitResult.reason}`;
        if (waitTime > 0) {
          message += `\n⏰ Попробуйте через ${waitTime} секунд`;
        }
        if (limitResult.blockedUntil) {
          const unblockTime = new Date(limitResult.blockedUntil).toLocaleTimeString('ru-RU');
          message += `\n🚫 Разблокировка в ${unblockTime}`;
        }
        
        await ctx.reply(message);
        return; // Не вызываем next()
      }

      // Добавляем информацию о лимитах в контекст
      ctx.rateLimit = {
        remaining: limitResult.remaining,
        resetTime: limitResult.resetTime
      };

      return next();
    };
  }
}

// Экспорт singleton экземпляра
export const rateLimitService = new RateLimitService();

// Автоочистка каждые 10 минут
setInterval(() => {
  rateLimitService.cleanup();
}, 10 * 60 * 1000);
