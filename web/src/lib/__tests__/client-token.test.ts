import { describe, expect, it } from "vitest";
import {
  CLIENT_TOKEN_EXPIRY_DAYS,
  CLIENT_TOKEN_LENGTH,
  generateClientTokenValue,
  hashClientToken,
} from "../client-token";

describe("client tokens", () => {
  it("hashes deterministically with SHA-256 hex", () => {
    expect(hashClientToken("ABC123")).toBe(
      "e0bebd22819993425814866b62701e2919ea26f1370499c1037b53b9d49c2c8a",
    );
    expect(hashClientToken("ABC123")).toHaveLength(64);
    expect(hashClientToken("ABC123")).not.toBe(hashClientToken("ABC124"));
  });

  it("generates uppercase alphanumeric tokens of the requested length", () => {
    const token = generateClientTokenValue();
    expect(token).toMatch(new RegExp(`^[A-Z0-9]{${CLIENT_TOKEN_LENGTH}}$`));
    expect(generateClientTokenValue(8)).toMatch(/^[A-Z0-9]{8}$/);
  });

  it("does not repeat tokens in a small sample", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateClientTokenValue()));
    expect(tokens.size).toBe(100);
  });

  it("keeps the configured expiry at 30 days", () => {
    expect(CLIENT_TOKEN_EXPIRY_DAYS).toBe(30);
  });
});
