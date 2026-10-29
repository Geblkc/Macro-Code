<div align="center">
  <img src="public/macrocode-logo.svg" width="110" alt="Логотип MacroCode" />
  <h1>MacroCode</h1>
  <p><strong>ИИ-терминал под вашим контролем — свой ключ, свои данные.</strong></p>
  <p>
    <a href="https://github.com/Geblkc/Macro-Code/releases"><img src="https://img.shields.io/github/v/release/Geblkc/Macro-Code?label=release&color=0a7ea4" alt="Релиз" /></a>
    <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-0a7ea4" alt="Платформа" />
    <img src="https://img.shields.io/badge/Tauri-v2-24c8db" alt="Tauri v2" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--only-blue.svg" alt="Лицензия: GPL-2.0-only" /></a>
  </p>
  <p><a href="README.md">English</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <strong>Русский</strong></p>
</div>

<img width="1920" height="1006" alt="Скриншот MacroCode" src="https://github.com/user-attachments/assets/f67a19a7-9f72-458f-8236-75bbd31c18cd" />

## Что такое MacroCode?

MacroCode — кроссплатформенное настольное приложение с открытым исходным кодом,
позволяющее общаться и работать с моделями ИИ через **интерфейс в стиле терминала,
используя собственные API-ключи** (BYOK). Написано на Tauri v2 + React + TypeScript,
распространяется как один компактный нативный бинарник и создано для разработчиков,
которым по душе текст, команды и горячие клавиши.

Без сервера, без аккаунта, без телеметрии: ваши диалоги хранятся в локальной базе
SQLite, а ключи покидают ваш компьютер только в виде заголовков аутентификации,
отправляемых непосредственно выбранному провайдеру.

## Что умеет?

| | |
|---|---|
| 🧠 **7 провайдеров** | Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter, DeepSeek и xAI. Провайдер появляется в списках только после ввода его ключа (для Ollama — локального URL). |
| 🔮 **Сотни моделей** | Небольшой курируемый каталог обогащается метаданными [models.dev](https://models.dev): лимиты контекста, поддержка изображений/рассуждений и цены. |
| ⌨️ **Терминальный интерфейс** | Слэш-команды (`/model`, `/tokens`, `/compact`, `/help`…), история сообщений по `↑ ↓`, мгновенный подсчёт токенов за каждую итерацию. |
| 🤖 **Режим агента** | Укажите папку проекта через `/root`: он может читать файлы, искать по коду, редактировать файлы и выполнять команды shell. Каждая запись/выполнение проходит через карту подтверждения, которую можно принять или отклонить; `rm` ограничен, системные папки заблокированы. Дополнительно подключаются MCP-серверы (stdio или HTTP) — для дополнительных инструментов. |
| 💸 **Контроль затрат** | Кэширование промптов (брейкпоинты Anthropic / ключи кэша, совместимые с OpenAI) удешевляет длинные сессии; `/tokens` показывает точную стоимость каждой итерации, включая чтения кэша. |
| 🌍 **5 языков** | Интерфейс полностью переведён: English, Deutsch, Español, Français и Türkçe; переключение применяется мгновенно, без перезапуска. |
| 🔒 **Ваши данные остаются у вас** | Сессии живут в SQLite с экспортом/импортом JSON; всё переносимо и при необходимости работает офлайн. |

## Установка

Скачайте пакет для своей платформы на странице
[Releases](https://github.com/Geblkc/Macro-Code/releases)
(Linux `.deb` / `.AppImage`, Windows `.msi` / `.exe`, macOS `.dmg`).

Или соберите из исходников:

```bash
npm install
npm run tauri dev    # полнофункциональное настольное приложение (нужны Rust и зависимости Tauri)
npm test             # модульные тесты
```

Продуктовые сборки:

```bash
npm run dist:linux   # .deb / .rpm / AppImage
npm run build        # только проверка типов + веб-сборка
```

## Первый запуск

1. Откройте **Настройки** (или введите `/key`).
2. Вставьте API-ключ вашего провайдера и сохраните. Для [Ollama](https://ollama.com)
   достаточно локального URL, например `http://localhost:11434`.
3. Введите сообщение — или `/help`, чтобы увидеть все команды.

## Документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — устройство проекта, модуль за модулем
- [`docs/MODELS.md`](docs/MODELS.md) — каталог моделей и объединение с models.dev
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — сборка `.deb` / `.rpm` / AppImage локально, Windows-установщики через CI
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — датированный журнал всех изменений
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — правила оформления pull request'ов

## Участие в проекте

Вклад приветствуется — отчёты об ошибках, переводы и pull request'ы. Порядок работы
описан в [`CONTRIBUTING.md`](CONTRIBUTING.md); пожалуйста, откройте issue перед
крупными изменениями.

## Лицензия

MacroCode распространяется по лицензии **GNU General Public License, версия 2, только
её** (`GPL-2.0-only`) — полный текст в [`LICENSE`](LICENSE).

```
Copyright (C) 2026 Gökhan Efe Balıkçı
```
