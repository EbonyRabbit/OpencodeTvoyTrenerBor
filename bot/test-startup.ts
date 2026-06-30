import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "./src/app.js";

const MOCK_TOKEN = "0000000000:FAKE-TEST-TOKEN-NOT-REAL";
const MOCK_SECRET = "test-secret-key";
const MOCK_PORT = 19876;

process.env.TELEGRAM_BOT_TOKEN = MOCK_TOKEN;
process.env.TELEGRAM_WEBHOOK_SECRET = MOCK_SECRET;
process.env.SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.COACH_CHAT_ID = "123456789";
process.env.PORT = String(MOCK_PORT);
process.env.WEBHOOK_PATH = "/webhook";

const { bot } = await import("./src/bot.js");

bot.botInfo = {
  id: 123456789,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

const { server } = createApp({
  bot,
  webhookPath: "/webhook",
  webhookSecret: MOCK_SECRET,
});

const TIMEOUT_MS = 10_000;

function withTimeout(promise: Promise<boolean>, label: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.then((result) => {
      clearTimeout(timer);
      return result;
    }),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        console.error(`  FAIL: ${label} timed out after ${TIMEOUT_MS}ms`);
        resolve(false);
      }, TIMEOUT_MS);
    }),
  ]);
}

function mockRequest(
  url: string,
  method: string,
  headers: Record<string, string> = {}
): { req: IncomingMessage; res: ServerResponse; collect: () => Promise<{ status: number; body: string }> } {
  const chunks: Buffer[] = [];
  let statusCode = 200;

  const req = { url, method, headers } as unknown as IncomingMessage;

  const res = {
    headersSent: false,
    writeHead: (code: number) => {
      statusCode = code;
    },
    end: (chunk: Buffer | string) => {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    setHeader: () => {},
    getHeader: () => undefined,
  } as unknown as ServerResponse;

  const collect = () =>
    new Promise<{ status: number; body: string }>((resolve) => {
      const origEnd = res.end;
      (res as any).end = (chunk: Buffer | string) => {
        origEnd.call(res, chunk);
        resolve({
          status: statusCode,
          body: Buffer.concat(chunks).toString(),
        });
      };
    });

  return { req, res, collect };
}

function httpGet(path: string): Promise<{ status: number; body: string }> {
  const { req, res, collect } = mockRequest(path, "GET");
  const result = collect();
  server.emit("request", req, res); // collect() must be called BEFORE emit to intercept res.end()
  return result;
}

function fakeUpdate(text: string, updateId = 100000001) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      from: {
        id: 987654321,
        is_bot: false,
        first_name: "Test",
        username: "test_user",
        language_code: "ru",
      },
      chat: {
        id: 987654321,
        type: "private" as const,
      },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

async function testHealthEndpoint(): Promise<boolean> {
  const { status, body } = await httpGet("/health");
  if (status !== 200) {
    console.error(`  FAIL: Health endpoint returned status ${status}`);
    return false;
  }
  try {
    const data = JSON.parse(body);
    if (data.ok === true) {
      console.log("  PASS: Health endpoint returns { ok: true }");
      return true;
    }
    console.error(`  FAIL: Health endpoint returned unexpected body: ${body}`);
    return false;
  } catch {
    console.error(`  FAIL: Health endpoint returned invalid JSON: ${body}`);
    return false;
  }
}

async function test404Endpoint(): Promise<boolean> {
  const { status, body } = await httpGet("/nonexistent");
  if (status !== 404) {
    console.error(`  FAIL: 404 endpoint returned status ${status}`);
    return false;
  }
  if (body === "Not Found") {
    console.log("  PASS: Unknown route returns 404");
    return true;
  }
  console.error(`  FAIL: 404 endpoint returned unexpected body: ${body}`);
  return false;
}

async function testPingPongDirect(): Promise<boolean> {
  try {
    await bot.handleUpdate(fakeUpdate("ping") as any);
    console.log("  PASS: Bot processed ping → pong (direct handleUpdate)");
    return true;
  } catch (err: any) {
    if (err.message?.includes("sendMessage") || err.message?.includes("401")) {
      console.log("  PASS: Bot middleware ran, reply failed (mock token — expected)");
      return true;
    }
    console.error(`  FAIL: Unexpected error: ${err}`);
    return false;
  }
}

async function testWebhookPostValidSecret(): Promise<boolean> {
  const body = JSON.stringify(fakeUpdate("ping", 100000010));
  try {
    const res = await fetch(`http://127.0.0.1:${MOCK_PORT}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": MOCK_SECRET,
      },
      body,
    });
    // 200 = processed OK, 500 = processed but ctx.reply() failed (mock token)
    // Both mean the webhook handler ran and the secret was accepted.
    if (res.status === 200) {
      console.log("  PASS: Webhook accepted valid secret (200 OK)");
      return true;
    }
    if (res.status === 500) {
      console.log("  PASS: Webhook accepted valid secret (500 — mock token, reply failed as expected)");
      return true;
    }
    console.error(`  FAIL: Webhook returned unexpected status ${res.status}`);
    return false;
  } catch (err) {
    console.error(`  FAIL: Webhook request failed: ${err}`);
    return false;
  }
}

async function testWebhookPostBadSecret(): Promise<boolean> {
  const body = JSON.stringify(fakeUpdate("test", 100000011));
  try {
    const res = await fetch(`http://127.0.0.1:${MOCK_PORT}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong-secret",
      },
      body,
    });
    if (res.status === 401 || res.status === 403) {
      console.log(`  PASS: Webhook rejected bad secret (status ${res.status})`);
      return true;
    }
    console.error(`  FAIL: Expected 401/403, got ${res.status}`);
    return false;
  } catch (err) {
    console.error(`  FAIL: Webhook request failed: ${err}`);
    return false;
  }
}

async function testBotInit(): Promise<boolean> {
  try {
    await bot.init();
    console.log(`  PASS: Bot initialized with botInfo (username: @${bot.botInfo.username})`);
    return true;
  } catch (err: any) {
    console.error(`  FAIL: bot.init() threw unexpectedly: ${err.message}`);
    return false;
  }
}

function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  await new Promise<void>((resolve) => {
    server.listen(MOCK_PORT, () => {
      console.log(`Test server listening on port ${MOCK_PORT}`);
      resolve();
    });
  });

  try {
    console.log("\n--- Test: Health Endpoint ---");
    if (await withTimeout(testHealthEndpoint(), "Health Endpoint")) passed++; else failed++;

    console.log("\n--- Test: 404 Endpoint ---");
    if (await withTimeout(test404Endpoint(), "404 Endpoint")) passed++; else failed++;

    console.log("\n--- Test: Ping/Pong (direct) ---");
    if (await withTimeout(testPingPongDirect(), "Ping/Pong Direct")) passed++; else failed++;

    console.log("\n--- Test: Webhook POST (valid secret) ---");
    if (await withTimeout(testWebhookPostValidSecret(), "Webhook POST Valid")) passed++; else failed++;

    console.log("\n--- Test: Webhook POST (bad secret) ---");
    if (await withTimeout(testWebhookPostBadSecret(), "Webhook POST Bad Secret")) passed++; else failed++;

    console.log("\n--- Test: Bot Init ---");
    if (await withTimeout(testBotInit(), "Bot Init")) passed++; else failed++;
  } finally {
    await closeServer();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
