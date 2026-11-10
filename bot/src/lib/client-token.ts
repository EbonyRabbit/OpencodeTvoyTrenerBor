import { createHash, randomBytes } from "node:crypto";

export const CLIENT_TOKEN_EXPIRY_DAYS = 30;
export const CLIENT_TOKEN_LENGTH = 16;

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function hashClientToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateClientTokenValue(length = CLIENT_TOKEN_LENGTH): string {
  let token = "";
  while (token.length < length) {
    const byte = randomBytes(1)[0];
    if (byte < 252) {
      token += TOKEN_CHARS[byte % TOKEN_CHARS.length];
    }
  }
  return token;
}
