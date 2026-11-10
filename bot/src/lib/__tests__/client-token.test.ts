import { describe, expect, it } from "vitest";
import {
  CLIENT_TOKEN_EXPIRY_DAYS,
  CLIENT_TOKEN_LENGTH,
  generateClientTokenValue,
  hashClientToken,
} from "../client-token.js";

describe("client tokens", () => {
  it("hashes deterministically with SHA-256 hex", () => {
    expect(hashClientToken("ABC123")).toBe(
      "e0bebd22819993425814866b62701e2919ea26f1370499c1037b53b9d49c2c8a",
    );
    expect(hashClientToken("ABC123")).toHaveLength(64);
    expect(hashClientToken("ABC124")).not.toBe(hashClientToken("ABC123"));
  });

  it("generates uppercase alphanumeric tokens", () => {
    expect(generateClientTokenValue()).toMatch(
      new RegExp(`^[A-Z0-9]{${CLIENT_TOKEN_LENGTH}}$`),
    );
  });

  it("keeps the configured expiry at 30 days", () => {
    expect(CLIENT_TOKEN_EXPIRY_DAYS).toBe(30);
  });
});
