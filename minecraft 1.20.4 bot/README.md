# MC Bot — Autonomous Minecraft Bot

Автономный бот для Minecraft 1.20.4. Проходит игру от дерева до дракона.

## Быстрый старт (консоль)

```bash
npm install
npm start
```

## Запуск с GUI (Electron)

```bash
npm install
npm run app
```

## Сборка .exe

```bash
npm run build           # Установщик NSIS
npm run build:portable  # Portable .exe
```

Результат в папке `dist/`.

## Настройка

В GUI: заполни поля Host/Port/Ник и нажми "Запуск".

Или через переменные окружения:
```
BOT_HOST=localhost
BOT_PORT=25565
BOT_NAME=UltimateBot
BOT_VERSION=1.20.4
```

## Веб-панель

http://localhost:3000 — HP, еда, инвентарь, лог в реальном времени.

## Команды в чате

| Команда | Действие |
|---------|----------|
| !stop | Остановить |
| !go | Продолжить |
| !mine | Добыча |
| !tree | Рубить дерево |
| !craft [item] | Крафт |
| !smelt | Плавка |
| !fight | Атака ближайшего моба |
| !branch | Бранч-майнинг |
| !goap | Текущая цель |
| !pos | Координаты |
| !stats | HP/Еда/XP |

## Архитектура

31 модуль, 34 цели GOAP. Полная цепочка: дерево → инструменты → железо → алмазы → незер → эндер → дракон. Mid-game: исследование мира, охота, постройка маркеров, поиск деревень.
