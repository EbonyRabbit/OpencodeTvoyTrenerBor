import "dotenv/config";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { bot } from "./bot.js";
import { startScheduler, stopScheduler } from "./cron/scheduler.js";
import {
  startSubscriptionReconcile,
  stopSubscriptionReconcile,
} from "./cron/subscription-reconcile.js";
import { startupWarnings } from "./startup-warnings.js";
import { syncBotCommands } from "./lib/bot-commands.js";
import { buildWebhookOptions } from "./lib/webhook-config.js";

const { server } = createApp({
  bot,
  webhookPath: config.webhookPath,
  webhookSecret: config.telegram.webhookSecret,
});

server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

async function main(): Promise<void> {
  await bot.init();
  console.log(`Bot initialized: @${bot.botInfo.username}`);

  await syncBotCommands(bot);

  startScheduler(bot);
  startSubscriptionReconcile(bot);

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
      resolve();
    });
  });

  const webhookUrl = config.publicUrl
    ? `${config.publicUrl}${config.webhookPath}`
    : `http://localhost:${config.port}${config.webhookPath}`;

  if (!config.publicUrl) {
    console.warn("Local webhook URL will not work with Telegram. Use ngrok or cloudflare tunnel.");
  }

  for (const warning of startupWarnings(config)) {
    console.warn(warning);
  }

  await bot.api.setWebhook(webhookUrl, buildWebhookOptions(config.telegram.webhookSecret));
  console.log(`Webhook set to: ${webhookUrl}`);
}

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  stopScheduler();
  stopSubscriptionReconcile();
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
