import i18next from "i18next";

const resources = {
  ru: {
    translation: {
      error: {
        user_not_identified: "Ошибка: не удалось определить вашего пользователя.",
        service_unavailable: "Сервис временно недоступен. Попробуйте позже.",
        invalid_exercise_index: "Некорректный индекс упражнения.",
        unknown_callback: "Неизвестное действие. Обновите меню.",
        callback_error: "Произошла ошибка. Попробуйте ещё раз.",
        connection_error: "Ошибка подключения. Попробуйте позже.",
      },
      greeting: {
        hello: "Привет, {{name}}!",
        welcome_new: "Добро пожаловать! Приобретите программу у тренера для начала тренировок.",
        session_expired: "Сессия истекла. Отправьте /start для начала работы.",
        default_name: "клиент",
      },
      client: {
        access_expired: "Ваш доступ истёк. Продлите программу у тренера.",
        inactive: "Аккаунт неактивен. Свяжитесь с тренером.",
        payment_pending: "Ожидается подтверждение оплаты.",
        no_program: "Программа ещё не назначена.\nОжидайте — тренер скоро свяжется с вами.",
        program_not_found: "Программа не найдена в системе.\nСвяжитесь с тренером для уточнения.",
      },
      menu: {
        title: "Доступные команды:",
        today: "/today — тренировка дня",
        checkin: "/checkin — чек-ин",
        myprogram: "/myprogram — моя программа",
        settings: "/settings — настройки",
      },
      program: {
        title_label: "Программа: {{title}}",
        type_label: "Тип: {{type}}",
        duration_label: "Длительность: {{weeks}} нед.",
        current_week: "Текущая: {{label}} ({{current}} из {{total}})",
        current_week_deload: "Текущая: {{label}} (дельоад) ({{current}} из {{total}})",
        total_weeks: "Всего недель: {{count}}",
        workout_days: "Тренировочных дней: {{count}}",
        days_header: "Дни недели:",
        spreadsheet: "Таблица: {{url}}",
        description: "{{text}}",
        truncation_suffix: "\n\n⚠️ Сообщение обрезано. Полная версия в таблице.",
        week_fallback: "Неделя {{week}}",
      },
      callback: {
        loading_workout: "🏋️ Загрузка тренировки дня...",
        exercise_logging: "📝 Логирование упражнения #{{index}}...",
        exercise_skipped: "⏭ Упражнение #{{index}} пропущено.",
        workout_skipped: "⏭ Тренировка пропущена.",
      },
    },
  },
  en: {
    translation: {
      error: {
        user_not_identified: "Error: could not identify your account.",
        service_unavailable: "Service temporarily unavailable. Please try again later.",
        invalid_exercise_index: "Invalid exercise index.",
        unknown_callback: "Unknown action. Please refresh the menu.",
        callback_error: "An error occurred. Please try again.",
        connection_error: "Connection error. Please try again later.",
      },
      greeting: {
        hello: "Hello, {{name}}!",
        welcome_new: "Welcome! Purchase a program from your coach to start training.",
        session_expired: "Session expired. Send /start to begin.",
        default_name: "client",
      },
      client: {
        access_expired: "Your access has expired. Please renew your program with your coach.",
        inactive: "Account is inactive. Please contact your coach.",
        payment_pending: "Payment confirmation pending.",
        no_program: "Program not yet assigned.\nPlease wait — your coach will contact you soon.",
        program_not_found: "Program not found in the system.\nPlease contact your coach for details.",
      },
      menu: {
        title: "Available commands:",
        today: "/today — today's workout",
        checkin: "/checkin — check-in",
        myprogram: "/myprogram — my program",
        settings: "/settings — settings",
      },
      program: {
        title_label: "Program: {{title}}",
        type_label: "Type: {{type}}",
        duration_label: "Duration: {{weeks}} wk.",
        current_week: "Current: {{label}} ({{current}} of {{total}})",
        current_week_deload: "Current: {{label}} (deload) ({{current}} of {{total}})",
        total_weeks: "Total weeks: {{count}}",
        workout_days: "Workout days: {{count}}",
        days_header: "Days of the week:",
        spreadsheet: "Spreadsheet: {{url}}",
        description: "{{text}}",
        truncation_suffix: "\n\n⚠️ Message truncated. Full version in spreadsheet.",
        week_fallback: "Week {{week}}",
      },
      callback: {
        loading_workout: "🏋️ Loading today's workout...",
        exercise_logging: "📝 Logging exercise #{{index}}...",
        exercise_skipped: "⏭ Exercise #{{index}} skipped.",
        workout_skipped: "⏭ Workout skipped.",
      },
    },
  },
};

i18next.init({
  lng: "ru",
  fallbackLng: "ru",
  resources,
  interpolation: { escapeValue: false },
});

export type Language = "ru" | "en";

export function t(key: string, lang?: Language, options?: Record<string, unknown>): string {
  return i18next.t(key, { lng: lang ?? "ru", ...options });
}

export function resolveLanguage(languageCode?: string): Language {
  if (languageCode?.toLowerCase().startsWith("en")) return "en";
  return "ru";
}

export function applyClientLanguage(ctx: { language: Language }, clientLanguage?: string | null): void {
  if (clientLanguage === "ru" || clientLanguage === "en") {
    ctx.language = clientLanguage;
  }
}
