import type { Database } from "@/types/supabase";

export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

export type ClientWithProgram = Pick<
  ClientRow,
  | "id"
  | "name"
  | "telegram_id"
  | "status"
  | "payment_status"
  | "language"
  | "timezone"
  | "access_start_date"
  | "access_end_date"
  | "created_at"
  | "program_id"
> & {
  program: { title: string } | null;
};

export type ClientStatus = "active" | "inactive" | "access_expired";
export type PaymentStatus = "pending" | "paid";

export const VALID_CLIENT_STATUSES = ["all", "active", "inactive", "access_expired"] as const;
export type ClientFilter = (typeof VALID_CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  inactive: "Неактивен",
  access_expired: "Доступ истёк",
};

export const CLIENT_STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  inactive: "secondary",
  access_expired: "destructive",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Оплачено",
  pending: "Ожидает",
};

export const PAYMENT_STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive"> = {
  paid: "default",
  pending: "secondary",
};

export const FILTER_LABELS: Record<ClientFilter, string> = {
  all: "Все",
  active: "Активные",
  inactive: "Неактивные",
  access_expired: "Доступ истёк",
};

export const VALID_PAYMENT_FILTERS = ["all", "paid", "pending"] as const;
export type PaymentFilter = (typeof VALID_PAYMENT_FILTERS)[number];

export const PAYMENT_FILTER_LABELS: Record<PaymentFilter, string> = {
  all: "Все",
  paid: "Оплачено",
  pending: "Ожидает",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  ru: "Русский",
  en: "English",
};

export function escapeSearch(value: string): string {
  return value.replace(/[%_]/g, "\\$&");
}

export const TIMEZONE_LIST = [
  "Europe/Moscow",
  "Europe/Kiev",
  "Europe/Minsk",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Astana",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
] as const;

export const MEASUREMENT_DAY_OPTIONS: readonly { value: number; label: string }[] = Array.from(
  { length: 31 },
  (_, i) => ({
    value: i + 1,
    label: `${i + 1}-е число`,
  }),
);

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Понедельник" },
  { value: 2, label: "Вторник" },
  { value: 3, label: "Среда" },
  { value: 4, label: "Четверг" },
  { value: 5, label: "Пятница" },
  { value: 6, label: "Суббота" },
  { value: 7, label: "Воскресенье" },
] as const;

export const CHECKIN_DAY_OPTIONS = WEEKDAY_OPTIONS;

export function isQuarterTime(time: string): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const minute = Number(time.slice(3, 5));
  return minute % 15 === 0;
}
