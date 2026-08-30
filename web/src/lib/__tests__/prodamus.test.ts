import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildPaymentUrl,
  buildProdamusSignature,
  canonicalizeProdamusBody,
  parseBracketForm,
  parseProdamusOrder,
  verifyProdamusSignature,
} from "../prodamus";

// Официальный пример из докахов Продамуса
// (help.prodamus.ru - «Webhook об оплате» → «Примеры webhook payload»):
// body «Обычная плата» + Sign ec3d935e... + демо-ключ.
const DOCS_SECRET_KEY = "2y2aw4oknnke80bp1a8fniwuuq7tdkwmmuq7vwi4nzbr8z1182ftbn6p8mhw3bhz";
const DOCS_SIGN = "ec3d935e7abe95a4929bc3c7029ca9832fe5c20f8041e7c4eba602d9ecd90ca9";

function docsBody(): string {
  const params = new URLSearchParams();
  params.set("date", "2026-05-15T00:00:00+03:00");
  params.set("order_id", "1");
  params.set("order_num", "test");
  params.set("domain", "demo.payform.ru");
  params.set("sum", "1000.00");
  params.set("customer_phone", "+79999999999");
  params.set("customer_email", "email@domain.com");
  params.set("customer_extra", "тест");
  params.set("payment_type", "Пластиковая карта Visa, MasterCard, МИР");
  params.set("commission", "3.5");
  params.set("commission_sum", "35.00");
  params.set("attempt", "1");
  params.set("sys", "test");
  params.set("products[0][name]", "Доступ к обучающим материалам");
  params.set("products[0][price]", "1000.00");
  params.set("products[0][quantity]", "1");
  params.set("products[0][sum]", "1000.00");
  params.set("payment_status", "success");
  params.set("payment_status_description", "Успешная оплата");
  return params.toString();
}

describe("canonicalizeProdamusBody", () => {
  it("совпадает с канонической строкой из докахов", () => {
    expect(canonicalizeProdamusBody(docsBody())).toBe(
      `{"attempt":"1","commission":"3.5","commission_sum":"35.00","customer_email":"email@domain.com","customer_extra":"тест","customer_phone":"+79999999999","date":"2026-05-15T00:00:00+03:00","domain":"demo.payform.ru","order_id":"1","order_num":"test","payment_status":"success","payment_status_description":"Успешная оплата","payment_type":"Пластиковая карта Visa, MasterCard, МИР","products":[{"name":"Доступ к обучающим материалам","price":"1000.00","quantity":"1","sum":"1000.00"}],"sum":"1000.00","sys":"test"}`,
    );
  });

  it("экранирует / в значениях и сохраняет кириллицу и пустые значения", () => {
    const body = new URLSearchParams();
    body.set("payment_type", "Visa/MasterCard/МИР, RUB");
    body.set("customer_extra", "");
    body.set("sum", "1000.00");
    const canonical = canonicalizeProdamusBody(body.toString());
    expect(canonical).toContain('"payment_type":"Visa\\/MasterCard\\/МИР, RUB"');
    expect(canonical).toContain('"customer_extra":""');
    expect(canonical).toContain("МИР"); // без \uXXXX
    // HMAC от канонической строки == buildProdamusSignature
    expect(buildProdamusSignature(body.toString(), "k")).toBe(
      createHmac("sha256", "k").update(canonical, "utf8").digest("hex"),
    );
  });

  it("исключает ключ signature верхнего уровня и сортирует ключи рекурсивно", () => {
    const body = new URLSearchParams();
    body.set("b", "2");
    body.set("a", "1");
    body.set("signature", "fake");
    body.set("products[0][y]", "yy");
    body.set("products[0][x]", "xx");
    expect(canonicalizeProdamusBody(body.toString())).toBe(
      `{"a":"1","b":"2","products":[{"x":"xx","y":"yy"}]}`,
    );
  });

  it("парсит brackets: массив с индексами, дыры → пустые значения, push через []", () => {
    const parsed = parseBracketForm(
      "products[0][name]=A&products[2][name]=B&plain=1&list[]=one&list[]=two",
    );
    expect(parsed).toEqual({
      products: [{ name: "A" }, null, { name: "B" }],
      plain: "1",
      list: ["one", "two"],
    });
  });

  it("защищён от prototype pollution", () => {
    expect(() => {
      parseBracketForm("__proto__[x]=1&constructor[prototype][polluted]=yes&toString[owned]=1");
    }).not.toThrow();
    const proto = Object.prototype as Record<string, unknown>;
    expect(proto.x).toBeUndefined();
    expect(proto.polluted).toBeUndefined();
    expect(proto.owned).toBeUndefined();
    expect(parseBracketForm("__proto__[x]=1")).toEqual({});
    expect(parseBracketForm("list[0][__proto__][x]=1")).toEqual({ list: [{}] });
    expect(proto.x).toBeUndefined();
  });

  it("конфликтующие типы ключей не бросают (last-wins)", () => {
    expect(() => parseBracketForm("a=2&a[b]=1")).not.toThrow();
    expect(parseBracketForm("a=2&a[b]=1")).toEqual({ a: { b: "1" } });
    expect(parseBracketForm("products[0]=A&products[0][name]=B")).toEqual({
      products: [{ name: "B" }],
    });
  });

  it("некорректные индексы массивов пропускаются, большие - не раздувают память", () => {
    expect(parseBracketForm("products[x][y]=B")).toEqual({ products: { x: { y: "B" } } });
    expect(parseBracketForm("products[999999999][name]=A")).toEqual({ products: [] });
    expect(parseBracketForm("list[0]=x&list[999999999][y]=1")).toEqual({ list: ["x"] });
  });

  it("глубокая вложенность не роняет стек", () => {
    const segments = Array.from({ length: 40 }, () => "[0]").join("");
    const deep = `a${segments}[x]=1`;
    expect(() => parseBracketForm(deep)).not.toThrow();
    expect(parseBracketForm(deep)).toEqual({});
  });

  it("несколько продуктов", () => {
    const body = new URLSearchParams();
    body.set("products[0][name]", "A");
    body.set("products[1][name]", "B");
    expect(parseBracketForm(body.toString())).toEqual({
      products: [{ name: "A" }, { name: "B" }],
    });
  });
});

describe("buildProdamusSignature / verifyProdamusSignature", () => {
  it("официальный пример: подпись совпадает", () => {
    expect(buildProdamusSignature(docsBody(), DOCS_SECRET_KEY)).toBe(DOCS_SIGN);
  });

  it("официальный пример: verify успешен", () => {
    expect(verifyProdamusSignature(docsBody(), DOCS_SIGN, DOCS_SECRET_KEY)).toBe(true);
  });

  it("multipart/form-data (FormData): подпись совпадает", () => {
    const fd = new FormData();
    fd.set("date", "2026-05-15T00:00:00+03:00");
    fd.set("order_id", "1");
    fd.set("order_num", "test");
    fd.set("domain", "demo.payform.ru");
    fd.set("sum", "1000.00");
    fd.set("customer_phone", "+79999999999");
    fd.set("customer_email", "email@domain.com");
    fd.set("customer_extra", "тест");
    fd.set("payment_type", "Пластиковая карта Visa, MasterCard, МИР");
    fd.set("commission", "3.5");
    fd.set("commission_sum", "35.00");
    fd.set("attempt", "1");
    fd.set("sys", "test");
    fd.set("products[0][name]", "Доступ к обучающим материалам");
    fd.set("products[0][price]", "1000.00");
    fd.set("products[0][quantity]", "1");
    fd.set("products[0][sum]", "1000.00");
    fd.set("payment_status", "success");
    fd.set("payment_status_description", "Успешная оплата");
    expect(verifyProdamusSignature(fd, DOCS_SIGN, DOCS_SECRET_KEY)).toBe(true);
  });

  it("отклоняет подпись при изменённом body", () => {
    const tampered = docsBody().replace("sum=1000.00", "sum=999.00");
    expect(verifyProdamusSignature(tampered, DOCS_SIGN, DOCS_SECRET_KEY)).toBe(false);
  });

  it("отклоняет подпись при неверном секрете", () => {
    expect(verifyProdamusSignature(docsBody(), DOCS_SIGN, "wrong-secret")).toBe(false);
  });

  it("отклоняет при пустом/отсутствующем/не-строковом заголовке и не-подписи", () => {
    expect(verifyProdamusSignature(docsBody(), null, DOCS_SECRET_KEY)).toBe(false);
    expect(verifyProdamusSignature(docsBody(), "", DOCS_SECRET_KEY)).toBe(false);
    expect(verifyProdamusSignature(docsBody(), 123, DOCS_SECRET_KEY)).toBe(false);
    expect(verifyProdamusSignature(docsBody(), ["x", "y"], DOCS_SECRET_KEY)).toBe(false);
    expect(verifyProdamusSignature(docsBody(), "zz-not-a-hex", DOCS_SECRET_KEY)).toBe(false);
  });

  it("не бросает на мусорном body (pre-auth поверхность)", () => {
    expect(verifyProdamusSignature("a=2&a[b]=1", "fake-sign", "k")).toBe(false);
    expect(verifyProdamusSignature("__proto__[x]=1", DOCS_SIGN, DOCS_SECRET_KEY)).toBe(false);
    expect(
      verifyProdamusSignature("products[999999999][name]=A", DOCS_SIGN, DOCS_SECRET_KEY),
    ).toBe(false);
  });

  it("не бросает на не-шестнадцатеричной подписи той же длины", () => {
    const fake = "g".repeat(DOCS_SIGN.length);
    expect(verifyProdamusSignature(docsBody(), fake, DOCS_SECRET_KEY)).toBe(false);
  });

  it("регистр и пробелы подписи не важны", () => {
    expect(verifyProdamusSignature(docsBody(), DOCS_SIGN.toUpperCase(), DOCS_SECRET_KEY)).toBe(
      true,
    );
    expect(verifyProdamusSignature(docsBody(), `  ${DOCS_SIGN}  `, DOCS_SECRET_KEY)).toBe(true);
  });

  it("round-trip: собственная подпись проверяется", () => {
    const body = new URLSearchParams();
    body.set("order_id", "abc-123");
    body.set("payment_status", "success");
    body.set("sum", "1000.00");
    const raw = body.toString();
    const sign = buildProdamusSignature(raw, "secret");
    expect(verifyProdamusSignature(raw, sign, "secret")).toBe(true);
    expect(verifyProdamusSignature(raw, sign, "other")).toBe(false);
  });
});

describe("parseProdamusOrder", () => {
  it("официальный пример: order_id, sum, status, products", () => {
    const order = parseProdamusOrder(docsBody());
    // В доках order_id=1 (внутренний ID Продамуса), order_num="test" (наш номер
    // заказа) - приоритет у order_num.
    expect(order.orderId).toBe("test");
    expect(order.sum).toBe(1000);
    expect(order.paymentStatus).toBe("success");
    expect(order.products).toEqual([
      { name: "Доступ к обучающим материалам", price: "1000.00", quantity: "1", sum: "1000.00" },
    ]);
  });

  it("пустое body → null и пустые продукты", () => {
    expect(parseProdamusOrder("")).toEqual({
      orderId: null,
      sum: null,
      paymentStatus: null,
      products: [],
    });
  });

  it("битая сумма → null", () => {
    const body = new URLSearchParams();
    body.set("order_id", "7");
    body.set("sum", "не-число");
    const order = parseProdamusOrder(body.toString());
    expect(order.orderId).toBe("7");
    expect(order.sum).toBeNull();
  });

  it("без products → пустой массив", () => {
    const body = new URLSearchParams();
    body.set("payment_status", "order_canceled");
    expect(parseProdamusOrder(body.toString()).products).toEqual([]);
  });

  it("принимает FormData (multipart)", () => {
    const fd = new FormData();
    fd.set("order_id", "9");
    fd.set("sum", "1000.00");
    fd.set("payment_status", "success");
    const order = parseProdamusOrder(fd);
    expect(order.orderId).toBe("9");
    expect(order.sum).toBe(1000);
    expect(order.paymentStatus).toBe("success");
  });

  it("реальный продовый payload: наш UUID в order_num, внутренний ID Продамуса в order_id", () => {
    // Регрессия e2e 24.08.2026: вебхук приходил с order_id="47987743"
    // (внутренний ID Продамуса) и order_num=<наш UUID> - активация падала.
    const body = new URLSearchParams();
    body.set("date", "2026-08-24T15:33:17+03:00");
    body.set("order_id", "47987743");
    body.set("order_num", "36ba6284-4e7c-4ba8-bcbc-de502107a0bf");
    body.set("domain", "TvoyTrener.payform.ru");
    body.set("sum", "7770.00");
    body.set("currency", "rub");
    body.set("customer_phone", "+79978797709");
    body.set("payment_type", "СБП");
    body.set("payment_status", "success");
    body.set(
      "products",
      JSON.stringify([
        { name: "Домашний Full Body 10 недель", price: "7770.00", quantity: "1", sum: "7770.00" },
      ]),
    );

    const order = parseProdamusOrder(body.toString());
    expect(order.orderId).toBe("36ba6284-4e7c-4ba8-bcbc-de502107a0bf");
    expect(order.sum).toBe(7770);
    expect(order.paymentStatus).toBe("success");
  });

  it("нет order_num → fallback на order_id (обратная совместимость с доками)", () => {
    const body = new URLSearchParams();
    body.set("order_id", "1");
    expect(parseProdamusOrder(body.toString()).orderId).toBe("1");
  });
});

describe("buildPaymentUrl", () => {
  const payformUrl = "https://demo.payform.ru";

  it("санитизирует типографские символы в названии (регрессия e2e: HYROX 5×12)", () => {
    const url = buildPaymentUrl({
      payformUrl,
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 7770,
      productName: "HYROX 5\u00D712 \u2014 подготовка к гонке",
    });
    const parsed = new URL(url);
    // × → x, - → - : страница Продамуса (windows-1251) не распознаёт их
    expect(parsed.searchParams.get("products[0][name]")).toBe(
      "HYROX 5x12 - подготовка к гонке",
    );
    expect(url).not.toContain("%C3%97"); // UTF-8 ×
    expect(url).not.toContain("%E2%80%94"); // UTF-8 -
  });

  it("санитизирует кавычки и вырезает символы вне windows-1251 (emoji, стрелки)", () => {
    const parsed = new URL(
      buildPaymentUrl({
        payformUrl,
        orderId: "550e8400-e29b-41d4-a716-446655440000",
        amount: 1000,
        productName: "\u00ABСила\u00BB \u201CPro\u201D \u2192 \u{1F3CB}\uFE0F",
      }),
    );
    expect(parsed.searchParams.get("products[0][name]")).toBe('"Сила" "Pro"');
  });

  it("строит полный URL с кодированными скобками", () => {
    const url = buildPaymentUrl({
      payformUrl,
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 4900,
      productName: "Гипертрофия 10 недель",
      customerPhone: "+79999999999",
      urlSuccess: "https://example.com/success",
      urlReturn: "https://example.com/return",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe(payformUrl);
    expect(parsed.searchParams.get("do")).toBe("pay");
    expect(parsed.searchParams.get("order_id")).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parsed.searchParams.get("products[0][name]")).toBe("Гипертрофия 10 недель");
    expect(parsed.searchParams.get("products[0][price]")).toBe("4900.00");
    expect(parsed.searchParams.get("products[0][quantity]")).toBe("1");
    expect(parsed.searchParams.get("customer_phone")).toBe("+79999999999");
    expect(parsed.searchParams.get("urlSuccess")).toBe("https://example.com/success");
    expect(parsed.searchParams.get("urlReturn")).toBe("https://example.com/return");
    expect(url).toContain("products%5B0%5D%5Bname%5D=");
  });

  it("опциональные параметры опускаются", () => {
    const url = buildPaymentUrl({
      payformUrl,
      orderId: "1",
      amount: 1000,
      productName: "База",
    });
    expect(url).not.toContain("customer_phone");
    expect(url).not.toContain("urlSuccess");
    expect(url).not.toContain("urlReturn");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("products[0][price]")).toBe("1000.00");
    expect(parsed.searchParams.get("products[0][quantity]")).toBe("1");
    expect(parsed.searchParams.get("customer_phone")).toBeNull();
  });

  it("отклоняет некорректные суммы", () => {
    const base = { payformUrl, orderId: "1", productName: "X" };
    expect(() => buildPaymentUrl({ ...base, amount: NaN })).toThrow();
    expect(() => buildPaymentUrl({ ...base, amount: Infinity })).toThrow();
    expect(() => buildPaymentUrl({ ...base, amount: 0 })).toThrow();
    expect(() => buildPaymentUrl({ ...base, amount: -5 })).toThrow();
    expect(new URL(buildPaymentUrl({ ...base, amount: 1000 })).searchParams.get("products[0][price]")).toBe("1000.00");
  });
});

describe("createShortPaymentUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("запрашивает do=link и возвращает короткий URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("https://payform.ru/m9cmErR/", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createShortPaymentUrl } = await import("@/lib/prodamus");
    const short = await createShortPaymentUrl({
      payformUrl: "https://tvoytrener.payform.ru",
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 7770,
      productName: "HYROX 5x12 - подготовка к гонке",
    });

    expect(short).toBe("https://payform.ru/m9cmErR/");
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain("do=link");
    expect(requested).toContain("products%5B0%5D%5Bprice%5D=7770.00");
  });

  it("бросает при не-URL ответе Продамуса", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error: bad request", { status: 200 })),
    );
    const { createShortPaymentUrl } = await import("@/lib/prodamus");
    await expect(
      createShortPaymentUrl({
        payformUrl: "https://demo.payform.ru",
        orderId: "1",
        amount: 100,
        productName: "X",
      }),
    ).rejects.toThrow("unexpected response");
  });

  it("бросает при HTTP-ошибке API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    const { createShortPaymentUrl } = await import("@/lib/prodamus");
    await expect(
      createShortPaymentUrl({
        payformUrl: "https://demo.payform.ru",
        orderId: "1",
        amount: 100,
        productName: "X",
      }),
    ).rejects.toThrow("responded 500");
  });
});
