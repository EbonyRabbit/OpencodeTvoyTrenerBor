// ⚠️ MUST stay in sync with web/src/lib/prodamus.ts (buildPaymentUrl).
// Бот — отдельный пакет и не может импортировать web/; здесь только URL-билдер
// платёжной страницы. Подпись webhook'а верифицируется на стороне веба.

export type PaymentUrlOptions = {
  payformUrl: string;
  orderId: string;
  amount: number;
  productName: string;
  customerPhone?: string | null;
  urlSuccess?: string | null;
  urlReturn?: string | null;
};

// Ссылка на платёжную страницу Продамуса (развёрнутая, без SYS-кода).
// Скобки `[`/`]` в ключах продуктов кодируются (как у официальных примеров
// Продамуса: URLSearchParams/http_build_query).
export function buildPaymentUrl({
  payformUrl,
  orderId,
  amount,
  productName,
  customerPhone,
  urlSuccess,
  urlReturn,
}: PaymentUrlOptions): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount: expected a positive finite number");
  }
  const url = new URL(payformUrl);
  url.searchParams.set("do", "pay");
  url.searchParams.set("order_id", orderId);
  url.searchParams.set("products[0][name]", productName);
  url.searchParams.set("products[0][price]", amount.toFixed(2));
  url.searchParams.set("products[0][quantity]", "1");
  if (customerPhone) url.searchParams.set("customer_phone", customerPhone);
  if (urlSuccess) url.searchParams.set("urlSuccess", urlSuccess);
  if (urlReturn) url.searchParams.set("urlReturn", urlReturn);
  return url.toString();
}
