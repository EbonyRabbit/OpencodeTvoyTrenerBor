import { Bot, type Context, BotError, GrammyError, HttpError } from "grammy";
import { config } from "./config.js";

export interface MyContext extends Context {
  clientId?: string;
  language?: "ru" | "en";
}

export const bot = new Bot<MyContext>(config.telegram.botToken);

bot.use(async (ctx, next) => {
  const start = Date.now();
  const updateType = ctx.update.message
    ? "message"
    : ctx.update.callback_query
      ? "callback_query"
      : "other";
  const userId = ctx.from?.id ?? "unknown";

  console.log(`[${new Date().toISOString()}] ${updateType} from ${userId}`);

  try {
    await next();
  } finally {
    console.log(`  ↳ ${updateType} processed in ${Date.now() - start}ms`);
  }
});

bot.on("message:text", (ctx) => {
  console.log(`Received message from ${ctx.from?.id}: ${ctx.message.text}`);
  return ctx.reply("pong");
});

bot.errorBoundary((err: BotError<MyContext>) => {
  const error = err.error;
  console.error(`[ERROR] Update ${err.ctx.update.update_id} failed:`);

  if (error instanceof GrammyError) {
    console.error(`  GrammyError: ${error.description} (code: ${error.error_code})`);
  } else if (error instanceof HttpError) {
    console.error(`  HttpError: ${error.message}`);
  } else {
    console.error(`  Unknown: ${error instanceof Error ? error.stack : error}`);
  }
});
