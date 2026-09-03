# ManyChat — ЖИР → канал t.me/YuriyShoshin

> Воронка: инста Reels/Story «пиши ЖИР в директ» → ManyChat (триггер ЖИР) → DM «лови t.me/YuriyShoshin» → канал (закреп-пост с кнопкой `Забрать в боте → t.me/tvoyTrekerBot?start=channel_grow`) → бот фриби + цепочка.

## Что нужно

- Instagram Business/Creator + привязанная Facebook-страница
- ManyChat Pro (keyword-триггеры только на Pro)
- Права админа канала `t.me/YuriyShoshin`

## Импорт флоу

1. ManyChat → Automations → New Automation → Import → выбери `flow-ZIR-to-channel.json`
2. Открой 2 автоматизации: `DM: ЖИР -> канал` и `Comment: ЖИР -> reply + DM`
3. Проверь триггеры:
   - DM Keyword: `жир` (contains word, регистронезависимо, trim)
   - Comment Keyword: `жир` (All posts/Reels)
4. Проверь тексты DM и кнопку `Перейти в Телеграм → https://t.me/YuriyShoshin`
5. Включи автоматизации, сделай Publish

> **UTM:** `t.me` игнорирует `?utm_source` — не добавляй к ссылке канала. Трекинг:
> - инста → канал: статистика ManyChat по флоу
> - канал → бот: `?start=channel_grow` (бот логирует `welcome_sent`)
> - точный инста → join: invite link `inst_ZIR` (задача 22.7, опционально)

## Настройка триггеров (важно)

- DM: `Keyword = жир` — добавь варианты `жир`, `ЖИР`, `Жир` или включи `contains word` чтобы ловить `ЖИР!`
- Comment: `Apply to = All posts/Reels` или выбери конкретные Reels с призывом
- Включи `Smart filter / Cooldown 1h` чтобы не спамить повторными `ЖИР`
- Для коммента второй шаг: `Public Reply: кинул в директ` + `Send DM`

## Скрины (сделай после импорта)

Сохрани 2 скрина вне кода (Drive) + сюда:

- `docs/manychat/screenshot-dm-flow.png` — DM-автоматизация
- `docs/manychat/screenshot-comment-flow.png` — comment-автоматизация + reply

Бэкап экспорта храни также вне git (Google Drive) — json в `docs/manychat/` это шаблон для версионирования, может не импортироваться между версиями ManyChat.

## Проверка

1. С тестового инста-аккаунта напиши `ЖИР` в директ → должен прийти DM с кнопкой `Перейти в Телеграм` → клик → канал
2. Напиши `ЖИР` в коммент под Reels → должен появиться reply `кинул в директ` + придёт DM
3. В канале нажми закреп-кнопку `Забрать в боте` → бот `?start=channel_grow` → фриби PDF
