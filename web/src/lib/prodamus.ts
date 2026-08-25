import { createHmac, timingSafeEqual } from "node:crypto";

// Prodamus (Продамус) — онлайн-оплата (Фаза 21).
// Ссылка на платёжную страницу и проверка подписи webhook'ов.
//
// Алгоритм подписи (https://help.prodamus.ru — «Webhook об оплате» →
// «Проверка подписи Sign»): параметры body → вложенная структура →
// все значения приводятся к строкам (false/null → "", true → "1") →
// ключи сортируются рекурсивно по алфавиту (массивы сохраняют порядок) →
// компактный JSON (без пробелов, кириллица НЕ экранируется) →
// каждый "/" экранируется в "\/" → HMAC-SHA256 секретным ключом → hex.
//
// ВАЖНО (безопасность): webhook не аутентифицирован до проверки подписи,
// поэтому разбор body выполняется до верификации и обязан быть тотальным:
// без крашей, без прототип-поллюции, с ограничением глубины/индексов.

export type ProdamusFormEntries =
  | string // raw application/x-www-form-urlencoded body
  | URLSearchParams
  | FormData // multipart/form-data (официальный формат доставки webhook)
  | Iterable<readonly [string, string]>;

const MAX_ARRAY_INDEX = 1000; // реальный платёж — 1-3 продукта; cap защищает от OOM
const MAX_SEGMENTS = 32; // глубина вложенности ключей (защита от stack overflow)
const BLOCKED_HEADS = new Set(["__proto__", "constructor", "prototype"]);

export type PaymentUrlOptions = {
  payformUrl: string;
  orderId: string;
  amount: number;
  productName: string;
  customerPhone?: string | null;
  urlSuccess?: string | null;
  urlReturn?: string | null;
};

function entriesToPairs(entries: ProdamusFormEntries): Iterable<readonly [string, string]> {
  if (typeof entries === "string") return new URLSearchParams(entries);
  if (entries instanceof URLSearchParams) return entries;
  if (typeof FormData !== "undefined" && entries instanceof FormData) {
    return Array.from(entries.entries()).map(
      ([k, v]) => [k, typeof v === "string" ? v : String(v)] as const,
    );
  }
  return entries as Iterable<readonly [string, string]>;
}

// Разворачивает параметры формы во вложенную структуру:
// "products[0][name]=Жим" → { products: [{ name: "Жим" }] },
// "products[]=..." → массив с добавлением; дубликаты — последнее значение.
export function parseBracketForm(raw: string): Record<string, unknown> {
  return parseFormEntries(new URLSearchParams(raw));
}

function parseFormEntries(entries: ProdamusFormEntries): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of entriesToPairs(entries)) {
    placeValue(root, splitKey(key), value);
  }
  return root;
}

function splitKey(key: string): string[] {
  const bracketStart = key.indexOf("[");
  const segments = [bracketStart === -1 ? key : key.slice(0, bracketStart)];
  const bracketRe = /\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = bracketRe.exec(key)) !== null) {
    segments.push(match[1]);
  }
  return segments;
}

function placeValue(parent: unknown, segments: string[], value: string): void {
  if (segments.length > MAX_SEGMENTS) return;
  const head = segments[0];
  const rest = segments.slice(1);
  if (BLOCKED_HEADS.has(head)) return; // защита от prototype pollution

  if (rest.length === 0) {
    if (Array.isArray(parent)) {
      if (head === "") {
        (parent as unknown[]).push(value);
      } else {
        const idx = Number(head);
        if (!isSafeIndex(idx)) return;
        ensureArrayLength(parent, idx);
        (parent as unknown[])[idx] = value;
      }
    } else {
      (parent as Record<string, unknown>)[head] = value;
    }
    return;
  }

  const nextIsAppendOrIndex = rest[0] === "" || /^\d+$/.test(rest[0]);
  const freshContainer = nextIsAppendOrIndex ? [] : {};

  if (Array.isArray(parent)) {
    const idx = Number(head);
    if (!isSafeIndex(idx)) return;
    ensureArrayLength(parent, idx);
    const child = (parent as unknown[])[idx];
    if (typeof child !== "object" || child === null) {
      (parent as unknown[])[idx] = freshContainer;
    }
    placeValue((parent as unknown[])[idx], rest, value);
  } else {
    const obj = parent as Record<string, unknown>;
    if (!Object.hasOwn(obj, head) || typeof obj[head] !== "object" || obj[head] === null) {
      obj[head] = freshContainer;
    }
    placeValue(obj[head], rest, value);
  }
}

function isSafeIndex(idx: number): boolean {
  return Number.isInteger(idx) && idx >= 0 && idx < MAX_ARRAY_INDEX;
}

function ensureArrayLength(arr: unknown[], idx: number): void {
  while (arr.length <= idx) {
    arr.push(null);
  }
}

// Значения к строкам по семантике PHP strval (как в эталонных библиотеках
// Продамуса): false/null/undefined → "", true → "1".
function toSignStrings(value: unknown): unknown {
  if (value === null || value === undefined || value === false) return "";
  if (value === true) return "1";
  if (Array.isArray(value)) return value.map(toSignStrings);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toSignStrings(v);
    }
    return out;
  }
  return String(value);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// Канонический JSON-компонент подписи из параметров формы
// (работает и для x-www-form-urlencoded, и для multipart/form-data).
export function canonicalizeProdamusEntries(entries: ProdamusFormEntries): string {
  const payload = parseFormEntries(entries);
  delete payload.signature; // верхний уровень: ключ signature не подписывается
  const normalized = sortDeep(toSignStrings(payload));
  return JSON.stringify(normalized).replaceAll("/", "\\/");
}

export function canonicalizeProdamusBody(raw: string): string {
  return canonicalizeProdamusEntries(new URLSearchParams(raw));
}

export function buildProdamusSignature(rawBody: string, secretKey: string): string {
  return createHmac("sha256", secretKey)
    .update(canonicalizeProdamusBody(rawBody), "utf8")
    .digest("hex");
}

// Верификация подписи. Никогда не бросает: при любых ошибках разбора,
// неверном заголовке или не-шестнадцатеричной подписи — false.
export function verifyProdamusSignature(
  entries: ProdamusFormEntries,
  signHeader: unknown,
  secretKey: string,
): boolean {
  if (typeof signHeader !== "string" || signHeader === "") return false;
  try {
    const canonical = canonicalizeProdamusEntries(entries);
    const expected = createHmac("sha256", secretKey).update(canonical, "utf8").digest("hex");
    const actual = signHeader.trim().toLowerCase();
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  } catch {
    return false;
  }
}

export type ProdamusProduct = {
  name: string | null;
  price: string | null;
  quantity: string | null;
  sum: string | null;
};

export type ProdamusOrder = {
  orderId: string | null;
  sum: number | null;
  paymentStatus: string | null;
  products: ProdamusProduct[];
};

export function parseProdamusOrder(entries: ProdamusFormEntries): ProdamusOrder {
  const payload = parseFormEntries(entries);
  const toStr = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v);

  const products = Array.isArray(payload.products)
    ? (payload.products as unknown[]).map((p): ProdamusProduct => {
        const obj = (p ?? {}) as Record<string, unknown>;
        return {
          name: toStr(obj.name),
          price: toStr(obj.price),
          quantity: toStr(obj.quantity),
          sum: toStr(obj.sum),
        };
      })
    : [];

  const sumRaw = toStr(payload.sum);
  const sum = sumRaw === null ? null : Number(sumRaw);

  // Пустая/пробельная строка order_num не должна перекрывать fallback.
  const orderNum = toStr(payload.order_num)?.trim();

  return {
    // Продамус возвращает наш идентификатор заказа (то, что мы отправляли
    // в order_id платёжной ссылки) в поле order_num, а в order_id кладёт
    // свой внутренний числовой ID. Активация ищет заявку по нашему UUID,
    // поэтому приоритет — order_num.
    orderId: orderNum || toStr(payload.order_id),
    sum: sum === null || !Number.isFinite(sum) ? null : sum,
    paymentStatus: toStr(payload.payment_status),
    products,
  };
}

// Замена типографских символов и вырезание всего, что отсутствует в
// кодировке windows-1251 страницы оплаты Продамуса (эмодзи, стрелки,
// dingbats и т.п.): × ✕ ✖, тире, типографские кавычки, emoji.
export function sanitizeProductName(name: string): string {
  // Fallback: если после санитизации пусто (название целиком из emoji),
  // оставляем нейтральное наименование — пустой товар Продамус не примет.
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

// Ссылка на платёжную страницу (развёрнутая, без SYS-кода).
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
  // NB: отправляемый здесь orderId вебхук вернёт в поле order_num
  // (см. parseProdamusOrder).
  url.searchParams.set("order_id", orderId);
  url.searchParams.set(
    "products[0][name]",
    sanitizeProductName(productName),
  );
  url.searchParams.set("products[0][price]", amount.toFixed(2));
  url.searchParams.set("products[0][quantity]", "1");
  if (customerPhone) url.searchParams.set("customer_phone", customerPhone);
  if (urlSuccess) url.searchParams.set("urlSuccess", urlSuccess);
  if (urlReturn) url.searchParams.set("urlReturn", urlReturn);
  return url.toString();
}
