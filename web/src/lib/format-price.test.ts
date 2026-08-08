import { describe, it, expect } from "vitest";
import { formatPrice } from "./format-price";

describe("formatPrice", () => {
  it("formats with ru-RU grouping (non-breaking space)", () => {
    expect(formatPrice(15000)).toBe(`15\u00A0000`);
    expect(formatPrice(1234567)).toBe(`1\u00A0234\u00A0567`);
  });

  it("does not add grouping for small numbers", () => {
    expect(formatPrice(0)).toBe("0");
    expect(formatPrice(999)).toBe("999");
  });

  it("rounds fractions to integers", () => {
    expect(formatPrice(15000.75)).toBe(`15\u00A0001`);
  });
});