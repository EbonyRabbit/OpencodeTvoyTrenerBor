import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { type Bot, webhookCallback } from "grammy";

export interface AppOptions {
  bot: Bot;
  webhookPath: string;
  webhookSecret: string;
}

export function createApp({ bot, webhookPath, webhookSecret }: AppOptions) {
  const handleUpdate = webhookCallback(bot, "http", {
    secretToken: webhookSecret,
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === webhookPath && req.method === "POST") {
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

  return { server, handleUpdate };
}
