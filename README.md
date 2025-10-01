# TG AI Help Bot

Современный Telegram бот с интеграцией OpenRouter AI и модульной архитектурой.

## Возможности

- 🤖 Интеграция с OpenRouter API (поддержка различных моделей ИИ)
- 🚀 TypeScript с современной архитектурой
- 🛡️ Rate limiting и защита от спама
- 🖼️ Обработка изображений с неблокирующим интерфейсом
- ⚡ Быстрые ответы и оптимизированная производительность
- 🔧 Настраиваемые команды и клавиатуры
- 📊 Health check эндпоинт для мониторинга

## Быстрый старт

### 1. Клонирование репозитория
```bash
git clone <your-repo-url>
cd TGaihelpbot-clean
```

### 2. Установка зависимостей
```bash
npm install
```

### 3. Настройка окружения
```bash
cp .env.example .env
```

Заполните следующие переменные в `.env`:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=x-ai/grok-4-fast:free
SYSTEM_PROMPT=Отвечай простым текстом на русском. Запрещено: эмодзи, ASCII-рамки/разделители, markdown-заголовки и списки. Не добавляй лишних разделителей. Давай только суть.
```

### 4. Запуск в разработке
```bash
npm run dev
```

### 5. Сборка для продакшена
```bash
npm run build
npm start
```

## Развертывание на VPS

### Системные требования
- Node.js 18+
- RAM: 512MB минимум (рекомендуется 1GB)
- CPU: 1 vCPU
- Диск: 2GB свободного места

### Шаги развертывания

1. **Подключение к VPS:**
```bash
ssh user@your-vps-ip
```

2. **Установка Node.js (если не установлен):**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

3. **Клонирование проекта:**
```bash
git clone <your-repo-url>
cd TGaihelpbot-clean
```

4. **Установка зависимостей и сборка:**
```bash
npm install
npm run build
```

5. **Настройка переменных окружения:**
```bash
cp .env.example .env
nano .env  # Заполните своими данными
```

6. **Запуск с PM2 (рекомендуется):**
```bash
npm install -g pm2
pm2 start npm --name "tg-bot" -- start
pm2 startup
pm2 save
```

### Альтернативные варианты развертывания

#### Railway
Проект уже настроен для Railway:
- `railway.json` - конфигурация
- `Procfile` - процесс запуска

#### Docker
```bash
# Создайте Dockerfile при необходимости
docker build -t tg-bot .
docker run -d --name tg-bot --env-file .env tg-bot
```

## Структура проекта

```
src/
├── handlers/          # Обработчики команд и событий
├── services/          # Бизнес-логика и внешние API
├── types/            # TypeScript типы
├── utils/            # Утилиты и помощники
├── bot.ts            # Основной класс бота
├── main.ts           # Точка входа
└── health.ts         # Health check сервер
```

## API и эндпоинты

- `GET /health` - Health check (порт из переменной окружения или 3000)

## Команды бота

- `/start` - Начало работы с ботом
- `/help` - Список команд
- `/model` - Выбор модели ИИ
- `/settings` - Настройки пользователя
- `/stats` - Статистика использования

## Разработка

### Доступные скрипты
- `npm run dev` - Запуск в режиме разработки с hot-reload
- `npm run build` - Сборка TypeScript в JavaScript
- `npm start` - Запуск собранной версии

### Добавление новых функций
1. Создайте необходимые типы в `src/types/`
2. Добавьте сервис в `src/services/`
3. Создайте обработчик в `src/handlers/`
4. Подключите в `src/bot.ts`

## Мониторинг и логи

Бот включает встроенный health check сервер и логирование ошибок. Для продакшена рекомендуется:

- Настроить мониторинг health check эндпоинта
- Использовать PM2 для автоматического перезапуска
- Настроить ротацию логов
- Использовать внешний сервис мониторинга

## Лицензия

MIT
