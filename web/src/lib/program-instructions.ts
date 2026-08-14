export type ProgramInstructionsInput = {
  name: string;
  language: string | null;
  programTitle: string;
  accessEndDate: string | null;
  connectCode?: string | null;
  botUsername?: string | null;
  timezone?: string | null;
};

function formatAccessDate(
  date: string,
  language: string,
  timezone?: string | null,
): string | null {
  const locale = language === "en" ? "en-US" : "ru-RU";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    };
    if (timezone) options.timeZone = timezone;
    return new Intl.DateTimeFormat(locale, options).format(parsed);
  } catch {
    return parsed.toLocaleDateString(locale);
  }
}

export function buildProgramInstructions(input: ProgramInstructionsInput): string {
  const isEn = input.language === "en";
  const displayName = input.name.trim() || (isEn ? "friend" : "друг");
  const safeBotUsername = input.botUsername
    ? input.botUsername.replace(/^@/, "").replace(/\s+/g, "")
    : null;
  const accessDate = input.accessEndDate
    ? formatAccessDate(input.accessEndDate, isEn ? "en" : "ru", input.timezone)
    : null;
  const lines: string[] = [];

  if (isEn) {
    lines.push(`Hi, ${displayName}!`);
    lines.push("");
    lines.push("Your coach confirmed the payment and added your program:");
    lines.push(`Program: ${input.programTitle}`);
    if (accessDate) lines.push(`Access is available until ${accessDate}.`);
    lines.push("");
    lines.push("What to do next:");

    const steps: string[] = [
      `Open the bot${safeBotUsername ? `: t.me/${safeBotUsername}` : ""} and press /start`,
    ];
    if (input.connectCode) {
      steps.push(`Enter the connect code: ${input.connectCode}`);
    }
    steps.push(
      [
        "Set up your workouts and measurements via /settings:",
        "   - training days (Mon/Wed/Fri, etc.)",
        "   - measurement day and time",
        "   - check-in day and time",
      ].join("\n"),
    );
    steps.push("Start your first workout: /today");
    steps.push("Your program is always available in /menu");

    lines.push(...steps.map((step, i) => `${i + 1}. ${step}`));
    lines.push("");
    lines.push("If you have any questions — message your coach.");
  } else {
    lines.push(`Привет, ${displayName}!`);
    lines.push("");
    lines.push("Тренер подтвердил оплату и добавил тебе программу:");
    lines.push(`Программа: ${input.programTitle}`);
    if (accessDate) lines.push(`Доступ действует до ${accessDate}.`);
    lines.push("");
    lines.push("Что делать дальше:");

    const steps: string[] = [
      `Открой бота${safeBotUsername ? `: t.me/${safeBotUsername}` : ""} и нажми /start`,
    ];
    if (input.connectCode) {
      steps.push(`Введи код подключения: ${input.connectCode}`);
    }
    steps.push(
      [
        "Настрой тренировки и замеры через /settings:",
        "   - дни тренировок (пн/ср/пт и т.д.)",
        "   - день и время замеров",
        "   - день и время чек-ина",
      ].join("\n"),
    );
    steps.push("Начни первую тренировку: /today");
    steps.push("Программа и план всегда в /menu");

    lines.push(...steps.map((step, i) => `${i + 1}. ${step}`));
    lines.push("");
    lines.push("Если возникнут вопросы — напиши тренеру.");
  }

  return lines.join("\n");
}