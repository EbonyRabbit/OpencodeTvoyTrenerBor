import "dotenv/config";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { bot } from "./bot.js";
import { startEveningPollCron } from "./cron/evening-scheduler.js";

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

  startEveningPollCron(bot);

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
