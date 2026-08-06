function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in your .env file or shell environment.`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid ${name}: ${raw}. Expected 0-65535.`);
  }
  return parsed;
}

const resolvedPublicUrl: string = (() => {
  const explicit = process.env["PUBLIC_URL"];
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = process.env["RAILWAY_PUBLIC_DOMAIN"];
  if (railway) return `https://${railway}`;
  const render = process.env["RENDER_EXTERNAL_URL"];
  if (render) return render.replace(/\/+$/, "");
  return "";
})();

export const config = {
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookSecret: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
  },
  supabase: {
    url: requireEnv("SUPABASE_URL").replace(/\/+$/, ""),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  },
  coachChatId: BigInt(requireEnv("COACH_CHAT_ID")),
  paymentBaseUrl: optionalEnv("PAYMENT_BASE_URL", "").trim().replace(/\/+$/, ""),
  clientPortalUrl: optionalEnv("CLIENT_PORTAL_URL", "").trim().replace(/\/+$/, ""),
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  port: optionalPort("PORT", 3001),
  webhookPath: optionalEnv("WEBHOOK_PATH", "/webhook"),
  publicUrl: resolvedPublicUrl,
} as const;
