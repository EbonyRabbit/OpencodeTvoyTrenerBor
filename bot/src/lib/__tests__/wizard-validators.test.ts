import { describe, it, expect } from "vitest";
import {
  parseSets,
  parseReps,
  parseWeight,
  parseRpe,
  parseMeasurement,
  parseScale1to10,
  parseHours,
  parsePercentage,
  parseCount,
  parseDate,
  parsePauseReason,
  repsListMatchesSets,
} from "../wizard-validators.js";

describe("repsListMatchesSets", () => {
  it("returns true for non-list reps", () => {
    expect(repsListMatchesSets("8", "3")).toBe(true);
    expect(repsListMatchesSets("8-10", "3")).toBe(true);
  });

  it("returns true when list length matches sets", () => {
    expect(repsListMatchesSets("10/10/10", "3")).toBe(true);
  });

  it("returns false when list length mismatches sets", () => {
    expect(repsListMatchesSets("10/10", "3")).toBe(false);
    expect(repsListMatchesSets("10/10/10/10", "3")).toBe(false);
  });

  it("does not reject when sets is missing or invalid", () => {
    expect(repsListMatchesSets("10/10/10", undefined)).toBe(true);
    expect(repsListMatchesSets("10/10/10", "abc")).toBe(true);
    expect(repsListMatchesSets("10/10/10", "0")).toBe(true);
  });
});

describe("parseSets", () => {
  it("parses valid integers", () => {
    expect(parseSets("3")).toBe("3");
    expect(parseSets("10")).toBe("10");
    expect(parseSets("100")).toBe("100");
  });

  it("trims whitespace", () => {
    expect(parseSets("  5  ")).toBe("5");
  });

  it("rejects zero and negative", () => {
    expect(parseSets("0")).toBeNull();
    expect(parseSets("-1")).toBeNull();
  });

  it("rejects over 100", () => {
    expect(parseSets("101")).toBeNull();
  });

  it("rejects non-integers", () => {
    expect(parseSets("3.5")).toBeNull();
    expect(parseSets("abc")).toBeNull();
  });
});

describe("parseReps", () => {
  it("parses single number", () => {
    expect(parseReps("8")).toBe("8");
  });

  it("parses range with hyphen", () => {
    expect(parseReps("8-10")).toBe("8-10");
  });

  it("parses range with en-dash", () => {
    expect(parseReps("8–10")).toBe("8-10");
  });

  it("parses range with spaces", () => {
    expect(parseReps("8 - 10")).toBe("8-10");
  });

  it("parses per-set list with slashes", () => {
    expect(parseReps("10/10/10")).toBe("10/10/10");
    expect(parseReps("8/7/6")).toBe("8/7/6");
    expect(parseReps("8/10")).toBe("8/10");
  });

  it("parses per-set list with spaces", () => {
    expect(parseReps("10 / 10 / 10")).toBe("10/10/10");
  });

  it("rejects invalid per-set lists", () => {
    expect(parseReps("0/10/10")).toBeNull();
    expect(parseReps("10/0/10")).toBeNull();
    expect(parseReps("10/101/10")).toBeNull();
    expect(parseReps("10/abc/10")).toBeNull();
    expect(parseReps("10//10")).toBeNull();
  });

  it("rejects per-set ranges", () => {
    expect(parseReps("8-10/8-10")).toBeNull();
  });

  it("rejects empty or slash-only input", () => {
    expect(parseReps("")).toBeNull();
    expect(parseReps("   ")).toBeNull();
    expect(parseReps("/")).toBeNull();
    expect(parseReps("10/")).toBeNull();
    expect(parseReps("/10")).toBeNull();
  });

  it("rejects lists over 100 values", () => {
    expect(parseReps(Array(101).fill("8").join("/"))).toBeNull();
  });

  it("rejects invalid ranges", () => {
    expect(parseReps("0-10")).toBeNull();
    expect(parseReps("8-0")).toBeNull();
    expect(parseReps("8-101")).toBeNull();
  });

  it("rejects non-numeric", () => {
    expect(parseReps("abc")).toBeNull();
  });
});

describe("parseWeight", () => {
  it("parses valid weight", () => {
    expect(parseWeight("60")).toBe("60");
    expect(parseWeight("60.5")).toBe("60.5");
  });

  it("strips кг suffix", () => {
    expect(parseWeight("60кг")).toBe("60");
    expect(parseWeight("60 кг")).toBe("60");
  });

  it("strips kg suffix", () => {
    expect(parseWeight("60kg")).toBe("60");
    expect(parseWeight("60 kg")).toBe("60");
  });

  it("parses comma decimals", () => {
    expect(parseWeight("60,5")).toBe("60.5");
    expect(parseWeight("60,5 кг")).toBe("60.5");
  });

  it("parses zero", () => {
    expect(parseWeight("0")).toBe("0");
  });

  it("rejects over 1000", () => {
    expect(parseWeight("1001")).toBeNull();
  });

  it("rejects empty after stripping", () => {
    expect(parseWeight("кг")).toBeNull();
  });

  it("rejects non-numeric", () => {
    expect(parseWeight("abc")).toBeNull();
  });
});

describe("parseRpe", () => {
  it("parses valid RPE", () => {
    expect(parseRpe("7")).toBe("7");
    expect(parseRpe("1")).toBe("1");
    expect(parseRpe("10")).toBe("10");
  });

  it("strips RPE prefix", () => {
    expect(parseRpe("RPE 7")).toBe("7");
    expect(parseRpe("rpe:7")).toBe("7");
    expect(parseRpe("rpe: 7")).toBe("7");
  });

  it("strips RIR prefix", () => {
    expect(parseRpe("RIR 3")).toBe("3");
    expect(parseRpe("rir:3")).toBe("3");
  });

  it("rejects out of range", () => {
    expect(parseRpe("0")).toBeNull();
    expect(parseRpe("11")).toBeNull();
  });

  it("rejects non-integer", () => {
    expect(parseRpe("7.5")).toBeNull();
  });

  it("rejects empty after stripping", () => {
    expect(parseRpe("RPE")).toBeNull();
  });
});

describe("parseMeasurement", () => {
  it("parses valid number", () => {
    expect(parseMeasurement("80")).toBe("80");
    expect(parseMeasurement("80.5")).toBe("80.5");
  });

  it("strips units", () => {
    expect(parseMeasurement("80кг")).toBe("80");
    expect(parseMeasurement("80см")).toBe("80");
    expect(parseMeasurement("80cm")).toBe("80");
  });

  it("rejects over 300", () => {
    expect(parseMeasurement("301")).toBeNull();
  });

  it("rejects empty after stripping", () => {
    expect(parseMeasurement("кг")).toBeNull();
  });
});

describe("parseScale1to10", () => {
  it("parses valid scale", () => {
    expect(parseScale1to10("1")).toBe("1");
    expect(parseScale1to10("10")).toBe("10");
    expect(parseScale1to10("5")).toBe("5");
  });

  it("rejects out of range", () => {
    expect(parseScale1to10("0")).toBeNull();
    expect(parseScale1to10("11")).toBeNull();
  });

  it("rejects non-integer", () => {
    expect(parseScale1to10("5.5")).toBeNull();
  });
});

describe("parseHours", () => {
  it("parses valid hours", () => {
    expect(parseHours("7")).toBe("7");
    expect(parseHours("7.5")).toBe("7.5");
    expect(parseHours("0")).toBe("0");
    expect(parseHours("24")).toBe("24");
  });

  it("strips час suffix", () => {
    expect(parseHours("7час")).toBe("7");
    expect(parseHours("7 час")).toBe("7");
  });

  it("strips hour suffix", () => {
    expect(parseHours("7hour")).toBe("7");
  });

  it("rejects over 24", () => {
    expect(parseHours("25")).toBeNull();
  });

  it("rejects empty after stripping", () => {
    expect(parseHours("час")).toBeNull();
  });
});

describe("parsePercentage", () => {
  it("parses valid percentage", () => {
    expect(parsePercentage("85")).toBe("85");
    expect(parsePercentage("0")).toBe("0");
    expect(parsePercentage("100")).toBe("100");
  });

  it("strips % suffix", () => {
    expect(parsePercentage("85%")).toBe("85");
  });

  it("rejects over 100", () => {
    expect(parsePercentage("101")).toBeNull();
  });

  it("rejects empty after stripping", () => {
    expect(parsePercentage("%")).toBeNull();
  });
});

describe("parseCount", () => {
  it("parses valid count", () => {
    expect(parseCount("0")).toBe("0");
    expect(parseCount("5")).toBe("5");
    expect(parseCount("30")).toBe("30");
  });

  it("rejects negative", () => {
    expect(parseCount("-1")).toBeNull();
  });

  it("rejects over 30", () => {
    expect(parseCount("31")).toBeNull();
  });

  it("rejects non-integer", () => {
    expect(parseCount("1.5")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses valid date", () => {
    expect(parseDate("2026-07-15")).toBe("2026-07-15");
  });

  it("rejects invalid format", () => {
    expect(parseDate("15-07-2026")).toBeNull();
    expect(parseDate("2026/07/15")).toBeNull();
    expect(parseDate("abc")).toBeNull();
  });

  it("rejects invalid month", () => {
    expect(parseDate("2026-13-15")).toBeNull();
    expect(parseDate("2026-00-15")).toBeNull();
  });

  it("rejects invalid day", () => {
    expect(parseDate("2026-07-32")).toBeNull();
    expect(parseDate("2026-07-00")).toBeNull();
  });

  it("rejects non-existent dates", () => {
    expect(parseDate("2026-02-30")).toBeNull();
  });
});

describe("parsePauseReason", () => {
  it("parses numeric reasons", () => {
    expect(parsePauseReason("1")).toBe("sick");
    expect(parsePauseReason("2")).toBe("vacation");
    expect(parsePauseReason("3")).toBe("injury");
    expect(parsePauseReason("4")).toBe("personal");
    expect(parsePauseReason("5")).toBe("other");
  });

  it("parses English reasons", () => {
    expect(parsePauseReason("sick")).toBe("sick");
    expect(parsePauseReason("vacation")).toBe("vacation");
    expect(parsePauseReason("injury")).toBe("injury");
    expect(parsePauseReason("personal")).toBe("personal");
    expect(parsePauseReason("other")).toBe("other");
  });

  it("parses Russian reasons", () => {
    expect(parsePauseReason("болезнь")).toBe("sick");
    expect(parsePauseReason("отпуск")).toBe("vacation");
    expect(parsePauseReason("травма")).toBe("injury");
    expect(parsePauseReason("личное")).toBe("personal");
    expect(parsePauseReason("другое")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(parsePauseReason("Sick")).toBe("sick");
    expect(parsePauseReason("БОЛЕЗНЬ")).toBe("sick");
  });

  it("returns null for unknown reasons", () => {
    expect(parsePauseReason("unknown")).toBeNull();
    expect(parsePauseReason("6")).toBeNull();
  });
});
