import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Bot, webhookCallback } from "grammy";
import { config } from "./config.js";

const bot = new Bot(config.telegram.botToken);

bot.on("message", (ctx) => {
  console.log(`Received message from ${ctx.from?.id}: ${ctx.message.text}`);
  return ctx.reply("pong");
});

const handleUpdate = webhookCallback(bot, "http", {
  secretToken: config.telegram.webhookSecret,
});

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === config.webhookPath && req.method === "POST") {
    try {
      await handleUpdate(req, res);
    } catch (err) {
      console.error("Webhook handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    }
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

async function main(): Promise<void> {
  await bot.init();
  console.log(`Bot initialized: @${bot.botInfo.username}`);

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
      resolve();
    });
  });

  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const webhookUrl = domain
    ? `https://${domain}${config.webhookPath}`
    : `http://localhost:${config.port}${config.webhookPath}`;

  if (!domain) {
    console.warn("Local webhook URL will not work with Telegram. Use ngrok or cloudflare tunnel.");
  }

  await bot.api.setWebhook(webhookUrl, {
    secret_token: config.telegram.webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  console.log(`Webhook set to: ${webhookUrl}`);
}

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
