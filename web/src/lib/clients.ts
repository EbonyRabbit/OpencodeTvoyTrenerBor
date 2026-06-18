import type { Database } from "@/types/supabase";

export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

export type ClientWithProgram = ClientRow & {
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
