import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
const extraArgs = process.argv.slice(3);

const targets = {
  bot: "bot",
  web: "web",
};

if (!targets[target]) {
  console.error("Usage: node scripts/test-db.mjs <bot|web> [vitest args...]");
  process.exit(2);
}

const lockPath = path.join(root, ".test-db.lock");
const lockOwner = `${process.pid}:${randomUUID()}`;
const commandTimeoutMs = 10 * 60 * 1000;
const captureTimeoutMs = 30 * 1000;
const apiReadinessTimeoutMs = 30 * 1000;
const vitestTimeoutMs = 30 * 60 * 1000;
const markerTable = "__test_harness";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    timeout: commandTimeoutMs,
    ...options,
  });
  if (result.error) {
    console.error(`[test-db] ${command} failed: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: captureTimeoutMs,
    ...options,
  });
}

function parseEnv(output) {
  const env = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function dockerIsRunning() {
  try {
    capture("docker", ["info"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 10 * 1000,
    });
    return true;
  } catch {
    return false;
  }
}

function containerIsRunning(container) {
  try {
    return (
      capture("docker", [
        "inspect",
        "--format",
        "{{.State.Running}}",
        container,
      ]).trim() === "true"
    );
  } catch {
    return false;
  }
}

function projectId() {
  try {
    const config = readFileSync(
      path.join(root, "supabase", "config.toml"),
      "utf8",
    );
    return config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] ?? "OpenCode";
  } catch {
    return "OpenCode";
  }
}

function psql(container, sql) {
  return capture("docker", [
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
  ]).trim();
}

function migrationsFingerprint() {
  try {
    const dir = path.join(root, "supabase", "migrations");
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(file);
      hash.update("\0");
      hash.update(readFileSync(path.join(dir, file)));
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch {
    return "";
  }
}

function harnessFingerprint(container) {
  if (
    psql(
      container,
      `SELECT to_regclass('public.${markerTable}') IS NOT NULL`,
    ) !== "t"
  ) {
    return null;
  }
  try {
    return psql(
      container,
      `SELECT coalesce(fingerprint, '') FROM public.${markerTable} LIMIT 1`,
    );
  } catch {
    // marker старой версии без fingerprint
    return "";
  }
}

function ensureHarnessMarker(container, fingerprint, runToken) {
  psql(
    container,
    `CREATE TABLE IF NOT EXISTS public.${markerTable} (
       id boolean PRIMARY KEY DEFAULT true,
       fingerprint text,
       run_token text
     );
     ALTER TABLE public.${markerTable} ADD COLUMN IF NOT EXISTS fingerprint text;
     ALTER TABLE public.${markerTable} ADD COLUMN IF NOT EXISTS run_token text;
     INSERT INTO public.${markerTable} (id, fingerprint, run_token)
       VALUES (true, '${fingerprint}', '${runToken}')
       ON CONFLICT (id) DO UPDATE
         SET fingerprint = EXCLUDED.fingerprint,
             run_token = EXCLUDED.run_token;
     GRANT SELECT, INSERT, UPDATE, DELETE ON public.${markerTable} TO authenticated;
     GRANT ALL ON public.${markerTable} TO service_role;`,
  );
}

function hasApplicationData(container) {
  try {
    psql(
      container,
      `DO $$
       DECLARE
         table_row record;
         has_rows boolean;
       BEGIN
         FOR table_row IN
           SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tablename <> '${markerTable}'
         LOOP
           EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', table_row.tablename)
             INTO has_rows;
           IF has_rows THEN
             RAISE EXCEPTION 'TEST_DB_HAS_DATA';
           END IF;
         END LOOP;
       END $$;`,
    );
    return false;
  } catch (error) {
    const text = String(error);
    if (text.includes("TEST_DB_HAS_DATA")) return true;
    throw new Error(`Could not inspect local database contents: ${text}`);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function lockPidPath() {
  return path.join(lockPath, "pid");
}

function acquireLock() {
  try {
    mkdirSync(lockPath);
    writeFileSync(lockPidPath(), lockOwner);
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  let stale = false;
  let observed = "";
  let age = Number.POSITIVE_INFINITY;
  try {
    age = Date.now() - statSync(lockPath).mtimeMs;
    observed = readFileSync(lockPidPath(), "utf8").trim();
    if (!observed) {
      stale = age > 5000;
    } else {
      const pid = Number(observed.split(":")[0]);
      stale =
        !Number.isInteger(pid) ||
        pid <= 0 ||
        !processIsAlive(pid) ||
        age > 2 * 60 * 60 * 1000;
    }
  } catch {
    stale = age > 5000 || age === Number.POSITIVE_INFINITY;
  }

  if (!stale) return false;
  try {
    const current = readFileSync(lockPidPath(), "utf8").trim();
    if (current !== observed) return acquireLock();
    rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // другой процесс успел удалить lock
  }
  return acquireLock();
}

function releaseLock() {
  try {
    const owner = readFileSync(lockPidPath(), "utf8").trim();
    if (owner === lockOwner) {
      rmSync(lockPath, { recursive: true, force: true });
    }
  } catch {
    // lock уже удалён
  }
}

function supabaseStatus() {
  try {
    return parseEnv(capture("supabase", ["status", "-o", "env"]));
  } catch {
    return null;
  }
}

async function waitForApi(apiUrl, anonKey) {
  const deadline = Date.now() + apiReadinessTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/rest/v1/`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      // стек ещё поднимается
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  if (process.env.TEST_DB_ALLOW_RESET !== "1") {
    console.error(
      [
        "[test-db] Integration tests truncate the local test database.",
        "Refusing to run without explicit opt-in.",
        "Set TEST_DB_ALLOW_RESET=1 to wipe this local database and run integration tests.",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (!acquireLock()) {
    console.error(
      "[test-db] Another integration run is active. Wait for it to finish.",
    );
    process.exit(1);
  }
  process.on("exit", releaseLock);
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));

  if (!dockerIsRunning()) {
    console.error(
      "Docker is not running. Start Docker Desktop, then rerun this command.",
    );
    process.exit(1);
  }

  console.log("[test-db] Starting local Supabase...");
  const startCode = run("supabase", [
    "start",
    "--exclude",
    "realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor",
  ]);
  if (startCode !== 0) {
    console.error("[test-db] supabase start failed.");
    process.exit(startCode);
  }

  const status = supabaseStatus();
  if (!status) {
    console.error("[test-db] Could not read supabase status after start.");
    process.exit(1);
  }

  const apiUrl = status.API_URL ?? "http://127.0.0.1:54321";
  const dbUrl =
    status.DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;

  if (!anonKey || !serviceRoleKey) {
    console.error("[test-db] Missing local Supabase API keys.");
    process.exit(1);
  }

  const apiHost = new URL(apiUrl).hostname;
  const dbHost = new URL(dbUrl).hostname;
  const isLoopback = (host) =>
    host.replace(/^\[|\]$/g, "") === "127.0.0.1" ||
    host.replace(/^\[|\]$/g, "") === "localhost" ||
    host.replace(/^\[|\]$/g, "") === "::1";
  if (!isLoopback(apiHost) || !isLoopback(dbHost)) {
    const safeDb = new URL(dbUrl);
    safeDb.username = safeDb.username ? "***" : "";
    safeDb.password = safeDb.password ? "***" : "";
    console.error(
      `[test-db] Refusing non-local database: ${apiUrl} / ${safeDb.toString()}`,
    );
    process.exit(1);
  }

  if (!(await waitForApi(apiUrl, anonKey))) {
    console.error("[test-db] Local Supabase API did not become ready.");
    process.exit(1);
  }

  const dbContainer =
    process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId()}`;
  if (!containerIsRunning(dbContainer)) {
    console.error(
      `[test-db] Test database container is not running: ${dbContainer}`,
    );
    process.exit(1);
  }

  const fingerprint = migrationsFingerprint();
  const runToken = randomUUID();
  const appliedFingerprint = harnessFingerprint(dbContainer);
  if (appliedFingerprint !== fingerprint) {
    let hasData;
    try {
      hasData = hasApplicationData(dbContainer);
    } catch (error) {
      console.error(`[test-db] ${error.message}`);
      process.exit(1);
    }
    if (hasData && process.env.TEST_DB_ALLOW_RESET !== "1") {
      console.error(
        [
          "[test-db] This local Supabase already contains application data.",
          "Refusing to reset it without explicit opt-in.",
          "Set TEST_DB_ALLOW_RESET=1 to wipe this local database and run integration tests.",
        ].join("\n"),
      );
      process.exit(1);
    }

    console.log("[test-db] Applying schema (supabase db reset)...");
    const resetArgs = ["db", "reset", "--local", "--no-seed"];
    let resetCode = run("supabase", resetArgs, {
      timeout: 6 * 60 * 1000,
    });
    if (resetCode !== 0) {
      console.error("[test-db] supabase db reset failed; retrying once...");
      resetCode = run("supabase", resetArgs, {
        timeout: 6 * 60 * 1000,
      });
    }
    if (resetCode !== 0) {
      console.error("[test-db] supabase db reset failed.");
      process.exit(resetCode);
    }
    if (!(await waitForApi(apiUrl, anonKey))) {
      console.error("[test-db] Local Supabase API did not become ready after reset.");
      process.exit(1);
    }
  } else {
    console.log("[test-db] Schema is current; skipping db reset.");
  }
  // Одноразовый токен прогона: прямой запуск Vitest с устаревшим env не
  // сможет протереть базу, даже если fingerprint совпадает.
  ensureHarnessMarker(dbContainer, fingerprint, runToken);

  const env = {
    ...process.env,
    NODE_ENV: "test",
    TZ: "UTC",
    SUPABASE_URL: apiUrl,
    SUPABASE_DB_URL: dbUrl,
    SUPABASE_DB_CONTAINER: dbContainer,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    TEST_DB_HARNESS: "1",
    TEST_DB_FINGERPRINT: fingerprint,
    TEST_DB_RUN_TOKEN: runToken,
    TELEGRAM_BOT_TOKEN: "000000:test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    TELEGRAM_BOT_USERNAME: "tvoyTrekerBot",
    COACH_CHAT_ID: "999999999",
    PRODAMUS_PAYFORM_BASE_URL: "https://pay.demo.prodamus.ru/payment",
    CLIENT_PORTAL_URL: "https://portal.example.com",
    PUBLIC_URL: "http://127.0.0.1:3001",
  };

  const packageDir = path.join(root, targets[target]);
  const vitestBin = path.join(
    packageDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );

  if (!existsSync(vitestBin)) {
    console.error(`[test-db] vitest not found at ${vitestBin}`);
    process.exit(1);
  }

  const configFile =
    target === "web"
      ? "vitest.integration.config.mts"
      : "vitest.integration.config.ts";
  const code = run(
    vitestBin,
    ["run", "--config", configFile, ...extraArgs],
    { cwd: packageDir, env, timeout: vitestTimeoutMs },
  );
  process.exitCode = code;
}

main().catch((error) => {
  console.error("[test-db] Unexpected error:", error);
  process.exitCode = 1;
});
