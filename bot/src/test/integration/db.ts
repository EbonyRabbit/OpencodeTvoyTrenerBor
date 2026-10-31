import { execFileSync } from "node:child_process";

if (process.env.TEST_DB_HARNESS !== "1") {
  throw new Error(
    "Integration DB helpers are only available through the integration harness.",
  );
}
const containerEnv = process.env.SUPABASE_DB_CONTAINER;
if (!containerEnv?.startsWith("supabase_db_")) {
  throw new Error(
    "SUPABASE_DB_CONTAINER is required and must be a supabase_db_* container.",
  );
}
const container: string = containerEnv;
const expectedFingerprint = process.env.TEST_DB_FINGERPRINT;
const expectedRunToken = process.env.TEST_DB_RUN_TOKEN;
if (!expectedFingerprint || !expectedRunToken) {
  throw new Error(
    "TEST_DB_FINGERPRINT and TEST_DB_RUN_TOKEN are required. Run the integration harness, not Vitest directly.",
  );
}

function psql(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
  ).trim();
}

const marker = psql(
  "SELECT coalesce(fingerprint, '') || '|' || coalesce(run_token, '') FROM public.__test_harness LIMIT 1",
);
if (marker !== `${expectedFingerprint}|${expectedRunToken}`) {
  throw new Error(
    "Test database marker does not match this harness run.",
  );
}

const TRUNCATE_ALL_SQL = `
DO $$
DECLARE
  row record;
BEGIN
  FOR row IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__test_harness'
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', row.tablename);
  END LOOP;
END $$;
`;

export function runTestSql(sql: string): void {
  try {
    psql(sql);
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: Buffer }).stderr)
        : String(error);
    throw new Error(`Failed to run test SQL in ${container}: ${stderr}`);
  }
}

export function resetDb(): void {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        TRUNCATE_ALL_SQL,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      },
    );
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: Buffer }).stderr)
        : String(error);
    throw new Error(`Failed to reset test database ${container}: ${stderr}`);
  }
}
