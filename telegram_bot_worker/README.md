# Cloudflare Worker для Telegram webhook

## Зачем нужен Worker

Telegram не принимает webhook, если endpoint отвечает редиректом `302 Moved Temporarily`.

Google Apps Script Web App часто сначала делает редирект с `script.google.com` на `script.googleusercontent.com`, поэтому Telegram видит ошибку:

`Wrong response from the webhook: 302 Moved Temporarily`

Cloudflare Worker решает проблему:

`Telegram -> Cloudflare Worker -> Apps Script`

Worker сам следует редиректу Apps Script, а Telegram сразу получает `200 ok`.

## Что нужно сделать

1. Создать Cloudflare аккаунт, если его нет.
2. Открыть `Workers & Pages`.
3. Нажать `Create Worker`.
4. Вставить код из `worker.js`.
5. Добавить переменную окружения `APPS_SCRIPT_URL`.
6. Установить Telegram webhook уже на URL Worker, а не на Apps Script.

## Переменная окружения

В Cloudflare Worker добавь variable:

| Variable | Value |
|---|---|
| `APPS_SCRIPT_URL` | Web App URL из Apps Script, который заканчивается на `/exec` |

Пример:

`https://script.google.com/macros/s/AKfyc.../exec`

## Проверка Worker

Открой Worker URL в браузере.

Должен появиться текст:

`Telegram webhook proxy is running`

## Установка webhook

После публикации Worker у тебя будет URL вида:

`https://telegram-fitness-bot.username.workers.dev`

Webhook нужно ставить на Worker URL:

`https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://telegram-fitness-bot.username.workers.dev`

Проверка:

`https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo`

В хорошем результате не должно быть `last_error_message`.

## Важно

В Apps Script webhook напрямую больше не нужен. Apps Script остается обработчиком логики, но Telegram общается с Worker.
