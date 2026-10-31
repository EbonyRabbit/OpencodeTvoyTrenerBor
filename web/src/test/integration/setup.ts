import { beforeAll } from "vitest";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function isLocalSupabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      parsed.protocol === "http:" &&
      parsed.port !== "" &&
      LOOPBACK_HOSTS.has(host)
    );
  } catch {
    return false;
  }
}

beforeAll(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      "Integration tests require a local Supabase. Run `npm run test:integration` from the web package.",
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for integration tests.");
  }
  if (process.env.TEST_DB_HARNESS !== "1") {
    throw new Error(
      "Integration tests are only available through the integration harness.",
    );
  }
  if (!process.env.SUPABASE_DB_CONTAINER?.startsWith("supabase_db_")) {
    throw new Error(
      "SUPABASE_DB_CONTAINER is required for integration tests and must be a supabase_db_* container.",
    );
  }
  if (!process.env.TEST_DB_FINGERPRINT) {
    throw new Error(
      "TEST_DB_FINGERPRINT is required. Run the integration harness, not Vitest directly.",
    );
  }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const dbHost = new URL(dbUrl).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    if (!LOOPBACK_HOSTS.has(dbHost)) {
      throw new Error("Integration tests refuse a non-local SUPABASE_DB_URL.");
    }
  }
});
