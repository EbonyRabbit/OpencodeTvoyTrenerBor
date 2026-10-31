import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPaymentUrl,
  resolvePaymentUrl,
  sanitizeProductName,
} from "../prodamus.js";

describe("buildPaymentUrl", () => {
  it("builds a pay URL with the stored amount and sanitized product name", () => {
    const url = new URL(
      buildPaymentUrl({
        payformUrl: "https://pay.demo.prodamus.ru/payment",
        orderId: "order-1",
        amount: 5900,
        productName: "Сила — «новичка» 🏋️",
      }),
    );

    expect(url.searchParams.get("do")).toBe("pay");
    expect(url.searchParams.get("order_id")).toBe("order-1");
    expect(url.searchParams.get("products[0][name]")).toBe(
      'Сила - "новичка"',
    );
    expect(url.searchParams.get("products[0][price]")).toBe("5900.00");
    expect(url.searchParams.get("products[0][quantity]")).toBe("1");
  });

  it("rejects a non-positive or non-finite amount", () => {
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildPaymentUrl({
          payformUrl: "https://pay.demo.prodamus.ru/payment",
          orderId: "order-1",
          amount,
          productName: "Программа",
        }),
      ).toThrow();
    }
  });
});

describe("sanitizeProductName", () => {
  it("normalizes typographic characters and removes emoji", () => {
    expect(sanitizeProductName("Сила – «старт» × 2 🏋️")).toBe(
      'Сила - "старт" x 2',
    );
  });

  it("falls back to a neutral name when only emoji remain", () => {
    expect(sanitizeProductName("🏋️‍♂️🔥")).toBe("Программа");
  });
});

describe("resolvePaymentUrl", () => {
  const opts = {
    payformUrl: "https://pay.demo.prodamus.ru/payment",
    orderId: "order-1",
    amount: 5900,
    productName: "Программа",
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the short link from the payment API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "https://payform.ru/abc123/",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePaymentUrl(opts)).resolves.toBe(
      "https://payform.ru/abc123/",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("do=link");
  });

  it("falls back to the direct payment URL when the API fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    const url = new URL(await resolvePaymentUrl(opts));

    expect(url.searchParams.get("do")).toBe("pay");
    expect(url.searchParams.get("order_id")).toBe("order-1");
    expect(url.searchParams.get("products[0][price]")).toBe("5900.00");
    expect(warn).toHaveBeenCalled();
  });
});
