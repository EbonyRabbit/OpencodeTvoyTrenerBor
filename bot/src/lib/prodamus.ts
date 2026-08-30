// ⚠️ MUST stay in sync with web/src/lib/prodamus.ts (buildPaymentUrl).
// Бот - отдельный пакет и не может импортировать web/; здесь только URL-билдер
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

// Замена типографских символов и вырезание всего, что отсутствует в
// кодировке windows-1251 страницы оплаты Продамуса (эмодзи, стрелки,
// dingbats и т.п.): × ✕ ✖, тире, типографские кавычки, emoji.
export function sanitizeProductName(name: string): string {
  // Fallback: если после санитизации пусто (название целиком из emoji),
  // оставляем нейтральное наименование - пустой товар Продамус не примет.
  const sanitized = sanitizeInner(name);
  return sanitized || "Программа";
}

function sanitizeInner(name: string): string {
  return name
    .replace(/[×✕✖]/g, "x")
    .replace(/[\u2014\u2013\u2212]/g, "-")
    .replace(/[\u00AB\u00BB\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(
      /[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\uFE0E\u200D\u20E3\u{1F000}-\u{1FAFF}]/gu,
      "",
    )
    .replace(/ {2,}/g, " ")
    .trim();
}

// Параметры платёжной ссылки (общие для прямой и короткой).
function buildPaymentUrlString(
  opts: PaymentUrlOptions,
  action: "pay" | "link",
): string {
  const { amount, productName, ...rest } = opts;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount: expected a positive finite number");
  }
  const url = new URL(rest.payformUrl);
  url.searchParams.set("do", action);
  // NB: отправляемый здесь orderId вебхук вернёт в поле order_num
  // (см. parseProdamusOrder в web-копии).
  url.searchParams.set("order_id", rest.orderId);
  url.searchParams.set(
    "products[0][name]",
    sanitizeProductName(productName),
  );
  url.searchParams.set("products[0][price]", amount.toFixed(2));
  url.searchParams.set("products[0][quantity]", "1");
  if (rest.customerPhone) {
    url.searchParams.set("customer_phone", rest.customerPhone);
  }
  if (rest.urlSuccess) url.searchParams.set("urlSuccess", rest.urlSuccess);
  if (rest.urlReturn) url.searchParams.set("urlReturn", rest.urlReturn);
  return url.toString();
}

export function buildPaymentUrl(opts: PaymentUrlOptions): string {
  return buildPaymentUrlString(opts, "pay");
}

const SHORT_LINK_TIMEOUT_MS = 8000;

/**
 * Короткая ссылка вида https://payform.ru/u8zDE/ - Продамус регистрирует
 * заказ и возвращает компактный URL без скобок и параметров. Использовать
 * вместо buildPaymentUrl в сообщениях клиентам: длинная ссылка с
 * products[0][...] ломается при копировании текстом (`[` вырезается),
 * и клиент видит пустую сумму. Fallback на buildPaymentUrl - у вызывающих.
 */
/**
 * Короткая ссылка с автоматическим fallback на прямую: если API коротких
 * ссылок недоступен/ответил мусором - клиент получает длинную ссылку
 * (менее устойчивую к копированию, но рабочую).
 */
export async function resolvePaymentUrl(opts: PaymentUrlOptions): Promise<string> {
  try {
    return await createShortPaymentUrl(opts);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.replace(/[\x00-\x1f]/g, " ") : String(err);
    console.warn(
      "[PAYMENTS] Short link failed, falling back to direct URL:",
      msg,
    );
    return buildPaymentUrl(opts);
  }
}

export async function createShortPaymentUrl(opts: PaymentUrlOptions): Promise<string> {
  const res = await fetch(buildPaymentUrlString(opts, "link"), {
    headers: { "User-Agent": "tvoitrener-bot" },
    signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Prodamus link API responded ${res.status}`);
  }
  const text = (await res.text()).trim();
  // Ответ - просто URL; что-либо иное означает ошибку на стороне Продамуса.
  if (!/^https:\/\/\S+$/.test(text)) {
    throw new Error(`Prodamus link API returned unexpected response: ${text.slice(0, 100)}`);
  }
  return text;
}
