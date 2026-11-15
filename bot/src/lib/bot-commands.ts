import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";

// Клиентские команды, которые видны в текстовом /menu. Панель команд
// Telegram (кнопка «Меню») синхронизируется при старте бота; скрытые
// служебные команды (debug_today, recalc_schedule, generate_codes,
// measure, measurements, chat) сюда не попадают сознательно.
const CLIENT_COMMANDS = [
  { command: "start", description: "Запуск бота" },
  { command: "menu", description: "Меню" },
  { command: "today", description: "Тренировка дня" },
  { command: "progress", description: "Прогресс и замеры" },
  { command: "myprogram", description: "Моя программа" },
  { command: "mystats", description: "Статистика за месяц" },
  { command: "checkin", description: "Чек-ин" },
  { command: "pause", description: "Пауза в тренировках" },
  { command: "resume", description: "Возобновить тренировки" },
  { command: "programs", description: "Каталог программ" },
  { command: "myweb", description: "Мой веб-портал" },
  { command: "schedule", description: "Расписание тренировок" },
  { command: "exercise", description: "Техника упражнений" },
  { command: "guide", description: "Посчитать калории" },
  { command: "settings", description: "Настройки" },
];

// Косметика: сбой синхронизации не должен мешать старту бота.
export async function syncBotCommands(bot: Bot<MyContext>): Promise<void> {
  try {
    await bot.api.setMyCommands(CLIENT_COMMANDS);
    console.log(`Bot command menu synced: ${CLIENT_COMMANDS.length} commands`);
  } catch (err) {
    console.warn("Bot command menu sync failed:", err);
  }
}
