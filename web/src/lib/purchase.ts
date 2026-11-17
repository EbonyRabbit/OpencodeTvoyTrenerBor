export const DEDUP_ERROR_MESSAGE =
  "Заявка уже отправлена. Тренер скоро свяжется с вами.";

export const COACH_REQUEST_ALREADY_SENT_MESSAGE =
  "Вы уже отправили заявку. Тренер скоро свяжется с вами.";

export function buildCoachRequestCoachMessage({
  name,
  contact,
  formatContact,
}: {
  name: string;
  contact: string;
  formatContact: (value: string) => string;
}): string {
  return (
    `🤝 Хочу индивидуальное ведение/кураторство\n\n` +
    `👤 Имя: ${name}\n` +
    `📱 Контакт: ${formatContact(contact)}\n\n` +
    `Свяжитесь с клиентом в Telegram.`
  );
}
